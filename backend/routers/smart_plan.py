import uuid

import cv2
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile

from services.ocr import is_noise, run_ocr

router = APIRouter(prefix="/api", tags=["smart-plan"])

# Higher resolution = more text detail; critical for small room labels
_TARGET_DIM = 2000


def _find_room_polygon(
    img_binary: np.ndarray,
    cx: float,
    cy: float,
) -> list[float] | None:
    """Flood-fill from the text centroid to recover the true room boundary.

    Expects a white-rooms / black-walls binarised image.
    Returns a flat [x1, y1, x2, y2, …] polygon (resized-image coords)
    or None when no valid closed room region is found.
    """
    h, w = img_binary.shape[:2]
    sx = int(np.clip(cx, 1, w - 2))
    sy = int(np.clip(cy, 1, h - 2))

    # Text strokes are black — spiral outward to find the nearest white (room interior) pixel
    if img_binary[sy, sx] != 255:
        found = False
        for radius in range(1, 60):
            for dy in range(-radius, radius + 1):
                for dx in range(-radius, radius + 1):
                    if abs(dx) != radius and abs(dy) != radius:
                        continue  # only check the ring border
                    nx, ny = sx + dx, sy + dy
                    if 0 <= nx < w and 0 <= ny < h and img_binary[ny, nx] == 255:
                        sx, sy = nx, ny
                        found = True
                        break
                if found:
                    break
            if found:
                break
        if not found:
            return None

    # Flood-fill the connected white region (the room interior)
    flood = img_binary.copy()
    mask = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(flood, mask, (sx, sy), 128)

    # Isolate the filled pixels
    filled = np.zeros((h, w), np.uint8)
    filled[flood == 128] = 255

    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    largest = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(largest)

    # Reject: too tiny (noise) or too large (wall gap caused a leak)
    if area < (w * h) * 0.002 or area > (w * h) * 0.55:
        return None

    # Fit a minimum-area rotated rectangle — always 4 corners, ignores wall curves
    rect = cv2.minAreaRect(largest)
    box = cv2.boxPoints(rect)  # shape (4, 2), float32, ordered clockwise
    return box.reshape(-1).astype(float).tolist()


@router.post("/upload-smart-plan")
async def process_smart_plan(file: UploadFile = File(...)):
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="File must be an image.")

    try:
        image_bytes = await file.read()
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(status_code=400, detail="Could not decode image.")

        img_h, img_w = img.shape[:2]

        # Resize for OCR
        scaling_factor = _TARGET_DIM / float(max(img_h, img_w))
        new_w = int(img_w * scaling_factor)
        new_h = int(img_h * scaling_factor)
        img_resized = cv2.resize(img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        # CLAHE grayscale — fed directly to Tesseract (better than pre-binarising;
        # Tesseract's internal binarisation is more adaptive to local contrast)
        gray = cv2.cvtColor(img_resized, cv2.COLOR_BGR2GRAY)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        gray_clahe = clahe.apply(gray)

        # Separate binary image (white rooms, black walls) used only for flood-fill
        _, img_binary = cv2.threshold(gray_clahe, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Handle dark-background floorplans (invert so rooms are always white)
        if np.mean(img_binary) < 128:
            img_binary = cv2.bitwise_not(img_binary)

        # Run multi-pass OCR on the CLAHE grayscale image
        results = run_ocr(gray_clahe)

        spaces = []
        seen: set[str] = set()

        for entry in results:
            text = entry["text"].strip().title()

            if is_noise(text) or text.lower() in seen:
                continue

            seen.add(text.lower())

            # Text centroid in resized-image space
            cx = (entry["x_min"] + entry["x_max"]) / 2.0
            cy = (entry["y_min"] + entry["y_max"]) / 2.0

            # Attempt flood-fill to get the exact room boundary polygon
            poly_resized = _find_room_polygon(img_binary, cx, cy)
            if poly_resized is not None:
                # Scale all vertices back to original image coordinates
                points = [float(v / scaling_factor) for v in poly_resized]
            else:
                # Fallback: padded axis-aligned bounding box
                x_min = entry["x_min"] / scaling_factor
                y_min = entry["y_min"] / scaling_factor
                x_max = entry["x_max"] / scaling_factor
                y_max = entry["y_max"] / scaling_factor
                w, h = x_max - x_min, y_max - y_min
                pad_x = max(40.0, w * 0.5)
                pad_y = max(40.0, h * 1.0)
                points = [
                    float(max(0.0, x_min - pad_x)), float(max(0.0, y_min - pad_y)),
                    float(min(img_w, x_max + pad_x)), float(max(0.0, y_min - pad_y)),
                    float(min(img_w, x_max + pad_x)), float(min(img_h, y_max + pad_y)),
                    float(max(0.0, x_min - pad_x)), float(min(img_h, y_max + pad_y)),
                ]

            spaces.append({
                "id": str(uuid.uuid4()),
                "name": text,
                "type": "Office",
                "department_id": "",
                "points": points,
                "source": "ai",
            })

        return {
            "status": "success",
            "spaces": spaces,
            "image_width": int(img_w),
            "image_height": int(img_h),
            "rooms_detected": len(spaces),
        }

    except HTTPException:
        raise
    except Exception as e:
        print(f"Extraction Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

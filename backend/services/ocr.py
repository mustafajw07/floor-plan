import re

import numpy as np
import pytesseract
from pytesseract import Output

_NOISE_TOKENS = {
    "ft", "m", "sqft", "sq", "sq.ft", "m2", "m²", "dn", "up",
    "scale", "nts", "n.t.s", "north", "east", "west", "south",
    "level", "floor", "plan", "drawing", "revision", "page",
}

# Lower threshold catches faint/small room labels that high-conf mode misses
_MIN_CONFIDENCE = 40

# PSM 11: sparse text — best for scattered floorplan labels
# PSM  6: single uniform text block — catches dense areas PSM 11 may miss
_PSM_MODES = [11, 6]


def is_noise(text: str) -> bool:
    t = text.lower().strip()
    if len(t) < 3:
        return True
    if t in _NOISE_TOKENS:
        return True
    if re.search(r"\d", t) and ("x" in t or "*" in t):
        return True
    if t.replace(".", "").replace(",", "").isdigit():
        return True
    return False


def _overlap_ratio(a: dict, b: dict) -> float:
    """Intersection-over-min-area for two bbox dicts."""
    ix1 = max(a["x_min"], b["x_min"])
    iy1 = max(a["y_min"], b["y_min"])
    ix2 = min(a["x_max"], b["x_max"])
    iy2 = min(a["y_max"], b["y_max"])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    a_area = max((a["x_max"] - a["x_min"]) * (a["y_max"] - a["y_min"]), 1)
    b_area = max((b["x_max"] - b["x_min"]) * (b["y_max"] - b["y_min"]), 1)
    return inter / min(a_area, b_area)


def run_ocr(gray_img: np.ndarray) -> list[dict]:
    """Run Tesseract across multiple PSM modes on a CLAHE grayscale image.

    Accepts a uint8 grayscale array (not pre-binarised — Tesseract’s internal
    binarisation is more adaptive for varied floorplan styles).

    Returns a deduplicated list of dicts:
        { text, x_min, y_min, x_max, y_max }

    Words sharing the same block/paragraph/line are merged into one phrase.
    PSM 11 results take priority; PSM 6 fills gaps.
    """
    all_groups: list[dict] = []

    for psm in _PSM_MODES:
        config = f"--psm {psm} --oem 1"
        data = pytesseract.image_to_data(gray_img, config=config, output_type=Output.DICT)

        line_groups: dict[tuple, dict] = {}
        n = len(data["text"])
        for i in range(n):
            conf = int(data["conf"][i])
            word = data["text"][i].strip()
            if conf < _MIN_CONFIDENCE or not word:
                continue

            key = (data["block_num"][i], data["par_num"][i], data["line_num"][i])
            x, y, w, h = data["left"][i], data["top"][i], data["width"][i], data["height"][i]

            if key not in line_groups:
                line_groups[key] = {
                    "words": [],
                    "x_min": x, "y_min": y,
                    "x_max": x + w, "y_max": y + h,
                }
            else:
                g = line_groups[key]
                g["x_min"] = min(g["x_min"], x)
                g["y_min"] = min(g["y_min"], y)
                g["x_max"] = max(g["x_max"], x + w)
                g["y_max"] = max(g["y_max"], y + h)
            line_groups[key]["words"].append(word)

        for g in line_groups.values():
            all_groups.append({
                "text": " ".join(g["words"]),
                "x_min": float(g["x_min"]),
                "y_min": float(g["y_min"]),
                "x_max": float(g["x_max"]),
                "y_max": float(g["y_max"]),
            })

    # Deduplicate: if two detections overlap significantly keep the first (PSM 11 preferred)
    deduplicated: list[dict] = []
    for r in all_groups:
        if not any(_overlap_ratio(r, kept) > 0.4 for kept in deduplicated):
            deduplicated.append(r)

    return deduplicated

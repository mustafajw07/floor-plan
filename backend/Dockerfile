# ── Build stage ──────────────────────────────────────────────────────────
FROM python:3.11-slim AS base

# System deps: OpenCV runtime libs + Tesseract OCR engine
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxrender1 \
    libxext6 \
    tesseract-ocr \
    tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies first (layer-cached unless requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application source
COPY . .

# ── Runtime ──────────────────────────────────────────────────────────────
EXPOSE 8000

# Run with uvicorn; single worker is fine for a CPU-bound OCR service
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

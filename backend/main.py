"""
BlurryFish – FastAPI Backend
============================
Each pipeline step has its own endpoint, so the frontend (or any client)
can call any step independently, chain them manually, or run everything
at once via the /process SSE endpoint.

Image storage
─────────────
Every step saves its output image and returns a `download_url`.
The storage backend is selected by the STORAGE_BACKEND env var:
  memory     (default) — in-process dict, served via GET /download/{job_id}/{step}
  cloudinary — Cloudinary free tier (set CLOUDINARY_URL env var)
  supabase   — Supabase Storage (set SUPABASE_URL + SUPABASE_KEY env vars)

Individual step endpoints
─────────────────────────
  POST /step/clahe              raw image            → CLAHE-enhanced image
  POST /step/color-correction   image                → color-corrected image
  POST /step/unet-denoising     image                → U-Net denoised image
  POST /step/detection          image                → annotated image + boxes
  POST /step/upscaling          image + boxes (JSON) → crops + upscaled crops

Full pipeline (SSE stream)
──────────────────────────
  POST /process                 raw image → SSE stream of all step results

Storage & job management
─────────────────────────
  GET  /download/{job_id}/{step}  download a saved step image (memory backend)
  DELETE /jobs/{job_id}           delete all images for a job

Utility
───────
  GET  /health                  model availability + list of step endpoints
  GET  /steps                   machine-readable step catalogue
"""

from __future__ import annotations

import uuid

import json
import logging
import os
from contextlib import asynccontextmanager
from typing import AsyncGenerator, List, Optional

import cv2
import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response, StreamingResponse

from pipeline.detection import detect_fish, load_yolo
from pipeline.restoration import (
    apply_clahe,
    apply_color_correction,
    apply_unet_denoising,
    load_unet,
)
from pipeline.upscaling import load_esrgan, upscale_crops
from utils.image_utils import bgr_to_base64, bytes_to_bgr
from utils.storage import StorageBackend, create_storage

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
)
logger = logging.getLogger("blurryfish")

# ---------------------------------------------------------------------------
# Model paths  (place weight files under backend/models/)
# ---------------------------------------------------------------------------

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
MODELS_DIR  = os.path.join(BASE_DIR, "models")

UNET_WEIGHTS   = os.path.join(MODELS_DIR, "denoising_unet.pth")
YOLO_WEIGHTS   = os.path.join(MODELS_DIR, "best.pt")
ESRGAN_WEIGHTS = os.path.join(MODELS_DIR, "RealESRGAN_x4plus.pth")

# ---------------------------------------------------------------------------
# Global model registry + storage (initialised once at startup)
# ---------------------------------------------------------------------------

_models: dict = {}
_storage: Optional[StorageBackend] = None


def _download_models_if_needed() -> None:
    """
    Download model weights from Hugging Face if they are missing locally.
    Uses HF_TOKEN env var (set as a runtime secret in HF Spaces / Render).
    Safe to call in local dev — skips files that already exist.
    """
    hf_token = os.environ.get("HF_TOKEN")
    hf_repo  = os.environ.get("HF_REPO", "Myiper/blurryfish-weights")
    weights  = {
        "denoising_unet.pth":    UNET_WEIGHTS,
        "best.pt":               YOLO_WEIGHTS,
        "RealESRGAN_x4plus.pth": ESRGAN_WEIGHTS,
    }

    missing = {name: dest for name, dest in weights.items() if not os.path.exists(dest)}
    if not missing:
        logger.info("All model weights already present — skipping download.")
        return

    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        logger.warning("huggingface_hub not installed — cannot auto-download weights.")
        return

    os.makedirs(MODELS_DIR, exist_ok=True)
    for filename, dest_path in missing.items():
        logger.info("Downloading %s from %s …", filename, hf_repo)
        try:
            import shutil
            cached = hf_hub_download(repo_id=hf_repo, filename=filename, token=hf_token)
            shutil.copy(cached, dest_path)
            logger.info("  ✓ %s  (%s bytes)", filename, f"{os.path.getsize(dest_path):,}")
        except Exception as exc:
            logger.error("  ✗ Failed to download %s: %s", filename, exc)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load all models and storage backend during startup."""
    global _storage
    _download_models_if_needed()
    logger.info("Loading models…")
    _models["unet"]   = load_unet(UNET_WEIGHTS)
    _models["yolo"]   = load_yolo(YOLO_WEIGHTS)
    _models["esrgan"] = load_esrgan(ESRGAN_WEIGHTS)
    logger.info(
        "Models ready — U-Net: %s | YOLO: %s | ESRGAN: %s",
        "✓" if _models["unet"]   else "✗ (passthrough)",
        "✓" if _models["yolo"]   else "✗ (skip)",
        "✓" if _models["esrgan"] else "✗ (Lanczos fallback)",
    )
    _storage = create_storage()
    logger.info("Storage backend initialised: %s", type(_storage).__name__)
    yield
    _models.clear()
    logger.info("Models unloaded.")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(
    title="BlurryFish API",
    description=(
        "Underwater image restoration, fish detection, and upscaling pipeline. "
        "Every step has its own endpoint so you can call them independently or chain them."
    ),
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_ALLOWED_TYPES  = ("image/jpeg", "image/png", "image/webp")
_MAX_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB


async def _read_image(file: UploadFile) -> np.ndarray:
    """Validate and decode an uploaded image into a BGR numpy array."""
    if file.content_type not in _ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{file.content_type}'. Use JPEG, PNG, or WebP.",
        )
    raw = await file.read()
    if len(raw) > _MAX_SIZE_BYTES:
        raise HTTPException(status_code=413, detail="File too large. Maximum size is 20 MB.")
    try:
        return bytes_to_bgr(raw)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))


def _bgr_to_png_bytes(img_bgr: np.ndarray) -> bytes:
    """Encode a BGR numpy array to PNG bytes."""
    import cv2
    ok, buf = cv2.imencode(".png", img_bgr)
    if not ok:
        raise RuntimeError("Failed to encode image to PNG.")
    return buf.tobytes()


def _save_step(
    job_id: str,
    step: str,
    img_bgr: np.ndarray,
) -> str:
    """
    Save a step's output image to the active storage backend.
    Returns a URL string (absolute for cloud backends, relative for memory).
    """
    png_bytes = _bgr_to_png_bytes(img_bgr)
    return _storage.save(job_id, step, png_bytes, ext="png")


def _new_job_id() -> str:
    return uuid.uuid4().hex


# ---------------------------------------------------------------------------
# Utility endpoints
# ---------------------------------------------------------------------------

@app.get("/health", tags=["Utility"])
async def health_check():
    """Returns model availability, storage backend, and the list of callable step endpoints."""
    return {
        "status": "ok",
        "models": {
            "unet":   _models.get("unet")   is not None,
            "yolo":   _models.get("yolo")   is not None,
            "esrgan": _models.get("esrgan") is not None,
        },
        "storage": type(_storage).__name__,
        "steps": [
            {"id": "clahe",            "endpoint": "POST /step/clahe"},
            {"id": "color_correction", "endpoint": "POST /step/color-correction"},
            {"id": "unet_denoising",   "endpoint": "POST /step/unet-denoising"},
            {"id": "detection",        "endpoint": "POST /step/detection"},
            {"id": "upscaling",        "endpoint": "POST /step/upscaling"},
        ],
    }


# ─────────────────────────────────────────────────────────────────────────────
# Download / job management endpoints
# ─────────────────────────────────────────────────────────────────────────────

@app.get("/download/{job_id}/{step}", tags=["Storage"])
async def download_step_image(job_id: str, step: str):
    """
    Download the saved image for a specific pipeline step.

    - For the **memory** backend this endpoint serves the bytes directly.
    - For **Cloudinary / Supabase** backends the `download_url` in each step
      response is already a direct public URL — this endpoint returns 404
      for those backends (use the URL instead).
    """
    from utils.storage import MemoryBackend
    if not isinstance(_storage, MemoryBackend):
        raise HTTPException(
            status_code=404,
            detail=(
                "This endpoint only serves files from the memory backend. "
                "Use the download_url returned by the step endpoint directly."
            ),
        )
    data = _storage.get(job_id, step)
    if data is None:
        raise HTTPException(
            status_code=404,
            detail=f"No saved image found for job '{job_id}', step '{step}'. "
                   "It may have expired (TTL) or the job_id is incorrect.",
        )
    return Response(
        content=data,
        media_type="image/png",
        headers={
            "Content-Disposition": f'attachment; filename="{job_id}_{step}.png"',
            "Cache-Control": "no-cache",
        },
    )


@app.delete("/jobs/{job_id}", tags=["Storage"], status_code=204)
async def delete_job(job_id: str):
    """
    Delete all saved images for a job.
    Useful to free memory / cloud storage once the client is done.
    """
    _storage.delete(job_id)
    return


@app.get("/steps", tags=["Utility"])
async def list_steps():
    """
    Machine-readable catalogue of every pipeline step.
    Useful for the frontend to dynamically build its UI.
    """
    return [
        {
            "id":          "clahe",
            "stepIndex":   1,
            "subStep":     "1a",
            "label":       "CLAHE Enhancement",
            "description": "Adaptive contrast enhancement in LAB color space",
            "endpoint":    "POST /step/clahe",
            "input":       "Raw underwater image",
            "output":      "CLAHE-enhanced image (base64)",
        },
        {
            "id":          "color_correction",
            "stepIndex":   1,
            "subStep":     "1b",
            "label":       "Color Correction",
            "description": "Per-channel mean normalization to remove underwater color cast",
            "endpoint":    "POST /step/color-correction",
            "input":       "CLAHE-enhanced image",
            "output":      "Color-corrected image (base64)",
        },
        {
            "id":          "unet_denoising",
            "stepIndex":   1,
            "subStep":     "1c",
            "label":       "U-Net Denoising",
            "description": "Custom-trained U-Net removes residual noise and haze",
            "endpoint":    "POST /step/unet-denoising",
            "input":       "Color-corrected image",
            "output":      "Denoised image (base64)",
        },
        {
            "id":          "detection",
            "stepIndex":   2,
            "subStep":     "2",
            "label":       "Fish Detection",
            "description": "YOLOv8 detects fish and returns bounding boxes",
            "endpoint":    "POST /step/detection",
            "input":       "Any image (typically restored)",
            "output":      "Annotated image (base64) + boxes array",
        },
        {
            "id":          "upscaling",
            "stepIndex":   3,
            "subStep":     "3a+3b",
            "label":       "Crop & Upscale",
            "description": "Crops each fish bounding box and upscales 4× via Real-ESRGAN or Lanczos",
            "endpoint":    "POST /step/upscaling",
            "input":       "Restored image + boxes JSON from /step/detection",
            "output":      "crops[] and upscaled[] image arrays (base64)",
        },
    ]


# ---------------------------------------------------------------------------
# ── Step 1a: CLAHE ───────────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.post("/step/clahe", tags=["Pipeline Steps"])
async def step_clahe(file: UploadFile = File(..., description="Raw underwater image")):
    """
    **Step 1a — CLAHE Enhancement**

    Applies Contrast Limited Adaptive Histogram Equalization in LAB color
    space to boost local contrast. The clip limit adapts based on image
    brightness (2.0 for bright images, 1.5 for dark ones).

    Returns the enhanced image as a base64-encoded PNG.
    """
    job_id = _new_job_id()
    img = await _read_image(file)
    logger.info("Step 1a CLAHE — image %dx%d", img.shape[1], img.shape[0])

    result = apply_clahe(img)
    download_url = _save_step(job_id, "clahe", result)

    return JSONResponse({
        "step":         "clahe",
        "stepIndex":    1,
        "subStep":      "1a",
        "label":        "CLAHE Enhancement",
        "description":  "Adaptive contrast enhancement in LAB color space",
        "image":        bgr_to_base64(result),
        "job_id":       job_id,
        "download_url": download_url,
    })


# ---------------------------------------------------------------------------
# ── Step 1b: Color Correction ─────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.post("/step/color-correction", tags=["Pipeline Steps"])
async def step_color_correction(
    file: UploadFile = File(..., description="Image to color-correct (e.g. output of /step/clahe)")
):
    """
    **Step 1b — Color Correction**

    Normalizes each RGB channel so their means are equal, removing the
    blue/green color cast typical in underwater photography.

    Input: any image (ideally CLAHE-processed).
    Returns the color-corrected image as a base64-encoded PNG.
    """
    job_id = _new_job_id()
    img = await _read_image(file)
    logger.info("Step 1b Color correction — image %dx%d", img.shape[1], img.shape[0])

    result = apply_color_correction(img)
    download_url = _save_step(job_id, "color_correction", result)

    return JSONResponse({
        "step":         "color_correction",
        "stepIndex":    1,
        "subStep":      "1b",
        "label":        "Color Correction",
        "description":  "Per-channel mean normalization to remove underwater color cast",
        "image":        bgr_to_base64(result),
        "job_id":       job_id,
        "download_url": download_url,
    })


# ---------------------------------------------------------------------------
# ── Step 1c: U-Net Denoising ──────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.post("/step/unet-denoising", tags=["Pipeline Steps"])
async def step_unet_denoising(
    file: UploadFile = File(..., description="Image to denoise (e.g. output of /step/color-correction)")
):
    """
    **Step 1c — U-Net Denoising**

    Runs the image through the custom-trained U-Net to remove residual
    noise and haze. If the model weights are unavailable the input image
    is returned unchanged.

    Input: any image (ideally color-corrected).
    Returns the denoised image as a base64-encoded PNG.
    """
    job_id = _new_job_id()
    img = await _read_image(file)
    logger.info("Step 1c U-Net denoising — image %dx%d", img.shape[1], img.shape[0])

    model_available = _models.get("unet") is not None
    result = apply_unet_denoising(img, _models.get("unet"))
    download_url = _save_step(job_id, "unet_denoising", result)

    return JSONResponse({
        "step":           "unet_denoising",
        "stepIndex":      1,
        "subStep":        "1c",
        "label":          "U-Net Denoising",
        "description":    "Custom-trained U-Net removes residual noise and haze",
        "image":          bgr_to_base64(result),
        "modelAvailable": model_available,
        "job_id":         job_id,
        "download_url":   download_url,
    })


# ---------------------------------------------------------------------------
# ── Step 2: Fish Detection ────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.post("/step/detection", tags=["Pipeline Steps"])
async def step_detection(
    file: UploadFile = File(..., description="Restored image to run detection on"),
    conf: float = Form(default=0.25, ge=0.01, le=1.0, description="YOLO confidence threshold"),
):
    """
    **Step 2 — Fish Detection**

    Runs YOLOv8 fish detection on the input image.

    Returns:
    - `image`     — annotated image with bounding boxes drawn (base64 PNG)
    - `fishCount` — number of fish detected
    - `boxes`     — array of bounding box objects; pass this directly to
                    `/step/upscaling` as the `boxes` field
    """
    job_id = _new_job_id()
    img = await _read_image(file)
    logger.info("Step 2 Detection — image %dx%d, conf=%.2f", img.shape[1], img.shape[0], conf)

    annotated, boxes = detect_fish(img, _models.get("yolo"), conf_threshold=conf)
    download_url = _save_step(job_id, "detection", annotated)

    return JSONResponse({
        "step":         "detection",
        "stepIndex":    2,
        "subStep":      "2",
        "label":        "Fish Detection",
        "description":  f"YOLOv8 detected {len(boxes)} fish",
        "image":        bgr_to_base64(annotated),
        "fishCount":    len(boxes),
        "boxes":        boxes,
        "job_id":       job_id,
        "download_url": download_url,
    })


# ---------------------------------------------------------------------------
# ── Step 3: Upscaling ─────────────────────────────────────────────────────
# ---------------------------------------------------------------------------

@app.post("/step/upscaling", tags=["Pipeline Steps"])
async def step_upscaling(
    file: UploadFile = File(..., description="Restored image (same one passed to /step/detection)"),
    boxes: str = Form(
        default="[]",
        description=(
            "JSON array of bounding box objects from /step/detection. "
            "Each object must have an 'xyxy' key with [x1,y1,x2,y2] pixel coordinates. "
            "Pass '[]' to auto-detect fish first."
        ),
    ),
    conf: float = Form(default=0.25, ge=0.01, le=1.0, description="YOLO confidence threshold (used only when boxes==[])"),
):
    """
    **Step 3 — Crop & Upscale**

    Crops each fish bounding box region (with 20 px padding) from the
    restored image and upscales it 4× using Real-ESRGAN (if available)
    or Lanczos + sharpening as fallback.

    **`boxes` field**: pass the `boxes` array returned by `/step/detection`
    as a JSON string. If you pass `[]` (or omit it), detection runs
    automatically before upscaling.

    Returns:
    - `crops`    — original-resolution fish crop images (base64 PNG array)
    - `upscaled` — 4× upscaled versions (base64 PNG array)
    - `method`   — `"realesrgan"` or `"lanczos"`
    """
    img = await _read_image(file)

    # Parse boxes
    try:
        parsed_boxes: List[dict] = json.loads(boxes)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="'boxes' is not valid JSON.")

    if not isinstance(parsed_boxes, list):
        raise HTTPException(status_code=422, detail="'boxes' must be a JSON array.")

    # Auto-detect if no boxes were provided
    if len(parsed_boxes) == 0:
        logger.info("Step 3 Upscaling — no boxes provided, running detection first")
        _, parsed_boxes = detect_fish(img, _models.get("yolo"), conf_threshold=conf)
    else:
        # Validate each box has the required 'xyxy' key
        for i, b in enumerate(parsed_boxes):
            if "xyxy" not in b or len(b["xyxy"]) != 4:
                raise HTTPException(
                    status_code=422,
                    detail=f"Box at index {i} is missing 'xyxy' with 4 coordinates.",
                )

    job_id = _new_job_id()
    logger.info(
        "Step 3 Upscaling — image %dx%d, %d boxes, ESRGAN=%s",
        img.shape[1], img.shape[0], len(parsed_boxes),
        "✓" if _models.get("esrgan") else "✗",
    )

    crops, upscaled = upscale_crops(img, parsed_boxes, esrgan_model=_models.get("esrgan"))

    # Save each upscaled crop individually
    crop_urls    = []
    upscaled_urls = []
    for i, (crop, up) in enumerate(zip(crops, upscaled)):
        crop_urls.append(_save_step(job_id, f"crop_{i}", crop))
        upscaled_urls.append(_save_step(job_id, f"upscaled_{i}", up))

    esrgan_available = _models.get("esrgan") is not None
    return JSONResponse({
        "step":          "upscaling",
        "stepIndex":     3,
        "subStep":       "3a+3b",
        "label":         "Crop & Upscale",
        "description":   (
            f"Real-ESRGAN 4× super-resolution on {len(crops)} fish"
            if esrgan_available
            else f"Lanczos 4× upscale + sharpening on {len(crops)} fish"
        ),
        "method":        "realesrgan" if esrgan_available else "lanczos",
        "fishCount":     len(crops),
        "job_id":        job_id,
        "crops":         [bgr_to_base64(c) for c in crops],
        "upscaled":      [bgr_to_base64(u) for u in upscaled],
        "crop_urls":     crop_urls,
        "upscaled_urls": upscaled_urls,
    })


# ---------------------------------------------------------------------------
# Full pipeline — SSE stream
# ---------------------------------------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _done_event() -> str:
    return "data: [DONE]\n\n"


async def _full_pipeline_stream(img_bgr: np.ndarray) -> AsyncGenerator[str, None]:
    """Chains all 5 step functions and streams each result as an SSE event."""
    job_id = _new_job_id()

    # 1a CLAHE
    clahe_img = apply_clahe(img_bgr)
    yield _sse({"step": "clahe", "stepIndex": 1, "subStep": "1a",
                "label": "CLAHE Enhancement",
                "description": "Adaptive contrast enhancement in LAB color space",
                "image": bgr_to_base64(clahe_img),
                "job_id": job_id,
                "download_url": _save_step(job_id, "clahe", clahe_img)})

    # 1b Color correction
    color_img = apply_color_correction(clahe_img)
    yield _sse({"step": "color_correction", "stepIndex": 1, "subStep": "1b",
                "label": "Color Correction",
                "description": "Per-channel mean normalization to remove underwater color cast",
                "image": bgr_to_base64(color_img),
                "job_id": job_id,
                "download_url": _save_step(job_id, "color_correction", color_img)})

    # 1c U-Net denoising
    denoised_img = apply_unet_denoising(color_img, _models.get("unet"))
    yield _sse({"step": "unet_denoising", "stepIndex": 1, "subStep": "1c",
                "label": "U-Net Denoising",
                "description": "Custom-trained U-Net removes residual noise and haze",
                "image": bgr_to_base64(denoised_img),
                "modelAvailable": _models.get("unet") is not None,
                "job_id": job_id,
                "download_url": _save_step(job_id, "unet_denoising", denoised_img)})

    # 2 Detection
    detection_img, boxes = detect_fish(denoised_img, _models.get("yolo"))
    yield _sse({"step": "detection", "stepIndex": 2, "subStep": "2",
                "label": "Fish Detection",
                "description": f"YOLOv8 detected {len(boxes)} fish",
                "image": bgr_to_base64(detection_img),
                "fishCount": len(boxes),
                "boxes": boxes,
                "job_id": job_id,
                "download_url": _save_step(job_id, "detection", detection_img)})

    # 3 Upscaling
    crops, upscaled = upscale_crops(denoised_img, boxes, esrgan_model=_models.get("esrgan"))
    esrgan_available = _models.get("esrgan") is not None

    crop_urls     = [_save_step(job_id, f"crop_{i}",     c) for i, c in enumerate(crops)]
    upscaled_urls = [_save_step(job_id, f"upscaled_{i}", u) for i, u in enumerate(upscaled)]

    yield _sse({"step": "crops", "stepIndex": 3, "subStep": "3a",
                "label": "Fish Crops",
                "description": f"Cropped {len(crops)} detected fish regions",
                "images": [bgr_to_base64(c) for c in crops],
                "job_id": job_id,
                "download_urls": crop_urls})

    yield _sse({"step": "upscaled", "stepIndex": 3, "subStep": "3b",
                "label": "4× Upscaling",
                "description": ("Real-ESRGAN 4× super-resolution"
                                if esrgan_available else "Lanczos 4× upscale + sharpening"),
                "method": "realesrgan" if esrgan_available else "lanczos",
                "images": [bgr_to_base64(u) for u in upscaled],
                "job_id": job_id,
                "download_urls": upscaled_urls})

    # 4 Final
    final_url = _save_step(job_id, "final", denoised_img)
    yield _sse({"step": "final", "stepIndex": 4, "subStep": "4",
                "label": "Final Output",
                "description": "Fully restored image ready for use",
                "image": bgr_to_base64(denoised_img),
                "fishCount": len(boxes),
                "upscaledCount": len(upscaled),
                "job_id": job_id,
                "download_url": final_url})

    yield _done_event()


@app.post("/process", tags=["Full Pipeline"])
async def process_image(file: UploadFile = File(...)):
    """
    **Full Pipeline — SSE Stream**

    Runs all five steps in sequence and streams each result as a
    Server-Sent Event. Use this when you want to show every step
    progressively in the UI.

    To run only a specific step, use the individual `/step/*` endpoints.
    """
    img_bgr = await _read_image(file)
    logger.info("/process — image %dx%d", img_bgr.shape[1], img_bgr.shape[0])

    return StreamingResponse(
        _full_pipeline_stream(img_bgr),
        media_type="text/event-stream",
        headers={
            "Cache-Control":     "no-cache",
            "X-Accel-Buffering": "no",
        },
    )

"""
Step 3 – Upscaling
  3a. Crop each detected fish region (with padding)
  3b. Upscale 4× using Real-ESRGAN (if available) or Lanczos + sharpening fallback

Real-ESRGAN is optional — if basicsr / realesrgan are not installed or the
weight file is missing, the module gracefully falls back to Lanczos interpolation
followed by an unsharp-mask sharpening kernel.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Optional Real-ESRGAN import
# ---------------------------------------------------------------------------

try:
    import torchvision.transforms.functional as _F_tv
    import sys
    import types

    # Compatibility patch required for some torchvision versions
    if "torchvision.transforms.functional_tensor" not in sys.modules:
        _fake = types.ModuleType("torchvision.transforms.functional_tensor")
        _fake.rgb_to_grayscale = _F_tv.rgb_to_grayscale
        sys.modules["torchvision.transforms.functional_tensor"] = _fake

    from basicsr.archs.rrdbnet_arch import RRDBNet  # type: ignore
    from realesrgan import RealESRGANer  # type: ignore

    _ESRGAN_AVAILABLE = True
except ImportError:
    _ESRGAN_AVAILABLE = False
    logger.info("Real-ESRGAN not available — Lanczos fallback will be used.")


# ---------------------------------------------------------------------------
# Model loader
# ---------------------------------------------------------------------------

def load_esrgan(weights_path: str) -> Optional[Any]:
    """
    Load the Real-ESRGAN upsampler.
    Returns None if the library or weights are unavailable.
    """
    if not _ESRGAN_AVAILABLE:
        return None
    if not os.path.exists(weights_path):
        logger.warning(
            "Real-ESRGAN weights not found at %s — Lanczos fallback will be used.", weights_path
        )
        return None
    try:
        rrdb = RRDBNet(
            num_in_ch=3, num_out_ch=3, num_feat=64,
            num_block=23, num_grow_ch=32, scale=4
        )
        upsampler = RealESRGANer(
            scale=4,
            model_path=weights_path,
            model=rrdb,
            half=False,  # half-precision requires CUDA
        )
        logger.info("Real-ESRGAN loaded from %s", weights_path)
        return upsampler
    except Exception as exc:
        logger.error("Failed to load Real-ESRGAN: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Upscaling helpers
# ---------------------------------------------------------------------------

_SHARPEN_KERNEL = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)


def _lanczos_upscale(crop_bgr: np.ndarray, scale: int = 4) -> np.ndarray:
    """Lanczos 4× upscale followed by unsharp-mask sharpening."""
    h, w = crop_bgr.shape[:2]
    upscaled = cv2.resize(crop_bgr, (w * scale, h * scale), interpolation=cv2.INTER_LANCZOS4)
    return cv2.filter2D(upscaled, -1, _SHARPEN_KERNEL)


def _esrgan_upscale(crop_bgr: np.ndarray, upsampler: Any) -> np.ndarray:
    """Real-ESRGAN 4× upscale (RGB in, RGB out → convert back to BGR)."""
    crop_rgb = cv2.cvtColor(crop_bgr, cv2.COLOR_BGR2RGB)
    upscaled_rgb, _ = upsampler.enhance(crop_rgb, outscale=4)
    return cv2.cvtColor(upscaled_rgb, cv2.COLOR_RGB2BGR)


# ---------------------------------------------------------------------------
# Step 3 – Crop + Upscale
# ---------------------------------------------------------------------------

def upscale_crops(
    img_bgr: np.ndarray,
    boxes: List[Dict],
    esrgan_model: Optional[Any] = None,
    pad: int = 20,
) -> Tuple[List[np.ndarray], List[np.ndarray]]:
    """
    Crop each detected fish region and upscale it.

    Args:
        img_bgr      – the restored image (BGR) from Step 1
        boxes        – list of bounding box dicts from Step 2
        esrgan_model – optional Real-ESRGAN upsampler
        pad          – pixel padding around each bounding box crop

    Returns:
        crops    – list of original-resolution crops (BGR)
        upscaled – list of 4× upscaled crops (BGR)
    """
    h, w = img_bgr.shape[:2]
    crops: List[np.ndarray] = []
    upscaled: List[np.ndarray] = []

    for box in boxes:
        x1, y1, x2, y2 = [int(v) for v in box["xyxy"]]
        # Apply padding, clamped to image bounds
        x1 = max(0, x1 - pad)
        y1 = max(0, y1 - pad)
        x2 = min(w, x2 + pad)
        y2 = min(h, y2 + pad)

        if x2 <= x1 or y2 <= y1:
            continue

        crop = img_bgr[y1:y2, x1:x2]
        crops.append(crop)

        if esrgan_model is not None:
            try:
                up = _esrgan_upscale(crop, esrgan_model)
            except Exception as exc:
                logger.warning("Real-ESRGAN failed on crop; falling back. %s", exc)
                up = _lanczos_upscale(crop)
        else:
            up = _lanczos_upscale(crop)

        upscaled.append(up)

    return crops, upscaled

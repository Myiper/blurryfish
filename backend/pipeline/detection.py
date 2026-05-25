"""
Step 2 – Fish Detection
  Uses a YOLOv8 model (custom trained or fallback to yolov8s.pt).
  Returns the annotated image and a list of bounding box dicts.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

logger = logging.getLogger(__name__)

# We import ultralytics lazily to avoid import-time errors if not installed.
try:
    from ultralytics import YOLO as _YOLO  # type: ignore

    _ULTRALYTICS_AVAILABLE = True
except ImportError:
    _ULTRALYTICS_AVAILABLE = False
    logger.warning("ultralytics not installed — fish detection will be skipped.")


# ---------------------------------------------------------------------------
# Model loader
# ---------------------------------------------------------------------------

def load_yolo(weights_path: str) -> Optional[Any]:
    """
    Load the YOLO model.
    Falls back to yolov8s.pt (auto-downloaded) if the custom weights are missing.
    Returns None if ultralytics is not installed.
    """
    if not _ULTRALYTICS_AVAILABLE:
        return None

    if os.path.exists(weights_path):
        logger.info("Loading custom YOLO weights from %s", weights_path)
        model = _YOLO(weights_path)
    else:
        logger.warning(
            "Custom YOLO weights not found at %s — falling back to yolov8s.pt.", weights_path
        )
        model = _YOLO("yolov8s.pt")  # downloads on first run

    return model


# ---------------------------------------------------------------------------
# Step 2 – Detection
# ---------------------------------------------------------------------------

def detect_fish(
    img_bgr: np.ndarray,
    model: Optional[Any],
    conf_threshold: float = 0.25,
) -> Tuple[np.ndarray, List[Dict]]:
    """
    Run fish detection on a BGR image.

    Returns:
        annotated_bgr  – image with bounding boxes drawn
        boxes          – list of dicts with keys: xyxy, conf, cls
    """
    if model is None:
        logger.debug("YOLO model not loaded; skipping detection.")
        return img_bgr.copy(), []

    results = model(img_bgr, conf=conf_threshold, verbose=False)
    result = results[0]

    boxes: List[Dict] = []
    for box in result.boxes:
        xyxy = box.xyxy[0].cpu().numpy().tolist()
        conf = float(box.conf[0].cpu().numpy())
        cls = int(box.cls[0].cpu().numpy())
        boxes.append({"xyxy": xyxy, "conf": conf, "cls": cls})

    # Use ultralytics' built-in plotting for the annotated image
    annotated_rgb = result.plot()  # returns RGB
    annotated_bgr = cv2.cvtColor(annotated_rgb, cv2.COLOR_RGB2BGR)

    logger.info("Detected %d fish (conf ≥ %.2f)", len(boxes), conf_threshold)
    return annotated_bgr, boxes

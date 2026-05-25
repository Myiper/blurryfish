import base64
import io
import cv2
import numpy as np
from PIL import Image


def bgr_to_base64(img_bgr: np.ndarray) -> str:
    """Convert a BGR numpy array to a base64-encoded PNG string."""
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    pil_img = Image.fromarray(img_rgb)
    return pil_to_base64(pil_img)


def pil_to_base64(img: Image.Image) -> str:
    """Convert a PIL Image to a base64-encoded PNG string."""
    buffer = io.BytesIO()
    img.save(buffer, format="PNG")
    buffer.seek(0)
    return base64.b64encode(buffer.read()).decode("utf-8")


def bytes_to_bgr(file_bytes: bytes) -> np.ndarray:
    """Decode raw image bytes into a BGR numpy array."""
    arr = np.frombuffer(file_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Could not decode image. Make sure it is a valid JPEG or PNG.")
    return img


def draw_detections(img_bgr: np.ndarray, boxes) -> np.ndarray:
    """Draw bounding boxes on a copy of the image."""
    annotated = img_bgr.copy()
    for box in boxes:
        x1, y1, x2, y2 = map(int, box["xyxy"])
        conf = box["conf"]
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 255, 80), 2)
        label = f"fish {conf:.2f}"
        cv2.putText(
            annotated,
            label,
            (x1, max(y1 - 8, 0)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (0, 255, 80),
            2,
        )
    return annotated

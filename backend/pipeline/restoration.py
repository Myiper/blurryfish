"""
Step 1 – Underwater Image Restoration
  1a. CLAHE (Contrast Limited Adaptive Histogram Equalization)
  1b. Color Correction (per-channel mean normalization)
  1c. U-Net Denoising (custom trained model)
"""

from __future__ import annotations

import logging
import os
from typing import Optional

import cv2
import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.transforms as transforms
from PIL import Image

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# U-Net Architecture (must match the trained model exactly)
# ---------------------------------------------------------------------------

class _ConvBlock(nn.Module):
    def __init__(self, in_c: int, out_c: int):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_c, out_c, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
            nn.Conv2d(out_c, out_c, kernel_size=3, padding=1),
            nn.ReLU(inplace=True),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class UNet(nn.Module):
    def __init__(self, in_channels: int = 3, out_channels: int = 3):
        super().__init__()
        self.encoder1 = _ConvBlock(in_channels, 64)
        self.encoder2 = _ConvBlock(64, 128)
        self.encoder3 = _ConvBlock(128, 256)
        self.encoder4 = _ConvBlock(256, 512)
        self.pool = nn.MaxPool2d(2, 2)
        self.bottleneck = _ConvBlock(512, 1024)
        self.upconv4 = nn.ConvTranspose2d(1024, 512, kernel_size=2, stride=2)
        self.decoder4 = _ConvBlock(1024, 512)
        self.upconv3 = nn.ConvTranspose2d(512, 256, kernel_size=2, stride=2)
        self.decoder3 = _ConvBlock(512, 256)
        self.upconv2 = nn.ConvTranspose2d(256, 128, kernel_size=2, stride=2)
        self.decoder2 = _ConvBlock(256, 128)
        self.upconv1 = nn.ConvTranspose2d(128, 64, kernel_size=2, stride=2)
        self.decoder1 = _ConvBlock(128, 64)
        self.final_conv = nn.Conv2d(64, out_channels, kernel_size=1)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        enc1 = self.encoder1(x)
        enc2 = self.encoder2(self.pool(enc1))
        enc3 = self.encoder3(self.pool(enc2))
        enc4 = self.encoder4(self.pool(enc3))
        bottleneck = self.bottleneck(self.pool(enc4))
        dec4 = self.decoder4(torch.cat([self.upconv4(bottleneck), enc4], dim=1))
        dec3 = self.decoder3(torch.cat([self.upconv3(dec4), enc3], dim=1))
        dec2 = self.decoder2(torch.cat([self.upconv2(dec3), enc2], dim=1))
        dec1 = self.decoder1(torch.cat([self.upconv1(dec2), enc1], dim=1))
        return self.final_conv(dec1)


# ---------------------------------------------------------------------------
# Model loader (called once at startup)
# ---------------------------------------------------------------------------

def load_unet(weights_path: str) -> Optional[UNet]:
    """Load the U-Net weights. Returns None if the file doesn't exist."""
    if not os.path.exists(weights_path):
        logger.warning(
            "U-Net weights not found at %s — denoising step will be skipped.", weights_path
        )
        return None
    try:
        device = torch.device("cpu")
        model = UNet()
        state = torch.load(weights_path, map_location=device)

        # Remap legacy flat keys (encoder1.0.weight) → block-namespaced keys
        # (encoder1.block.0.weight) to handle weights saved without _ConvBlock wrapper.
        _BLOCK_MODULES = {
            "encoder1", "encoder2", "encoder3", "encoder4",
            "bottleneck",
            "decoder4", "decoder3", "decoder2", "decoder1",
        }
        new_state = {}
        for k, v in state.items():
            parts = k.split(".")
            if len(parts) >= 3 and parts[0] in _BLOCK_MODULES and parts[1].isdigit():
                # e.g. ["encoder1", "0", "weight"] → "encoder1.block.0.weight"
                new_key = parts[0] + ".block." + ".".join(parts[1:])
                new_state[new_key] = v
            else:
                new_state[k] = v
        
        model.load_state_dict(new_state)
        model.eval()
        logger.info("U-Net loaded from %s", weights_path)
        return model
    except Exception as exc:
        logger.error("Failed to load U-Net: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Step 1a – CLAHE
# ---------------------------------------------------------------------------

def apply_clahe(img_bgr: np.ndarray) -> np.ndarray:
    """Apply CLAHE in LAB color space with adaptive clip limit."""
    lab = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    mean_brightness = float(np.mean(l))
    clip_limit = 2.0 if mean_brightness > 100 else 1.5
    clahe = cv2.createCLAHE(clipLimit=clip_limit, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l)
    lab_enhanced = cv2.merge([l_enhanced, a, b])
    return cv2.cvtColor(lab_enhanced, cv2.COLOR_LAB2BGR)


# ---------------------------------------------------------------------------
# Step 1b – Color Correction
# ---------------------------------------------------------------------------

def apply_color_correction(img_bgr: np.ndarray) -> np.ndarray:
    """Per-channel mean normalization to remove color cast."""
    b, g, r = cv2.split(img_bgr.astype(np.float32))
    r_mean, g_mean, b_mean = float(np.mean(r)), float(np.mean(g)), float(np.mean(b))
    # Guard against near-zero channels
    if r_mean < 1e-6 or g_mean < 1e-6 or b_mean < 1e-6:
        return img_bgr
    overall_mean = (r_mean + g_mean + b_mean) / 3.0
    r = np.clip(r * (overall_mean / r_mean), 0, 255)
    g = np.clip(g * (overall_mean / g_mean), 0, 255)
    b = np.clip(b * (overall_mean / b_mean), 0, 255)
    return cv2.merge([b.astype(np.uint8), g.astype(np.uint8), r.astype(np.uint8)])


# ---------------------------------------------------------------------------
# Step 1c – U-Net Denoising
# ---------------------------------------------------------------------------

def apply_unet_denoising(img_bgr: np.ndarray, model: Optional[UNet]) -> np.ndarray:
    """
    Run the U-Net denoiser.
    If no model is available, returns the input unchanged (passthrough).
    """
    if model is None:
        logger.debug("U-Net model not loaded; skipping denoising.")
        return img_bgr

    device = torch.device("cpu")
    pil_img = Image.fromarray(cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB))
    original_size = pil_img.size  # (W, H)

    to_tensor = transforms.ToTensor()
    img_tensor = to_tensor(pil_img).unsqueeze(0).to(device)  # [1, 3, H, W]

    # Pad to multiple of 16
    _, _, h, w = img_tensor.shape
    pad_h = (16 - h % 16) % 16
    pad_w = (16 - w % 16) % 16
    padded = F.pad(img_tensor, (0, pad_w, 0, pad_h))

    with torch.no_grad():
        output_padded = model(padded)

    # Crop back to original size and convert
    output = output_padded[:, :, :h, :w].squeeze(0)
    output_img = transforms.ToPILImage()(torch.clamp(output.cpu(), 0, 1))
    output_img = output_img.resize(original_size, Image.LANCZOS)

    return cv2.cvtColor(np.array(output_img), cv2.COLOR_RGB2BGR)

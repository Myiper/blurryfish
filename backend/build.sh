#!/usr/bin/env bash
set -e   # exit immediately on any error

echo "=== Installing Python dependencies ==="
pip install -r requirements.txt huggingface_hub

echo "=== Downloading model weights from Hugging Face ==="
python - <<'PYEOF'
import os, shutil, sys
from huggingface_hub import hf_hub_download

token = os.environ.get("HF_TOKEN")
repo  = "Myiper/blurryfish-weights"

# Render's working directory when rootDir=backend is /opt/render/project/src
script_dir = os.path.dirname(os.path.abspath(__file__))
dest = os.path.join(script_dir, "models")
os.makedirs(dest, exist_ok=True)

print(f"Model destination: {dest}", flush=True)

files = ["denoising_unet.pth", "best.pt", "RealESRGAN_x4plus.pth"]
for f in files:
    print(f"Downloading {f} ...", flush=True)
    try:
        cached = hf_hub_download(repo_id=repo, filename=f, token=token)
        out    = os.path.join(dest, f)
        shutil.copy(cached, out)
        size   = os.path.getsize(out)
        print(f"  OK  ->  {out}  ({size:,} bytes)", flush=True)
    except Exception as e:
        print(f"  FAIL: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

print("=== All models downloaded successfully ===", flush=True)
PYEOF

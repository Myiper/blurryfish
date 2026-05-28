FROM python:3.11-slim

# Install system dependencies for OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Step 1 — Install main dependencies (includes torch CPU)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt huggingface_hub

# Step 2 — Install Real-ESRGAN stack AFTER torch is present
# basicsr uses a legacy setup.py that tries to resolve CUDA packages;
# --no-build-isolation makes it reuse the already-installed torch/torchvision
# instead of pulling a new CUDA build, avoiding the version conflict.
RUN pip install --no-cache-dir --no-build-isolation basicsr==1.4.2
RUN pip install --no-cache-dir facexlib==0.3.0 gfpgan==1.3.8 realesrgan==0.3.0

# Copy application code
COPY . .

# Models are downloaded at startup (HF_TOKEN is a runtime secret, not a build secret)
# HF Spaces requires port 7860
ENV PORT=7860
EXPOSE 7860

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860", "--workers", "1"]

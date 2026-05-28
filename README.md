# 🐟 blurryfish

A fish detection and image enhancement pipeline — YOLOv8 detection + denoising + Real-ESRGAN upscaling, served via a FastAPI backend and a React/Vite frontend.

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Python | 3.11+ | [python.org](https://www.python.org/downloads/) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org/) |
| npm | 9+ | Comes with Node.js |
| Git | any | [git-scm.com](https://git-scm.com/) |
| HuggingFace account | — | Needed to download model weights |

---

## 1 — Clone the repo

```bash
git clone https://github.com/Myiper/blurryfish.git
cd blurryfish
```

---

## 2 — Backend setup

### 2.1 Create a virtual environment

```bash
cd backend

# Windows
python -m venv venv
venv\Scripts\activate

# macOS / Linux
python -m venv venv
source venv/bin/activate
```

### 2.2 Install Python dependencies

```bash
pip install -r requirements.txt
```

> **Note:** PyTorch is installed as a CPU-only build by default (smaller download). If you have a CUDA GPU, edit `requirements.txt` and replace the `torch` / `torchvision` lines with the appropriate CUDA wheels from [pytorch.org](https://pytorch.org/get-started/locally/).

### 2.3 Download model weights from HuggingFace

The backend requires three model files that are stored in the private HuggingFace repo `Myiper/blurryfish-weights`. You need a HuggingFace token with read access.

1. Generate a token at <https://huggingface.co/settings/tokens> (select **Read** scope).
2. Run the download script:

```bash
# Windows (PowerShell)
$env:HF_TOKEN="hf_your_token_here"
bash build.sh          # or: python build.sh if bash is not available

# macOS / Linux
HF_TOKEN="hf_your_token_here" bash build.sh
```

This places `denoising_unet.pth`, `best.pt`, and `RealESRGAN_x4plus.pth` into `backend/models/`.

### 2.4 Start the backend server

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

The API will be available at **http://localhost:8000**.  
Interactive docs: **http://localhost:8000/docs**  
Health check: **http://localhost:8000/health**

---

## 3 — Frontend setup

Open a **new terminal** (keep the backend running).

```bash
cd frontend
```

### 3.1 Install Node dependencies

```bash
npm install
```

### 3.2 Configure environment variables

```bash
# Windows (PowerShell)
Copy-Item .env.example .env.local

# macOS / Linux
cp .env.example .env.local
```

Open `.env.local` and set the backend URL to your local server:

```env
VITE_API_URL=http://localhost:8000
```

### 3.3 Start the frontend dev server

```bash
npm run dev
```

The app will be available at **http://localhost:5173** (Vite default).

---

## 4 — Running both services together (quick reference)

```
Terminal 1 — Backend
  cd backend && venv\Scripts\activate && uvicorn main:app --port 8000 --reload

Terminal 2 — Frontend
  cd frontend && npm run dev
```

Then open **http://localhost:5173** in your browser.

---

## Project structure

```
blurryfish/
├── backend/
│   ├── main.py              # FastAPI app & all endpoints
│   ├── requirements.txt     # Python dependencies
│   ├── build.sh             # Model weight download script
│   ├── yolov8s.pt           # Base YOLOv8 weights (included)
│   ├── models/              # Downloaded model weights (git-ignored)
│   ├── pipeline/            # Image processing pipeline modules
│   └── utils/               # Utility helpers
├── frontend/
│   ├── src/                 # React + TypeScript source
│   ├── public/              # Static assets
│   ├── .env.example         # Environment variable template
│   └── vite.config.ts       # Vite configuration
└── render.yaml              # Render.com deployment config
```

---

## Storage backends (optional)

By default the backend uses **in-memory** storage (images are lost on restart). For persistent storage, uncomment one of the following in `requirements.txt` and set the corresponding env variable:

| Backend | Package | Environment variable |
|---------|---------|----------------------|
| Cloudinary | `cloudinary==1.41.0` | `CLOUDINARY_URL` |
| Supabase | `supabase==2.9.1` | `SUPABASE_URL` + `SUPABASE_KEY` |

Set `STORAGE_BACKEND=cloudinary` or `STORAGE_BACKEND=supabase` before starting the server.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `HF_TOKEN not set` error during model download | Export the `HF_TOKEN` env variable as shown in step 2.3 |
| `models/` files missing | Re-run `build.sh` with a valid `HF_TOKEN` |
| CORS errors in browser | Make sure `VITE_API_URL` in `.env.local` points to `http://localhost:8000` (no trailing slash) |
| Port 8000 already in use | Change `--port 8000` to another port and update `.env.local` accordingly |
| `torch` import slow or OOM | You are using the CPU build; reduce image size or upgrade to a GPU build |

import type {
  ClaheResult,
  ColorCorrectionResult,
  UnetDenoisingResult,
  DetectionResult,
  UpscalingResult,
  HealthStatus,
  SSEEvent,
  BoundingBox,
} from './types';

// ─── Configuration ────────────────────────────────────────────────────────────

// Set VITE_API_URL in your .env.local (dev) or Vercel environment variables (prod)
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formData(file: File, extra?: Record<string, string>): FormData {
  const fd = new FormData();
  fd.append('file', file);
  if (extra) {
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  }
  return fd;
}

async function post<T>(path: string, body: FormData): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', body });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Health ────────────────────────────────────────────────────────────────────

export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch(`${API_BASE}/health`);
  if (!res.ok) throw new Error('Backend unreachable');
  return res.json();
}

// ─── Individual steps ─────────────────────────────────────────────────────────

export async function runClahe(file: File): Promise<ClaheResult> {
  return post('/step/clahe', formData(file));
}

export async function runColorCorrection(file: File): Promise<ColorCorrectionResult> {
  return post('/step/color-correction', formData(file));
}

export async function runUnetDenoising(file: File): Promise<UnetDenoisingResult> {
  return post('/step/unet-denoising', formData(file));
}

export async function runDetection(
  file: File,
  conf = 0.25
): Promise<DetectionResult> {
  return post('/step/detection', formData(file, { conf: String(conf) }));
}

export async function runUpscaling(
  file: File,
  boxes: BoundingBox[] = [],
  conf = 0.25
): Promise<UpscalingResult> {
  return post(
    '/step/upscaling',
    formData(file, { boxes: JSON.stringify(boxes), conf: String(conf) })
  );
}

// ─── Full pipeline via SSE ────────────────────────────────────────────────────

export async function* runFullPipeline(
  file: File,
  signal?: AbortSignal
): AsyncGenerator<SSEEvent> {
  const fd = new FormData();
  fd.append('file', file);

  const res = await fetch(`${API_BASE}/process`, {
    method: 'POST',
    body: fd,
    signal,
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(detail?.detail ?? `HTTP ${res.status}`);
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const raw = trimmed.slice(5).trim();
      if (raw === '[DONE]') return;
      try {
        yield JSON.parse(raw) as SSEEvent;
      } catch {
        // ignore malformed lines
      }
    }
  }
}

// ─── Download helper ──────────────────────────────────────────────────────────

/**
 * Download a base64 image or a URL to the user's disk.
 * @param src   Either a base64 data URI or a full URL.
 * @param name  Suggested filename (without extension).
 */
export function downloadImage(src: string, name: string): void {
  const a = document.createElement('a');
  if (src.startsWith('data:') || src.startsWith('http')) {
    a.href = src;
  } else {
    // relative download_url from memory backend
    a.href = `${API_BASE}${src}`;
  }
  a.download = `${name}.png`;
  a.target = '_blank';
  a.rel = 'noopener';
  a.click();
}

/** Convert a base64 string to a data URI */
export function b64ToDataUri(b64: string): string {
  if (b64.startsWith('data:')) return b64;
  return `data:image/png;base64,${b64}`;
}

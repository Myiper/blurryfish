import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchHealth,
  runClahe,
  runColorCorrection,
  runUnetDenoising,
  runDetection,
  runUpscaling,
  runFullPipeline,
  b64ToFile,
} from './api';
import type {
  HealthStatus,
  ClaheResult,
  ColorCorrectionResult,
  UnetDenoisingResult,
  DetectionResult,
  UpscalingResult,
  BoundingBox,
} from './types';
import UploadZone from './components/UploadZone';
import HealthBadge from './components/HealthBadge';
import ProgressBar from './components/ProgressBar';
import StepCard from './components/StepCard';
import StepCardUpscaling from './components/StepCardUpscaling';
import FishAnnotator from './components/FishAnnotator';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Results {
  clahe?: ClaheResult;
  color_correction?: ColorCorrectionResult;
  unet_denoising?: UnetDenoisingResult;
  detection?: DetectionResult;
  upscaling?: UpscalingResult;
  // From SSE crops/upscaled sub-events
  crops?: string[];
  upscaled_images?: string[];
  crop_urls?: string[];
  upscaled_urls?: string[];
  upscale_method?: 'realesrgan' | 'lanczos';
  upscale_fish_count?: number;
}

interface StepLoadingMap {
  clahe: boolean;
  color_correction: boolean;
  unet_denoising: boolean;
  detection: boolean;
  upscaling: boolean;
  all: boolean;
}

// ─── Step catalog (mirrors GET /steps) ───────────────────────────────────────

const STEPS = [
  {
    id: 'clahe' as const,
    stepIndex: 1,
    subStep: '1a',
    label: 'CLAHE Enhancement',
    description: 'Adaptive contrast enhancement in LAB color space',
    inputHint: 'Raw underwater image',
  },
  {
    id: 'color_correction' as const,
    stepIndex: 1,
    subStep: '1b',
    label: 'Color Correction',
    description: 'Per-channel mean normalization to remove underwater color cast',
    inputHint: 'CLAHE-enhanced image',
  },
  {
    id: 'unet_denoising' as const,
    stepIndex: 1,
    subStep: '1c',
    label: 'U-Net Denoising',
    description: 'Custom-trained U-Net removes residual noise and haze',
    inputHint: 'Color-corrected image',
  },
  {
    id: 'detection' as const,
    stepIndex: 2,
    subStep: '2',
    label: 'Fish Detection',
    description: 'YOLOv8 detects fish and draws bounding boxes',
    inputHint: 'Restored image',
  },
  {
    id: 'upscaling' as const,
    stepIndex: 3,
    subStep: '3a+3b',
    label: 'Crop & Upscale',
    description: 'Crops each fish 4× via Real-ESRGAN or Lanczos',
    inputHint: 'Restored image + detection boxes',
  },
];

// ─── App ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [results, setResults] = useState<Results>({});
  const [loading, setLoading] = useState<StepLoadingMap>({
    clahe: false,
    color_correction: false,
    unet_denoising: false,
    detection: false,
    upscaling: false,
    all: false,
  });
  const [errors, setErrors] = useState<Partial<Record<keyof StepLoadingMap, string>>>({});
  const [progress, setProgress] = useState(0);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  // Base64 data URI of the uploaded file — used as FishAnnotator background fallback
  const [fileBase64, setFileBase64] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // ── Health check ─────────────────────────────────────────────────────────

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null))
      .finally(() => setHealthLoading(false));
  }, []);

  // ── Convert uploaded file → base64 so FishAnnotator can display it ────────

  useEffect(() => {
    if (!file) { setFileBase64(null); return; }
    const reader = new FileReader();
    reader.onload = (e) => setFileBase64((e.target?.result as string) ?? null);
    reader.readAsDataURL(file);
  }, [file]);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const setStepLoading = useCallback((step: keyof StepLoadingMap, v: boolean) => {
    setLoading((prev) => ({ ...prev, [step]: v }));
  }, []);

  const clearError = (step: keyof StepLoadingMap) => {
    setErrors((prev) => { const n = { ...prev }; delete n[step]; return n; });
  };

  const setError = (step: keyof StepLoadingMap, msg: string) => {
    setErrors((prev) => ({ ...prev, [step]: msg }));
  };

  // ── Individual step runners ───────────────────────────────────────────────

  const runStep = useCallback(
    async (stepId: keyof StepLoadingMap, fileOverride?: File) => {
      const src = fileOverride ?? file;
      if (!src) return;
      setStepLoading(stepId, true);
      clearError(stepId);
      try {
        switch (stepId) {
          case 'clahe': {
            const r = await runClahe(src);
            setResults((p) => ({ ...p, clahe: r }));
            break;
          }
          case 'color_correction': {
            const r = await runColorCorrection(src);
            setResults((p) => ({ ...p, color_correction: r }));
            break;
          }
          case 'unet_denoising': {
            const r = await runUnetDenoising(src);
            setResults((p) => ({ ...p, unet_denoising: r }));
            break;
          }
          case 'detection': {
            const r = await runDetection(src);
            setResults((p) => ({ ...p, detection: r }));
            break;
          }
          case 'upscaling': {
            // Use boxes from detection if available and no custom file override
            const boxes: BoundingBox[] =
              !fileOverride && results.detection?.boxes
                ? results.detection.boxes
                : [];
            const r = await runUpscaling(src, boxes);
            setResults((p) => ({
              ...p,
              upscaling: r,
              crops: r.crops,
              upscaled_images: r.upscaled,
              crop_urls: r.crop_urls,
              upscaled_urls: r.upscaled_urls,
              upscale_method: r.method,
              upscale_fish_count: r.fishCount,
            }));
            break;
          }
        }
      } catch (err) {
        setError(stepId, (err as Error).message);
      } finally {
        setStepLoading(stepId, false);
      }
    },
    [file, results.detection?.boxes, setStepLoading]
  );

  // ── Manual upscaling from FishAnnotator ──────────────────────────────────

  const handleManualUpscaling = useCallback(
    async (manualBoxes: BoundingBox[]) => {
      if (manualBoxes.length === 0 || !file) return;
      setStepLoading('upscaling', true);
      clearError('upscaling');
      try {
        // Prefer the denoised image (same source detection used); fall back to raw upload
        const src = results.unet_denoising?.image
          ? b64ToFile(results.unet_denoising.image, 'denoised.png')
          : file;
        const r = await runUpscaling(src, manualBoxes);
        setResults((p) => ({
          ...p,
          upscaling: r,
          crops: r.crops,
          upscaled_images: r.upscaled,
          crop_urls: r.crop_urls,
          upscaled_urls: r.upscaled_urls,
          upscale_method: r.method,
          upscale_fish_count: r.fishCount,
        }));
      } catch (err) {
        setError('upscaling', (err as Error).message);
      } finally {
        setStepLoading('upscaling', false);
      }
    },
    [file, results.unet_denoising, setStepLoading],
  );

  // ── Full pipeline (SSE) ───────────────────────────────────────────────────

  const runAll = useCallback(async () => {
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setPipelineRunning(true);
    setProgress(0);
    setResults({});
    setErrors({});
    setStepLoading('all', true);

    const SSE_STEPS = ['clahe', 'color_correction', 'unet_denoising', 'detection', 'crops', 'upscaled', 'final'];

    try {
      let stepsDone = 0;
      for await (const event of runFullPipeline(file, controller.signal)) {
        const idx = SSE_STEPS.indexOf(event.step);
        if (idx >= 0) {
          stepsDone = idx + 1;
          setProgress(Math.round((stepsDone / SSE_STEPS.length) * 100));
        }

        // Map SSE events to results state
        if (event.step === 'clahe') {
          setResults((p) => ({ ...p, clahe: event as ClaheResult }));
        } else if (event.step === 'color_correction') {
          setResults((p) => ({ ...p, color_correction: event as ColorCorrectionResult }));
        } else if (event.step === 'unet_denoising') {
          setResults((p) => ({ ...p, unet_denoising: event as UnetDenoisingResult }));
        } else if (event.step === 'detection') {
          setResults((p) => ({ ...p, detection: event as DetectionResult }));
        } else if (event.step === 'crops') {
          const e = event as any;
          setResults((p) => ({
            ...p,
            crops: e.images,
            crop_urls: e.download_urls,
          }));
        } else if (event.step === 'upscaled') {
          const e = event as any;
          setResults((p) => ({
            ...p,
            upscaled_images: e.images,
            upscaled_urls: e.download_urls,
            upscale_method: e.method,
            upscale_fish_count: e.images?.length,
          }));
        }
      }
      setProgress(100);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        setError('all', (err as Error).message);
      }
    } finally {
      setStepLoading('all', false);
      setPipelineRunning(false);
    }
  }, [file, setStepLoading]);

  const stopPipeline = () => {
    abortRef.current?.abort();
    setPipelineRunning(false);
    setStepLoading('all', false);
  };

  // ── Image shown in FishAnnotator (clean, no YOLO annotations) ───────────
  // Prefer the denoised image; fall back to the raw uploaded file as data URI.
  const annotatorImage = results.unet_denoising?.image ?? fileBase64 ?? null;

  // ── Upscaling has result if either came from full pipeline or individual ──
  const hasUpscalingResult =
    (results.crops && results.crops.length >= 0) ||
    results.upscaling !== undefined;

  const upscalingCrops = results.crops ?? results.upscaling?.crops ?? [];
  const upscalingUpscaled = results.upscaled_images ?? results.upscaling?.upscaled ?? [];
  const upscalingCropUrls = results.crop_urls ?? results.upscaling?.crop_urls ?? [];
  const upscalingUpscaledUrls = results.upscaled_urls ?? results.upscaling?.upscaled_urls ?? [];
  const upscalingMethod = results.upscale_method ?? results.upscaling?.method;
  const upscalingFishCount = results.upscale_fish_count ?? results.upscaling?.fishCount;

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen">
      {/* ── Animated background bubbles ─────────────────────────────────── */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        {[...Array(8)].map((_, i) => (
          <div
            key={i}
            className="bubble"
            style={{
              width: `${8 + (i % 3) * 6}px`,
              height: `${8 + (i % 3) * 6}px`,
              left: `${10 + i * 11}%`,
              bottom: '0',
              '--duration': `${5 + (i % 4)}s`,
              '--delay': `${i * 0.8}s`,
            } as React.CSSProperties}
          />
        ))}
        {/* Top radial glow */}
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-cyan-500/5 rounded-full blur-3xl" />
      </div>

      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="relative z-10 border-b border-white/5 bg-ocean-950/80 backdrop-blur-md sticky top-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-teal-500 flex items-center justify-center text-ocean-950 font-black text-lg shadow-cyan-glow">
                🐟
              </div>
              <div className="absolute -inset-1 bg-gradient-to-br from-cyan-400/20 to-teal-500/20 rounded-2xl blur-lg -z-10" />
            </div>
            <div>
              <h1 className="text-white font-extrabold text-xl tracking-tight glow-text">
                BlurryFish
              </h1>
              <p className="text-white/30 text-xs">Underwater image restoration</p>
            </div>
          </div>
          <HealthBadge health={health} loading={healthLoading} />
        </div>
      </header>

      {/* ── Main content ─────────────────────────────────────────────────── */}
      <main className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-10 space-y-8">

        {/* Hero section */}
        <section className="text-center space-y-3 pt-4 pb-2">
          <h2 className="text-3xl sm:text-4xl font-extrabold text-white">
            Restore your{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-teal-400 bg-clip-text text-transparent">
              underwater images
            </span>
          </h2>
          <p className="text-white/40 text-base max-w-xl mx-auto">
            AI-powered pipeline: CLAHE contrast enhancement → color correction → U-Net denoising → fish detection → super-resolution upscaling.
          </p>
        </section>

        {/* Upload zone */}
        <section id="upload-section">
          <UploadZone
            onFile={setFile}
            file={file}
            disabled={loading.all}
          />
        </section>

        {/* Control panel */}
        <section id="controls-section" className="glass-card p-5">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* Run All */}
            <div className="flex items-center gap-3 flex-1">
              <button
                id="run-all-btn"
                className="btn-primary flex items-center gap-2 text-base px-8 py-3"
                disabled={!file || loading.all}
                onClick={pipelineRunning ? stopPipeline : runAll}
              >
                {pipelineRunning ? (
                  <>
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16">
                      <rect x="3" y="3" width="4" height="10" rx="1" />
                      <rect x="9" y="3" width="4" height="10" rx="1" />
                    </svg>
                    Stop
                  </>
                ) : loading.all ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                    </svg>
                    Running…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 16 16">
                      <path d="M5 3l8 5-8 5V3z" fill="currentColor"/>
                    </svg>
                    Run All Steps
                  </>
                )}
              </button>
              {!file && (
                <span className="text-white/30 text-sm">← Upload an image first</span>
              )}
            </div>

            {/* Divider */}
            <div className="hidden sm:block w-px h-10 bg-white/10" />

            {/* Individual step buttons */}
            <div className="flex flex-wrap gap-2 justify-center sm:justify-end">
              {STEPS.map((step) => (
                <button
                  key={step.id}
                  id={`run-${step.id}-btn`}
                  className="btn-secondary flex items-center gap-1.5"
                  disabled={!file || loading[step.id] || loading.all}
                  title={`Run ${step.label} individually. Input: ${step.inputHint}`}
                  onClick={() => runStep(step.id)}
                >
                  {loading[step.id] ? (
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                    </svg>
                  ) : (
                    <span className="text-cyan-400/60 font-mono text-xs">{step.subStep}</span>
                  )}
                  {step.label}
                </button>
              ))}
            </div>
          </div>

          {/* Global error */}
          {errors.all && (
            <div className="mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              ⚠️ {errors.all}
            </div>
          )}
        </section>

        {/* Progress bar */}
        <ProgressBar
          progress={progress}
          visible={pipelineRunning || (loading.all && progress > 0)}
        />

        {/* ── Step results ─────────────────────────────────────────────── */}
        <section id="results-section" className="space-y-5">
          {/* CLAHE */}
          {results.clahe && (
            <StepCard
              stepId="clahe"
              label="CLAHE Enhancement"
              subStep="1a"
              description={results.clahe.description}
              result={results.clahe}
              status={loading.clahe ? 'loading' : 'success'}
              onRerun={(f) => runStep('clahe', f)}
              onRerunWithCurrent={() => runStep('clahe')}
              loading={loading.clahe}
              animDelay={0}
            />
          )}
          {errors.clahe && <ErrorBanner msg={errors.clahe} />}

          {/* Color Correction */}
          {results.color_correction && (
            <StepCard
              stepId="color_correction"
              label="Color Correction"
              subStep="1b"
              description={results.color_correction.description}
              result={results.color_correction}
              status={loading.color_correction ? 'loading' : 'success'}
              onRerun={(f) => runStep('color_correction', f)}
              onRerunWithCurrent={() => runStep('color_correction')}
              loading={loading.color_correction}
              animDelay={100}
            />
          )}
          {errors.color_correction && <ErrorBanner msg={errors.color_correction} />}

          {/* U-Net Denoising */}
          {results.unet_denoising && (
            <StepCard
              stepId="unet_denoising"
              label="U-Net Denoising"
              subStep="1c"
              description={results.unet_denoising.description}
              result={results.unet_denoising}
              status={loading.unet_denoising ? 'loading' : 'success'}
              onRerun={(f) => runStep('unet_denoising', f)}
              onRerunWithCurrent={() => runStep('unet_denoising')}
              loading={loading.unet_denoising}
              animDelay={200}
            />
          )}
          {errors.unet_denoising && <ErrorBanner msg={errors.unet_denoising} />}

          {/* Fish Detection */}
          {results.detection && (
            <StepCard
              stepId="detection"
              label="Fish Detection"
              subStep="2"
              description={results.detection.description}
              result={results.detection}
              status={loading.detection ? 'loading' : 'success'}
              onRerun={(f) => runStep('detection', f)}
              onRerunWithCurrent={() => runStep('detection')}
              loading={loading.detection}
              animDelay={300}
            />
          )}
          {errors.detection && <ErrorBanner msg={errors.detection} />}

          {/* Fish Selection Editor — always shown under detection */}
          {results.detection && annotatorImage && (
            <FishAnnotator
              imageBase64={annotatorImage}
              initialBoxes={results.detection.boxes ?? []}
              onRunUpscaling={handleManualUpscaling}
              loading={loading.upscaling}
              animDelay={350}
            />
          )}

          {/* Upscaling */}
          {hasUpscalingResult && (
            <StepCardUpscaling
              crops={upscalingCrops}
              upscaled={upscalingUpscaled}
              cropUrls={upscalingCropUrls}
              upscaledUrls={upscalingUpscaledUrls}
              method={upscalingMethod}
              fishCount={upscalingFishCount}
              onRerun={(f) => runStep('upscaling', f)}
              onRerunWithCurrent={() => runStep('upscaling')}
              loading={loading.upscaling}
              animDelay={400}
            />
          )}
          {errors.upscaling && <ErrorBanner msg={errors.upscaling} />}
        </section>

        {/* Empty state */}
        {!Object.keys(results).length && !pipelineRunning && !loading.all && (
          <div className="text-center py-16 text-white/20">
            <div className="text-5xl mb-4 animate-float">🌊</div>
            <p className="text-lg font-medium">Upload an image and run the pipeline</p>
            <p className="text-sm mt-1">Results will appear here step by step</p>
          </div>
        )}
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-white/5 mt-20 py-8 text-center">
        <p className="text-white/20 text-sm">
          BlurryFish &mdash; Underwater image restoration pipeline
        </p>
      </footer>
    </div>
  );
}

// ─── Small inline error banner ────────────────────────────────────────────────
function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
      ⚠️ {msg}
    </div>
  );
}

import { useRef } from 'react';
import { videoDownloadUrl } from '../api';

interface Props {
  /** Metadata from video_start SSE event */
  totalFrames: number;
  fps: number;
  width: number;
  height: number;
  /** Progress from video_progress SSE event (0-100) */
  percent: number;
  framesProcessed: number;
  /** Set when video_done event arrives */
  downloadUrl?: string;
  frameCount?: number;
  /** Error message from video_error event */
  error?: string;
  /** Is the pipeline currently running? */
  processing: boolean;
  animDelay?: number;
}

export default function VideoResultCard({
  totalFrames,
  fps,
  width,
  height,
  percent,
  framesProcessed,
  downloadUrl,
  frameCount,
  error,
  processing,
  animDelay = 0,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const isDone = !!downloadUrl && !processing;
  const fullUrl = downloadUrl ? videoDownloadUrl(downloadUrl) : undefined;

  const durationSecs = totalFrames > 0 && fps > 0 ? (totalFrames / fps).toFixed(1) : '?';

  return (
    <div
      className="glass-card overflow-hidden"
      style={{ animationDelay: `${animDelay}ms` }}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 p-5 border-b border-white/5">
        {/* Step badge */}
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-purple-500/20 border border-purple-400/20 flex items-center justify-center">
          <span className="text-purple-300 font-bold text-xs">🎬</span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white/40 font-mono text-xs">Video</span>
            <h3 className="text-white font-semibold text-sm">Temporal Restoration Pipeline</h3>
            {isDone && (
              <span className="px-2 py-0.5 rounded-full bg-green-500/15 border border-green-500/25 text-green-400 text-xs font-medium">
                ✓ Complete
              </span>
            )}
            {processing && (
              <span className="px-2 py-0.5 rounded-full bg-purple-500/15 border border-purple-500/25 text-purple-400 text-xs font-medium flex items-center gap-1.5">
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                </svg>
                Processing…
              </span>
            )}
          </div>
          <p className="text-white/35 text-xs mt-0.5">
            {width}×{height} · {fps.toFixed(0)} fps · {durationSecs}s · {totalFrames} frames
          </p>
        </div>

        {/* Download button */}
        {isDone && fullUrl && (
          <a
            href={fullUrl}
            download={`blurryfish_restored.mp4`}
            className="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold
              bg-purple-500/20 hover:bg-purple-500/30 border border-purple-400/25 hover:border-purple-400/50
              text-purple-300 hover:text-purple-200
              transition-all duration-200 flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
              <path d="M8 2v8m-4-1l4 4 4-4M2 14h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Download MP4
          </a>
        )}
      </div>

      {/* ── Body ───────────────────────────────────────────────────────────── */}
      <div className="p-5 space-y-5">

        {/* Error state */}
        {error && (
          <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            ⚠️ {error}
          </div>
        )}

        {/* Progress bar — shown while processing */}
        {(processing || (!isDone && !error)) && (
          <div className="space-y-2">
            <div className="flex justify-between text-xs text-white/40">
              <span>Processing frames…</span>
              <span>{framesProcessed} / {totalFrames} frames ({percent}%)</span>
            </div>
            <div className="relative h-2 rounded-full bg-white/5 overflow-hidden">
              {/* Animated shimmer behind the bar */}
              <div
                className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500/60 via-fuchsia-500/60 to-purple-500/60 transition-all duration-500"
                style={{ width: `${percent}%` }}
              />
              {/* Shimmer overlay */}
              {processing && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-[shimmer_2s_linear_infinite]" />
              )}
            </div>

            {/* Processing step pills */}
            <div className="flex flex-wrap gap-1.5 mt-3">
              {['Temporal Smoothing', 'Color Correction', 'U-Net Denoising', 'Fish Detection'].map((step) => (
                <span
                  key={step}
                  className="px-2 py-0.5 rounded-full text-xs bg-purple-500/10 border border-purple-400/15 text-purple-300/60"
                >
                  {step}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Video player — shown when done */}
        {isDone && fullUrl && (
          <div className="space-y-4">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Frames', value: String(frameCount ?? totalFrames) },
                { label: 'FPS', value: fps.toFixed(0) },
                { label: 'Duration', value: `${durationSecs}s` },
              ].map(({ label, value }) => (
                <div key={label} className="text-center p-2 rounded-lg bg-white/3 border border-white/5">
                  <p className="text-white font-bold text-base">{value}</p>
                  <p className="text-white/30 text-xs mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Pipeline badge row */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { label: 'Temporal Smoothing', color: 'purple' },
                { label: 'Color Correction', color: 'teal' },
                { label: 'U-Net Denoising', color: 'cyan' },
                { label: 'Fish Detection', color: 'amber' },
              ].map(({ label, color }) => (
                <span
                  key={label}
                  className={`px-2 py-0.5 rounded-full text-xs font-medium
                    bg-${color}-500/15 border border-${color}-400/20 text-${color}-300`}
                >
                  ✓ {label}
                </span>
              ))}
            </div>

            {/* Video player */}
            <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black">
              <video
                ref={videoRef}
                src={fullUrl}
                controls
                playsInline
                className="w-full max-h-[480px] object-contain"
                style={{ background: '#000' }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

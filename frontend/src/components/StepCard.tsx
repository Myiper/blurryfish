import { useRef } from 'react';
import { b64ToDataUri, downloadImage } from '../api';
import type { SSEEvent, UpscalingResult } from '../types';

interface Props {
  stepId: string;
  label: string;
  subStep: string;
  description: string;
  result: SSEEvent | UpscalingResult;
  status: 'loading' | 'success' | 'error';
  onRerun?: (file: File) => void;
  onRerunWithCurrent?: () => void;
  loading?: boolean;
  /** Whether to show an upload button for re-uploading a custom image for this step */
  showUpload?: boolean;
  animDelay?: number;
}

const STEP_COLORS: Record<string, string> = {
  clahe: 'from-blue-500/20 to-cyan-500/20',
  color_correction: 'from-purple-500/20 to-blue-500/20',
  unet_denoising: 'from-cyan-500/20 to-teal-500/20',
  detection: 'from-teal-500/20 to-green-500/20',
  upscaling: 'from-amber-500/20 to-orange-500/20',
  crops: 'from-amber-500/20 to-orange-500/20',
  upscaled: 'from-orange-500/20 to-red-500/20',
  final: 'from-teal-500/20 to-cyan-500/20',
};

const STEP_ICONS: Record<string, string> = {
  clahe: '🌊',
  color_correction: '🎨',
  unet_denoising: '✨',
  detection: '🐟',
  upscaling: '🔬',
  crops: '✂️',
  upscaled: '⬆️',
  final: '🏆',
};

function ImageResult({
  src,
  alt,
  downloadName,
  downloadUrl,
}: {
  src: string;
  alt: string;
  downloadName: string;
  downloadUrl?: string;
}) {
  const dataUri = b64ToDataUri(src);
  return (
    <div className="group relative image-container">
      <img
        src={dataUri}
        alt={alt}
        className="w-full h-auto max-h-72 object-contain bg-black/30"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-end p-3">
        <button
          id={`download-${downloadName}`}
          onClick={(e) => {
            e.stopPropagation();
            downloadImage(downloadUrl ?? dataUri, downloadName);
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white text-xs font-medium border border-white/20 hover:bg-white/10 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
            <path d="M8 2v8m-4-2l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          </svg>
          Download
        </button>
      </div>
    </div>
  );
}

export default function StepCard({
  stepId,
  label,
  subStep,
  description,
  result,
  status,
  onRerun,
  onRerunWithCurrent,
  loading,
  showUpload = true,
  animDelay = 0,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const colorClass = STEP_COLORS[stepId] ?? 'from-cyan-500/20 to-teal-500/20';
  const icon = STEP_ICONS[stepId] ?? '⚙️';

  // Determine images to show
  const singleImage = 'image' in result ? result.image : null;

  return (
    <div
      className="glass-card overflow-hidden step-card-enter"
      style={{ animationDelay: `${animDelay}ms`, opacity: 0 }}
      id={`step-card-${stepId}`}
    >
      {/* Header gradient strip */}
      <div className={`h-1 bg-gradient-to-r ${colorClass.replace('/20', '')}`} />

      <div className="p-5">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br ${colorClass} border border-white/10 text-xl`}>
              {icon}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-white/30 uppercase tracking-wider">
                  Step {subStep}
                </span>
                {status === 'success' && (
                  <span className="badge badge-success text-xs">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Done
                  </span>
                )}
                {status === 'loading' && (
                  <span className="badge badge-info text-xs">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                    </svg>
                    Processing
                  </span>
                )}
              </div>
              <h3 className="text-white font-semibold text-base">{label}</h3>
              <p className="text-white/40 text-xs mt-0.5">{description}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {showUpload && onRerun && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  id={`rerun-upload-${stepId}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { onRerun(f); e.target.value = ''; }
                  }}
                />
                <button
                  id={`upload-for-${stepId}`}
                  className="btn-ghost"
                  title="Upload a custom image for this step"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                >
                  <svg className="w-3.5 h-3.5 mr-1 inline" fill="none" viewBox="0 0 16 16">
                    <path d="M8 2v8m-4-4l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  Upload
                </button>
              </>
            )}
            {onRerunWithCurrent && (
              <button
                id={`rerun-${stepId}`}
                className="btn-ghost"
                onClick={onRerunWithCurrent}
                disabled={loading}
                title="Rerun with current file"
              >
                {loading ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                  </svg>
                ) : (
                  <svg className="w-3.5 h-3.5 mr-1 inline" fill="none" viewBox="0 0 16 16">
                    <path d="M3 8a5 5 0 1 0 1-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M1 5l2 3 3-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
                Rerun
              </button>
            )}
          </div>
        </div>

        {/* Image result */}
        {singleImage && (
          <ImageResult
            src={singleImage}
            alt={label}
            downloadName={`blurryfish_${stepId}`}
            downloadUrl={'download_url' in result ? result.download_url : undefined}
          />
        )}

        {/* Detection-specific: fish count & boxes */}
        {'fishCount' in result && 'boxes' in result && (
          <div className="mt-3 flex items-center gap-2">
            <span className="badge badge-info">
              🐟 {result.fishCount} fish detected
            </span>
            {'modelAvailable' in result && !result.modelAvailable && (
              <span className="badge badge-warning">Passthrough (no weights)</span>
            )}
          </div>
        )}

        {/* Download button (always visible) */}
        {singleImage && (
          <div className="mt-3 flex items-center justify-end">
            <button
              id={`download-btn-${stepId}`}
              onClick={() => downloadImage(
                'download_url' in result ? result.download_url : b64ToDataUri(singleImage),
                `blurryfish_${stepId}`
              )}
              className="btn-secondary text-xs flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
                <path d="M8 2v8m-4-2l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Download PNG
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

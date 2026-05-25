import { useRef } from 'react';
import { b64ToDataUri, downloadImage } from '../api';

interface Props {
  crops?: string[];
  upscaled?: string[];
  cropUrls?: string[];
  upscaledUrls?: string[];
  method?: 'realesrgan' | 'lanczos';
  fishCount?: number;
  jobId?: string;
  onRerun?: (file: File) => void;
  onRerunWithCurrent?: () => void;
  loading?: boolean;
  animDelay?: number;
}

function ImagePair({
  crop,
  up,
  index,
  cropUrl,
  upUrl,
}: {
  crop: string;
  up: string;
  index: number;
  cropUrl?: string;
  upUrl?: string;
}) {
  const cropUri = b64ToDataUri(crop);
  const upUri = b64ToDataUri(up);

  return (
    <div className="glass-card p-3 flex flex-col gap-2">
      <div className="text-xs text-white/30 font-medium text-center">Fish #{index + 1}</div>
      <div className="grid grid-cols-2 gap-2">
        <div className="group relative">
          <div className="text-xs text-white/30 text-center mb-1">Original crop</div>
          <img src={cropUri} alt={`Crop ${index + 1}`} className="w-full h-auto rounded-lg border border-white/5 object-cover" />
          <button
            id={`download-crop-${index}`}
            onClick={() => downloadImage(cropUrl ?? cropUri, `blurryfish_crop_${index}`)}
            className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-black/60 text-white"
            title="Download crop"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16">
              <path d="M8 2v8m-4-2l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="group relative">
          <div className="text-xs text-cyan-400/60 text-center mb-1">4× Upscaled</div>
          <img src={upUri} alt={`Upscaled ${index + 1}`} className="w-full h-auto rounded-lg border border-cyan-500/20 object-cover" />
          <button
            id={`download-upscaled-${index}`}
            onClick={() => downloadImage(upUrl ?? upUri, `blurryfish_upscaled_${index}`)}
            className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-md bg-black/60 text-white"
            title="Download upscaled"
          >
            <svg className="w-3 h-3" fill="none" viewBox="0 0 16 16">
              <path d="M8 2v8m-4-2l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M2 13h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StepCardUpscaling({
  crops = [],
  upscaled = [],
  cropUrls = [],
  upscaledUrls = [],
  method,
  fishCount,
  onRerun,
  onRerunWithCurrent,
  loading,
  animDelay = 0,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEmpty = crops.length === 0;

  return (
    <div
      className="glass-card overflow-hidden step-card-enter"
      style={{ animationDelay: `${animDelay}ms`, opacity: 0 }}
      id="step-card-upscaling"
    >
      <div className="h-1 bg-gradient-to-r from-amber-500 to-orange-500" />

      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-white/10 text-xl">
              🔬
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-white/30 uppercase tracking-wider">Step 3a+3b</span>
                {!loading && !isEmpty && (
                  <span className="badge badge-success text-xs">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 12 12">
                      <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Done
                  </span>
                )}
                {loading && (
                  <span className="badge badge-info text-xs">
                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 16 16">
                      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                    </svg>
                    Processing
                  </span>
                )}
              </div>
              <h3 className="text-white font-semibold text-base">Crop &amp; Upscale</h3>
              <p className="text-white/40 text-xs mt-0.5">
                {method === 'realesrgan'
                  ? 'Real-ESRGAN 4× super-resolution'
                  : method === 'lanczos'
                  ? 'Lanczos 4× upscale + sharpening'
                  : 'Crops each fish 4× super-resolution'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {onRerun && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  id="rerun-upload-upscaling"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) { onRerun(f); e.target.value = ''; }
                  }}
                />
                <button
                  id="upload-for-upscaling"
                  className="btn-ghost"
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
                id="rerun-upscaling"
                className="btn-ghost"
                onClick={onRerunWithCurrent}
                disabled={loading}
              >
                {loading ? (
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 16 16">
                    <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="10"/>
                  </svg>
                ) : (
                  <>
                    <svg className="w-3.5 h-3.5 mr-1 inline" fill="none" viewBox="0 0 16 16">
                      <path d="M3 8a5 5 0 1 0 1-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      <path d="M1 5l2 3 3-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    Rerun
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Stats row */}
        {!isEmpty && (
          <div className="flex items-center gap-3 mb-4">
            <span className="badge badge-info">🐟 {fishCount ?? crops.length} fish</span>
            <span className="badge badge-success">
              {method === 'realesrgan' ? '⚡ Real-ESRGAN' : '🔷 Lanczos'}
            </span>
          </div>
        )}

        {/* Grid of crops + upscaled pairs */}
        {isEmpty ? (
          <div className="text-center py-8 text-white/30 text-sm">
            No fish detected — nothing to upscale.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {crops.map((crop, i) => (
              <ImagePair
                key={i}
                index={i}
                crop={crop}
                up={upscaled[i] ?? crop}
                cropUrl={cropUrls[i]}
                upUrl={upscaledUrls[i]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

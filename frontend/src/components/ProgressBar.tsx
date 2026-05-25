interface Props {
  progress: number; // 0-100
  label?: string;
  visible: boolean;
}

const STEP_LABELS = [
  'CLAHE Enhancement',
  'Color Correction',
  'U-Net Denoising',
  'Fish Detection',
  'Crop & Upscale',
];

export default function ProgressBar({ progress, label, visible }: Props) {
  if (!visible) return null;

  const stepIndex = Math.floor((progress / 100) * STEP_LABELS.length);
  const currentStep = STEP_LABELS[Math.min(stepIndex, STEP_LABELS.length - 1)];

  return (
    <div className="glass-card p-5 animate-fade-in-up">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-sm font-medium text-white/80">
            {label ?? currentStep}
          </span>
        </div>
        <span className="text-sm font-bold text-cyan-400 tabular-nums">
          {Math.round(progress)}%
        </span>
      </div>

      {/* Progress track */}
      <div className="h-2 bg-ocean-700/80 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
          style={{
            width: `${progress}%`,
            background: 'linear-gradient(90deg, #06b6d4, #2dd4bf)',
          }}
        >
          {/* Shimmer on the progress bar */}
          <div className="absolute inset-0 shimmer-bg" />
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex justify-between mt-3">
        {STEP_LABELS.map((_, i) => {
          const stepProgress = ((i + 1) / STEP_LABELS.length) * 100;
          const isDone = progress >= stepProgress;
          const isActive = progress >= (i / STEP_LABELS.length) * 100 && progress < stepProgress;
          return (
            <div
              key={i}
              className={`w-2 h-2 rounded-full transition-all duration-300 ${
                isDone
                  ? 'bg-teal-400'
                  : isActive
                  ? 'bg-cyan-400 animate-pulse scale-125'
                  : 'bg-ocean-600'
              }`}
            />
          );
        })}
      </div>
    </div>
  );
}

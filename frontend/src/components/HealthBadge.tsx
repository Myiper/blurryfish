import type { HealthStatus } from '../types';

interface Props {
  health: HealthStatus | null;
  loading: boolean;
}

const MODEL_LABELS: Record<string, string> = {
  unet: 'U-Net',
  yolo: 'YOLOv8',
  esrgan: 'ESRGAN',
};

export default function HealthBadge({ health, loading }: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-ocean-800/60 border border-white/5">
        <div className="w-2 h-2 rounded-full bg-white/20 animate-pulse" />
        <span className="text-xs text-white/40">Connecting…</span>
      </div>
    );
  }

  if (!health) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20">
        <div className="w-2 h-2 rounded-full bg-red-400" />
        <span className="text-xs text-red-400">Backend offline</span>
      </div>
    );
  }

  const allReady = Object.values(health.models).every(Boolean);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border ${
        allReady
          ? 'bg-teal-500/10 border-teal-500/20'
          : 'bg-amber-500/10 border-amber-500/20'
      }`}>
        <div className={`w-2 h-2 rounded-full ${allReady ? 'bg-teal-400' : 'bg-amber-400'} animate-pulse-slow`} />
        <span className={`text-xs font-medium ${allReady ? 'text-teal-400' : 'text-amber-400'}`}>
          {allReady ? 'All models ready' : 'Partial models'}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {Object.entries(health.models).map(([key, available]) => (
          <span
            key={key}
            title={`${MODEL_LABELS[key]}: ${available ? 'Available' : 'Not loaded (fallback active)'}`}
            className={`px-2 py-0.5 rounded text-xs border font-mono ${
              available
                ? 'bg-teal-500/10 border-teal-500/20 text-teal-400'
                : 'bg-ocean-700/60 border-white/10 text-white/30 line-through'
            }`}
          >
            {MODEL_LABELS[key]}
          </span>
        ))}
      </div>
    </div>
  );
}

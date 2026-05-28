import { useCallback, useEffect, useRef, useState } from 'react';
import type { BoundingBox } from '../types';
import { b64ToDataUri } from '../api';

interface FishAnnotatorProps {
  imageBase64: string;
  initialBoxes: BoundingBox[];
  onRunUpscaling: (boxes: BoundingBox[]) => void;
  loading?: boolean;
  animDelay?: number;
}

type ToolMode = 'select' | 'draw';

export default function FishAnnotator({
  imageBase64,
  initialBoxes,
  onRunUpscaling,
  loading,
  animDelay = 350,
}: FishAnnotatorProps) {
  const [editActive, setEditActive] = useState(false);
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [boxes, setBoxes] = useState<BoundingBox[]>(initialBoxes);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const [imgNatural, setImgNatural] = useState<{ w: number; h: number } | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // Sync boxes when a new detection result arrives
  useEffect(() => {
    setBoxes(initialBoxes);
    setSelectedIdx(null);
    setEditActive(false);
    setToolMode('select');
    setDrawStart(null);
    setDrawEnd(null);
  }, [initialBoxes]);

  const handleImgLoad = () => {
    const img = imgRef.current;
    if (img) setImgNatural({ w: img.naturalWidth, h: img.naturalHeight });
  };

  // Convert a screen-space mouse event to SVG/image-pixel coordinates via CTM
  const toSVGCoords = useCallback(
    (e: React.MouseEvent<SVGSVGElement>): { x: number; y: number } => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const matrix = svg.getScreenCTM();
      if (!matrix) return { x: 0, y: 0 };
      const svgPt = pt.matrixTransform(matrix.inverse());
      return { x: svgPt.x, y: svgPt.y };
    },
    [],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!editActive || toolMode !== 'draw') return;
      e.preventDefault();
      const pt = toSVGCoords(e);
      setDrawStart(pt);
      setDrawEnd(pt);
    },
    [editActive, toolMode, toSVGCoords],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!drawStart) return;
      setDrawEnd(toSVGCoords(e));
    },
    [drawStart, toSVGCoords],
  );

  const handleMouseUp = useCallback(() => {
    if (!drawStart || !drawEnd) return;
    const x1 = Math.min(drawStart.x, drawEnd.x);
    const y1 = Math.min(drawStart.y, drawEnd.y);
    const x2 = Math.max(drawStart.x, drawEnd.x);
    const y2 = Math.max(drawStart.y, drawEnd.y);
    // Only add if box has meaningful area (>8px in each axis)
    if (x2 - x1 > 8 && y2 - y1 > 8) {
      const newBox: BoundingBox = { xyxy: [x1, y1, x2, y2], confidence: 1.0 };
      setBoxes((prev) => {
        const next = [...prev, newBox];
        setSelectedIdx(next.length - 1);
        return next;
      });
    }
    setDrawStart(null);
    setDrawEnd(null);
    setToolMode('select');
  }, [drawStart, drawEnd]);

  const handleBoxClick = useCallback(
    (e: React.MouseEvent, idx: number) => {
      if (!editActive) return;
      e.stopPropagation();
      setSelectedIdx((prev) => (prev === idx ? null : idx));
    },
    [editActive],
  );

  const removeSelected = useCallback(() => {
    if (selectedIdx === null) return;
    setBoxes((prev) => prev.filter((_, i) => i !== selectedIdx));
    setSelectedIdx(null);
  }, [selectedIdx]);

  const toggleEdit = () => {
    setEditActive((prev) => {
      if (prev) {
        setSelectedIdx(null);
        setDrawStart(null);
        setDrawEnd(null);
        setToolMode('select');
      }
      return !prev;
    });
  };

  const drawingRect =
    drawStart && drawEnd
      ? {
          x: Math.min(drawStart.x, drawEnd.x),
          y: Math.min(drawStart.y, drawEnd.y),
          w: Math.abs(drawEnd.x - drawStart.x),
          h: Math.abs(drawEnd.y - drawStart.y),
        }
      : null;

  const svgCursor = !editActive ? 'default' : toolMode === 'draw' ? 'crosshair' : 'default';

  return (
    <div
      className="glass-card overflow-hidden step-card-enter"
      style={{ animationDelay: `${animDelay}ms`, opacity: 0 }}
      id="fish-annotator"
    >
      {/* Top gradient accent */}
      <div className="h-1 bg-gradient-to-r from-amber-400 to-orange-500" />

      {/* Header */}
      <div className="p-5 pb-3 border-b border-white/5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-white/10 text-xl">
              🎯
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-white/30 uppercase tracking-wider">
                  Step 2 ✦ Manual Edit
                </span>
                {editActive && (
                  <span className="badge badge-warning text-xs">
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 8 8">
                      <circle cx="4" cy="4" r="3" />
                    </svg>
                    Edit Active
                  </span>
                )}
              </div>
              <h3 className="text-white font-semibold text-base">Fish Selection</h3>
              <p className="text-white/40 text-xs mt-0.5">
                {editActive
                  ? toolMode === 'draw'
                    ? 'Drag to draw a rectangle around a fish, then release to add it'
                    : 'Click a fish box to select it, or use toolbar to add a new one'
                  : 'Review auto-detected fish — enter Edit Mode to add or remove selections'}
              </p>
            </div>
          </div>
          <span className="badge badge-info shrink-0">
            🐟 {boxes.length} {boxes.length === 1 ? 'fish' : 'fish'}
          </span>
        </div>
      </div>

      {/* Toolbar */}
      <div className="px-5 py-2.5 flex flex-wrap items-center gap-2 border-b border-white/5 bg-white/[0.015]">
        {/* Edit mode toggle */}
        <button
          className={`btn-secondary flex items-center gap-1.5 text-xs ${
            editActive ? 'border-amber-400/40 text-amber-300' : ''
          }`}
          onClick={toggleEdit}
          title={editActive ? 'Exit edit mode' : 'Enter edit mode to add or remove fish'}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
            <path
              d="M2 14l2-2 8-8 2 2-8 8-2 2z"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
          </svg>
          {editActive ? 'Exit Edit Mode' : 'Edit Mode'}
        </button>

        {editActive && (
          <>
            <div className="w-px h-4 bg-white/10" />

            {/* Select New Fish / Cancel Draw */}
            <button
              className={`btn-secondary flex items-center gap-1.5 text-xs ${
                toolMode === 'draw' ? 'border-cyan-400/40 text-cyan-300' : ''
              }`}
              onClick={() => setToolMode((prev) => (prev === 'draw' ? 'select' : 'draw'))}
              title="Click and drag on the image to select a new fish"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
                <rect
                  x="2"
                  y="2"
                  width="12"
                  height="12"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeDasharray="3 2"
                />
                <path
                  d="M8 5v6M5 8h6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
              {toolMode === 'draw' ? 'Cancel Draw' : 'Select New Fish'}
            </button>

            {/* Remove Selected Fish */}
            <button
              className="btn-secondary flex items-center gap-1.5 text-xs"
              onClick={removeSelected}
              disabled={selectedIdx === null}
              title={selectedIdx !== null ? `Remove Fish ${selectedIdx + 1}` : 'Click a box first'}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
                <path
                  d="M3 8h10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <rect
                  x="2"
                  y="3"
                  width="12"
                  height="10"
                  rx="1.5"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
              Remove Selected
            </button>
          </>
        )}
      </div>

      {/* Image area with SVG overlay */}
      <div
        className="relative bg-black/50"
        style={{ userSelect: 'none' }}
      >
        <img
          ref={imgRef}
          src={b64ToDataUri(imageBase64)}
          onLoad={handleImgLoad}
          alt="Fish selection view"
          className="w-full h-auto block"
          draggable={false}
        />

        {imgNatural && (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${imgNatural.w} ${imgNatural.h}`}
            className="absolute inset-0 w-full h-full"
            style={{ cursor: svgCursor }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              setDrawStart(null);
              setDrawEnd(null);
            }}
          >
            {/* Existing fish boxes */}
            {boxes.map((box, i) => {
              const [x1, y1, x2, y2] = box.xyxy;
              const selected = selectedIdx === i;
              return (
                <g
                  key={i}
                  style={{ cursor: editActive ? 'pointer' : 'default' }}
                  onClick={(e) => handleBoxClick(e as unknown as React.MouseEvent, i)}
                >
                  {/* Box fill + stroke */}
                  <rect
                    x={x1}
                    y={y1}
                    width={x2 - x1}
                    height={y2 - y1}
                    fill={selected ? 'rgba(251,191,36,0.18)' : 'rgba(6,182,212,0.08)'}
                    stroke={selected ? '#fbbf24' : '#22d3ee'}
                    strokeWidth={selected ? 2.5 : 1.8}
                    rx={3}
                  />
                  {/* Fish label pill */}
                  <rect
                    x={x1}
                    y={y1}
                    width={52}
                    height={19}
                    rx={3}
                    fill={selected ? '#fbbf24' : '#0891b2'}
                    opacity={0.92}
                  />
                  <text
                    x={x1 + 5}
                    y={y1 + 13}
                    fontSize={11}
                    fill={selected ? '#000' : '#fff'}
                    fontWeight="bold"
                    fontFamily="ui-monospace, monospace"
                    style={{ pointerEvents: 'none', userSelect: 'none' }}
                  >
                    Fish {i + 1}
                  </text>
                  {/* Inline remove button shown when selected in edit mode */}
                  {editActive && selected && (
                    <g
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        (e as unknown as Event).stopPropagation();
                        removeSelected();
                      }}
                    >
                      <circle cx={x2 - 1} cy={y1 + 1} r={9} fill="#ef4444" opacity={0.92} />
                      <text
                        x={x2 - 1}
                        y={y1 + 6}
                        textAnchor="middle"
                        fontSize={14}
                        fill="white"
                        fontWeight="bold"
                        style={{ pointerEvents: 'none', userSelect: 'none' }}
                      >
                        ×
                      </text>
                    </g>
                  )}
                </g>
              );
            })}

            {/* In-progress draw preview rectangle */}
            {drawingRect && (
              <rect
                x={drawingRect.x}
                y={drawingRect.y}
                width={drawingRect.w}
                height={drawingRect.h}
                fill="rgba(6,182,212,0.1)"
                stroke="#22d3ee"
                strokeWidth={1.8}
                strokeDasharray="6 3"
                rx={3}
              />
            )}
          </svg>
        )}

        {/* Empty state overlay */}
        {boxes.length === 0 && !drawingRect && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-black/65 backdrop-blur-sm rounded-xl px-5 py-4 text-center border border-white/10">
              <div className="text-3xl mb-2">🐟</div>
              <p className="text-white/70 text-sm font-medium">No fish detected</p>
              <p className="text-white/40 text-xs mt-1">Enable Edit Mode to add fish manually</p>
            </div>
          </div>
        )}
      </div>

      {/* Footer / run action */}
      <div className="px-5 py-4 border-t border-white/5 flex items-center justify-between gap-4">
        <p className="text-white/35 text-xs">
          {selectedIdx !== null
            ? `Fish ${selectedIdx + 1} selected — click × or use "Remove Selected"`
            : boxes.length === 0
            ? 'Add fish in edit mode, then run upscaling'
            : `${boxes.length} ${boxes.length === 1 ? 'fish' : 'fish'} confirmed — ready to upscale`}
        </p>
        <button
          className="btn-primary flex items-center gap-2 shrink-0 text-sm px-5 py-2.5"
          onClick={() => onRunUpscaling(boxes)}
          disabled={!!loading || boxes.length === 0}
          title={boxes.length === 0 ? 'Add at least one fish selection first' : 'Run upscaling with these fish selections'}
        >
          {loading ? (
            <>
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 16 16">
                <circle
                  cx="8"
                  cy="8"
                  r="6"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="28"
                  strokeDashoffset="10"
                />
              </svg>
              Processing…
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
                <path d="M5 3l8 5-8 5V3z" fill="currentColor" />
              </svg>
              Run Upscaling
            </>
          )}
        </button>
      </div>
    </div>
  );
}

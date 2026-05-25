import React, { useCallback, useState, useRef } from 'react';

interface Props {
  onFile: (file: File) => void;
  file: File | null;
  disabled?: boolean;
}

const FISH_SVG = (
  <svg viewBox="0 0 64 40" fill="none" className="w-16 h-10 opacity-60">
    <ellipse cx="28" cy="20" rx="18" ry="11" fill="currentColor" opacity="0.3" />
    <path d="M46 20 L58 10 L58 30 Z" fill="currentColor" opacity="0.3" />
    <circle cx="16" cy="17" r="2.5" fill="currentColor" opacity="0.7" />
    <path d="M10 15 Q6 12 4 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
    <path d="M10 17 Q5 17 2 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
    <path d="M10 19 Q6 22 4 26" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"/>
  </svg>
);

export default function UploadZone({ onFile, file, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) onFile(f);
    },
    [onFile]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) onFile(f);
    },
    [onFile]
  );

  const preview = file ? URL.createObjectURL(file) : null;

  return (
    <div
      id="upload-zone"
      className={`relative rounded-2xl border-2 border-dashed transition-all duration-300 cursor-pointer overflow-hidden
        ${dragging
          ? 'border-cyan-400 bg-cyan-400/5 shadow-cyan-glow'
          : file
          ? 'border-teal-500/40 bg-ocean-800/40'
          : 'border-ocean-600 bg-ocean-800/30 hover:border-cyan-500/50 hover:bg-ocean-800/50'
        }
        ${disabled ? 'pointer-events-none opacity-60' : ''}
      `}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        id="file-input"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={handleChange}
        disabled={disabled}
      />

      {file && preview ? (
        <div className="flex flex-col sm:flex-row items-center gap-6 p-6">
          <div className="relative flex-shrink-0">
            <img
              src={preview}
              alt="Uploaded preview"
              className="w-40 h-28 object-cover rounded-xl border border-white/10"
            />
            <div className="absolute inset-0 rounded-xl bg-gradient-to-t from-black/40 to-transparent" />
          </div>
          <div className="flex-1 text-left">
            <p className="text-white font-semibold text-base truncate max-w-xs">{file.name}</p>
            <p className="text-white/40 text-sm mt-1">
              {(file.size / 1024 / 1024).toFixed(2)} MB • {file.type.split('/')[1].toUpperCase()}
            </p>
            <p className="text-cyan-400 text-xs mt-3 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 16 16">
                <path d="M8 2v8m-4-4l4-4 4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M2 12h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              Click or drop to replace
            </p>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-14 px-6 text-center">
          <div className="text-cyan-400 mb-4 animate-float">
            {FISH_SVG}
          </div>
          <p className="text-white font-semibold text-lg mb-1">
            {dragging ? 'Drop your image here' : 'Upload an underwater image'}
          </p>
          <p className="text-white/40 text-sm mb-4">
            Drag & drop or click to browse
          </p>
          <div className="flex items-center gap-2 text-xs text-white/30">
            <span className="px-2 py-0.5 rounded bg-ocean-700/60 border border-white/10">JPEG</span>
            <span className="px-2 py-0.5 rounded bg-ocean-700/60 border border-white/10">PNG</span>
            <span className="px-2 py-0.5 rounded bg-ocean-700/60 border border-white/10">WebP</span>
            <span className="text-white/20">· max 20 MB</span>
          </div>
        </div>
      )}

      {/* Decorative corner glow */}
      {dragging && (
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-0 w-24 h-24 rounded-full bg-cyan-400/10 blur-2xl" />
          <div className="absolute bottom-0 right-0 w-24 h-24 rounded-full bg-teal-400/10 blur-2xl" />
        </div>
      )}
    </div>
  );
}

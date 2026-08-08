import { useState } from 'react';
import type { KeyboardEvent } from 'react';

/** A photo that expands to a full-screen zoom on tap. Escape (or a second tap) closes it. */
export function ZoomableShot({ src, alt }: { src: string; alt: string }) {
  const [zoomed, setZoomed] = useState(false);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'Escape' && zoomed) {
      e.stopPropagation();
      setZoomed(false);
    }
  };

  return (
    <button
      type="button"
      className={zoomed ? 'photo-zoom zoomed' : 'photo-zoom'}
      aria-label={zoomed ? `Close zoomed ${alt.toLowerCase()}` : `Zoom ${alt.toLowerCase()}`}
      onClick={() => setZoomed((v) => !v)}
      onKeyDown={onKeyDown}
    >
      <img src={src} alt={alt} />
    </button>
  );
}

export interface ShotTileProps {
  status: 'uploading' | 'ready' | 'failed';
  previewUrl?: string;
  /** Tiny caps caption under the tile ("Bill", "Page 2"). */
  caption: string;
  /** Image alt text ("Bill photo", "Measurement page 2"). */
  alt: string;
  onRetry?: () => void;
  onRemove?: () => void;
}

/** One captured photo in the wizard: preview (zoomable), live upload status, retry/remove. */
export default function ShotTile({ status, previewUrl, caption, alt, onRetry, onRemove }: ShotTileProps) {
  return (
    <figure className="shot-tile">
      {previewUrl ? (
        <ZoomableShot src={previewUrl} alt={alt} />
      ) : (
        <div className="shot-ph" aria-hidden="true" />
      )}
      {status === 'uploading' && (
        <div className="shot-st" role="status">
          <span className="spin" aria-hidden="true" />
          Uploading…
        </div>
      )}
      {status === 'failed' && (
        <div className="shot-st err" role="alert">
          Upload failed
          {onRetry && (
            <button type="button" className="ulink" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
      <figcaption>
        {caption}
        {onRemove && (
          <button type="button" className="ulink" onClick={onRemove}>
            Remove
          </button>
        )}
      </figcaption>
    </figure>
  );
}

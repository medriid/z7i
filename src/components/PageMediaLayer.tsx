import { memo } from 'react';

type PageMediaLayerProps = {
  url?: string | null;
  positionX?: number | null;
  positionY?: number | null;
  overlayVar: string;
  className?: string;
};

const VIDEO_MEDIA_REGEX = /^(data:video\/(mp4|webm);base64,|https?:\/\/.+\.(mp4|webm)(\?.*)?)$/i;

function isVideoMediaUrl(value?: string | null) {
  return Boolean(value && VIDEO_MEDIA_REGEX.test(value.trim()));
}

export const PageMediaLayer = memo(function PageMediaLayer({
  url,
  positionX,
  positionY,
  overlayVar,
  className
}: PageMediaLayerProps) {
  if (!isVideoMediaUrl(url)) return null;
  return (
    <div className={`page-media-layer ${className || ''}`} aria-hidden="true">
      <video
        className="page-media-video"
        src={url}
        muted
        loop
        playsInline
        autoPlay
        style={{ objectPosition: `${positionX ?? 50}% ${positionY ?? 50}%` }}
      />
      <div className="page-media-overlay" style={{ background: `var(${overlayVar})` }} />
    </div>
  );
});

/**
 * Canvas compositor + share helpers (spec §3.2 card, §3.3.7 AR blend).
 * This is the growth loop — do not cut.
 *
 *  - composePhotoCard: the historical photo letterboxed on a card with a
 *    "SPIRE · {year}" footer + location, for sharing from the Photo Sheet.
 *  - composeArBlend: the live camera frame + ghost at the current opacity and
 *    transform, watermarked "SPIRE · {year}/{currentYear}".
 */
import { useState } from 'react';
import type { HistoricalPhoto } from '../history/types';
import type { GhostTransform } from '../history/arAlignment';

const CARD_W = 1080;
const SEPIA = '#C9A227';
const NIGHT = '#141B2D';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/** Cover-fit source rect for drawing `img` into a `dw×dh` box without stretching. */
function coverRect(img: HTMLImageElement, dw: number, dh: number) {
  const scale = Math.max(dw / img.width, dh / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  return { sx: 0, sy: 0, x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

function drawFooter(ctx: CanvasRenderingContext2D, w: number, y: number, h: number, photo: HistoricalPhoto) {
  ctx.fillStyle = NIGHT;
  ctx.fillRect(0, y, w, h);
  ctx.fillStyle = SEPIA;
  ctx.font = '700 40px "Space Grotesk", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`SPIRE · ${photo.era}`, 44, y + h / 2 - 14);
  ctx.fillStyle = 'rgba(244,246,251,0.75)';
  ctx.font = '400 26px Inter, system-ui, sans-serif';
  const sub = photo.caption?.slice(0, 60) ?? photo.standHint ?? 'Chicago';
  ctx.fillText(sub, 44, y + h / 2 + 26);
}

/** Photo card: letterboxed image with a blurred fill + branded footer. */
export async function composePhotoCard(photo: HistoricalPhoto): Promise<Blob> {
  const img = await loadImage(photo.imageUrl);
  const aspect = img.height / img.width;
  const imgH = Math.round(CARD_W * Math.min(aspect, 1.25));
  const footerH = 140;
  const canvas = document.createElement('canvas');
  canvas.width = CARD_W;
  canvas.height = imgH + footerH;
  const ctx = canvas.getContext('2d')!;

  // Blurred fill behind letterboxed photo (never stretch — spec §3.2).
  const cover = coverRect(img, CARD_W, imgH);
  ctx.save();
  ctx.filter = 'blur(28px) brightness(0.6)';
  ctx.drawImage(img, cover.x - 20, cover.y - 20, cover.w + 40, cover.h + 40);
  ctx.restore();

  // Contain-fit the actual photo.
  const scale = Math.min(CARD_W / img.width, imgH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  ctx.drawImage(img, (CARD_W - w) / 2, (imgH - h) / 2, w, h);

  // Faint vignette to match the archival treatment.
  const grad = ctx.createRadialGradient(CARD_W / 2, imgH / 2, imgH / 3, CARD_W / 2, imgH / 2, imgH);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(20,14,4,0.4)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, CARD_W, imgH);

  drawFooter(ctx, CARD_W, imgH, footerH, photo);
  return canvasToBlob(canvas);
}

/** AR blend: live frame + ghost at current opacity/transform, then/now watermark. */
export async function composeArBlend(
  video: HTMLVideoElement,
  photo: HistoricalPhoto,
  transform: GhostTransform,
  opacity: number,
): Promise<Blob> {
  const vw = video.videoWidth || 1080;
  const vh = video.videoHeight || 1920;
  const canvas = document.createElement('canvas');
  canvas.width = vw;
  canvas.height = vh;
  const ctx = canvas.getContext('2d')!;

  ctx.drawImage(video, 0, 0, vw, vh);

  const ghost = await loadImage(photo.imageUrl);
  const cover = coverRect(ghost, vw, vh);
  // Scale the CSS-pixel offset into video pixels (transform is authored in CSS px).
  const pxScale = vw / (video.clientWidth || vw);
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.translate(vw / 2 + transform.offsetX * pxScale, vh / 2 + transform.offsetY * pxScale);
  ctx.rotate((transform.rotationDeg * Math.PI) / 180);
  ctx.scale(transform.scale, transform.scale);
  ctx.drawImage(ghost, -cover.w / 2, -cover.h / 2, cover.w, cover.h);
  ctx.restore();

  // Watermark.
  ctx.fillStyle = 'rgba(20,27,45,0.7)';
  ctx.fillRect(0, vh - 72, vw, 72);
  ctx.fillStyle = SEPIA;
  ctx.font = '700 34px "Space Grotesk", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(`SPIRE · ${photo.era}/${new Date().getFullYear()}`, 32, vh - 36);
  return canvasToBlob(canvas);
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas export failed (image may be cross-origin)'))),
      'image/jpeg',
      0.9,
    );
  });
}

/** Web Share with a file, falling back to a download. */
export async function shareBlob(blob: Blob, filename: string, text: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], text });
      return;
    } catch {
      /* user cancelled — fall through to download */
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Share button that composes on demand and reports failure inline. */
export function ShareButton({
  compose,
  filename,
  text,
  className = '',
  children,
}: {
  compose: () => Promise<Blob>;
  filename: string;
  text: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <button
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        setError(null);
        try {
          const blob = await compose();
          await shareBlob(blob, filename, text);
        } catch (err) {
          setError((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
      className={className}
      title={error ?? undefined}
    >
      {busy ? 'Rendering…' : error ? 'Retry share' : children}
    </button>
  );
}

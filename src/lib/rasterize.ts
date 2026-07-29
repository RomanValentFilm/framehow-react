// Off-screen rasterization for export pipelines.

import type { Frame, Version } from '../store/state';
import { drawMainStrokes, drawVersionStrokes } from './drawing';

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = src;
  });
}

export async function rasterizeMain(f: Frame, scale = 2): Promise<HTMLCanvasElement> {
  const w = (f && f.cropW) || 960,
    h = (f && f.cropH) || 540;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1a18';
  ctx.fillRect(0, 0, c.width, c.height);
  if (f.src) {
    try {
      const img = await loadImage(f.src);
      const s = Math.min(c.width / img.width, c.height / img.height);
      const dw = img.width * s,
        dh = img.height * s;
      ctx.drawImage(img, 0, 0, img.width, img.height, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    } catch {}
  }
  ctx.save();
  ctx.scale(scale, scale);
  drawMainStrokes(ctx, f.strokes || []);
  ctx.restore();
  return c;
}

export async function rasterizeVersion(
  ver: Version,
  frameCropW: number,
  frameCropH: number,
  scale = 2
): Promise<HTMLCanvasElement> {
  const w = frameCropW || 960,
    h = frameCropH || 540;
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#1a1a18';
  ctx.fillRect(0, 0, c.width, c.height);
  if (ver.bgImage) {
    try {
      const img = await loadImage(ver.bgImage);
      const s = Math.min(c.width / img.width, c.height / img.height);
      const dw = img.width * s,
        dh = img.height * s;
      ctx.drawImage(img, 0, 0, img.width, img.height, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
    } catch {}
  }
  ctx.save();
  ctx.scale(scale, scale);
  drawVersionStrokes(ctx, ver.strokes || []);
  ctx.restore();
  return c;
}

/**
 * Bake a black outline into the image itself, so it travels with the picture
 * into PDF, PowerPoint or anywhere else rather than being a separate object.
 *
 * Thickness is 0.6% of the image's long edge, and it is drawn fully INSIDE the
 * bounds (a plain strokeRect centres the line on the edge and loses half of
 * it), so the visible weight is identical on all four sides.
 */
export function withBakedBorder(canvas: HTMLCanvasElement, pct = 0.006): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = canvas.width;
  c.height = canvas.height;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(canvas, 0, 0);
  const lw = Math.max(1, Math.round(Math.max(c.width, c.height) * pct));
  ctx.strokeStyle = '#000';
  ctx.lineWidth = lw;
  ctx.strokeRect(lw / 2, lw / 2, c.width - lw, c.height - lw);
  return c;
}

export function versionHasContent(v: Version | null | undefined): boolean {
  if (!v) return false;
  if (v.bgImage) return true;
  if (v.strokes && v.strokes.length > 0) return true;
  return false;
}

export function canvasToBlob(cvs: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve) => {
    cvs.toBlob((blob) => resolve(blob!), 'image/jpeg', 0.92);
  });
}

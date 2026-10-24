// THE FH CAMERA'S LOOK (24 October, Roman).
//
// The browser hands the camera over as video — flatter and darker than the
// phone's own photos. Roman: 80 % of the look must be in the viewfinder, so
// DOPs see what they get; the last 20 % is a push on the shot alone.
//
//   80 % — ONE TONE CURVE, the same table of 256 values for the live view and
//          for the shot: the exposure slider's curve (as before) plus the
//          "FH look": a midtone lift, a gentle shadow lift, a highlight
//          roll-off and a touch of colour. A table lookup is cheap enough to
//          run live; at the same time it is exact, so live = shot.
//   20 % — after the shutter only: the frames around the press are averaged
//          when nothing moved (noise), then local contrast and sharpening.
//
// The look can be switched off (DOPs who want the plain picture); the
// exposure slider works either way.

import { trace } from './syncTrace';

const LOOK_KEY = 'fh_camLook';
export function getLookOn(): boolean {
  try { return localStorage.getItem(LOOK_KEY) !== 'off'; } catch { return true; }
}
export function setLookOn(on: boolean): void {
  try { localStorage.setItem(LOOK_KEY, on ? 'on' : 'off'); } catch { /* */ }
  trace(`camera: FH look ${on ? 'on' : 'off'}`);
}

/** The exposure curve (unchanged from before) and, on top, the FH look. */
export function buildToneLUT(ev: number, look: boolean): Uint8Array {
  const t = new Uint8Array(256);
  const bright = Math.pow(2, ev * 0.85);
  const contrast = ev > 0 ? 1 - ev * 0.08 : 1 + Math.abs(ev) * 0.55;
  const gamma = Math.pow(2, -ev);
  const pull = ev < 0 ? Math.abs(ev) * 0.075 : 0;
  for (let i = 0; i < 256; i++) {
    const n = i / 255;
    let v: number;
    if (Math.abs(ev) < 0.05) v = n;
    else {
      let c1 = i * bright;
      c1 = (c1 - 128) * contrast + 128;
      c1 = Math.max(0, Math.min(255, c1));
      let c3 = 255 * Math.pow(n, gamma);
      if (pull > 0) c3 *= 1 - pull * n * n;
      c3 = Math.max(0, Math.min(255, c3));
      v = (0.3 * c1 + 0.7 * c3) / 255;
    }
    if (look) {
      // Midtone lift: a gamma of 0.9 — brighter mids, black and white untouched.
      v = Math.pow(Math.max(0, v), 0.9);
      // Shadow lift: a small bump in the dark tones, zero at black.
      v = v + 0.08 * v * (1 - v) * (1 - v);
      // A gentle S for punch (darkens the lower quarter a touch, lifts the upper).
      v = v - 0.03 * Math.sin(2 * Math.PI * v);
      // Highlight roll-off: the top 12 % compressed, so bright windows keep detail.
      if (v > 0.88) v = 0.88 + (v - 0.88) * 0.7;
    }
    t[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return t;
}

/** Apply the table (and a colour factor) in place. */
export function applyLUT(d: Uint8ClampedArray, lut: Uint8Array, sat: number): void {
  const n = d.length;
  if (sat === 1) {
    for (let i = 0; i < n; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    return;
  }
  for (let i = 0; i < n; i += 4) {
    const r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    const gr = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = gr + (r - gr) * sat; d[i + 1] = gr + (g - gr) * sat; d[i + 2] = gr + (b - gr) * sat;
  }
}

/** The colour factor that goes with the look and the exposure. */
export function satFor(ev: number, look: boolean): number {
  const fromEv = ev < 0 ? 1 - Math.abs(ev) * 0.106 : 1;
  return fromEv * (look ? 1.08 : 1);
}

/** How different two frames are, on a small copy: 0 = identical. */
function frameDiff(a: ImageData, b: ImageData): number {
  const x = a.data, y = b.data; let s = 0;
  for (let i = 0; i < x.length; i += 16) s += Math.abs(x[i] - y[i]) + Math.abs(x[i + 1] - y[i + 1]) + Math.abs(x[i + 2] - y[i + 2]);
  return s / (x.length / 16) / 3;
}

/**
 * THE 20 %: `frames` are the crops taken around the shutter press (first = the
 * shot). They are averaged only when the small copies agree (nothing moved),
 * which takes the video noise down; then local contrast (a wide unsharp mask,
 * low amount) and sharpening (a narrow one). Returns the finished canvas.
 */
export function finishShot(frames: HTMLCanvasElement[], look: boolean): HTMLCanvasElement {
  const out = frames[0];
  const w = out.width, h = out.height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  let averaged = 1;
  if (look && frames.length > 1) {
    const small = frames.map((f) => { const c = document.createElement('canvas'); c.width = 64; c.height = 36;
      const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(f, 0, 0, 64, 36); return g.getImageData(0, 0, 64, 36); });
    const still = frames.slice(1).filter((_, i) => frameDiff(small[0], small[i + 1]) < 6);
    if (still.length) {
      const acc = ctx.getImageData(0, 0, w, h); const a = acc.data;
      const sum = new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) sum[i] = a[i];
      for (const f of still) {
        const d = f.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
        for (let i = 0; i < d.length; i++) sum[i] += d[i];
      }
      const k = 1 / (still.length + 1);
      for (let i = 0; i < a.length; i++) a[i] = sum[i] * k;
      ctx.putImageData(acc, 0, 0);
      averaged = still.length + 1;
    }
  }
  if (look) {
    // Unsharp masks via the canvas's own blur: wide & weak (local contrast),
    // narrow & firmer (sharpening). out = img + amount · (img − blur).
    const base = ctx.getImageData(0, 0, w, h);
    const blurred = (radius: number): Uint8ClampedArray => {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      g.filter = `blur(${radius}px)`; g.drawImage(out, 0, 0);
      return g.getImageData(0, 0, w, h).data;
    };
    const wide = blurred(Math.max(8, Math.round(Math.min(w, h) / 60)));
    const narrow = blurred(1.2);
    const d = base.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = d[i + c];
        d[i + c] = v + 0.18 * (v - wide[i + c]) + 0.45 * (v - narrow[i + c]);
      }
    }
    ctx.putImageData(base, 0, 0);
  }
  trace(`camera: shot finished ${w}×${h}${look ? ` · look on · ${averaged} frame(s) averaged` : ' · look off'}`);
  return out;
}

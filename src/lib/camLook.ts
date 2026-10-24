// THE FH CAMERA'S LOOK (24 October, Roman — twice).
//
// The browser hands the camera over as video — a little darker than the
// phone's own photos. The first look (035) was a tone curve painted over the
// video every frame plus averaging and sharpening after the shutter: it
// flickered at the edges at 4K, changed the colours, and the photo took ages
// to land. Roman: "keep the colours and brightness it brings by default,
// brightness 10 % down, skip the post-processing."
//
// So the look is now ONE NUMBER: a brightness gain. Live it is a display
// setting on the video itself (the screen does it — no copy, no flicker,
// no cost); on the shot it is the same gain in one quick pass. No colour
// change, no averaging, no sharpening. The exposure slider works either way.

import { trace } from './syncTrace';

/** The gain of the look: +8 % (035 lifted the mids about 18 %; 10 % down). */
export const LOOK_GAIN = 1.08;

const LOOK_KEY = 'fh_camLook';
export function getLookOn(): boolean {
  try { return localStorage.getItem(LOOK_KEY) !== 'off'; } catch { return true; }
}
export function setLookOn(on: boolean): void {
  try { localStorage.setItem(LOOK_KEY, on ? 'on' : 'off'); } catch { /* */ }
  trace(`camera: FH look ${on ? 'on' : 'off'}`);
}

/** The display setting for the viewfinder: the look's gain and the slider's
 *  brightness. The shot uses the exact curve below; this is its preview. */
export function liveFilter(ev: number, look: boolean): string {
  const gain = (look ? LOOK_GAIN : 1) * Math.pow(2, ev * 0.85);
  return Math.abs(gain - 1) < 0.005 ? '' : `brightness(${gain.toFixed(3)})`;
}

/** The exposure curve (unchanged from before) and, on top, the look's gain. */
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
    if (look) v *= LOOK_GAIN;
    t[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  return t;
}

/** Apply the table in place. Colours are left alone. */
export function applyLUT(d: Uint8ClampedArray, lut: Uint8Array): void {
  const n = d.length;
  for (let i = 0; i < n; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
}

// THE FH CAMERA'S CURVE (24 October, Roman: "yesterday's curve worked
// perfectly — why did we build a new one?").
//
// This is the exposure curve as it was before 035, untouched: the slider's
// brightness, contrast, gamma, a pull on the highlights and a touch less
// colour when going darker — tuned earlier and kept. The only addition is a
// small brightness lift (+8 %) at the slider's zero, because the browser's
// video is a little darker than the phone's own photos.
//
// ONE TABLE FOR THE VIEWFINDER AND THE SHOT, so what you see is what lands
// on the card. Live, the table is painted onto a copy of the video at screen
// size and the video itself is hidden under it (035 left the video showing
// through, and at 4K the copy ran a frame behind: flicker at the edges).
// Nothing is done to the photo afterwards — no averaging, no sharpening.

/** The lift at the slider's zero. */
export const LOOK_GAIN = 1.08;

/** Yesterday's curve, then the lift. */
export function buildToneLUT(ev: number): Uint8Array {
  const t = new Uint8Array(256);
  const bright = Math.pow(2, ev * 0.85);
  const contrast = ev > 0 ? 1 - ev * 0.08 : 1 + Math.abs(ev) * 0.55;
  const gamma = Math.pow(2, -ev);
  const pull = ev < 0 ? Math.abs(ev) * 0.075 : 0;
  const curve = Math.abs(ev) >= 0.05;
  for (let i = 0; i < 256; i++) {
    let v = i;
    if (curve) {
      let c1 = i * bright;
      c1 = (c1 - 128) * contrast + 128;
      c1 = Math.max(0, Math.min(255, c1));
      const n = i / 255;
      let c3 = 255 * Math.pow(n, gamma);
      if (pull > 0) c3 *= 1 - pull * n * n;
      c3 = Math.max(0, Math.min(255, c3));
      v = 0.3 * c1 + 0.7 * c3;
    }
    t[i] = Math.max(0, Math.min(255, Math.round(v * LOOK_GAIN)));
  }
  return t;
}

/** Less colour when going darker: 10 % at the end of the slider (ev −2),
 *  evenly along the way (Roman, 24 Oct; was 21 %). */
export function satFor(ev: number): number {
  return ev < 0 ? 1 - Math.abs(ev) * 0.05 : 1;
}

/** Apply the table and the colour factor in place. */
export function applyLUT(d: Uint8ClampedArray, lut: Uint8Array, sat: number): void {
  const n = d.length;
  if (sat >= 1) {
    for (let i = 0; i < n; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
    return;
  }
  for (let i = 0; i < n; i += 4) {
    const r = lut[d[i]], g = lut[d[i + 1]], b = lut[d[i + 2]];
    const gr = 0.299 * r + 0.587 * g + 0.114 * b;
    d[i] = gr + (r - gr) * sat; d[i + 1] = gr + (g - gr) * sat; d[i + 2] = gr + (b - gr) * sat;
  }
}

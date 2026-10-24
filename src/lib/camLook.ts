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
// change, no averaging, no sharpening, and no switch (24 Oct, Roman: "what is that toggle for?").

/** The gain of the look: +8 % (035 lifted the mids about 18 %; 10 % down). */
export const LOOK_GAIN = 1.08;

/** The display setting for the viewfinder: the look's gain and the slider's
 *  brightness. The shot uses the exact curve below; this is its preview. */
export function liveFilter(ev: number): string {
  const gain = LOOK_GAIN * Math.pow(2, ev * 0.85);
  return Math.abs(gain - 1) < 0.005 ? '' : `brightness(${gain.toFixed(3)})`;
}

/** THE SHOT GETS EXACTLY WHAT THE SCREEN SHOWED (Roman, 24 Oct: "no
 *  correction that is not on screen when taking the picture"): the same
 *  plain brightness as the viewfinder's display setting, as a table. */
export function buildToneLUT(ev: number): Uint8Array {
  const gain = LOOK_GAIN * Math.pow(2, ev * 0.85);
  const t = new Uint8Array(256);
  for (let i = 0; i < 256; i++) t[i] = Math.max(0, Math.min(255, Math.round(i * gain)));
  return t;
}

/** Apply the table in place. Colours are left alone. */
export function applyLUT(d: Uint8ClampedArray, lut: Uint8Array): void {
  const n = d.length;
  for (let i = 0; i < n; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
}

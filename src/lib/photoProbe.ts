// PHOTO TEST — WHAT IS IN A PHOTO, AND WHAT IT COSTS TO UNPACK (16 Nov).
//
// Roman: "we're not even sure that we are really saving photos with HDR. We
// don't know." And: "a JPEG is a JPEG." He is right that we did not KNOW: the
// log's "HDR layer in the file" only says the camera HANDED the layer to the
// encoder, nobody looked into the file afterwards. And the phone needed 750 ms
// to unpack a camera photo where a test picture of the same pixel size needed
// 15 — measured, but not explained.
//
// A button in the log panel. It takes the first pictures of the open project
// and says, for each one:
//   · what is IN the file — how many pictures it holds (a photo with Apple's
//     HDR layer holds a second, small one: the gain map), whether the words
//     that mark such a layer are there, which colour profile it names;
//   · what it costs to unpack AS IT IS;
//   · what a PLAIN copy costs — the same pixels drawn once and saved as an
//     ordinary JPEG — at full size, at 1280 and at 960, and what each weighs.
// Nothing is changed or saved. It only looks and measures.

import { useStore } from '../store/state';
import { trace } from './syncTrace';

function bytesOf(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function has(bytes: Uint8Array, word: string): boolean {
  const w = Array.from(word, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i <= bytes.length - w.length; i++) {
    for (let j = 0; j < w.length; j++) if (bytes[i + j] !== w[j]) continue outer;
    return true;
  }
  return false;
}

/** How many JPEG pictures start inside this file (FF D8 FF). One = a plain
 *  photo; more = something rides along (a gain map, an embedded thumbnail). */
function picturesInside(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) n++;
  return n;
}

/** Unpack a picture from scratch (its own address each time, so nothing the
 *  browser unpacked before is reused) and paint it once, small — as a card
 *  does. Milliseconds for the unpacking, and for the painting. */
async function costOf(blob: Blob): Promise<{ unpack: number; paint: number; w: number; h: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    const t0 = performance.now();
    img.src = url;
    await img.decode();
    const t1 = performance.now();
    const c = document.createElement('canvas');
    c.width = 870; c.height = Math.max(1, Math.round((870 * img.naturalHeight) / Math.max(1, img.naturalWidth)));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    c.getContext('2d')!.getImageData(0, 0, 1, 1);          // (makes the painting really happen now)
    const t2 = performance.now();
    return { unpack: Math.round(t1 - t0), paint: Math.round(t2 - t1), w: img.naturalWidth, h: img.naturalHeight };
  } finally { URL.revokeObjectURL(url); }
}

/** THE GLOW, MEASURED (17 Nov, Roman: "keep that Apple push … and at the same
 *  time we want to be fast with everything"). A picture that still carries the
 *  brightness layer is put ON THE SCREEN (small, top left, for a moment) with
 *  the screen told how much glow it may show: 'standard' = none (plain),
 *  'constrained' = a little, 'no-limit' = all of it. Milliseconds from handing
 *  the file over until it is unpacked, and until the screen has drawn it. Then
 *  a picture shown plain is switched to full glow, and that is timed too —
 *  what a card would cost when the scroll comes to rest. */
const twoFrames = (): Promise<void> => new Promise((go) => requestAnimationFrame(() => requestAnimationFrame(() => go())));
async function shownWith(blob: Blob, limit: string): Promise<{ unpack: number; shown: number; img: HTMLImageElement; done: () => void }> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:auto;z-index:2147483646;pointer-events:none;';
  img.style.setProperty('dynamic-range-limit', limit);
  const t0 = performance.now();
  img.src = url;
  await img.decode();
  const t1 = performance.now();
  document.body.appendChild(img);
  await twoFrames();
  const t2 = performance.now();
  return { unpack: Math.round(t1 - t0), shown: Math.round(t2 - t0), img, done: () => { img.remove(); URL.revokeObjectURL(url); } };
}
async function glowLines(i: number, blob: Blob): Promise<void> {
  const knows = typeof CSS !== 'undefined' && !!CSS.supports && CSS.supports('dynamic-range-limit', 'standard');
  const out: string[] = [];
  for (const [limit, word] of [['standard', 'PLAIN (no glow)'], ['constrained', 'A LITTLE GLOW'], ['no-limit', 'FULL GLOW']] as const) {
    const r = await shownWith(blob, limit);
    out.push(`${word}: unpacked in ${r.unpack} ms, on the screen after ${r.shown} ms`);
    await new Promise<void>((go) => setTimeout(go, 250));
    r.done();
    await new Promise<void>((go) => setTimeout(go, 50));
  }
  // a picture already shown plain is told it may glow — the card when the scroll rests
  const r = await shownWith(blob, 'standard');
  await new Promise<void>((go) => setTimeout(go, 150));
  const t0 = performance.now();
  r.img.style.setProperty('dynamic-range-limit', 'no-limit');
  await twoFrames();
  const sw = Math.round(performance.now() - t0);
  await new Promise<void>((go) => setTimeout(go, 600));     // (long enough for the eye to see whether it glows)
  r.done();
  trace(`PHOTO TEST ${i}:   THE GLOW — this screen ${knows ? 'understands' : 'DOES NOT understand'} the glow setting · ${out.join(' · ')} · SWITCHING a shown picture from plain to full glow: ${sw} ms (two screen frames, about 17–33 ms, are in every "on the screen" and in the switch)`);
}

async function plainCopy(blob: Blob, longSide: number | null): Promise<Blob> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = longSide ? Math.min(1, longSide / Math.max(img.naturalWidth, img.naturalHeight)) : 1;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    const x = c.getContext('2d')!;
    x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    return await new Promise<Blob>((ok, bad) => c.toBlob((b) => (b ? ok(b) : bad(new Error('no copy'))), 'image/jpeg', 0.9));
  } finally { URL.revokeObjectURL(url); }
}

let _busy = false;
export async function photoTest(say: (word: string) => void): Promise<void> {
  if (_busy) return;
  _busy = true;
  try {
    const s = useStore.getState();
    const found: Array<{ where: string; src: string }> = [];
    const seen = new Set<string>();
    const take = (where: string, src: string | null | undefined): void => {
      if (!src || !src.startsWith('data:image') || seen.has(src) || found.length >= 4) return;
      seen.add(src); found.push({ where, src });
    };
    // the newest first: the last shots, their versions from the back
    for (const f of [...s.frames].reverse()) {
      for (const strip of Object.keys(s.stripVersions)) for (const v of [...(s.stripVersions[strip]?.[f.id] ?? [])].reverse()) take(`shot ${f.label || f.id} · ${strip} ${v.label || ''}`, v.bgImage);
      take(`shot ${f.label || f.id} · main`, f.src);
    }
    if (!found.length) { trace('PHOTO TEST: the open project has no picture'); say('NO PICTURE'); return; }
    const kb = (n: number) => `${Math.round(n / 1024)} KB`;
    let i = 0;
    let layered = 0;
    for (const p of found) {
      say(`${++i} / ${found.length}`);
      const bytes = bytesOf(p.src);
      const type = p.src.slice(5, p.src.indexOf(';'));
      const inside = picturesInside(bytes);
      const marks = [
        has(bytes, 'MPF\0') ? 'several pictures listed (MPF)' : '',
        has(bytes, 'HDRGainMap') || has(bytes, 'hdrgm') || has(bytes, 'urn:iso:std:iso:ts:21496') ? 'GAIN MAP NAMED' : '',
        has(bytes, 'Display P3') ? 'colour: Display P3' : has(bytes, 'sRGB') ? 'colour: sRGB' : 'colour: no profile named',
      ].filter(Boolean).join(' · ');
      const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type });
      const asIs = await costOf(blob);
      trace(`PHOTO TEST ${i}: ${p.where} — ${asIs.w}×${asIs.h}, ${kb(bytes.length)}, ${type} · IN THE FILE: ${inside} picture(s) · ${marks} · AS IT IS: unpacked in ${asIs.unpack} ms, painted small in ${asIs.paint} ms`);
      if (inside >= 2) { layered++; await glowLines(i, blob); }
      for (const side of [null, 1280, 960] as const) {
        const copy = await plainCopy(blob, side);
        const c = await costOf(copy);
        trace(`PHOTO TEST ${i}:   a plain copy ${side ? `at ${side}` : 'at full size'} — ${c.w}×${c.h}, ${kb(copy.size)} · unpacked in ${c.unpack} ms, painted small in ${c.paint} ms`);
        await new Promise<void>((go) => setTimeout(go, 0));
      }
    }
    // …AND THE EYE (16 Nov, Roman: "does the brightness thing show in Framehow, or
    // only in the Photos app? If only there, we don't care"). The newest
    // picture twice, side by side: as it was shot, and its plain copy at full
    // size. Two plain pictures, nothing laid over them. A tap closes it.
    if (!layered) trace('PHOTO TEST:   THE GLOW was not measured — none of these pictures carries the brightness layer (the camera saves plain since 16 Nov evening). Open a project with camera photos shot before that, and tap PHOTO TEST again.');
    await showSideBySide(found[0].src);
    say('DONE');
  } catch (e) {
    trace(`PHOTO TEST: stopped — ${(e as Error)?.message ?? e}`);
    say('FAILED');
  } finally { _busy = false; }
}

async function showSideBySide(src: string): Promise<void> {
  const bytes = bytesOf(src);
  const type = src.slice(5, src.indexOf(';'));
  const asShot = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }));
  const plain = URL.createObjectURL(await plainCopy(new Blob([bytes as Uint8Array<ArrayBuffer>], { type }), null));
  const wall = document.createElement('div');
  wall.id = 'photoTestWall';
  wall.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:#000;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:2px;';
  const half = (url: string, word: string): HTMLElement => {
    const box = document.createElement('div');
    box.style.cssText = 'flex:1 1 0;min-width:0;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;';
    const img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'max-width:100%;max-height:88%;display:block;';
    const label = document.createElement('div');
    label.textContent = word;
    label.style.cssText = 'color:#fff;font:11px ui-monospace,monospace;letter-spacing:.08em;padding:6px 0 0;text-align:center;';
    box.appendChild(img); box.appendChild(label);
    return box;
  };
  wall.appendChild(half(asShot, 'AS SHOT'));
  wall.appendChild(half(plain, 'PLAIN COPY'));
  wall.addEventListener('click', () => { wall.remove(); URL.revokeObjectURL(asShot); URL.revokeObjectURL(plain); });
  document.body.appendChild(wall);
  trace('PHOTO TEST: the newest picture twice on the screen — AS SHOT on the left, PLAIN COPY on the right; a tap closes it');
}

// FILL 25 — THE MEASUREMENT (agreed 11 Nov, built 16 Nov).
//
// How many pictures can a device hold before its page is thrown out? Nobody
// knows; step C of lazy loading (only the pictures near the screen sharp in APP
// MEMORY) needs that number, and a guess is not a number.
//
// A button in the log panel. One tap adds 25 pictures of camera size — 2400 px
// on the long side, about 800 KB, made on this device, each one different — as
// versions to the shots of the open project, and writes one line: how many
// pictures the project holds now, how much APP MEMORY that is, how long the
// save into LOCAL APP STORAGE took, how long one drawing of the project took.
//
// How Roman uses it: SIGNED OUT, in a new project (nothing goes to the SERVER,
// his 500 MB are not touched) — tap, wait for the line, tap again, until the
// page starts anew or 300 pictures are in. The log survives the restart; the
// last line before "THE PAGE STARTED ANEW" is the number.

import { useStore } from '../store/state';
import { trace } from './syncTrace';
import { addNewStripVersion, ensureStripVersions } from './helpers';
import type { Version } from '../store/state';

let _made = 0;
let _busy = false;

/** One picture a person can recognise: a sky, a ground, a sun, a figure, its
 *  number written large — and enough fine texture to weigh what a photo weighs. */
function makePicture(n: number, w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d')!;
  const hue = (n * 47) % 360;
  const ground = (hue + 200) % 360;
  const horizon = h * 0.62;
  const sky = x.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, `hsl(${hue},55%,58%)`);
  sky.addColorStop(1, `hsl(${(hue + 30) % 360},55%,82%)`);
  x.fillStyle = sky; x.fillRect(0, 0, w, horizon);
  const land = x.createLinearGradient(0, horizon, 0, h);
  land.addColorStop(0, `hsl(${ground},28%,34%)`);
  land.addColorStop(1, `hsl(${ground},32%,12%)`);
  x.fillStyle = land; x.fillRect(0, horizon, w, h - horizon);
  // the sun, somewhere else each time
  const unit = Math.min(w, h);
  x.fillStyle = 'rgba(255,246,222,.92)';
  x.beginPath(); x.arc(w * (0.15 + 0.7 * (((n * 13) % 10) / 10)), h * 0.24, unit * 0.08, 0, Math.PI * 2); x.fill();
  // hills
  for (let k = 0; k < 3; k++) {
    x.fillStyle = `hsla(${ground},${24 + k * 6}%,${44 - k * 9}%,.9)`;
    x.beginPath(); x.moveTo(0, horizon);
    for (let i = 0; i <= 8; i++) x.lineTo((w / 8) * i, horizon - unit * (0.05 + 0.09 * Math.abs(Math.sin(n * (k + 1) + i * 1.7))) + k * unit * 0.03);
    x.lineTo(w, horizon + unit * 0.02); x.lineTo(0, horizon + unit * 0.02); x.closePath(); x.fill();
  }
  // a figure standing on the ground
  const fx = w * (0.2 + 0.6 * (((n * 7) % 10) / 10)), fh = unit * 0.34, fy = horizon + unit * 0.12;
  x.fillStyle = 'rgba(18,18,22,.92)';
  x.beginPath(); x.arc(fx, fy - fh, fh * 0.11, 0, Math.PI * 2); x.fill();
  x.fillRect(fx - fh * 0.1, fy - fh * 0.88, fh * 0.2, fh * 0.52);
  x.fillRect(fx - fh * 0.1, fy - fh * 0.38, fh * 0.08, fh * 0.38);
  x.fillRect(fx + fh * 0.02, fy - fh * 0.38, fh * 0.08, fh * 0.38);
  // fine texture, so the file weighs what a photograph weighs
  for (let i = 0; i < 14_000; i++) {
    x.fillStyle = `hsla(${(Math.random() * 360) | 0},45%,${(25 + Math.random() * 55) | 0}%,.14)`;
    x.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 9, 2 + Math.random() * 9);
  }
  // its number, large, and when it was made
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = unit * 0.012; x.strokeStyle = 'rgba(0,0,0,.55)'; x.fillStyle = '#fff';
  x.font = `700 ${Math.round(unit * 0.3)}px ui-monospace, Menlo, monospace`;
  x.strokeText(String(n), w / 2, h * 0.4); x.fillText(String(n), w / 2, h * 0.4);
  x.font = `500 ${Math.round(unit * 0.045)}px ui-monospace, Menlo, monospace`;
  const words = `FILL 25 · picture ${n} · ${new Date().toLocaleTimeString()}`;
  x.strokeText(words, w / 2, h * 0.93); x.fillText(words, w / 2, h * 0.93);
  // about 800 KB: the quality is turned until the weight is near it
  let q = 0.9, out = c.toDataURL('image/jpeg', q);
  for (let i = 0; i < 4; i++) {
    const kb = (out.length * 0.75) / 1024;
    if (kb > 1000) q -= 0.08; else if (kb < 600 && q < 0.98) q += 0.04; else break;
    out = c.toDataURL('image/jpeg', q);
  }
  return out;
}

/** What the open project's pictures weigh in APP MEMORY — each picture once. */
export function picturesInAppMemory(): { pictures: number; mb: number } {
  const s = useStore.getState();
  const seen = new Set<string>();
  let chars = 0;
  const take = (v: string | null | undefined): void => { if (v && v.length > 200 && !seen.has(v)) { seen.add(v); chars += v.length; } };
  for (const f of s.frames) take(f.src);
  for (const strip of Object.keys(s.stripVersions)) for (const fid of Object.keys(s.stripVersions[strip] ?? {})) for (const v of s.stripVersions[strip][+fid] ?? []) take(v.bgImage);
  return { pictures: seen.size, mb: Math.round((chars / 1048576) * 10) / 10 };
}

export async function fill25(say: (word: string) => void): Promise<void> {
  if (_busy) return;
  const s0 = useStore.getState();
  if (s0.frames.length === 0) { trace('FILL 25: no project open — make a new one first'); say('NO PROJECT'); return; }
  _busy = true;
  try {
    const upright = s0.projectType === 'portrait' || s0.projectType === 'fitting';
    const [w, h] = upright ? [1350, 2400] : [2400, 1350];
    const signedIn = !!(await import('./session')).getToken?.();
    if (signedIn) trace('FILL 25: SIGNED IN — these 25 pictures will be sent to the SERVER and count in the 500 MB. For the measurement, sign out and use a new project.');
    if (_made === 0) _made = picturesInAppMemory().pictures;   // after a restart the numbers go on where the project stands
    const madeFrom = performance.now();
    let kb = 0;
    for (let i = 0; i < 25; i++) {
      _made++;
      say(`${i + 1} / 25`);
      const src = makePicture(_made, w, h);
      kb += (src.length * 0.75) / 1024;
      const frames = useStore.getState().frames;
      const fid = frames[(_made - 1) % frames.length].id;
      const vers = ensureStripVersions(fid, 'ver');
      const blank = vers.length === 1 && vers[0].type === 'empty' && !vers[0].bgImage && !(vers[0].strokes?.length);
      if (blank) { vers[0].type = 'upload'; vers[0].bgImage = src; }
      else addNewStripVersion(fid, 'ver', { id: vers.length + 1, label: `v${vers.length + 1}`, type: 'upload', strokes: [], bgImage: src } as Version);
      await new Promise<void>((go) => setTimeout(go, 0));     // the page breathes between two pictures
    }
    const madeMs = Math.round(performance.now() - madeFrom);
    // the store is told (so the save into LOCAL APP STORAGE and, signed in, the sync see it)
    useStore.setState((prev) => ({ renderTick: prev.renderTick + 1 }));
    const drawFrom = performance.now();
    (window as never as { __fh_renderWhy?: string }).__fh_renderWhy = 'FILL 25';
    (window as never as { __fh_renderAll?: () => void }).__fh_renderAll?.();
    const drawMs = Math.round(performance.now() - drawFrom);
    say('SAVING');
    const saveFrom = performance.now();
    let saved = 'saved';
    try { await (await import('./currentProject')).saveLocalNow(); } catch (e) { saved = `SAVE FAILED (${(e as Error)?.message ?? e})`; }
    const saveMs = Math.round(performance.now() - saveFrom);
    let storage = '';
    try { const est = await (await import('./persistence')).storageEstimate(); if (est) storage = ` · LOCAL APP STORAGE ${Math.round(est.usage / 1048576)} MB used`; } catch { /* not told */ }
    const m = picturesInAppMemory();
    trace(`FILL 25: ${m.pictures} picture(s) in the open project · ${m.mb} MB in APP MEMORY · these 25: ${Math.round(kb / 25)} KB each, made in ${madeMs} ms · one drawing of the project ${drawMs} ms · ${saved} in ${saveMs} ms${storage}`);
    say('DONE');
  } catch (e) {
    trace(`FILL 25: stopped — ${(e as Error)?.message ?? e}`);
    say('FAILED');
  } finally {
    _busy = false;
  }
}

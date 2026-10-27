// THE PICTS LIBRARY (26 October, Roman).
//
// Every picture the account ever uploaded, by the day it arrived, newest at the
// bottom — like the phone's own photo library. Each picture keeps its own
// shape: rows of equal height, filled edge to edge, nothing cropped. A row
// holds 5 landscape or 8 portrait pictures on a desktop or iPad, 3 of either on
// a phone. Tap a picture: the max screen, which returns here.
// Turning the device keeps every row as it is, only larger or smaller (091).
//
// Step 3 (27 Oct):
//   PREVIEWS  the library shows a small copy of each picture (512 px on its
//             long side). Made by the app the first time a picture is shown,
//             kept in the account's folder, counted in its storage. The full
//             picture is loaded only for the max screen and for sharing.
//   SELECT    top right; turns marking on and becomes CANCEL. A tap marks a
//             picture (a red tick, nothing dimmed); a tap on a date line marks
//             or unmarks its whole day; a finger moved sideways across the
//             pictures marks all of them on the way (up or down still
//             scrolls); the mouse marks in any direction.
//   THE BAR   at the bottom while marking: SHARE · "3 selected" · DELETE.
//             iPhone/iPad: the share sheet with the pictures. Mac/PC: one
//             picture downloads as itself, several as one ZIP. DELETE is grey
//             until step 4.
//
// Offline (27 Oct, Roman: "a user offline shoots 10 pictures — he sees 10 in
// the library"):
//   THE DEVICE KEEPS PREVIEWS in a store of its own (pictsStore.ts) — never
//             mixed with the projects. A picture added on this device gets
//             its preview a few seconds later, when the device is idle,
//             online or not, under the picture's FINGERPRINT. When the
//             picture reaches the server, the same fingerprint finds the same
//             preview: it is linked to the server's name and sent along — made
//             once, downloaded never.
//   OFFLINE   the library shows what the device keeps, and every picture of
//             the open project and of unsent work.
//   KEPT      everything not yet uploaded; the open project's pictures; the
//             whole of today and of the last day with pictures; and the newest
//             three screens. Making room removes previews only.
//   ONLINE    the server's list joins; days whose previews are not on the
//             device load when you scroll near them.

import { api, API_BASE_URL } from './api';
import { getToken } from './session';
import { logStripHeight, trace } from './syncTrace';
import { openMaxView } from './maxView';
import { useStore } from '../store/state';
import { getCurrentProject } from './currentProject';
import { isArchived, listPending } from './persistence';
import { allPreviews, deletePreviews, fingerprint, getPreview, putPreview, type PreviewRec } from './pictsStore';

type Use = { project_id: string; project: string; shot: string | null; version: string | null };
type Pic = { key: string; uploaded_at: number; size: number; width: number | null; height: number | null; uses: Use[]; thumb?: boolean; thumb_size?: number | null;
  /** Not on the server yet: known only from this device (key "local:<fingerprint>"). */
  local?: boolean; fp?: string; label?: string };
type Loaded = Pic & { url: string; w: number; h: number };

/** Per row: landscape and portrait pictures (Roman, 26 Oct; portraits tuned to 8). */
const PER_ROW = { wide: { landscape: 5, portrait: 8 }, phone: { landscape: 3, portrait: 3 } };
/** The preview: long side and JPEG quality (≈ 25–40 KB). */
const THUMB_LONG = 512;
const THUMB_Q = 0.72;

let _root: HTMLElement | null = null;
const _thumbs = new Map<string, string>();   // r2 key → preview object URL, kept for the session
const _full = new Map<string, Blob>();       // r2 key → the full picture, once loaded
const _fullUrls = new Map<string, string>();
const _localSrc = new Map<string, string>();  // key → the picture as this device holds it (data URL)
const _fpOf = new Map<string, string>();      // data URL → fingerprint, so a picture is hashed once

export function pictsOpen(): boolean { return !!_root; }

export function togglePicts(): void { if (_root) closePicts(); else void openPicts(); }

export function closePicts(): void {
  if (!_root) return;
  _root.remove(); _root = null;
  document.getElementById('pictsBtn')?.classList.remove('active');
  document.body.classList.remove('picts-open');
  releasePage();
  trace('PICTS: closed');
}

// THE PAGE BEHIND IS HELD STILL while the library is open (Roman's iPhone,
// 27 Oct: a swipe on the library scrolled the 3×2 view behind it). No swipe
// outside the library's own pictures moves anything; on closing, the 3×2 view
// is exactly where it was.
let _heldY: number | null = null;
function blockBehind(e: TouchEvent): void {
  if (!_root) return;
  const t = e.target as HTMLElement | null;
  if (t && t.closest('#pictsLibrary .picts-scroll')) return;
  if (t && t.closest('#maxView')) return;
  if (e.cancelable) e.preventDefault();
}
function holdPage(): void {
  if (_heldY !== null) return;
  _heldY = window.scrollY;
  document.documentElement.classList.add('picts-hold');
  document.addEventListener('touchmove', blockBehind, { passive: false });
}
function releasePage(): void {
  if (_heldY === null) return;
  const y = _heldY;
  _heldY = null;
  document.documentElement.classList.remove('picts-hold');
  document.removeEventListener('touchmove', blockBehind);
  if (Math.abs(window.scrollY - y) > 1) window.scrollTo(0, y);
}

function topOfContent(): number {
  // Under whatever bars are showing (view bar, detail bar), wherever they are.
  let bottom = 0;
  // Asked where each bar sits on the screen — not whether it has a layout
  // parent: on the iPad the bars are pinned to the screen, have none, and the
  // library started at 0, under them (27 Oct, iPad log: "library top 0px").
  for (const sel of ['#mainToolbar', '.view-bar', '#detailBar']) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom > 0 && r.bottom > bottom) bottom = r.bottom;
  }
  return Math.max(0, Math.round(bottom));
}

const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();

function whereUsed(p: Pic): string {
  const u = p.uses[0];
  if (!u) return p.label || 'not on a card';
  return `${u.project} – shot ${u.shot ?? '?'}${u.version ? ` – ${u.version}` : ''}`;
}

const authed = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });

/** The full picture, once per session. */
async function fullBlob(key: string, token: string): Promise<Blob | null> {
  const had = _full.get(key);
  if (had) return had;
  // On this device already (a card of the open project, unsent work): no download.
  const local = _localSrc.get(key);
  if (local) {
    const m = local.match(/^data:([^;,]+)?(;base64)?,/);
    if (m) {
      const bytes = m[2] ? b64ToBytes(local.slice(m[0].length)) : new TextEncoder().encode(decodeURIComponent(local.slice(m[0].length)));
      const b = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: m[1] || 'image/jpeg' });
      _full.set(key, b);
      return b;
    }
  }
  if (key.startsWith('local:')) return null;
  const res = await authed(`/images/${key}`, token);
  if (!res.ok) return null;
  const b = await res.blob();
  _full.set(key, b);
  return b;
}
async function fullUrl(key: string, token: string): Promise<string | null> {
  const had = _fullUrls.get(key);
  if (had) return had;
  const local = _localSrc.get(key);
  if (local) return local;   // the picture itself, as this device holds it
  const b = await fullBlob(key, token);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  _fullUrls.set(key, u);
  return u;
}

const loadImg = (url: string) => new Promise<HTMLImageElement>((ok, bad) => {
  const img = new Image(); img.onload = () => ok(img); img.onerror = () => bad(new Error('no picture')); img.src = url;
});

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToDataUrl(bytes: ArrayBuffer, type = 'image/jpeg'): string {
  const u = new Uint8Array(bytes);
  let bin = '';
  for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}
type Made = { bytes: ArrayBuffer; dataUrl: string; w: number; h: number };

/** Shrink a picture to its preview — straight from the drawing to bytes, never
 *  through a picture object (runs 493/494). */
async function shrinkWithSize(url: string): Promise<Made | null> {
  const img = await loadImg(url);
  const k = Math.min(1, THUMB_LONG / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const dataUrl = c.toDataURL('image/jpeg', THUMB_Q);
  if (!dataUrl.startsWith('data:image/jpeg')) return null;
  const bytes = b64ToBytes(dataUrl.slice(dataUrl.indexOf(',') + 1));
  return { bytes: bytes.buffer as ArrayBuffer, dataUrl, w: c.width, h: c.height };
}

function keepThumb(key: string, bytes: ArrayBuffer, token: string, why: string): Promise<boolean> {
  return authed(`/thumbs/${key}`, token, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: bytes })
    .then((r) => { trace(`PICTS: preview kept for ${key.split('/').pop()} (${Math.round(bytes.byteLength / 1024)} KB, ${why}) — ${r.status}`); return r.ok; })
    .catch(() => { trace(`PICTS: preview not kept for ${key.split('/').pop()} (offline?)`); return false; });
}

/** An older picture without a preview: made once from the full picture. */
async function makeThumb(p: Pic, token: string): Promise<Made | null> {
  const url = await fullUrl(p.key, token);
  if (!url) return null;
  const made = await shrinkWithSize(url);
  if (made) void keepThumb(p.key, made.bytes, token, 'first look');
  return made;
}

// ---- the preview goes with its picture (27 Oct, Roman) -----------------------
const idle = (fn: () => void) => {
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 10_000 }); else setTimeout(fn, 400);
};

/** Called by the upload, straight after its picture reached the server. The
 *  preview this device made when the picture was added (offline, maybe) is
 *  found by the picture's fingerprint — or made now — linked to the server's
 *  name, and sent. If it does not make it, the device notes it as not sent. */
export async function sendPreviewNow(key: string, src: string): Promise<void> {
  const token = getToken();
  if (!token) return;
  const fp = await fpOf(src);
  let rec = await getPreview(previewId(fp));
  if (!rec) {
    const made = await shrinkWithSize(src);
    if (!made) return;
    rec = { id: previewId(fp), fp, r2Key: key, at: Date.now(), madeAt: Date.now(), label: '', w: made.w, h: made.h, bytes: made.bytes };
  }
  rec = { ...rec, r2Key: key, sent: false };
  await putPreview(rec);
  const ok = await keepThumb(key, rec.bytes, token, 'with its picture');
  if (ok) await putPreview({ ...rec, sent: true });
  else noteWaiting();
}

// A preview waiting to be sent: tried again when the connection comes back,
// and every 30 seconds while one waits (run 496). Nothing runs when none waits.
let _waiting = false;
let _retryT = 0;
function noteWaiting(): void {
  _waiting = true;
  if (_retryT) return;
  _retryT = window.setInterval(() => { if (navigator.onLine !== false) void sendUnsentPreviews(); }, 30_000);
  window.addEventListener('online', () => void sendUnsentPreviews());
}

/** After a sync went through: every preview whose picture is on the server but
 *  which itself is not yet (the connection dropped between the two). */
let _sending = false;
export async function sendUnsentPreviews(): Promise<void> {
  if (_sending) return;
  const token = getToken();
  if (!token) return;
  _sending = true;
  try {
    if (!_waiting) return;   // nothing noted this session — no need to read the store
    const waiting = (await allPreviews()).filter((r) => r.r2Key && r.sent === false);
    if (!waiting.length) { _waiting = false; if (_retryT) { clearInterval(_retryT); _retryT = 0; } return; }
    trace(`PICTS: ${waiting.length} preview(s) not sent with their picture — sending now`);
    let left = 0;
    for (const r of waiting) {
      if (await keepThumb(r.r2Key!, r.bytes, token, 'after the sync')) await putPreview({ ...r, sent: true });
      else left++;
    }
    if (!left) { _waiting = false; if (_retryT) { clearInterval(_retryT); _retryT = 0; } }
  } finally { _sending = false; }
}

/** The device's name for a picture's PREVIEW: the picture's fingerprint with
 *  ":preview" on the end — never to be mistaken for the picture itself. */
const previewId = (fp: string | undefined | null) => `fp:${fp}:preview`;

async function fpOf(src: string): Promise<string> {
  const had = _fpOf.get(src);
  if (had) return had;
  const fp = await fingerprint(src);
  _fpOf.set(src, fp);
  return fp;
}

// ---- the pictures this device holds (27 Oct) ---------------------------------
type LocalPic = { key: string; src: string; r2Key: string | null; label: string };

function picturesOf(frames: Array<{ id: number; src: string; label: string; r2Key?: string }> | undefined,
  stripVersions: Record<string, Record<number, Array<{ label: string; bgImage: string | null; r2Key?: string }>>> | undefined,
  project: string, out: LocalPic[]): void {
  for (const f of frames || []) {
    if (f.src && f.src.startsWith('data:image')) out.push({ key: '', src: f.src, r2Key: f.r2Key || null, label: `${project} – shot ${f.label} – main` });
    for (const st of Object.keys(stripVersions || {})) {
      for (const v of stripVersions![st]?.[f.id] || []) {
        if (v.bgImage && v.bgImage.startsWith('data:image')) out.push({ key: '', src: v.bgImage, r2Key: v.r2Key || null, label: `${project} – shot ${f.label} – ${v.label}` });
      }
    }
  }
}

/** Every picture of the open project and of unsent work on this device. */
async function localPictures(): Promise<LocalPic[]> {
  const out: LocalPic[] = [];
  const s = useStore.getState();
  picturesOf(s.frames, s.stripVersions, getCurrentProject().name || 'Untitled', out);
  try {
    for (const rec of await listPending()) {
      if (rec.deletedAt) continue;
      // The 24-hour safety copy of work already uploaded: its pictures are on
      // the server — not new ones (27 Oct, iPhone: 4 "not uploaded yet" at the end).
      if (isArchived(rec)) continue;
      const snap = rec.snapshot as unknown as { frames?: never; stripVersions?: never };
      picturesOf(snap.frames, snap.stripVersions, rec.name || 'Untitled', out);
    }
  } catch { /* no unsent work */ }
  const seen = new Set<string>();
  const res: LocalPic[] = [];
  for (const l of out) {
    l.key = l.r2Key ?? `local:${await fpOf(l.src)}`;
    if (seen.has(l.key)) continue;
    seen.add(l.key);
    _localSrc.set(l.key, l.src);
    res.push(l);
  }
  return res;
}

// A picture ADDED on this device, online or offline, gets its preview a few
// seconds later, when the device is idle — so the library shows it even if it
// never reaches the server today (Roman, 27 Oct).
let _watching = false;
let _lastSig = '';
let _busy = false;
/** A cheap look every few seconds: which pictures are not uploaded yet (how
 *  many, how long). The app changes a picture inside its shot without
 *  replacing the list of shots (run 491: a watcher on the list never woke),
 *  so the pictures themselves are looked at — counted, not worked on. */
function unsentSignature(): string {
  const s = useStore.getState();
  let n = 0, len = 0;
  for (const f of s.frames) {
    if (f.src && f.src.startsWith('data:image') && !f.r2Key) { n++; len += f.src.length; }
    for (const st of Object.keys(s.stripVersions || {})) {
      for (const v of s.stripVersions[st]?.[f.id] || []) if (v.bgImage && v.bgImage.startsWith('data:image') && !v.r2Key) { n++; len += v.bgImage.length; }
    }
  }
  return `${n}:${len}`;
}
export function watchNewPictures(): void {
  if (_watching) return;
  _watching = true;
  trace('PICTS: watching for new pictures (a preview each, when the device is idle)');
  // A preview left waiting from an earlier visit: found once, a little after start.
  setTimeout(() => idle(() => void allPreviews().then((all) => {
    if (all.some((r) => r.r2Key && r.sent === false)) { noteWaiting(); void sendUnsentPreviews(); }
  })), 10_000);
  setInterval(() => {
    if (_busy) return;
    const sig = unsentSignature();
    if (sig === _lastSig) return;
    _lastSig = sig;
    if (sig.startsWith('0:')) return;
    _busy = true;
    // Straight away: 35 ms for a camera picture on Roman's iPad (27 Oct log).
    void previewsForUnsent().finally(() => { _busy = false; });
  }, 1000);   // a look every second (Roman, 27 Oct: "can it be done simultaneously?")
}
async function previewsForUnsent(): Promise<void> {
  const s = useStore.getState();
  const mine: LocalPic[] = [];
  picturesOf(s.frames, s.stripVersions, getCurrentProject().name || 'Untitled', mine);
  for (const l of mine.filter((x) => !x.r2Key)) {
    const t0 = performance.now();   // the whole work: fingerprint, unpack, draw small, pack
    const fp = await fpOf(l.src);
    if (await getPreview(previewId(fp))) continue;
    const made = await shrinkWithSize(l.src).catch(() => null);
    if (!made) continue;
    const ms = Math.round(performance.now() - t0);
    await putPreview({ id: previewId(fp), fp, r2Key: null, at: Date.now(), madeAt: Date.now(), label: l.label, w: made.w, h: made.h, bytes: made.bytes });
    trace(`PICTS: preview made on this device for ${l.label} in ${ms} ms (${Math.round(made.bytes.byteLength / 1024)} KB, not uploaded yet)`);
    await new Promise<void>((r) => setTimeout(r, 0));   // one at a time, the screen keeps drawing between
  }
}

type Device = { byId: Map<string, PreviewRec>; byR2: Map<string, PreviewRec> };

async function loadPic(p: Pic, token: string, dev: Device, online: boolean): Promise<Loaded | null> {
  try {
    let url = _thumbs.get(p.key);
    let w = 0, h = 0;
    const rec = p.local ? dev.byId.get(previewId(p.fp)) : (dev.byR2.get(p.key) ?? (p.fp ? dev.byId.get(previewId(p.fp)) : undefined));
    if (!url) {
      let bytes: ArrayBuffer | null = rec?.bytes ?? null;
      let from = 'device';
      if (rec) { w = rec.w; h = rec.h; }
      const local = _localSrc.get(p.key);
      if (!bytes && local) { const m = await shrinkWithSize(local); if (m) { bytes = m.bytes; w = m.w; h = m.h; from = 'made here'; } }
      if (!bytes && online && p.thumb) { const r = await authed(`/thumbs/${p.key}`, token); if (r.ok) { bytes = await r.arrayBuffer(); from = 'downloaded'; } }
      if (!bytes && online && !p.local) { const m = await makeThumb(p, token); if (m) { bytes = m.bytes; w = m.w; h = m.h; } from = 'made from the full picture'; }
      if (!bytes) return null;
      url = bytesToDataUrl(bytes);
      _thumbs.set(p.key, url);
      if (!w || !h) { const img = await loadImg(url); w = img.naturalWidth; h = img.naturalHeight; }
      // Kept on the device, under the fingerprint when there is one.
      const fp = p.fp ?? (local ? await fpOf(local) : undefined);
      const next: PreviewRec = { id: fp ? previewId(fp) : `r2:${p.key}:preview`, fp, r2Key: p.local ? null : p.key, at: p.uploaded_at, madeAt: rec?.madeAt, label: whereUsed(p), w, h, bytes,
        sent: rec?.sent ?? (online && !p.local ? (p.thumb || from !== 'made here') : undefined) };
      if (!rec || rec.at !== next.at || rec.label !== next.label || (rec.r2Key ?? null) !== next.r2Key) void putPreview(next);
      // Online, a server picture without a preview gets this one.
      if (online && !p.local && !p.thumb && from === 'made here') void keepThumb(p.key, bytes, token, 'from this device');
      _dims.set(p.key, { w, h });
    } else {
      const d = _dims.get(p.key);
      if (d) { w = d.w; h = d.h; } else { const img = await loadImg(url); w = img.naturalWidth; h = img.naturalHeight; }
    }
    return { ...p, url, w, h };
  } catch { return null; }
}
const _dims = new Map<string, { w: number; h: number }>();

/** At most n at a time — a first visit may have hundreds of previews to make. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const GAP = 4;   // the lines between pictures (Roman, 27 Oct: 4 px)
type Row = { pics: Loaded[]; weight: number; el: HTMLElement };

/** Which pictures share a row — decided once. Turning the device does not
 *  move a picture to another row; the rows only grow or shrink (Roman, 26 Oct). */
function buildDay(host: HTMLElement, pics: Loaded[]): Row[] {
  const phone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  const per = phone ? PER_ROW.phone : PER_ROW.wide;
  host.innerHTML = '';
  const rows: Row[] = [];
  let cur: Loaded[] = [], weight = 0;
  const flush = () => {
    if (!cur.length) return;
    const el = document.createElement('div');
    el.className = 'picts-row';
    for (const p of cur) {
      const t = document.createElement('button');
      t.type = 'button'; t.className = 'picts-tile';
      t.title = whereUsed(p);
      t.dataset.key = p.key;
      // A real image, not the tile's wallpaper (27 Oct): the iPad unpacks it on
      // the side, beforehand — not in the middle of a scroll.
      const img = document.createElement('img');
      img.decoding = 'async'; img.loading = 'lazy'; img.alt = ''; img.draggable = false;
      img.src = p.url;
      t.appendChild(img);
      t.insertAdjacentHTML('beforeend', '<span class="picts-tick"></span>');
      el.appendChild(t);
    }
    host.appendChild(el);
    rows.push({ pics: cur, weight, el });
    cur = []; weight = 0;
  };
  for (const p of pics) {
    cur.push(p);
    weight += p.h > p.w ? 1 / per.portrait : 1 / per.landscape;
    if (weight >= 0.999) flush();
  }
  flush();
  return rows;
}

/** Rows of equal height, each picture its own shape, filled edge to edge. An
 *  unfilled last row is as high as a full row of the same pictures would be —
 *  not higher than the row above it (Roman, 26 Oct). */
function sizeRows(rows: Row[], width: number): void {
  for (const r of rows) {
    const ratios = r.pics.map((p) => p.w / p.h);
    const sum = ratios.reduce((a, b) => a + b, 0);
    let h = (width - GAP * (r.pics.length - 1)) / sum;
    if (r.weight < 0.999) h *= r.weight;
    r.el.style.height = `${Math.round(h)}px`;
    [...r.el.children].forEach((t, i) => { (t as HTMLElement).style.width = `${Math.floor(ratios[i] * h)}px`; });
  }
  // A day far off screen is not drawn (27 Oct); its height is kept, so the
  // scrolling never jumps.
  const days = new Set(rows.map((r) => r.el.closest<HTMLElement>('.picts-day')).filter(Boolean) as HTMLElement[]);
  for (const d of days) d.style.containIntrinsicSize = `auto ${d.offsetHeight}px`;
}

/** iPhone and iPad: a touch device whose browser hands files to the share sheet. */
function canShareSheet(): boolean {
  try {
    const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' });
    return navigator.maxTouchPoints > 1 && !!navigator.canShare && navigator.canShare({ files: [probe] });
  } catch { return false; }
}

/** A file name from where the picture is used; the same name twice gets a number. */
function fileNames(pics: Pic[]): string[] {
  const seen = new Map<string, number>();
  return pics.map((p) => {
    const mime = (_localSrc.get(p.key) || '').slice(5, 30);
    const ext = p.local ? (mime.startsWith('image/png') ? 'png' : 'jpg') : (p.key.split('.').pop() || 'jpg').toLowerCase();
    const base = (p.uses[0] ? whereUsed(p) : `Framehow picture ${new Date(p.uploaded_at).toISOString().slice(0, 10)}`).replace(/[\\/:*?"<>|]/g, '-');
    const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
    return `${base}${n > 1 ? ` (${n})` : ''}.${ext}`;
  });
}

export async function openPicts(): Promise<void> {
  const token = getToken();
  if (!token) { trace('PICTS: not signed in'); return; }
  closePicts();
  const root = document.createElement('div');
  root.id = 'pictsLibrary';
  root.style.top = `${topOfContent()}px`;
  // Above the sync log strip when it shows, so the bar is never under it (run 486).
  root.style.bottom = `${logStripHeight()}px`;
  root.innerHTML = `<div class="picts-scroll"><div class="picts-days"></div><p class="picts-empty">Loading your pictures…</p></div>`
    + `<button type="button" class="picts-btn picts-select">SELECT</button>`
    + `<div class="picts-bar"><button type="button" class="picts-btn picts-share" disabled>SHARE</button>`
    + `<span class="picts-count">0 selected</span>`
    + `<button type="button" class="picts-btn picts-delete" disabled title="Comes next">DELETE</button></div>`
    + `<div class="picts-flash"></div>`;
  document.body.appendChild(root);
  _root = root;
  document.body.classList.add('picts-open');
  holdPage();
  document.getElementById('pictsBtn')?.classList.add('active');
  const scroller = root.querySelector<HTMLElement>('.picts-scroll')!;
  // Where everything sits, and whether the first swipe moves the library
  // (27 Oct: on the iPhone it did not, and a gap showed above it).
  setTimeout(() => {
    if (_root !== root) return;
    const r = root.getBoundingClientRect();
    const bars = ['#mainToolbar', '.view-bar', '#detailBar'].map((sel) => {
      const el = document.querySelector<HTMLElement>(sel);
      if (!el || getComputedStyle(el).display === 'none') return `${sel} hidden`;
      const b = el.getBoundingClientRect();
      return `${sel} ${Math.round(b.top)}–${Math.round(b.bottom)}`;
    }).join(', ');
    trace(`PICTS: library ${Math.round(r.top)}–${Math.round(r.bottom)} px; pictures ${scroller.scrollHeight} px tall in ${scroller.clientHeight} px; bars: ${bars}; page at ${Math.round(window.scrollY)}`);
  }, 1200);
  let firstSwipe = true;
  scroller.addEventListener('touchstart', () => {
    if (!firstSwipe) return;
    firstSwipe = false;
    const from = scroller.scrollTop, pageFrom = window.scrollY;
    setTimeout(() => trace(`PICTS: first swipe — library ${Math.round(from)} → ${Math.round(scroller.scrollTop)} px, page ${Math.round(pageFrom)} → ${Math.round(window.scrollY)}`), 700);
  }, { passive: true });
  const daysEl = root.querySelector<HTMLElement>('.picts-days')!;
  const note = root.querySelector<HTMLElement>('.picts-empty')!;
  const selectBtn = root.querySelector<HTMLButtonElement>('.picts-select')!;
  // Where SELECT is, and what is on top of it (27 Oct: missing on the iPad).
  setTimeout(() => {
    if (_root !== root) return;
    const r = selectBtn.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
    const what = (el: HTMLElement | null) => (el ? `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : ''}` : 'nothing');
    trace(`PICTS: SELECT at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)} — ${top === selectBtn ? 'visible' : `covered by ${what(top)}`} (library top ${root.style.top}, screen ${window.innerWidth}×${window.innerHeight})`);
  }, 800);
  const shareBtn = root.querySelector<HTMLButtonElement>('.picts-share')!;
  const countEl = root.querySelector<HTMLElement>('.picts-count')!;
  const flashEl = root.querySelector<HTMLElement>('.picts-flash')!;
  let flashT = 0;
  const say = (t: string) => {
    flashEl.textContent = t; flashEl.classList.add('on');
    clearTimeout(flashT); flashT = window.setTimeout(() => flashEl.classList.remove('on'), 2200);
  };

  // What this device holds, what the server lists, merged (27 Oct).
  const devRecs = await allPreviews();
  const dev: Device = { byId: new Map(devRecs.map((r) => [r.id, r])), byR2: new Map() };
  for (const r of devRecs) if (r.r2Key) dev.byR2.set(r.r2Key, r);
  const locals = await localPictures();
  let server: Pic[] | null = null;
  try {
    server = await Promise.race([
      api.get<{ pictures: Pic[] }>('/user/pictures', token).then((r) => r.pictures),
      new Promise<null>((r) => setTimeout(() => r(null), 8000)),
    ]);
  } catch { server = null; }
  if (_root !== root) return;
  const online = server !== null;
  const items = new Map<string, Pic>();
  for (const p of server ?? []) items.set(p.key, p);
  const blank = (key: string, at: number, label: string, extra: Partial<Pic>): Pic =>
    ({ key, uploaded_at: at, size: 0, width: null, height: null, uses: [], label, ...extra });
  for (const l of locals) {
    if (items.has(l.key)) continue;
    if (!l.r2Key) {
      const fp = l.key.slice('local:'.length);
      // Already on the server, the card not told yet (Roman's iPad, 27 Oct: the
      // library opened in that second and showed the picture twice). Its
      // preview knows the server's name: one picture, not two.
      const known = dev.byId.get(previewId(fp))?.r2Key;
      if (known) {
        _localSrc.set(known, l.src);
        if (!items.has(known)) items.set(known, blank(known, dev.byId.get(previewId(fp))!.at, l.label, { fp }));
        continue;
      }
      items.set(l.key, blank(l.key, dev.byId.get(previewId(fp))?.at ?? Date.now(), l.label, { local: true, fp }));
    } else if (!online) {
      items.set(l.key, blank(l.key, dev.byR2.get(l.key)?.at ?? Date.now(), l.label, {}));
    }
  }
  if (!online) {
    for (const r of devRecs) {
      if (r.r2Key && !items.has(r.r2Key)) items.set(r.r2Key, blank(r.r2Key, r.at, r.label, { fp: r.fp }));
    }
  }
  const pics = [...items.values()].sort((a, b) => a.uploaded_at - b.uploaded_at);
  // THE ORDER OF THE NEWEST (27 Oct, iPhone: "the last 3/4 pictures are not
  // in the right order"): each with its time, whose clock it is, and when this
  // device made its preview (≈ when the picture landed in its card).
  {
    const serverKeys = new Set((server ?? []).map((p) => p.key));
    const hm = (t: number) => new Date(t).toLocaleTimeString();
    const tail = pics.slice(-6).map((p) => {
      const rec = p.local ? dev.byId.get(previewId(p.fp)) : (dev.byR2.get(p.key) ?? (p.fp ? dev.byId.get(previewId(p.fp)) : undefined));
      const clock = serverKeys.has(p.key) ? 'server' : 'this device';
      return `${whereUsed(p)} @${hm(p.uploaded_at)} (${clock}${rec?.madeAt ? `, landed ${hm(rec.madeAt)}` : ''})`;
    });
    trace(`PICTS: the newest, in the library's order: ${tail.join(' | ')}`);
  }
  const unsent = pics.filter((p) => p.local).length;
  trace(`PICTS: ${online ? `${server!.length} picture(s) on the server, ${server!.filter((p) => p.thumb).length} with a preview` : 'OFFLINE'}; on this device: ${devRecs.length} preview(s); not uploaded yet: ${unsent}`);
  try {
    const kept = await navigator.storage?.persisted?.();
    trace(`PICTS: this device ${kept ? 'keeps the app\'s data (allowed)' : 'may clear the app\'s data after some days unused (not allowed to keep it)'}`);
  } catch { /* not told */ }
  if (!online) {
    const off = document.createElement('p');
    off.className = 'picts-offline';
    off.textContent = 'Offline — the pictures kept on this device';
    scroller.insertBefore(off, scroller.firstChild);
  }
  {
    const sizes = (server ?? []).map((p) => p.thumb_size).filter((n): n is number => !!n);
    if (sizes.length) {
      const kb = (n: number) => `${Math.round(n / 1024)} KB`;
      trace(`PICTS: previews: ${sizes.length}, average ${kb(sizes.reduce((a, b) => a + b, 0) / sizes.length)}, smallest ${kb(Math.min(...sizes))}, largest ${kb(Math.max(...sizes))}`);
    }
  }
  if (!pics.length) { note.textContent = online ? 'No pictures yet. Every photo and picture you add appears here.' : 'Offline — no pictures kept on this device yet.'; return; }
  note.remove();

  // Days, oldest at the top; each day gets its line and a place for its rows.
  const days = new Map<string, Pic[]>();
  for (const p of pics) { const k = dayKey(p.uploaded_at); if (!days.has(k)) days.set(k, []); days.get(k)!.push(p); }
  const loadedAll: Loaded[] = [];
  const byKey = new Map<string, Loaded>();
  const slots: { pics: Pic[]; rows: HTMLElement; date: HTMLElement }[] = [];
  for (const [, list] of days) {
    const sec = document.createElement('section');
    sec.className = 'picts-day';
    sec.innerHTML = `<div class="picts-date"><span>${dayLabel(list[0].uploaded_at)}</span><span class="picts-day-all"></span></div><div class="picts-rows"><div class="picts-wait" style="height:${Math.round(Math.min(160, window.innerHeight / 5))}px"></div></div>`;
    daysEl.appendChild(sec);
    slots.push({ pics: list, rows: sec.querySelector<HTMLElement>('.picts-rows')!, date: sec.querySelector<HTMLElement>('.picts-date')! });
  }
  // PINNED TO THE BOTTOM (27 Oct, Roman: "always start at the bottom"). Until
  // the person touches or scrolls the library, it stays on the newest picture,
  // however much the days above it grow while they load and get drawn.
  let pinned = true;
  const toBottom = () => { if (pinned) scroller.scrollTop = scroller.scrollHeight; };
  const letGo = () => {
    if (!pinned) return;
    pinned = false;
    trace(`PICTS: touched — staying where you are (${Math.round(scroller.scrollTop)} of ${scroller.scrollHeight - scroller.clientHeight} px)`);
  };
  for (const ev of ['wheel', 'touchstart', 'pointerdown', 'keydown']) scroller.addEventListener(ev, letGo, { passive: true });
  try { new ResizeObserver(toBottom).observe(daysEl); } catch { /* older browser: the loading steps below still pin */ }
  toBottom();

  // ---- marking -------------------------------------------------------------
  let selecting = false;
  const marked = new Set<string>();
  const tileOf = (key: string) => root.querySelector<HTMLElement>(`.picts-tile[data-key="${CSS.escape(key)}"]`);
  const refresh = () => {
    countEl.textContent = `${marked.size} selected`;
    shareBtn.disabled = marked.size === 0;
    // Grey until something is marked, then white (Roman, 27 Oct) — CANCEL too.
    selectBtn.classList.toggle('ready', selecting && marked.size > 0);
    shareBtn.classList.toggle('ready', marked.size > 0);
    for (const s of slots) {
      const all = s.pics.filter((p) => byKey.has(p.key));
      const every = all.length > 0 && all.every((p) => marked.has(p.key));
      s.date.querySelector<HTMLElement>('.picts-day-all')!.textContent = selecting ? (every ? 'UNSELECT DAY' : 'SELECT DAY') : '';
    }
  };
  const setMark = (key: string, on: boolean) => {
    if (on) marked.add(key); else marked.delete(key);
    tileOf(key)?.classList.toggle('marked', on);
    // The full picture comes in the background, so SHARE is ready when pressed
    // (the share sheet must open inside the tap — no waiting allowed there).
    if (on && !_full.has(key)) void fullBlob(key, token);
  };
  const setSelecting = (on: boolean) => {
    selecting = on;
    root.classList.toggle('selecting', on);
    selectBtn.textContent = on ? 'CANCEL' : 'SELECT';
    if (!on) for (const k of [...marked]) setMark(k, false);
    trace(`PICTS: marking ${on ? 'on' : 'off'}`);
    refresh();
  };
  selectBtn.addEventListener('click', () => setSelecting(!selecting));

  for (const s of slots) {
    s.date.addEventListener('click', () => {
      if (!selecting) return;
      const all = s.pics.filter((p) => byKey.has(p.key));
      const on = !all.every((p) => marked.has(p.key));
      for (const p of all) setMark(p.key, on);
      trace(`PICTS: ${on ? 'marked' : 'unmarked'} the day ${dayLabel(s.pics[0].uploaded_at)} (${all.length})`);
      refresh();
    });
  }

  // ---- share -----------------------------------------------------------------
  shareBtn.addEventListener('click', () => {
    const chosen = pics.filter((p) => marked.has(p.key));
    if (!chosen.length) return;
    const names = fileNames(chosen);
    if (canShareSheet()) {
      const missing = chosen.filter((p) => !_full.has(p.key));
      if (missing.length) { say('One moment…'); for (const p of missing) void fullBlob(p.key, token); return; }
      const files = chosen.map((p, i) => { const b = _full.get(p.key)!; return new File([b], names[i], { type: b.type || 'image/jpeg' }); });
      trace(`PICTS: share sheet — ${files.length} picture(s)`);
      navigator.share({ files }).catch(() => { /* closed without sharing */ });
      return;
    }
    void (async () => {
      say(chosen.length > 1 ? 'Packing…' : 'One moment…');
      const blobs = await pool(chosen, 4, (p) => fullBlob(p.key, token));
      if (blobs.some((b) => !b)) { say('A picture could not be loaded — try again'); return; }
      let file: Blob, name: string;
      if (chosen.length === 1) { file = blobs[0]!; name = names[0]; }
      else {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        blobs.forEach((b, i) => zip.file(names[i], b!));
        file = await zip.generateAsync({ type: 'blob', compression: 'STORE' });
        name = `Framehow pictures – ${chosen.length}.zip`;
      }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 8000);
      trace(`PICTS: downloaded ${name}`);
      say('Downloaded');
    })();
  });

  // ---- tap, and the finger moved across ------------------------------------
  const tap = async (p: Loaded) => {
    const ordered = loadedAll.slice().sort((a, b) => a.uploaded_at - b.uploaded_at);
    const items = ordered.map((x) => ({ src: _fullUrls.get(x.key) ?? x.url, strokes: [], main: true, w: x.w, h: x.h, label: whereUsed(x) }));
    const at = ordered.indexOf(p);
    const u = await fullUrl(p.key, token);
    if (u) items[at].src = u;
    if (_root !== root) return;
    trace(`PICTS: opened ${whereUsed(p)}`);
    openMaxView(items, at, undefined, 'Framehow picture');
    // The neighbours in full, nearest first, for the arrows and the swipe.
    const order = ordered.map((_, i) => i).filter((i) => i !== at).sort((a, b) => Math.abs(a - at) - Math.abs(b - at)).slice(0, 12);
    void pool(order, 2, async (i) => { const fu = await fullUrl(ordered[i].key, token); if (fu) items[i].src = fu; });
  };

  let drag: { x: number; y: number; id: number; mouse: boolean; on: boolean | null; start: number; before: Set<string> } | null = null;
  let justDragged = 0;
  const tileKeys = () => [...root.querySelectorAll<HTMLElement>('.picts-tile')].map((t) => t.dataset.key!);
  const tileAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('.picts-tile') ?? null;
  let edgeRaf = 0, lastPt = { x: 0, y: 0 };
  const markRange = (x: number, y: number) => {
    if (!drag || drag.on === null) return;
    const t = tileAt(x, y);
    if (!t) return;
    const keys = tileKeys();
    const a = drag.start, b = keys.indexOf(t.dataset.key!);
    if (b < 0) return;
    const [lo, hi] = a < b ? [a, b] : [b, a];
    keys.forEach((k, i) => {
      const want = i >= lo && i <= hi ? drag!.on! : drag!.before.has(k);
      if (marked.has(k) !== want) setMark(k, want);
    });
    refresh();
  };
  // Near the top or bottom edge while marking, the library scrolls on its own.
  const edgeScroll = () => {
    if (!drag || drag.on === null) { edgeRaf = 0; return; }
    const r = scroller.getBoundingClientRect();
    const zone = 60;
    const dy = lastPt.y < r.top + zone ? -(r.top + zone - lastPt.y) / 4 : lastPt.y > r.bottom - zone ? (lastPt.y - (r.bottom - zone)) / 4 : 0;
    if (dy) { scroller.scrollTop += dy; markRange(lastPt.x, lastPt.y); }
    edgeRaf = requestAnimationFrame(edgeScroll);
  };
  scroller.addEventListener('pointerdown', (e) => {
    if (!selecting) return;
    const t = (e.target as HTMLElement).closest<HTMLElement>('.picts-tile');
    if (!t) return;
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId, mouse: e.pointerType === 'mouse', on: null, start: tileKeys().indexOf(t.dataset.key!), before: new Set(marked) };
  });
  // On the window, not held by the pictures (run 485: holding the mouse there
  // sent the next press — on SHARE — to the pictures instead).
  window.addEventListener('pointermove', (e) => {
    if (_root !== root) return;
    if (!drag || e.pointerId !== drag.id) return;
    lastPt = { x: e.clientX, y: e.clientY };
    if (drag.on === null) {
      const dx = Math.abs(e.clientX - drag.x), dy = Math.abs(e.clientY - drag.y);
      // A finger: sideways first marks, up or down first scrolls (the browser
      // takes that one). The mouse: any direction marks.
      if (drag.mouse ? Math.max(dx, dy) < 6 : dx < 10 || dx < dy) return;
      const startKey = tileKeys()[drag.start];
      drag.on = !marked.has(startKey);
      trace(`PICTS: drag ${drag.on ? 'marks' : 'unmarks'}`);
      if (!edgeRaf) edgeRaf = requestAnimationFrame(edgeScroll);
    }
    markRange(e.clientX, e.clientY);
  });
  const endDrag = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.on !== null) justDragged = Date.now();
    drag = null;
  };
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);

  daysEl.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('.picts-tile');
    if (!t) return;
    if (Date.now() - justDragged < 300) return;   // the end of a drag is not a tap
    const p = byKey.get(t.dataset.key!);
    if (!p) return;
    if (selecting) { setMark(p.key, !marked.has(p.key)); refresh(); return; }
    void tap(p);
  });

  // ---- turning the device ----------------------------------------------------
  // From the moment the library opens: the same rows, larger or smaller, edge
  // to edge again; the place kept. The iPad sometimes tells its new size a
  // moment late — so once more after a short pause.
  const allRows: Row[] = [];
  let lastWidth = daysEl.clientWidth;
  const resize = () => {
    if (_root !== root) { window.removeEventListener('resize', onTurn); window.removeEventListener('orientationchange', onTurn); return; }
    // A turn makes the app scroll the page to its shot; held still, the page
    // then stayed where the bars were out of view (27 Oct, iPhone). Back to
    // where it was held, so the bars are in place.
    if (_heldY !== null && Math.abs(window.scrollY - _heldY) > 1) window.scrollTo(0, _heldY);
    root.style.top = `${topOfContent()}px`;
    root.style.bottom = `${logStripHeight()}px`;
    const w = daysEl.clientWidth;
    if (w === lastWidth) return;
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const share = scroller.scrollHeight ? scroller.scrollTop / scroller.scrollHeight : 0;
    lastWidth = w;
    sizeRows(allRows, w);
    scroller.scrollTop = atBottom ? scroller.scrollHeight : share * scroller.scrollHeight;
    trace(`PICTS: turned — rows sized for ${w} px`);
  };
  function onTurn(): void { resize(); setTimeout(resize, 350); setTimeout(resize, 900); }
  window.addEventListener('resize', onTurn);
  window.addEventListener('orientationchange', onTurn);

  // A day is laid out when all its pictures are in, so its rows never jump.
  // The newest day first; the others when you scroll near them (27 Oct) —
  // from the device at once, from the server only then.
  const loaded = new Set<number>();
  let done = 0;
  const loadDay = async (i: number) => {
    if (loaded.has(i)) return;
    loaded.add(i);
    const s = slots[i];
    const got = (await pool(s.pics, 6, (p) => loadPic(p, token, dev, online))).filter(Boolean) as Loaded[];
    if (_root !== root) return;
    loadedAll.push(...got);
    for (const p of got) byKey.set(p.key, p);
    const rows = buildDay(s.rows, got);
    if (!got.length) s.rows.closest<HTMLElement>('.picts-day')!.style.display = 'none';
    for (const p of got) if (marked.has(p.key)) tileOf(p.key)?.classList.add('marked');
    const w = daysEl.clientWidth;
    allRows.push(...rows);
    sizeRows(w === lastWidth ? rows : allRows, w);   // turned while loading: the earlier days too
    lastWidth = w;
    toBottom();
    refresh();
    done++;
    if (i === slots.length - 1) {
      requestAnimationFrame(() => {
        toBottom();
        const gap = Math.round(scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight);
        trace(`PICTS: newest day loaded — ${gap <= 2 ? 'at the bottom' : `${gap} px above the bottom`}${pinned ? '' : ' (you had scrolled)'}`);
      });
    }
    if (done === slots.length) finished();
  };
  const near = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) void loadDay(Number((e.target as HTMLElement).dataset.slot));
  }, { root: scroller, rootMargin: '200% 0px' });
  slots.forEach((s, i) => {
    const sec = s.rows.closest<HTMLElement>('.picts-day')!;
    sec.dataset.slot = String(i);
    // Days whose previews are all on the device come at once; the rest when near.
    const allHere = s.pics.every((p) => _thumbs.has(p.key) || (p.local ? dev.byId.has(previewId(p.fp)) : dev.byR2.has(p.key)));
    if (allHere) void loadDay(i); else near.observe(sec);
  });
  void loadDay(slots.length - 1);

  // What could not be shown, and whether a card uses it (27 Oct).
  function finished(): void {
    near.disconnect();
    const missing = pics.filter((p) => !byKey.has(p.key));
    if (missing.length) {
      const noCard = missing.filter((p) => !p.uses.length && !p.local).length;
      trace(`PICTS: shown ${pics.length - missing.length} of ${pics.length}; not shown ${missing.length} — not on any card: ${noCard}, on a card: ${missing.length - noCard}`);
    } else trace(`PICTS: shown all ${pics.length}`);
    idle(() => void makeRoom(pics, online, locals, devRecs));
  }
}

/** WHAT THE DEVICE KEEPS (Roman, 27 Oct): everything not uploaded yet, the
 *  open project's and unsent work's pictures, the whole of today and of the
 *  last day with pictures, and the newest three screens. Only previews go. */
async function makeRoom(pics: Pic[], online: boolean, locals: LocalPic[], devRecs: PreviewRec[]): Promise<void> {
  const phone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  const per = phone ? PER_ROW.phone : PER_ROW.wide;
  const rowH = window.innerWidth / (per.landscape * 16 / 9);
  const screens = Math.ceil(3 * Math.max(1, window.innerHeight / rowH) * per.landscape);
  const newest = new Set(pics.slice(-screens).map((p) => p.key));
  const today = dayKey(Date.now());
  const lastDay = pics.length ? dayKey(pics[pics.length - 1].uploaded_at) : today;
  const onCards = new Set(locals.map((l) => l.key));
  const atOf = new Map(pics.map((p) => [p.key, p.uploaded_at]));
  const go: string[] = [];
  for (const r of devRecs) {
    const key = r.r2Key ?? `local:${r.fp}`;
    if (!r.r2Key) { if (!onCards.has(key)) go.push(r.id); continue; }   // removed from its card before it was ever sent
    if (onCards.has(key) || newest.has(key)) continue;
    if (online && !atOf.has(key)) { go.push(r.id); continue; }           // gone from the server
    const day = dayKey(atOf.get(key) ?? r.at);
    if (day === today || day === lastDay) continue;
    go.push(r.id);
  }
  await deletePreviews(go);
  trace(`PICTS: on this device: kept ${devRecs.length - go.length} preview(s), made room by ${go.length} (keeping ${screens} newest, today, the last day, the open project, everything not uploaded)`);
}

/** Any other view button takes over: the library closes, the button does its work. */
export function wirePictsButton(): void {
  watchNewPictures();
  const btn = document.getElementById('pictsBtn');
  btn?.addEventListener('click', (e) => { e.stopPropagation(); togglePicts(); });
  document.addEventListener('click', (e) => {
    if (!_root) return;
    const t = e.target as HTMLElement;
    if (t.closest('#pictsBtn')) return;
    if (t.closest('.view-btn, .strip-toggle, #mainMenuBtn')) closePicts();
  }, true);
}

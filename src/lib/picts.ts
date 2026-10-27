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

import { api, API_BASE_URL } from './api';
import { getToken } from './session';
import { logStripHeight, trace } from './syncTrace';
import { openMaxView } from './maxView';

type Use = { project_id: string; project: string; shot: string | null; version: string | null };
type Pic = { key: string; uploaded_at: number; size: number; width: number | null; height: number | null; uses: Use[]; thumb?: boolean; thumb_size?: number | null };
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

export function pictsOpen(): boolean { return !!_root; }

export function togglePicts(): void { if (_root) closePicts(); else void openPicts(); }

export function closePicts(): void {
  if (!_root) return;
  _root.remove(); _root = null;
  document.getElementById('pictsBtn')?.classList.remove('active');
  document.body.classList.remove('picts-open');
  trace('PICTS: closed');
}

function topOfContent(): number {
  // Under whatever bars are showing (view bar, detail bar), wherever they are.
  let bottom = 0;
  for (const sel of ['#mainToolbar', '.view-bar', '#detailBar']) {
    const el = document.querySelector<HTMLElement>(sel);
    if (!el || el.offsetParent === null) continue;
    const r = el.getBoundingClientRect();
    if (r.height > 0 && r.bottom > bottom) bottom = r.bottom;
  }
  return Math.max(0, Math.round(bottom));
}

const dayKey = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const dayLabel = (t: number) => new Date(t).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).toUpperCase();

function whereUsed(p: Pic): string {
  const u = p.uses[0];
  if (!u) return 'not on a card';
  return `${u.project} – shot ${u.shot ?? '?'}${u.version ? ` – ${u.version}` : ''}`;
}

const authed = (path: string, token: string, init: RequestInit = {}) =>
  fetch(`${API_BASE_URL}${path}`, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` } });

/** The full picture, once per session. */
async function fullBlob(key: string, token: string): Promise<Blob | null> {
  const had = _full.get(key);
  if (had) return had;
  const res = await authed(`/images/${key}`, token);
  if (!res.ok) return null;
  const b = await res.blob();
  _full.set(key, b);
  return b;
}
async function fullUrl(key: string, token: string): Promise<string | null> {
  const had = _fullUrls.get(key);
  if (had) return had;
  const b = await fullBlob(key, token);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  _fullUrls.set(key, u);
  return u;
}

const loadImg = (url: string) => new Promise<HTMLImageElement>((ok, bad) => {
  const img = new Image(); img.onload = () => ok(img); img.onerror = () => bad(new Error('no picture')); img.src = url;
});

/** Shrink a picture to its preview. */
async function shrink(url: string): Promise<Blob | null> {
  const img = await loadImg(url);
  const k = Math.min(1, THUMB_LONG / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', THUMB_Q));
}

function keepThumb(key: string, blob: Blob, token: string, why: string): Promise<boolean> {
  return authed(`/thumbs/${key}`, token, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: blob })
    .then((r) => { trace(`PICTS: preview kept for ${key.split('/').pop()} (${Math.round(blob.size / 1024)} KB, ${why}) — ${r.status}`); return r.ok; })
    .catch(() => { trace(`PICTS: preview not kept for ${key.split('/').pop()} (offline?)`); return false; });
}

/** An older picture without a preview: made once from the full picture. */
async function makeThumb(p: Pic, token: string): Promise<Blob | null> {
  const url = await fullUrl(p.key, token);
  if (!url) return null;
  const blob = await shrink(url);
  if (blob) void keepThumb(p.key, blob, token, 'first look');
  return blob;
}

// ---- previews made when a picture is added (27 Oct, Roman) -----------------
// From the picture already in hand, so nothing is downloaded. Never in the
// way: it waits until the upload has settled (a few seconds of quiet after the
// last one), then does one picture per moment the device has nothing to do.
const _queue: { key: string; blob: Blob }[] = [];
let _queueTimer = 0;
const idle = (fn: () => void) => {
  const ric = (window as unknown as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(fn, { timeout: 10_000 }); else setTimeout(fn, 400);
};
export function queuePreview(key: string, blob: Blob): void {
  _queue.push({ key, blob });
  clearTimeout(_queueTimer);
  _queueTimer = window.setTimeout(() => idle(nextPreview), 4000);
}
function nextPreview(): void {
  const job = _queue.shift();
  if (!job) return;
  const token = getToken();
  if (!token) { _queue.length = 0; return; }
  const url = URL.createObjectURL(job.blob);
  void shrink(url).then((b) => (b ? keepThumb(job.key, b, token, 'on adding') : false))
    .catch(() => false)
    .finally(() => { URL.revokeObjectURL(url); if (_queue.length) idle(nextPreview); });
}

async function loadPic(p: Pic, token: string): Promise<Loaded | null> {
  try {
    let url = _thumbs.get(p.key);
    if (!url) {
      let blob: Blob | null = null;
      if (p.thumb) { const r = await authed(`/thumbs/${p.key}`, token); if (r.ok) blob = await r.blob(); }
      if (!blob) blob = await makeThumb(p, token);
      if (!blob) return null;
      url = URL.createObjectURL(blob);
      _thumbs.set(p.key, url);
    }
    const img = await loadImg(url);
    return { ...p, url, w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}

/** At most n at a time — a first visit may have hundreds of previews to make. */
async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

const GAP = 3;   // the lines between pictures (Roman, 27 Oct: 3 px)
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
    const ext = (p.key.split('.').pop() || 'jpg').toLowerCase();
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
  document.getElementById('pictsBtn')?.classList.add('active');
  const scroller = root.querySelector<HTMLElement>('.picts-scroll')!;
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

  let pics: Pic[] = [];
  try { pics = (await api.get<{ pictures: Pic[] }>('/user/pictures', token)).pictures; }
  catch { note.textContent = 'The library could not be reached — try again when online.'; return; }
  if (_root !== root) return;
  trace(`PICTS: ${pics.length} picture(s) on the server, ${pics.filter((p) => p.thumb).length} with a preview`);
  {
    const sizes = pics.map((p) => p.thumb_size).filter((n): n is number => !!n);
    if (sizes.length) {
      const kb = (n: number) => `${Math.round(n / 1024)} KB`;
      trace(`PICTS: previews: ${sizes.length}, average ${kb(sizes.reduce((a, b) => a + b, 0) / sizes.length)}, smallest ${kb(Math.min(...sizes))}, largest ${kb(Math.max(...sizes))}`);
    }
  }
  if (!pics.length) { note.textContent = 'No pictures yet. Every photo and picture you add appears here.'; return; }
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
  scroller.scrollTop = scroller.scrollHeight;   // newest at the bottom, in view

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
  function onTurn(): void { resize(); setTimeout(resize, 350); }
  window.addEventListener('resize', onTurn);
  window.addEventListener('orientationchange', onTurn);

  // The newest day first, so what is on screen arrives first; a day is laid
  // out when all its pictures are in, so its rows never jump.
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    const got = (await pool(s.pics, 6, (p) => loadPic(p, token))).filter(Boolean) as Loaded[];
    if (_root !== root) return;
    loadedAll.push(...got);
    for (const p of got) byKey.set(p.key, p);
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const rows = buildDay(s.rows, got);
    for (const p of got) if (marked.has(p.key)) tileOf(p.key)?.classList.add('marked');
    const w = daysEl.clientWidth;
    allRows.push(...rows);
    sizeRows(w === lastWidth ? rows : allRows, w);   // turned while loading: the earlier days too
    lastWidth = w;
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
    refresh();
  }
}

/** Any other view button takes over: the library closes, the button does its work. */
export function wirePictsButton(): void {
  const btn = document.getElementById('pictsBtn');
  btn?.addEventListener('click', (e) => { e.stopPropagation(); togglePicts(); });
  document.addEventListener('click', (e) => {
    if (!_root) return;
    const t = e.target as HTMLElement;
    if (t.closest('#pictsBtn')) return;
    if (t.closest('.view-btn, .strip-toggle, #mainMenuBtn')) closePicts();
  }, true);
}

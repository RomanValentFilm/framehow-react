// THE PICTS LIBRARY (26 October, Roman).
//
// Every picture the account ever uploaded, by the day it arrived, newest at the
// bottom — like the phone's own photo library. Each picture keeps its own
// shape: rows of equal height, filled edge to edge, nothing cropped. A row
// holds 5 landscape or 8 portrait pictures on a desktop or iPad, 3 of either on
// a phone. Tap a picture: the max screen, which returns here.
//
// Step 2 of the library: looking only. Select, share and delete follow.
// Turning the device keeps every row as it is, only larger or smaller (091).

import { api, API_BASE_URL } from './api';
import { getToken } from './session';
import { trace } from './syncTrace';
import { openMaxView } from './maxView';

type Use = { project_id: string; project: string; shot: string | null; version: string | null };
type Pic = { key: string; uploaded_at: number; size: number; width: number | null; height: number | null; uses: Use[] };
type Loaded = Pic & { url: string; w: number; h: number };

/** Per row: landscape and portrait pictures (Roman, 26 Oct; portraits tuned to 8). */
const PER_ROW = { wide: { landscape: 5, portrait: 8 }, phone: { landscape: 3, portrait: 3 } };

let _root: HTMLElement | null = null;
const _urls = new Map<string, string>();   // r2 key → object URL, kept for the session

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

async function loadPic(p: Pic, token: string): Promise<Loaded | null> {
  try {
    let url = _urls.get(p.key);
    if (!url) {
      const res = await fetch(`${API_BASE_URL}/images/${p.key}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return null;
      url = URL.createObjectURL(await res.blob());
      _urls.set(p.key, url);
    }
    const img = new Image();
    await new Promise<void>((ok, bad) => { img.onload = () => ok(); img.onerror = () => bad(); img.src = url!; });
    return { ...p, url, w: img.naturalWidth, h: img.naturalHeight };
  } catch { return null; }
}

const GAP = 2;
type Row = { pics: Loaded[]; weight: number; el: HTMLElement };

/** Which pictures share a row — decided once. Turning the device does not
 *  move a picture to another row; the rows only grow or shrink (Roman, 26 Oct). */
function buildDay(host: HTMLElement, pics: Loaded[], onTap: (p: Loaded) => void): Row[] {
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
      t.style.backgroundImage = `url("${p.url}")`;
      t.title = whereUsed(p);
      t.dataset.key = p.key;
      t.addEventListener('click', () => onTap(p));
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
}

export async function openPicts(): Promise<void> {
  const token = getToken();
  if (!token) { trace('PICTS: not signed in'); return; }
  closePicts();
  const root = document.createElement('div');
  root.id = 'pictsLibrary';
  root.style.top = `${topOfContent()}px`;
  root.innerHTML = `<div class="picts-scroll"><div class="picts-days"></div><p class="picts-empty">Loading your pictures…</p></div>`;
  document.body.appendChild(root);
  _root = root;
  document.body.classList.add('picts-open');
  document.getElementById('pictsBtn')?.classList.add('active');
  const scroller = root.querySelector<HTMLElement>('.picts-scroll')!;
  const daysEl = root.querySelector<HTMLElement>('.picts-days')!;
  const note = root.querySelector<HTMLElement>('.picts-empty')!;

  let pics: Pic[] = [];
  try { pics = (await api.get<{ pictures: Pic[] }>('/user/pictures', token)).pictures; }
  catch { note.textContent = 'The library could not be reached — try again when online.'; return; }
  if (_root !== root) return;
  trace(`PICTS: ${pics.length} picture(s) on the server`);
  if (!pics.length) { note.textContent = 'No pictures yet. Every photo and picture you add appears here.'; return; }
  note.remove();

  // Days, oldest at the top; each day gets its line and a place for its rows.
  const days = new Map<string, Pic[]>();
  for (const p of pics) { const k = dayKey(p.uploaded_at); if (!days.has(k)) days.set(k, []); days.get(k)!.push(p); }
  const loadedAll: Loaded[] = [];
  const slots: { pics: Pic[]; rows: HTMLElement }[] = [];
  for (const [, list] of days) {
    const sec = document.createElement('section');
    sec.className = 'picts-day';
    sec.innerHTML = `<div class="picts-date">${dayLabel(list[0].uploaded_at)}</div><div class="picts-rows"><div class="picts-wait" style="height:${Math.round(Math.min(160, window.innerHeight / 5))}px"></div></div>`;
    daysEl.appendChild(sec);
    slots.push({ pics: list, rows: sec.querySelector<HTMLElement>('.picts-rows')! });
  }
  scroller.scrollTop = scroller.scrollHeight;   // newest at the bottom, in view

  const tap = (p: Loaded) => {
    const ordered = loadedAll.slice().sort((a, b) => a.uploaded_at - b.uploaded_at);
    const items = ordered.map((x) => ({ src: x.url, strokes: [], main: true, w: x.w, h: x.h, label: whereUsed(x) }));
    trace(`PICTS: opened ${whereUsed(p)}`);
    openMaxView(items, ordered.indexOf(p), undefined, 'Framehow picture');
  };
  // A turn of the device, from the moment the library opens: the same rows,
  // larger or smaller, edge to edge again; the place kept. The iPad sometimes
  // tells its new size a moment late — so once more after a short pause.
  const allRows: Row[] = [];
  let lastWidth = daysEl.clientWidth;
  const resize = () => {
    if (_root !== root) { window.removeEventListener('resize', onTurn); window.removeEventListener('orientationchange', onTurn); return; }
    root.style.top = `${topOfContent()}px`;
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
    const got = (await Promise.all(s.pics.map((p) => loadPic(p, token)))).filter(Boolean) as Loaded[];
    if (_root !== root) return;
    loadedAll.push(...got);
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    const rows = buildDay(s.rows, got, tap);
    const w = daysEl.clientWidth;
    allRows.push(...rows);
    sizeRows(w === lastWidth ? rows : allRows, w);   // turned while loading: the earlier days too
    lastWidth = w;
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
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

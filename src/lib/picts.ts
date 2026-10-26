// THE PICTS LIBRARY (26 October, Roman).
//
// Every picture the account ever uploaded, by the day it arrived, newest at the
// bottom — like the phone's own photo library. Each picture keeps its own
// shape: rows of equal height, filled edge to edge, nothing cropped. A row
// holds 5 landscape or 8 portrait pictures on a desktop or iPad, 3 of either on
// a phone. Tap a picture: the max screen, which returns here.
//
// Step 2 of the library: looking only. Select, share and delete follow.

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

/** Rows of equal height, each picture its own shape, filled edge to edge. */
function layoutDay(host: HTMLElement, pics: Loaded[], width: number, onTap: (p: Loaded) => void): void {
  const phone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  const per = phone ? PER_ROW.phone : PER_ROW.wide;
  const GAP = 2;
  host.innerHTML = '';
  let row: Loaded[] = [], weight = 0;
  const fullLandscapeH = (width - GAP * (per.landscape - 1)) / (per.landscape * 16 / 9);
  const flush = (last: boolean) => {
    if (!row.length) return;
    const ratios = row.map((p) => p.w / p.h);
    const sum = ratios.reduce((a, b) => a + b, 0);
    let h = (width - GAP * (row.length - 1)) / sum;
    if (last && weight < 1) h = Math.min(h, fullLandscapeH * (row.every((p) => p.h > p.w) ? 2 : 1));   // an unfilled last row is not stretched
    const r = document.createElement('div');
    r.className = 'picts-row';
    r.style.height = `${Math.round(h)}px`;
    row.forEach((p, i) => {
      const t = document.createElement('button');
      t.type = 'button'; t.className = 'picts-tile';
      t.style.width = `${Math.floor(ratios[i] * h)}px`;
      t.style.backgroundImage = `url("${p.url}")`;
      t.title = whereUsed(p);
      t.dataset.key = p.key;
      t.addEventListener('click', () => onTap(p));
      r.appendChild(t);
    });
    host.appendChild(r);
    row = []; weight = 0;
  };
  for (const p of pics) {
    row.push(p);
    weight += p.h > p.w ? 1 / per.portrait : 1 / per.landscape;
    if (weight >= 0.999) flush(false);
  }
  flush(true);
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
  // The newest day first, so what is on screen arrives first; a day is laid
  // out when all its pictures are in, so its rows never jump.
  for (let i = slots.length - 1; i >= 0; i--) {
    const s = slots[i];
    const got = (await Promise.all(s.pics.map((p) => loadPic(p, token)))).filter(Boolean) as Loaded[];
    if (_root !== root) return;
    loadedAll.push(...got);
    const atBottom = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 40;
    layoutDay(s.rows, got, daysEl.clientWidth, tap);
    if (atBottom) scroller.scrollTop = scroller.scrollHeight;
  }
  window.addEventListener('resize', relayout);
  function relayout(): void {
    if (_root !== root) { window.removeEventListener('resize', relayout); return; }
    root.style.top = `${topOfContent()}px`;
    for (const s of slots) {
      const got = loadedAll.filter((p) => s.pics.some((q) => q.key === p.key));
      if (got.length) layoutDay(s.rows, got, daysEl.clientWidth, tap);
    }
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

// MAX SCREEN (23 October, Roman).
//
// A half-transparent double-arrow in the top right corner of every picture.
// Tap it and that picture — the photo with its drawings and text, exactly as
// the card shows it — fills the screen: the long side touches the edge, black
// around it, the app's bars gone. Two fingers zoom, one finger moves the
// zoomed picture, a double tap goes back to fit. Not zoomed, a swipe goes to
// the next version of the same look. A preview only: nothing is drawn,
// nothing is changed, nothing is sent. The double-arrow in the top right
// closes it (the same corner as in the draw screen), so does a tap on the
// picture when it is not zoomed, and Escape.
//
// A crop function may come here later (Roman, 23 Oct) — not now.

import { state } from '../store/state';
import type { Stroke } from '../store/state';
import { getStripVersions } from './helpers';
import { drawMainStrokes, drawVersionStrokes } from './drawing';
import { trace } from './syncTrace';

type Item = { src: string | null | undefined; strokes: Stroke[] | undefined; main: boolean; w: number; h: number; label: string };

const EXPAND = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
const COLLAPSE = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"><path d="M4 14h6v6M20 10h-6V4M10 14l-7 7M14 10l7-7"/></svg>';

/** Put the corner button on a card's canvas (called by the painter). Once. */
export function attachMaxButton(cvs: HTMLCanvasElement | HTMLImageElement, hasPicture: boolean): void {
  const wrap = cvs.parentElement;
  if (!wrap || !wrap.classList.contains('canvas-wrap')) return;
  if (wrap.closest('.fs-overlay, #maxView')) return;          // not inside the draw screen or itself
  let btn = wrap.querySelector<HTMLButtonElement>(':scope > .max-btn');
  if (!hasPicture) { btn?.remove(); return; }
  if (btn) return;
  btn = document.createElement('button');
  btn.className = 'max-btn';
  btn.type = 'button';
  btn.title = 'Max screen';
  btn.innerHTML = EXPAND;
  btn.addEventListener('click', (e) => {
    e.stopPropagation(); e.preventDefault();
    openFromCanvas(cvs);
  });
  // The card's own handlers must not see this tap (drag, swipe, draw).
  ['pointerdown', 'pointerup', 'touchstart', 'touchend', 'mousedown', 'mouseup'].forEach((ev) =>
    btn!.addEventListener(ev, (e) => e.stopPropagation(), { passive: true }));
  wrap.appendChild(btn);
}

/** A main card with a plain photo and nothing drawn shows an <img>, not a
 *  canvas, so the painter never sees it. Those are found whenever the page
 *  changes and get their button too. Wired once at start. */
export function watchForPlainPictures(): void {
  let queued = false;
  const sweep = () => {
    queued = false;
    document.querySelectorAll<HTMLImageElement>('.canvas-wrap > img:not([data-maxed])').forEach((img) => {
      img.dataset.maxed = '1';
      attachMaxButton(img, true);
    });
  };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(sweep); } })
    .observe(document.body, { childList: true, subtree: true });
  sweep();
}

/** Which look and which strip this canvas belongs to, from where it sits. */
function openFromCanvas(cvs: HTMLCanvasElement | HTMLImageElement): void {
  const s = state();
  const card = cvs.closest<HTMLElement>('.frame-card, .grid3x2-card-wrap');
  const fidStr = card?.dataset.mfid ?? card?.dataset.vfid ?? card?.dataset.g3fid ?? card?.dataset.ovfid ?? card?.dataset.fid;
  const fid = fidStr ? Number(fidStr) : NaN;
  const f = s.frames.find((x) => x.id === fid);
  if (!f) return;
  const isMain = !!card?.dataset.mfid || (!!card?.dataset.g3fid && (s.crossCompare[fid] ?? -1) < 0);
  const w = f.cropW || 960, h = f.cropH || 540;
  const items: Item[] = [];
  let start = 0;
  if (isMain) {
    items.push({ src: f.src, strokes: f.strokes, main: true, w, h, label: f.label || '' });
    for (const v of getStripVersions(fid, 'ver')) if (v.bgImage || (v.strokes?.length ?? 0) > 0)
      items.push({ src: v.bgImage, strokes: v.strokes, main: false, w, h, label: v.label || '' });
  } else {
    // Which strip: a version column says so; a 3x2 card shows its cross strip;
    // an overview row shows the companion column.
    const strip = (card?.dataset.strip
      || (card?.dataset.ovfid ? (s.activeStrips.find((st: string) => st !== 'main') || 'ver') : null)
      || s.crossCompareStrip[fid] || 'ver') as 'ver' | 'floor' | 'refs';
    const vers = getStripVersions(fid, strip);
    const showing = card?.dataset.g3fid ? (s.crossCompare[fid] ?? 0)
      : card?.dataset.ovi !== undefined ? Number(card.dataset.ovi)
      : (s.activeTab[fid] ?? 0);
    vers.forEach((v, i) => {
      if (!v.bgImage && !(v.strokes?.length)) return;
      if (i === showing) start = items.length;
      items.push({ src: v.bgImage, strokes: v.strokes, main: false, w, h, label: v.label || '' });
    });
  }
  if (!items.length) return;
  trace(`max screen: shot ${s.frames.indexOf(f) + 1}, ${items.length} picture(s)`);
  openMaxView(items, start);
}

// --- the viewer -------------------------------------------------------------
let _root: HTMLElement | null = null;

function paintItem(cvs: HTMLCanvasElement, it: Item): void {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const fitK = Math.min(window.innerWidth / it.w, window.innerHeight / it.h);
  const k = fitK * dpr * 1.5;                           // room to zoom in sharply
  cvs.width = Math.round(it.w * k); cvs.height = Math.round(it.h * k);
  cvs.style.width = `${it.w * fitK}px`; cvs.style.height = `${it.h * fitK}px`;
  const ctx = cvs.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, it.w, it.h);
  const draw = () => {
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.clearRect(0, 0, it.w, it.h);
    if (img) {
      const sc = Math.min(it.w / img.width, it.h / img.height);
      const dw = img.width * sc, dh = img.height * sc;
      ctx.drawImage(img, (it.w - dw) / 2, (it.h - dh) / 2, dw, dh);
    }
    (it.main ? drawMainStrokes : drawVersionStrokes)(ctx, it.strokes || []);
  };
  let img: HTMLImageElement | null = null;
  if (it.src) {
    img = new Image();
    img.onload = draw;
    img.src = it.src;
    if (img.complete && img.naturalWidth) draw();
  } else draw();
}

export function openMaxView(items: Item[], index: number): void {
  closeMaxView();
  let i = Math.max(0, Math.min(index, items.length - 1));
  const root = document.createElement('div');
  root.id = 'maxView';
  root.innerHTML = `<div class="max-stage"><canvas></canvas></div>
    <button class="max-close" type="button" title="Close">${COLLAPSE}</button>
    <div class="max-label"></div>`;
  document.body.appendChild(root);
  _root = root;
  document.body.classList.add('max-view-open');
  const stage = root.querySelector<HTMLElement>('.max-stage')!;
  const cvs = root.querySelector('canvas')!;
  const label = root.querySelector<HTMLElement>('.max-label')!;

  let scale = 1, tx = 0, ty = 0;
  // THE TAP THAT OPENED IT MUST NOT CLOSE IT (Roman, 24 Oct: "you have to tap
  // twice"). After a touch, iOS sends a late mouse click to whatever is under
  // the finger — by then the viewer. So: no closing in the first half second,
  // and mouse events within a second of a touch are the touch's echo.
  const openedAt = Date.now();
  let lastTouch = 0;
  const settled = () => Date.now() - openedAt > 500;
  const apply = () => { stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const show = () => {
    scale = 1; tx = 0; ty = 0; apply();
    paintItem(cvs, items[i]);
    // Only the name of what is on screen (Roman, 24 Oct): the shot's number
    // for the main picture, the version's label (L2, v3) for a version.
    label.textContent = items[i].label;
  };
  const go = (d: number) => { const n = i + d; if (n < 0 || n >= items.length) return; i = n; show(); };
  show();

  // Two fingers: zoom around the pinch. One finger: move when zoomed, swipe when not.
  let pinch: { d: number; s: number; cx: number; cy: number; tx: number; ty: number } | null = null;
  let drag: { x: number; y: number; tx: number; ty: number; t: number } | null = null;
  let lastTap = 0;
  const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mid = (t: TouchList) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });
  root.addEventListener('touchstart', (e) => {
    lastTouch = Date.now();
    if (e.touches.length === 2) {
      const m = mid(e.touches);
      pinch = { d: dist(e.touches), s: scale, cx: m.x - window.innerWidth / 2, cy: m.y - window.innerHeight / 2, tx, ty };
      drag = null;
    } else if (e.touches.length === 1) {
      drag = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx, ty, t: Date.now() };
    }
  }, { passive: true });
  root.addEventListener('touchmove', (e) => {
    if (pinch && e.touches.length === 2) {
      e.preventDefault();
      const ns = Math.max(1, Math.min(6, pinch.s * dist(e.touches) / pinch.d));
      // keep the point under the fingers where it is
      tx = pinch.cx - (pinch.cx - pinch.tx) * (ns / pinch.s);
      ty = pinch.cy - (pinch.cy - pinch.ty) * (ns / pinch.s);
      scale = ns; apply();
    } else if (drag && e.touches.length === 1 && scale > 1) {
      e.preventDefault();
      tx = drag.tx + (e.touches[0].clientX - drag.x);
      ty = drag.ty + (e.touches[0].clientY - drag.y);
      apply();
    }
  }, { passive: false });
  root.addEventListener('touchend', (e) => {
    lastTouch = Date.now();
    if (pinch && e.touches.length < 2) { pinch = null; if (scale <= 1.02) { scale = 1; tx = 0; ty = 0; apply(); } return; }
    if (!drag || e.touches.length) return;
    const dx = e.changedTouches[0].clientX - drag.x, dy = e.changedTouches[0].clientY - drag.y;
    const quick = Date.now() - drag.t < 400;
    drag = null;
    if (scale === 1 && Math.abs(dx) > 50 && Math.abs(dy) < Math.abs(dx) * 0.7) { go(dx < 0 ? 1 : -1); return; }
    if (Math.hypot(dx, dy) < 10 && quick) {
      const now = Date.now();
      if (now - lastTap < 320) { scale = 1; tx = 0; ty = 0; apply(); lastTap = 0; return; }   // double tap: fit
      lastTap = now;
      if (scale === 1 && settled()) setTimeout(() => { if (lastTap === now) closeMaxView(); }, 330);   // single tap, not zoomed: close
    }
  });
  // Mouse / trackpad: wheel zooms, drag moves, click closes when not zoomed.
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const ns = Math.max(1, Math.min(6, scale * (e.deltaY < 0 ? 1.1 : 0.9)));
    const cx = e.clientX - window.innerWidth / 2, cy = e.clientY - window.innerHeight / 2;
    tx = cx - (cx - tx) * (ns / scale); ty = cy - (cy - ty) * (ns / scale); scale = ns;
    if (scale === 1) { tx = 0; ty = 0; }
    apply();
  }, { passive: false });
  let mdrag: { x: number; y: number; tx: number; ty: number; moved: boolean } | null = null;
  const touchEcho = () => Date.now() - lastTouch < 1000;
  root.addEventListener('mousedown', (e) => { if (touchEcho()) return; mdrag = { x: e.clientX, y: e.clientY, tx, ty, moved: false }; });
  root.addEventListener('mousemove', (e) => {
    if (!mdrag) return;
    if (Math.hypot(e.clientX - mdrag.x, e.clientY - mdrag.y) > 4) mdrag.moved = true;
    if (scale > 1) { tx = mdrag.tx + e.clientX - mdrag.x; ty = mdrag.ty + e.clientY - mdrag.y; apply(); }
  });
  root.addEventListener('mouseup', (e) => {
    if (!mdrag || touchEcho() || !settled()) { mdrag = null; return; }
    const dx = e.clientX - mdrag.x; const moved = mdrag.moved; mdrag = null;
    if ((e.target as HTMLElement).closest('.max-close')) return;
    if (scale === 1 && Math.abs(dx) > 50) { go(dx < 0 ? 1 : -1); return; }
    if (!moved && scale === 1) closeMaxView();
  });
  root.querySelector('.max-close')!.addEventListener('click', (e) => { e.stopPropagation(); closeMaxView(); });
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') closeMaxView();
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  document.addEventListener('keydown', onKey);
  (root as HTMLElement & { __fhKey?: (e: KeyboardEvent) => void }).__fhKey = onKey;
  const onResize = () => show();
  window.addEventListener('resize', onResize);
  (root as HTMLElement & { __fhResize?: () => void }).__fhResize = onResize;
}

export function closeMaxView(): void {
  if (!_root) return;
  const r = _root as HTMLElement & { __fhKey?: (e: KeyboardEvent) => void; __fhResize?: () => void };
  if (r.__fhKey) document.removeEventListener('keydown', r.__fhKey);
  if (r.__fhResize) window.removeEventListener('resize', r.__fhResize);
  r.remove();
  _root = null;
  document.body.classList.remove('max-view-open');
}

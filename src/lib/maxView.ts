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
import { getStripVersions, getStripActiveTab, followVersion, stripScrollId } from './helpers';
import { drawMainStrokes, drawVersionStrokes } from './drawing';
import { trace } from './syncTrace';
import { getCurrentProject } from './currentProject';

type Item = { src: string | null | undefined; strokes: Stroke[] | undefined; main: boolean; w: number; h: number; label: string;
  strip?: 'ver' | 'floor' | 'refs'; vi?: number };

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

type Strip = 'ver' | 'floor' | 'refs';

/**
 * Which look, which strip and WHICH PICTURE this canvas shows, from where it
 * sits. It opens on the picture that was pressed — period (Roman, 24 Oct: a
 * main card showing a fresh shot opened on the main picture instead, because
 * "main card" was taken for "main picture"). And when the viewer is closed on
 * another picture after swiping, the card is turned to that one, the same way
 * the card's own arrows would do it.
 */
function openFromCanvas(cvs: HTMLCanvasElement | HTMLImageElement): void {
  const s = state();
  const card = cvs.closest<HTMLElement>('.frame-card, .grid3x2-card-wrap');
  const fidStr = card?.dataset.mfid ?? card?.dataset.vfid ?? card?.dataset.g3fid ?? card?.dataset.ovfid ?? card?.dataset.fid;
  const fid = fidStr ? Number(fidStr) : NaN;
  const f = s.frames.find((x) => x.id === fid);
  if (!f || !card) return;
  const w = f.cropW || 960, h = f.cropH || 540;
  const items: Item[] = [];
  let start = 0;
  const mainItem = (): Item => ({ src: f.src, strokes: f.strokes, main: true, w, h, label: f.label || '' });
  const verItem = (v: ReturnType<typeof getStripVersions>[number], strip: Strip, vi: number): Item =>
    ({ src: v.bgImage, strokes: v.strokes, main: false, w, h, label: v.label || '', strip, vi });
  const hasSomething = (v: ReturnType<typeof getStripVersions>[number]) => !!v.bgImage || (v.strokes?.length ?? 0) > 0;

  const mainOrG3 = card.dataset.mfid !== undefined || card.dataset.g3fid !== undefined;
  let leave: ((it: Item) => void) | undefined;
  if (mainOrG3) {
    // Main picture first, then the versions of the strip the card cross-shows
    // (VERSN when it shows nothing but main). Showing = the cross pointer.
    const cross = s.crossCompare[fid] ?? -1;
    const strip = (s.crossCompareStrip[fid] || 'ver') as Strip;
    items.push(mainItem());
    getStripVersions(fid, strip).forEach((v, i) => {
      if (!hasSomething(v)) return;
      if (i === cross) start = items.length;
      items.push(verItem(v, strip, i));
    });
    const isG3 = card.dataset.g3fid !== undefined;
    leave = (it) => {
      const st = state();
      if (isG3 || st.currentViewMode === 'main') {
        // This card shows the picture itself (cross pointer), like its arrows.
        if (it.main) { st.crossCompare[fid] = -1; st.crossCompareStrip[fid] = 'ver'; }
        else { st.crossCompare[fid] = it.vi!; st.crossCompareStrip[fid] = it.strip!; st.activeTab[fid] = it.vi!; }
        const w3 = (window as unknown as Record<string, (el: HTMLElement, fid: number) => void>);
        if (isG3) w3.__fh_renderGrid3x2Card?.(card, fid); else w3.__fh_renderMainFrame?.(card, fid);
      } else if (!it.main) {
        // Main next to its strips: the strip's column turns to that version.
        followVersion(fid, it.strip!, it.vi!);
        const vd = document.querySelector<HTMLElement>(`#${stripScrollId(it.strip!)} .frame-card[data-vfid="${fid}"]`);
        if (vd) (window as unknown as Record<string, (el: HTMLElement, fid: number, strip: Strip) => void>).__fh_renderVersionFrame?.(vd, fid, it.strip!);
      }
    };
  } else {
    // A version column says its strip; an overview row shows the companion column.
    const strip = (card.dataset.strip
      || (card.dataset.ovfid ? (s.activeStrips.find((st: string) => st !== 'main') || 'ver') : null)
      || 'ver') as Strip;
    const showing = card.dataset.ovi !== undefined ? Number(card.dataset.ovi) : getStripActiveTab(fid, strip);
    getStripVersions(fid, strip).forEach((v, i) => {
      if (!hasSomething(v)) return;
      if (i === showing) start = items.length;
      items.push(verItem(v, strip, i));
    });
    if (card.dataset.vfid !== undefined) leave = (it) => {
      followVersion(fid, strip, it.vi!);
      (window as unknown as Record<string, (el: HTMLElement, fid: number, strip: Strip) => void>).__fh_renderVersionFrame?.(card, fid, strip);
    };
  }
  if (!items.length) return;
  trace(`max screen: shot ${s.frames.indexOf(f) + 1}, ${items.length} picture(s), opens on ${items[start].label || 'main'}`);
  const shotNo = s.frames.indexOf(f) + 1;
  const fileBase = `${(getCurrentProject().name || 'Framehow').replace(/[\\/:*?"<>|]+/g, ' ').trim()} – shot ${shotNo}`;
  openMaxView(items, start, (it, moved) => {
    if (!moved || !leave) return;
    trace(`max screen: left on ${it.label || 'main'} — the card follows`);
    leave(it);
  }, fileBase);
}

// --- sharing (26 Oct, Roman) ------------------------------------------------
// The picture as the viewer shows it — photo with its drawings and text —
// rendered at up to 2400 px on its long side. iPhone/iPad: the system share
// sheet (AirDrop, WhatsApp, Messages, Mail, Save to Photos, Copy). Mac/PC:
// download and copy.

const SHARE = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>';
const DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>';
const COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';

/** iPhone and iPad: a touch device whose browser can hand files to the share sheet. */
function canShareSheet(): boolean {
  try {
    const probe = new File([new Blob(['x'], { type: 'image/jpeg' })], 'x.jpg', { type: 'image/jpeg' });
    return navigator.maxTouchPoints > 1 && !!navigator.canShare && navigator.canShare({ files: [probe] });
  } catch { return false; }
}

function renderForShare(it: Item): Promise<HTMLCanvasElement> {
  return new Promise((resolve) => {
    const k = 2400 / Math.max(it.w, it.h);
    const cvs = document.createElement('canvas');
    cvs.width = Math.round(it.w * k); cvs.height = Math.round(it.h * k);
    const ctx = cvs.getContext('2d')!;
    const finish = (img: HTMLImageElement | null) => {
      ctx.setTransform(k, 0, 0, k, 0, 0);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, it.w, it.h);
      if (img) {
        const sc = Math.min(it.w / img.width, it.h / img.height);
        const dw = img.width * sc, dh = img.height * sc;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, (it.w - dw) / 2, (it.h - dh) / 2, dw, dh);
      }
      (it.main ? drawMainStrokes : drawVersionStrokes)(ctx, it.strokes || []);
      resolve(cvs);
    };
    if (!it.src) { finish(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => finish(img);
    img.onerror = () => finish(null);
    img.src = it.src;
  });
}
const toBlob = (c: HTMLCanvasElement, type: string) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('no picture'))), type, 0.92));

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

export function openMaxView(items: Item[], index: number, onClose?: (it: Item, moved: boolean) => void, fileBase = 'Framehow'): void {
  closeMaxView();
  let i = Math.max(0, Math.min(index, items.length - 1));
  const startI = i;
  const root = document.createElement('div');
  root.id = 'maxView';
  root.innerHTML = `<div class="max-stage"><canvas></canvas></div>
    <button class="max-close" type="button" title="Close">${COLLAPSE}</button>
    <button class="max-nav max-prev" type="button" title="Previous">‹</button>
    <button class="max-nav max-next" type="button" title="Next">›</button>
    <div class="max-share-row"></div>
    <div class="max-label"></div>
    <div class="max-flash"></div>`;
  document.body.appendChild(root);
  _root = root;
  document.body.classList.add('max-view-open');
  const stage = root.querySelector<HTMLElement>('.max-stage')!;
  const cvs = root.querySelector('canvas')!;
  const label = root.querySelector<HTMLElement>('.max-label')!;
  const prevBtn = root.querySelector<HTMLButtonElement>('.max-prev')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('.max-next')!;

  let scale = 1, tx = 0, ty = 0;
  // THE TAP THAT OPENED IT MUST NOT CLOSE IT (Roman, 24 Oct: "you have to tap
  // twice"). After a touch, iOS sends a late mouse click to whatever is under
  // the finger — by then the viewer. So: no closing in the first half second,
  // and mouse events within a second of a touch are the touch's echo.
  const openedAt = Date.now();
  let lastTouch = 0;
  const settled = () => Date.now() - openedAt > 500;
  // WHILE THE SHARE SHEET IS UP, NO TAP CLOSES THE VIEWER (26 Oct, Roman on
  // the iPad: pressing share closed it). The taps that dismiss the sheet, and
  // iOS's late mouse echo of the button tap, reached the viewer as "a tap on
  // the picture". Only the close button and Escape close it meanwhile.
  let holdUntil = 0;
  const mayClose = () => settled() && Date.now() > holdUntil;
  // Declared before show(), which clears it on every picture change.
  let ready: { at: number; file: File } | null = null;
  let prepareLater: (() => void) | null = null;
  const apply = () => { stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const show = () => {
    scale = 1; tx = 0; ty = 0; apply();
    paintItem(cvs, items[i]);
    // Only the name of what is on screen (Roman, 24 Oct): the shot's number
    // for the main picture, the version's label (L2, v3) for a version.
    label.textContent = items[i].label;
    // THE SIDE ARROWS (26 Oct, Roman): as on the cards — shown only where there
    // is somewhere to go.
    prevBtn.style.display = i > 0 ? '' : 'none';
    nextBtn.style.display = i < items.length - 1 ? '' : 'none';
    ready = null;
    if (prepareLater) prepareLater();
  };
  const go = (d: number) => { const n = i + d; if (n < 0 || n >= items.length) return; i = n; show(); };
  show();

  // SHARE / DOWNLOAD / COPY (26 Oct). The JPEG for the picture on screen is
  // made ahead, whenever the picture changes, so the share sheet can open
  // inside the tap itself (iOS refuses it after a wait).
  const flash = root.querySelector<HTMLElement>('.max-flash')!;
  const say = (msg: string) => { flash.textContent = msg; flash.classList.add('on'); setTimeout(() => flash.classList.remove('on'), 1400); };
  const fileName = () => `${fileBase} – ${items[i].label || 'main'}.jpg`;
  const prepare = () => {
    const at = i;
    void renderForShare(items[at]).then((c) => toBlob(c, 'image/jpeg')).then((b) => {
      if (at === i) ready = { at, file: new File([b], fileName(), { type: 'image/jpeg' }) };
    }).catch(() => { /* the button says so when pressed */ });
  };
  prepareLater = prepare;
  prepare();
  const row = root.querySelector<HTMLElement>('.max-share-row')!;
  const button = (svg: string, title: string, act: () => void) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'max-share'; b.title = title; b.innerHTML = svg;
    ['touchstart', 'touchend', 'mousedown', 'mouseup'].forEach((ev) => b.addEventListener(ev, (e) => { e.stopPropagation(); lastTouch = ev.startsWith('touch') ? Date.now() : lastTouch; }, { passive: true }));
    b.addEventListener('click', (e) => { e.stopPropagation(); act(); });
    row.appendChild(b);
  };
  if (canShareSheet()) {
    button(SHARE, 'Share', () => {
      if (!ready || ready.at !== i) { say('One moment…'); prepare(); return; }
      trace(`max screen: share sheet — ${ready.file.name}`);
      holdUntil = Infinity;
      navigator.share({ files: [ready.file] }).catch(() => { /* closed without sharing */ })
        .finally(() => { holdUntil = Date.now() + 1000; });
    });
  } else {
    button(COPY, 'Copy picture', () => {
      // PNG: the only picture type every browser's clipboard takes. The promise
      // goes straight into the clipboard item, inside the click (Safari).
      try {
        const png = renderForShare(items[i]).then((c) => toBlob(c, 'image/png'));
        void navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
          .then(() => { trace('max screen: picture copied'); say('Copied — paste it with ⌘V'); })
          .catch(() => say('Copy is not allowed here — use download'));
      } catch { say('Copy is not allowed here — use download'); }
    });
    button(DOWNLOAD, 'Download', () => {
      const go = (file: File) => {
        const url = URL.createObjectURL(file);
        const a = document.createElement('a'); a.href = url; a.download = file.name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        trace(`max screen: downloaded ${file.name}`); say('Downloaded');
      };
      if (ready && ready.at === i) go(ready.file);
      else void renderForShare(items[i]).then((c) => toBlob(c, 'image/jpeg')).then((b) => go(new File([b], fileName(), { type: 'image/jpeg' })));
    });
  }

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
      if (scale === 1 && mayClose()) setTimeout(() => { if (lastTap === now && mayClose()) closeMaxView(); }, 330);   // single tap, not zoomed: close
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
    if (!mdrag || touchEcho() || !mayClose()) { mdrag = null; return; }
    const dx = e.clientX - mdrag.x; const moved = mdrag.moved; mdrag = null;
    if ((e.target as HTMLElement).closest('.max-close')) return;
    if (scale === 1 && Math.abs(dx) > 50) { go(dx < 0 ? 1 : -1); return; }
    if (!moved && scale === 1) closeMaxView();
  });
  root.querySelector('.max-close')!.addEventListener('click', (e) => { e.stopPropagation(); closeMaxView(); });
  ([[prevBtn, -1], [nextBtn, 1]] as [HTMLButtonElement, number][]).forEach(([b, d]) => {
    ['touchstart', 'touchend', 'mousedown', 'mouseup'].forEach((ev) => b.addEventListener(ev, (e) => { e.stopPropagation(); if (ev.startsWith('touch')) lastTouch = Date.now(); }, { passive: true }));
    b.addEventListener('click', (e) => { e.stopPropagation(); go(d); });
  });
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
  (root as HTMLElement & { __fhClose?: () => void }).__fhClose = () => onClose?.(items[i], i !== startI);
}

export function closeMaxView(): void {
  if (!_root) return;
  const r = _root as HTMLElement & { __fhKey?: (e: KeyboardEvent) => void; __fhResize?: () => void; __fhClose?: () => void };
  if (r.__fhKey) document.removeEventListener('keydown', r.__fhKey);
  if (r.__fhResize) window.removeEventListener('resize', r.__fhResize);
  r.remove();
  _root = null;
  document.body.classList.remove('max-view-open');
  r.__fhClose?.();
}

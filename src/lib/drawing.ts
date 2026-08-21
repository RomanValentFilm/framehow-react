// Canvas drawing primitives — ported verbatim from the original.
// Stroke + text rendering, hit-testing, image-fit drawing, and the
// pointer-event setup for live drawing on a canvas.

import { COLORS, state, useStore } from '../store/state';
import type { Frame, Stroke, Version, StripType, FrameSnapshot } from '../store/state';
import { getStripVersions, getStripActiveTab, getStripCrossCompare, setStripPrevFrameState } from './helpers';
import { markFrameDirty } from './currentProject';
import { stampChangedContent } from './changeStamps';

export function _drawStrokeItem(tctx: CanvasRenderingContext2D, st: Stroke, cH: number): void {
  if (st.type === 'text') {
    const lineH = Math.round(cH / 10);
    const fontSize = Math.round(lineH * 0.7);
    tctx.font = `500 ${fontSize}px DM Sans,sans-serif`;
    const lines = (st.text || '').split('\n');
    const pad = Math.round(fontSize * 0.2);
    const maxW = Math.max(...lines.map((l) => tctx.measureText(l).width));
    const startY = lineH;
    const px = (st.x ?? 0) - pad,
      py = startY - Math.round(lineH * 0.75),
      pw = maxW + pad * 2,
      ph = lineH * lines.length;
    tctx.fillStyle = 'rgba(0,0,0,0.65)';
    tctx.fillRect(px, py, pw, ph);
    tctx.fillStyle = st.color || '#fff';
    lines.forEach((line, i) => tctx.fillText(line, st.x ?? 0, startY + i * lineH));
  } else {
    tctx.save();
    if (st.eraser) {
      tctx.globalCompositeOperation = 'destination-out';
      tctx.strokeStyle = 'rgba(0,0,0,1)';
    } else {
      tctx.strokeStyle = st.color || '#fff';
    }
    tctx.beginPath();
    tctx.lineWidth = st.width || 6;
    tctx.lineCap = 'round';
    tctx.lineJoin = 'round';
    (st.points || []).forEach((p, i) => (i === 0 ? tctx.moveTo(p.x, p.y) : tctx.lineTo(p.x, p.y)));
    tctx.stroke();
    tctx.restore();
  }
}

export function _drawStrokesLayered(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
  if (!strokes || strokes.length === 0) return;
  const cW = ctx.canvas.width,
    cH = ctx.canvas.height;
  const hasEraser = strokes.some((s) => s.eraser);
  if (!hasEraser) {
    strokes.forEach((st) => _drawStrokeItem(ctx, st, cH));
    return;
  }
  const off = document.createElement('canvas');
  off.width = cW;
  off.height = cH;
  const octx = off.getContext('2d')!;
  const tf = ctx.getTransform();
  octx.setTransform(tf);
  strokes.forEach((st) => _drawStrokeItem(octx, st, cH));
  const savedTf = ctx.getTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(off, 0, 0);
  ctx.setTransform(savedTf);
}

export function _hitTestStroke(strokes: Stroke[], p: { x: number; y: number }, threshold: number): number {
  if (!strokes || strokes.length === 0) return -1;
  let bestIdx = -1,
    bestDist = threshold;
  for (let si = strokes.length - 1; si >= 0; si--) {
    const st = strokes[si];
    if (st.type === 'text') continue;
    const pts = st.points;
    if (!pts || pts.length < 2) continue;
    const hw = (st.width || 6) / 2 + 4;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1].x,
        ay = pts[i - 1].y,
        bx = pts[i].x,
        by = pts[i].y;
      const dx = bx - ax,
        dy = by - ay,
        len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? ((p.x - ax) * dx + (p.y - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + t * dx,
        cy = ay + t * dy;
      const dist = Math.sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
      if (dist < Math.max(hw, bestDist)) {
        bestDist = dist;
        bestIdx = si;
      }
    }
    if (bestIdx === si) return si;
  }
  return bestIdx;
}

export function drawMainStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
  _drawStrokesLayered(ctx, strokes);
}

export function drawVersionStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]): void {
  _drawStrokesLayered(ctx, strokes);
}

// ---------------------------------------------------------------------------
// THE FLASH (#360)
// ---------------------------------------------------------------------------
//
// Roman: "a short flashing of all content after each sync… it's distracting."
//
// It is not the sync. It is that every picture was decoded from scratch every
// single time a card was drawn. The old code made a NEW Image, wiped the canvas
// straight away, and painted only when the picture had finished decoding — so
// every card went blank first and filled in a moment later. A sync redraws every
// card at once, so all of them blanked together. That is the flash.
//
// Pictures here are whole photographs held as text, which are slow to decode, so
// the gap is easily long enough to see.
//
// A picture is now decoded ONCE and kept. The second time the same picture is
// asked for it is already there, so the card is painted in the same instant it
// is built and nothing ever blanks. Only a picture this device has never shown
// still has to wait — and then the canvas is left alone until it is ready,
// rather than being wiped first.
//
// The store keeps every picture in the project anyway, so what is kept here is
// the decoded copy, not a second copy of the data.

const _decoded = new Map<string, HTMLImageElement>();
/** Enough for every card on screen several times over, on the biggest project
 *  we have. Beyond that the oldest goes, which only costs one decode. */
const KEEP_DECODED = 150;

function decodedImage(src: string): HTMLImageElement {
  const had = _decoded.get(src);
  if (had) {
    // Freshen its place in the queue: what is on screen stays.
    _decoded.delete(src);
    _decoded.set(src, had);
    return had;
  }
  const img = new Image();
  img.src = src;
  _decoded.set(src, img);
  while (_decoded.size > KEEP_DECODED) {
    const oldest = _decoded.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    _decoded.delete(oldest);
  }
  return img;
}

/** True once the picture can actually be painted. */
function ready(img: HTMLImageElement): boolean {
  return img.complete && img.naturalWidth > 0;
}

function fit(ctx: CanvasRenderingContext2D, cvs: HTMLCanvasElement, img: HTMLImageElement): void {
  const s = Math.min(cvs.width / img.width, cvs.height / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, 0, 0, img.width, img.height,
    (cvs.width - dw) / 2, (cvs.height - dh) / 2, dw, dh);
}

/**
 * Paint a canvas: the picture if there is one, then whatever was drawn on top.
 *
 * The canvas is wiped at the LAST possible moment — never before a picture is
 * ready — so it is either showing the old thing or the new thing, and never
 * nothing.
 */
function paint(cvs: HTMLCanvasElement, src: string | null | undefined, strokes: Stroke[] | undefined,
  drawStrokes: (ctx: CanvasRenderingContext2D, st: Stroke[]) => void): void {
  const ctx = cvs.getContext('2d')!;
  if (!src) {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    drawStrokes(ctx, strokes || []);
    return;
  }
  const img = decodedImage(src);
  if (ready(img)) {
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    fit(ctx, cvs, img);
    drawStrokes(ctx, strokes || []);
    return;
  }
  // Never shown on this device before. Leave whatever is there until it can be
  // replaced in one go.
  img.addEventListener('load', () => {
    // Not while a stroke is under the finger — the repaint would wipe the line
    // being drawn. It is painted again when the stroke ends.
    if (state().drawingInProgress) return;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    fit(ctx, cvs, img);
    drawStrokes(ctx, strokes || []);
  }, { once: true });
}

export function restoreMainCanvas(cvs: HTMLCanvasElement, f: Frame): void {
  paint(cvs, f.src, f.strokes, drawMainStrokes);
}

export function restoreCanvas(cvs: HTMLCanvasElement, ver: Version): void {
  paint(cvs, ver.bgImage, ver.strokes, drawVersionStrokes);
}

export function drawFit(cvs: HTMLCanvasElement, src: string): void {
  paint(cvs, src, [], drawVersionStrokes);
}

// snapshot + undo helpers — used by drawing setup and many action handlers.
export function snapshotFrame(fid: number, origin: 'main' | 'ver' | 'floor' | 'refs'): void {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  if (!f) return;

  // For 'main' origin, snapshot the ver strip's version data (backward compat).
  // For strip origins (ver/floor/refs), use the strip-agnostic accessors.
  const effectiveStrip: StripType = origin === 'main' ? 'ver' : origin as StripType;
  const stripVers = getStripVersions(fid, effectiveStrip);
  const stripTab = getStripActiveTab(fid, effectiveStrip);
  const rawCC = getStripCrossCompare(fid, effectiveStrip);
  const stripCC = rawCC >= 0 ? rawCC : undefined;

  const snap: FrameSnapshot = {
    origin,
    main: {
      src: f.src,
      strokes: JSON.parse(JSON.stringify(f.strokes || [])),
      drawMode: f.drawMode,
      textContent: f.textContent,
      tableData: f.tableData ? JSON.parse(JSON.stringify(f.tableData)) : null,
    },
    versions: JSON.parse(JSON.stringify(stripVers || [])),
    activeTab: stripTab,
    crossCompare: stripCC,
  };

  setStripPrevFrameState(fid, origin === 'main' ? 'ver' : origin as StripType, snap);
}

export function updateUndoButtons(fid: number): void {
  const snap = state().prevFrameState[fid];
  const mainOK = !!(snap && snap.origin === 'main');
  const verOK = !!(snap && snap.origin === 'ver');
  document.querySelectorAll(`[data-mfid="${fid}"][data-mact="undo"]`).forEach((b) => b.classList.toggle('disabled', !mainOK));
  document.querySelectorAll(`[data-cfid="${fid}"][data-cact="undo"]`).forEach((b) => b.classList.toggle('disabled', !verOK));
  document.querySelectorAll(`[data-fid="${fid}"][data-action="undo"]`).forEach((b) => b.classList.toggle('disabled', !verOK));
}

/**
 * ONE PEN, LISTENED TO ONCE (#334).
 *
 * Both setup functions below simply start listening to the canvas, and nothing
 * ever stopped listening. Two places re-run them on a canvas that is still the
 * same one: the fullscreen undo button, after every press, and the resize
 * handler, on every rotation of an iPad or drag of a window.
 *
 * So the listening piled up. After five undos the app heard every stroke five
 * times and wrote it into the frame five times: the line came out thicker and
 * rougher, one press of undo removed one of the five copies so it looked like
 * undo did nothing, and every pointer movement did five times the work, so it
 * grew laggier the longer it was used. Exactly the "sloppy, does not delete
 * when there are more strokes" that Roman described — and self-feeding, since
 * undoing is what added another listener.
 *
 * A canvas now says whether it has already been wired, and a second attempt is
 * simply ignored.
 */
function alreadyListening(cvs: HTMLCanvasElement, which: string): boolean {
  const key = `fhWired${which}`;
  if ((cvs.dataset as Record<string, string | undefined>)[key] === '1') return true;
  (cvs.dataset as Record<string, string | undefined>)[key] = '1';
  return false;
}

export function setupMainDrawing(cvs: HTMLCanvasElement, fid: number): void {
  if (alreadyListening(cvs, 'Main')) return;
  let isDrawing = false,
    isErasing = false,
    cur: Stroke | null = null;
  const f = state().frames.find((fr) => fr.id === fid);
  function getPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    const r = cvs.getBoundingClientRect(),
      sx = cvs.width / r.width,
      sy = cvs.height / r.height;
    const t = (e as TouchEvent).touches;
    const cx = t ? t[0].clientX : (e as MouseEvent).clientX;
    const cy = t ? t[0].clientY : (e as MouseEvent).clientY;
    return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
  }
  function eraseAtPoint(p: { x: number; y: number }): void {
    if (!f || !f.strokes || f.strokes.length === 0) return;
    const idx = _hitTestStroke(f.strokes, p, 20);
    if (idx < 0) return;
    snapshotFrame(fid, 'main');
    f.strokes.splice(idx, 1);
    updateUndoButtons(fid);
    restoreMainCanvas(cvs, f);
  }
  function start(e: MouseEvent | TouchEvent): void {
    const s = state();
    if (s.drawEraser[fid]) {
      isErasing = true;
      eraseAtPoint(getPos(e));
      return;
    }
    isDrawing = true;
    useStore.setState({ drawingInProgress: true });
    cur = { color: s.penColor || COLORS[0], width: s.drawWidth[fid] || 6, points: [getPos(e)] };
  }
  function move(e: MouseEvent | TouchEvent): void {
    // Eraser drag: erase any stroke the pointer passes over
    if (isErasing) {
      e.preventDefault();
      eraseAtPoint(getPos(e));
      return;
    }
    if (!isDrawing || !cur) return;
    e.preventDefault();
    const p = getPos(e);
    cur.points!.push(p);
    const ctx = cvs.getContext('2d')!;
    const pts = cur.points!;
    ctx.strokeStyle = cur.color || '#fff';
    ctx.beginPath();
    ctx.lineWidth = cur.width || 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function end(): void {
    if (isDrawing && cur && cur.points && cur.points.length > 1 && f) {
      snapshotFrame(fid, 'main');
      f.strokes = f.strokes || [];
      f.strokes.push(cur);
      updateUndoButtons(fid);
    }
    if (isDrawing || isErasing) {
      useStore.setState({ drawSuppressClick: true });
      // A DRAWING IS WORK, AND HAS TO SAY SO (#335).
      //
      // Strokes are added to the array in place, and the watcher that spots
      // changes looks for an object being REPLACED — so a drawing was never
      // counted as unsent. The scribble layer says so explicitly and has done
      // for a while; the drawing layer never did. A pull arriving before the
      // next push could therefore bring back strokes that had been rubbed out,
      // or take away ones just drawn.
      const drawn = state().frames.find((x) => x.id === fid);
      if (drawn?.serverFrameId) markFrameDirty(drawn.serverFrameId);
      stampChangedContent();
    }
    useStore.setState({ drawingInProgress: false });
    isDrawing = false;
    isErasing = false;
    cur = null;
  }
  cvs.addEventListener('mousedown', start);
  cvs.addEventListener('mousemove', move);
  cvs.addEventListener('mouseup', end);
  cvs.addEventListener('mouseleave', end);
  cvs.addEventListener('touchstart', start, { passive: false });
  cvs.addEventListener('touchmove', move, { passive: false });
  cvs.addEventListener('touchend', end);
}

export function setupDrawing(cvs: HTMLCanvasElement, fid: number, ai: number, strip: StripType = 'ver'): void {
  if (alreadyListening(cvs, 'Strip')) return;
  let isDrawing = false,
    isErasing = false,
    cur: Stroke | null = null;
  const ver = getStripVersions(fid, strip)[ai];
  function getPos(e: MouseEvent | TouchEvent): { x: number; y: number } {
    const r = cvs.getBoundingClientRect(),
      sx = cvs.width / r.width,
      sy = cvs.height / r.height;
    const t = (e as TouchEvent).touches;
    const cx = t ? t[0].clientX : (e as MouseEvent).clientX;
    const cy = t ? t[0].clientY : (e as MouseEvent).clientY;
    return { x: (cx - r.left) * sx, y: (cy - r.top) * sy };
  }
  function eraseAtPoint(p: { x: number; y: number }): void {
    if (!ver || !ver.strokes || ver.strokes.length === 0) return;
    const idx = _hitTestStroke(ver.strokes, p, 20);
    if (idx < 0) return;
    snapshotFrame(fid, strip);
    ver.strokes.splice(idx, 1);
    updateUndoButtons(fid);
    restoreCanvas(cvs, ver);
  }
  function start(e: MouseEvent | TouchEvent): void {
    const s = state();
    if (s.drawEraser[fid]) {
      isErasing = true;
      eraseAtPoint(getPos(e));
      return;
    }
    isDrawing = true;
    useStore.setState({ drawingInProgress: true });
    cur = { color: s.penColor || COLORS[0], width: s.drawWidth[fid] || 6, points: [getPos(e)] };
  }
  function move(e: MouseEvent | TouchEvent): void {
    // Eraser drag: erase any stroke the pointer passes over
    if (isErasing) {
      e.preventDefault();
      eraseAtPoint(getPos(e));
      return;
    }
    if (!isDrawing || !cur) return;
    e.preventDefault();
    const p = getPos(e);
    cur.points!.push(p);
    const ctx = cvs.getContext('2d')!;
    const pts = cur.points!;
    ctx.strokeStyle = cur.color || '#fff';
    ctx.beginPath();
    ctx.lineWidth = cur.width || 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.moveTo(pts[pts.length - 2].x, pts[pts.length - 2].y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function end(): void {
    if (isDrawing && cur && cur.points && cur.points.length > 1) {
      snapshotFrame(fid, strip);
      ver.strokes = ver.strokes || [];
      ver.strokes.push(cur);
      if (ver.type === 'empty') ver.type = 'drawing'; // clear "choose an action below" hint
      updateUndoButtons(fid);
    }
    if (isDrawing || isErasing) {
      useStore.setState({ drawSuppressClick: true });
      // A DRAWING IS WORK, AND HAS TO SAY SO (#335).
      //
      // Strokes are added to the array in place, and the watcher that spots
      // changes looks for an object being REPLACED — so a drawing was never
      // counted as unsent. The scribble layer says so explicitly and has done
      // for a while; the drawing layer never did. A pull arriving before the
      // next push could therefore bring back strokes that had been rubbed out,
      // or take away ones just drawn.
      const drawn = state().frames.find((x) => x.id === fid);
      if (drawn?.serverFrameId) markFrameDirty(drawn.serverFrameId);
      stampChangedContent();
    }
    useStore.setState({ drawingInProgress: false });
    isDrawing = false;
    isErasing = false;
    cur = null;
  }
  cvs.addEventListener('mousedown', start);
  cvs.addEventListener('mousemove', move);
  cvs.addEventListener('mouseup', end);
  cvs.addEventListener('mouseleave', end);
  cvs.addEventListener('touchstart', start, { passive: false });
  cvs.addEventListener('touchmove', move, { passive: false });
  cvs.addEventListener('touchend', end);
}

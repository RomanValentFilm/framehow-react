// Canvas drawing primitives — ported verbatim from the original.
// Stroke + text rendering, hit-testing, image-fit drawing, and the
// pointer-event setup for live drawing on a canvas.

import { COLORS, state, useStore } from '../store/state';
import type { Frame, Stroke, Version, StripType, FrameSnapshot } from '../store/state';
import { getStripVersions, getStripActiveTab, getStripCrossCompare, setStripPrevFrameState } from './helpers';

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

export function restoreMainCanvas(cvs: HTMLCanvasElement, f: Frame): void {
  const ctx = cvs.getContext('2d')!;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  if (f.src) {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(cvs.width / img.width, cvs.height / img.height);
      const dw = img.width * s,
        dh = img.height * s;
      ctx.drawImage(img, 0, 0, img.width, img.height, (cvs.width - dw) / 2, (cvs.height - dh) / 2, dw, dh);
      drawMainStrokes(ctx, f.strokes);
    };
    img.src = f.src;
  } else {
    drawMainStrokes(ctx, f.strokes);
  }
}

export function restoreCanvas(cvs: HTMLCanvasElement, ver: Version): void {
  const ctx = cvs.getContext('2d')!;
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  if (ver.bgImage) {
    const img = new Image();
    img.onload = () => {
      const s = Math.min(cvs.width / img.width, cvs.height / img.height);
      const dw = img.width * s,
        dh = img.height * s;
      ctx.drawImage(img, 0, 0, img.width, img.height, (cvs.width - dw) / 2, (cvs.height - dh) / 2, dw, dh);
      drawVersionStrokes(ctx, ver.strokes);
    };
    img.src = ver.bgImage;
    return;
  }
  drawVersionStrokes(ctx, ver.strokes);
}

export function drawFit(cvs: HTMLCanvasElement, src: string): void {
  const img = new Image();
  img.onload = () => {
    const ctx = cvs.getContext('2d')!;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    const s = Math.min(cvs.width / img.width, cvs.height / img.height);
    const dw = img.width * s,
      dh = img.height * s;
    ctx.drawImage(img, 0, 0, img.width, img.height, (cvs.width - dw) / 2, (cvs.height - dh) / 2, dw, dh);
  };
  img.src = src;
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

export function setupMainDrawing(cvs: HTMLCanvasElement, fid: number): void {
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
    cur = { color: s.drawColor[fid] || COLORS[0], width: s.drawWidth[fid] || 6, points: [getPos(e)] };
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
    cur = { color: s.drawColor[fid] || COLORS[0], width: s.drawWidth[fid] || 6, points: [getPos(e)] };
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

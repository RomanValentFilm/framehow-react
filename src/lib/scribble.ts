// Scribble — transparent drawing overlay for 3×2 view.
// One full-page canvas overlays the entire grid. Strokes are clipped into
// per-frame segments via zone detection (nearest card rect). Each segment
// stores coordinates relative to its card (0-1 normalized) so they travel
// with reordered frames. Cross-frame strokes split at zone boundaries.

import { state, useStore, bumpRenderTick } from '../store/state';
import type { Stroke } from '../store/state';
import { flushSyncNow, markFrameDirty } from './currentProject';
import { getZoomState, setZoomState } from './overview';

// ─── SVG icons ───────────────────────────────────────────────────────

const PENCIL_SVG_INACTIVE = `<svg viewBox="0 0 24 30" fill="none" stroke="#666" stroke-width="1.5" stroke-linejoin="round" style="width:22px;height:26px"><path d="M8 1h8v4H8z"/><line x1="8" y1="5" x2="16" y2="5"/><path d="M8 5h8v18l-4 6-4-6z"/></svg>`;

const PENCIL_SVG_ACTIVE = `<svg viewBox="0 0 24 30" fill="none" stroke="#222" stroke-width="1.5" stroke-linejoin="round" style="width:22px;height:26px"><rect x="8" y="1" width="8" height="4" fill="#E91E63" stroke="#222"/><line x1="8" y1="5" x2="16" y2="5" stroke="#222"/><path d="M8 5h8v18l-4 6-4-6z" fill="#FFD600" stroke="#222"/><line x1="8" y1="7" x2="16" y2="7" stroke="#222" stroke-width="0.8"/></svg>`;

const ERASER_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20H7L3 16c-.8-.8-.8-2 0-2.8L14.6 1.6c.8-.8 2-.8 2.8 0L21.4 5.6c.8.8.8 2 0 2.8L12 18"/><path d="M6 12l5 5"/></svg>`;

const UNDO_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 19v-2h7.1c1.15 0 2.13-.4 2.93-1.2.8-.8 1.2-1.78 1.2-2.93s-.4-2.13-1.2-2.93c-.8-.8-1.78-1.2-2.93-1.2H7.83l2.59 2.59L9 12.74 4 7.74l5-5 1.41 1.41L7.83 6.74H14.1c1.71 0 3.16.6 4.36 1.8s1.8 2.65 1.8 4.36-.6 3.16-1.8 4.36-2.65 1.8-4.36 1.8H7Z"/></svg>`;

function brushSVG(sw: number): string {
  return `<svg width="24" height="16" viewBox="0 0 24 16"><path d="M2 10 Q6 ${10 - sw * 1.5} 8 10 Q10 ${10 + sw * 1.5} 12 10 Q14 ${10 - sw * 1.5} 16 10 Q18 ${10 + sw * 1.5} 22 10" fill="none" stroke="#fff" stroke-width="${sw}" stroke-linecap="round"/></svg>`;
}

// ─── Constants ───────────────────────────────────────────────────────

const TAP_MAX_DURATION = 200;
const TAP_MAX_DISTANCE = 8;
const SCRIBBLE_COLORS = ['#FFD600', '#e03030', '#30b050', '#3080e0'];
const SCRIBBLE_WIDTHS = [3, 6, 12];
const BRUSH_SVG_WIDTHS = [1.5, 3, 5]; // visual thickness for the SVG icons
const UNDO_LIMIT = 50;

// ─── Module state ────────────────────────────────────────────────────

let activeColor = SCRIBBLE_COLORS[0];
let activeWidth = SCRIBBLE_WIDTHS[0];
let eraserOn = false;

interface UndoAction {
  type: 'draw' | 'erase';
  drawEntries?: { fid: number; count: number }[];
  eraseEntries?: { fid: number; strokes: Stroke[] }[];
}
const undoStack: UndoAction[] = [];

// ─── Zone helpers ────────────────────────────────────────────────────

interface CardZone { fid: number; left: number; top: number; width: number; height: number }

function getCardZones(): CardZone[] {
  const container = document.querySelector('.grid3x2-container') as HTMLElement | null;
  if (!container) return [];
  const cRect = container.getBoundingClientRect();
  // getBoundingClientRect returns TRANSFORMED bounds (scaled by CSS zoom).
  // Divide by zoom scale to recover natural (unscaled) canvas coordinates.
  const scale = getZoomState().scale;
  const zones: CardZone[] = [];
  container.querySelectorAll('.grid3x2-card-wrap').forEach((card) => {
    const fid = parseInt((card as HTMLElement).dataset.g3fid || '0', 10);
    if (!fid) return;
    const r = card.getBoundingClientRect();
    zones.push({
      fid,
      left: (r.left - cRect.left) / scale,
      top: (r.top - cRect.top) / scale,
      width: r.width / scale,
      height: r.height / scale,
    });
  });
  return zones;
}

function findZone(x: number, y: number, zones: CardZone[]): CardZone | null {
  let best: CardZone | null = null;
  let bestD = Infinity;
  for (const z of zones) {
    const dx = Math.max(z.left - x, 0, x - (z.left + z.width));
    const dy = Math.max(z.top - y, 0, y - (z.top + z.height));
    const d = dx * dx + dy * dy;
    if (d < bestD) { bestD = d; best = z; }
  }
  return best;
}

function toRel(x: number, y: number, z: CardZone): { x: number; y: number } {
  return { x: (x - z.left) / z.width, y: (y - z.top) / z.height };
}

function toAbs(rx: number, ry: number, z: CardZone): { x: number; y: number } {
  return { x: z.left + rx * z.width, y: z.top + ry * z.height };
}

// ─── Polyline clipping ───────────────────────────────────────────────

function clipToZones(pts: { x: number; y: number }[], zones: CardZone[]): Map<number, { x: number; y: number }[][]> {
  const result = new Map<number, { x: number; y: number }[][]>();
  if (pts.length < 2 || zones.length === 0) return result;
  let curZone = findZone(pts[0].x, pts[0].y, zones);
  if (!curZone) return result;
  let seg: { x: number; y: number }[] = [toRel(pts[0].x, pts[0].y, curZone)];
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    const z = findZone(p.x, p.y, zones);
    if (!z) continue;
    if (z.fid === curZone!.fid) {
      seg.push(toRel(p.x, p.y, z));
    } else {
      seg.push(toRel(p.x, p.y, curZone!));
      if (seg.length >= 2) {
        if (!result.has(curZone!.fid)) result.set(curZone!.fid, []);
        result.get(curZone!.fid)!.push(seg);
      }
      curZone = z;
      seg = [toRel(p.x, p.y, z)];
    }
  }
  if (seg.length >= 2 && curZone) {
    if (!result.has(curZone.fid)) result.set(curZone.fid, []);
    result.get(curZone.fid)!.push(seg);
  }
  return result;
}

// ─── Toggle ──────────────────────────────────────────────────────────

export function toggleScribbleMode(): void {
  const next = !state().scribbleMode;
  useStore.setState({ scribbleMode: next });
  document.body.classList.toggle('scribble-on', next);

  const btn = document.getElementById('scribbleBtn');
  if (btn) {
    btn.innerHTML = next ? PENCIL_SVG_ACTIVE : PENCIL_SVG_INACTIVE;
    btn.classList.toggle('scribble-active', next);
  }

  // Show/hide tools panel
  const tools = document.querySelector('.scribble-tools') as HTMLElement | null;
  if (tools) tools.style.display = next ? 'flex' : 'none';

  const cvs = document.querySelector('.scribble-page-canvas') as HTMLCanvasElement | null;
  if (cvs) {
    cvs.style.pointerEvents = next ? 'auto' : 'none';
    cvs.style.opacity = next ? '1' : '0';
  }
}

// ─── Tool selection update ───────────────────────────────────────────

function updateToolSelection(): void {
  const tools = document.querySelector('.scribble-tools');
  if (!tools) return;
  tools.querySelectorAll('.scribble-color-dot').forEach((d) => {
    d.classList.toggle('selected', !eraserOn && (d as HTMLElement).dataset.sccolor === activeColor);
  });
  tools.querySelectorAll('.scribble-brush-btn').forEach((d) => {
    d.classList.toggle('selected', !eraserOn && (d as HTMLElement).dataset.scwidth === String(activeWidth));
  });
  tools.querySelectorAll('.scribble-eraser-btn').forEach((d) => {
    d.classList.toggle('selected', eraserOn);
  });
}

// ─── Undo ────────────────────────────────────────────────────────────

function performUndo(): void {
  if (undoStack.length === 0) return;
  const action = undoStack.pop()!;

  const touchedFids: number[] = [];

  if (action.type === 'draw' && action.drawEntries) {
    for (const entry of action.drawEntries) {
      const f = state().frames.find((fr) => fr.id === entry.fid);
      if (f && f.scribbles) { f.scribbles.splice(f.scribbles.length - entry.count, entry.count); touchedFids.push(entry.fid); }
    }
  } else if (action.type === 'erase' && action.eraseEntries) {
    for (const entry of action.eraseEntries) {
      const f = state().frames.find((fr) => fr.id === entry.fid);
      if (f) {
        if (!f.scribbles) f.scribbles = [];
        f.scribbles.push(...entry.strokes);
        touchedFids.push(entry.fid);
      }
    }
  }

  for (const fid of touchedFids) {
    const fr = state().frames.find((x) => x.id === fid);
    if (fr?.serverFrameId) markFrameDirty(fr.serverFrameId);
  }

  bumpRenderTick();
  void flushSyncNow();
  refreshScribbleOverlays();
}

// ─── Button + toolbar ────────────────────────────────────────────────

function createSep(): HTMLElement {
  const sep = document.createElement('div');
  sep.className = 'scribble-sep';
  return sep;
}

export function injectScribbleButton(): void {
  document.getElementById('scribbleToolbar')?.remove();

  // No toolbar on iPhone (view-only)
  if (Math.min(window.innerWidth, window.innerHeight) <= 430) return;

  const isActive = state().scribbleMode;

  // Wrapper
  const wrapper = document.createElement('div');
  wrapper.id = 'scribbleToolbar';
  wrapper.className = 'scribble-toolbar';

  // Pencil toggle button
  const btn = document.createElement('button');
  btn.id = 'scribbleBtn';
  btn.className = 'scribble-toggle-btn' + (isActive ? ' scribble-active' : '');
  btn.innerHTML = isActive ? PENCIL_SVG_ACTIVE : PENCIL_SVG_INACTIVE;
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggleScribbleMode(); });
  wrapper.appendChild(btn);

  // Tools panel (visible only when active)
  const tools = document.createElement('div');
  tools.className = 'scribble-tools';
  tools.style.display = isActive ? 'flex' : 'none';

  // Color dots
  for (const c of SCRIBBLE_COLORS) {
    const dot = document.createElement('div');
    dot.className = 'scribble-color-dot' + (!eraserOn && c === activeColor ? ' selected' : '');
    dot.style.background = c;
    dot.dataset.sccolor = c;
    dot.addEventListener('click', (e) => { e.stopPropagation(); activeColor = c; eraserOn = false; updateToolSelection(); });
    tools.appendChild(dot);
  }

  tools.appendChild(createSep());

  // Brush sizes
  for (let i = 0; i < SCRIBBLE_WIDTHS.length; i++) {
    const w = SCRIBBLE_WIDTHS[i];
    const b = document.createElement('div');
    b.className = 'scribble-brush-btn' + (!eraserOn && w === activeWidth ? ' selected' : '');
    b.innerHTML = brushSVG(BRUSH_SVG_WIDTHS[i]);
    b.dataset.scwidth = String(w);
    b.addEventListener('click', (e) => { e.stopPropagation(); activeWidth = w; eraserOn = false; updateToolSelection(); });
    tools.appendChild(b);
  }

  tools.appendChild(createSep());

  // Eraser
  const er = document.createElement('div');
  er.className = 'scribble-eraser-btn' + (eraserOn ? ' selected' : '');
  er.innerHTML = ERASER_SVG;
  er.addEventListener('click', (e) => { e.stopPropagation(); eraserOn = !eraserOn; updateToolSelection(); });
  tools.appendChild(er);

  tools.appendChild(createSep());

  // Undo
  const undo = document.createElement('button');
  undo.className = 'scribble-undo-btn';
  undo.innerHTML = UNDO_SVG;
  undo.title = 'Undo';
  undo.addEventListener('click', (e) => { e.stopPropagation(); performUndo(); });
  tools.appendChild(undo);

  wrapper.appendChild(tools);

  const container = document.querySelector('.grid3x2-container');
  if (container && container.parentElement) {
    container.parentElement.insertBefore(wrapper, container);
  }
}

// ─── Full-page canvas overlay ────────────────────────────────────────

export function attachScribbleOverlays(): void {
  const container = document.querySelector('.grid3x2-container') as HTMLElement;
  if (!container) return;

  container.querySelector('.scribble-page-canvas')?.remove();

  const dpr = window.devicePixelRatio || 1;
  const w = container.scrollWidth;
  const h = container.scrollHeight;

  const cvs = document.createElement('canvas');
  cvs.className = 'scribble-page-canvas';
  cvs.width = Math.round(w * dpr);
  cvs.height = Math.round(h * dpr);
  cvs.style.width = w + 'px';
  cvs.style.height = h + 'px';

  container.style.position = 'relative';
  const active = state().scribbleMode;
  cvs.style.pointerEvents = active ? 'auto' : 'none';
  cvs.style.opacity = active ? '1' : '0';

  container.appendChild(cvs);

  const ctx = cvs.getContext('2d')!;
  ctx.scale(dpr, dpr);

  renderAllScribbles(cvs);

  // Wire drawing (not on iPhone)
  if (Math.min(window.innerWidth, window.innerHeight) > 430) {
    wirePageDrawing(cvs);
  }
}

// ─── Render ──────────────────────────────────────────────────────────

function renderAllScribbles(cvs: HTMLCanvasElement): void {
  const dpr = window.devicePixelRatio || 1;
  const ctx = cvs.getContext('2d')!;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cvs.width / dpr, cvs.height / dpr);

  const zones = getCardZones();
  const frames = state().frames;

  for (const zone of zones) {
    const f = frames.find((fr) => fr.id === zone.fid);
    if (!f?.scribbles?.length) continue;

    for (const stroke of f.scribbles) {
      if (!stroke.points || stroke.points.length < 1) continue;
      const col = stroke.color || SCRIBBLE_COLORS[0];
      const w = stroke.width || SCRIBBLE_WIDTHS[0];
      const p0 = toAbs(stroke.points[0].x, stroke.points[0].y, zone);

      // Dot detection: single point or two identical points
      if (stroke.points.length <= 2) {
        const pLast = toAbs(stroke.points[stroke.points.length - 1].x, stroke.points[stroke.points.length - 1].y, zone);
        const dx = pLast.x - p0.x, dy = pLast.y - p0.y;
        if (stroke.points.length === 1 || (dx * dx + dy * dy < 1)) {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(p0.x, p0.y, w / 2, 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
      }

      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < stroke.points.length; i++) {
        const p = toAbs(stroke.points[i].x, stroke.points[i].y, zone);
        ctx.lineTo(p.x, p.y);
      }
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ─── Eraser: remove strokes touched by path ─────────────────────────

const ERASER_RADIUS = 22; // px hit radius in canvas coords

/** Minimum distance from point P to line segment AB (squared). */
function ptSegDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) { const ex = px - ax, ey = py - ay; return ex * ex + ey * ey; }
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  const ex = px - cx, ey = py - cy;
  return ex * ex + ey * ey;
}

function eraseWithPath(eraserPath: { x: number; y: number }[], cvs: HTMLCanvasElement): void {
  const zones = getCardZones();
  const frames = state().frames;
  const rSq = ERASER_RADIUS * ERASER_RADIUS;

  const eraseEntries: { fid: number; strokes: Stroke[] }[] = [];

  for (const zone of zones) {
    const f = frames.find((fr) => fr.id === zone.fid);
    if (!f?.scribbles?.length) continue;

    const toRemove: number[] = [];

    for (let si = 0; si < f.scribbles.length; si++) {
      const stroke = f.scribbles[si];
      if (!stroke.points?.length) continue;

      // Convert stroke points to absolute coords once
      const absPoints = stroke.points.map((sp) => toAbs(sp.x, sp.y, zone));

      // Check each eraser point against each stroke SEGMENT (not just points).
      // This catches strokes even when stroke points are far apart.
      let touched = false;
      outer: for (const ep of eraserPath) {
        for (let j = 0; j < absPoints.length - 1; j++) {
          const a = absPoints[j], b = absPoints[j + 1];
          if (ptSegDistSq(ep.x, ep.y, a.x, a.y, b.x, b.y) < rSq) {
            touched = true;
            break outer;
          }
        }
        // Also check first point (for single-point strokes / dots)
        if (absPoints.length === 1) {
          const dx = ep.x - absPoints[0].x, dy = ep.y - absPoints[0].y;
          if (dx * dx + dy * dy < rSq) { touched = true; break outer; }
        }
      }

      if (touched) toRemove.push(si);
    }

    if (toRemove.length > 0) {
      const removed = toRemove.map((i) => f.scribbles![i]);
      for (let i = toRemove.length - 1; i >= 0; i--) f.scribbles!.splice(toRemove[i], 1);
      eraseEntries.push({ fid: zone.fid, strokes: removed });
    }
  }

  if (eraseEntries.length > 0) {
    undoStack.push({ type: 'erase', eraseEntries });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    for (const entry of eraseEntries) {
      const fr = state().frames.find((x) => x.id === entry.fid);
      if (fr?.serverFrameId) markFrameDirty(fr.serverFrameId);
    }
    bumpRenderTick();
    void flushSyncNow();
  }

  renderAllScribbles(cvs);
}

/** Tap-to-erase: find the single closest stroke to the tap point and remove it. */
function eraseAtPoint(pt: { x: number; y: number }, cvs: HTMLCanvasElement): void {
  const zones = getCardZones();
  const frames = state().frames;
  const TAP_ERASE_RADIUS = 30; // generous tap radius
  const rSq = TAP_ERASE_RADIUS * TAP_ERASE_RADIUS;

  let bestDist = Infinity;
  let bestFrame: typeof frames[0] | null = null;
  let bestIdx = -1;
  let bestFid = 0;

  for (const zone of zones) {
    const f = frames.find((fr) => fr.id === zone.fid);
    if (!f?.scribbles?.length) continue;

    for (let si = 0; si < f.scribbles.length; si++) {
      const stroke = f.scribbles[si];
      if (!stroke.points?.length) continue;
      const absPoints = stroke.points.map((sp) => toAbs(sp.x, sp.y, zone));
      for (let j = 0; j < absPoints.length - 1; j++) {
        const a = absPoints[j], b = absPoints[j + 1];
        const d = ptSegDistSq(pt.x, pt.y, a.x, a.y, b.x, b.y);
        if (d < bestDist) { bestDist = d; bestFrame = f; bestIdx = si; bestFid = zone.fid; }
      }
      if (absPoints.length === 1) {
        const dx = pt.x - absPoints[0].x, dy = pt.y - absPoints[0].y;
        const d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; bestFrame = f; bestIdx = si; bestFid = zone.fid; }
      }
    }
  }

  if (bestFrame && bestIdx >= 0 && bestDist < rSq) {
    const removed = bestFrame.scribbles!.splice(bestIdx, 1);
    undoStack.push({ type: 'erase', eraseEntries: [{ fid: bestFid, strokes: removed }] });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    if (bestFrame.serverFrameId) markFrameDirty(bestFrame.serverFrameId);
    bumpRenderTick();
    void flushSyncNow();
    renderAllScribbles(cvs);
  }
}

// ─── Drawing handler (with two-finger scroll / pinch support) ────────

function wirePageDrawing(cvs: HTMLCanvasElement): void {
  let drawing = false;
  let committed = false; // true once we're sure it's a single-finger draw
  let raw: { x: number; y: number }[] = [];
  let t0 = 0;
  let sx = 0;
  let sy = 0;
  let dist = 0;
  let commitTimer: number | null = null;
  const COMMIT_DELAY = 80; // ms — wait for possible second finger

  // Two-finger gesture state
  let twoFingerActive = false;
  let twoFingerIntent: 'undecided' | 'scroll' | 'pinch' = 'undecided';
  let lastMidX = 0;
  let lastMidY = 0;
  let lastPinchDist = 0;
  let startPinchDist = 0; // distance at gesture start (for cumulative ratio)
  let scrollAccum = 0;
  let cumulativeMidDy = 0; // total vertical midpoint travel

  const container = cvs.parentElement!;

  /** Convert screen pointer position to NATURAL (unscaled) canvas coords. */
  function pos(e: PointerEvent | Touch): { x: number; y: number } {
    const cr = container.getBoundingClientRect();
    const scale = getZoomState().scale;
    return { x: (e.clientX - cr.left) / scale, y: (e.clientY - cr.top) / scale };
  }

  function cancelDrawing(): void {
    drawing = false;
    committed = false;
    raw = [];
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    renderAllScribbles(cvs);
  }

  /** Flush accumulated raw points as progressive render */
  function flushAccumulated(): void {
    if (raw.length < 2) return;
    const dpr = window.devicePixelRatio || 1;
    const ctx = cvs.getContext('2d')!;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (eraserOn) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = activeWidth * 3;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = activeWidth;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(raw[0].x, raw[0].y);
    for (let i = 1; i < raw.length; i++) ctx.lineTo(raw[i].x, raw[i].y);
    ctx.stroke();
    ctx.restore();
  }

  // ─── Pointer events (drawing) ───────────────────────────────────

  function onDown(e: PointerEvent): void {
    if (!state().scribbleMode) return;
    if (drawing || twoFingerActive) return;

    t0 = Date.now();
    sx = e.clientX;
    sy = e.clientY;
    dist = 0;
    raw = [pos(e)];
    drawing = true;

    if (e.pointerType === 'touch') {
      committed = false;
      commitTimer = window.setTimeout(() => {
        commitTimer = null;
        if (!drawing || twoFingerActive) return;
        committed = true;
        flushAccumulated();
      }, COMMIT_DELAY);
    } else {
      committed = true;
      e.preventDefault();
    }
  }

  function onMove(e: PointerEvent): void {
    if (!drawing || twoFingerActive) return;

    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    dist = Math.max(dist, Math.sqrt(dx * dx + dy * dy));

    const p = pos(e);
    raw.push(p);

    if (!committed) return;

    // Progressive render (last segment only)
    const dpr = window.devicePixelRatio || 1;
    const ctx = cvs.getContext('2d')!;
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (eraserOn) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = activeWidth * 3;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = activeColor;
      ctx.lineWidth = activeWidth;
    }
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const prev = raw[raw.length - 2];
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    ctx.restore();
  }

  function onUp(e: PointerEvent): void {
    if (twoFingerActive) return;
    if (!drawing) return;
    if (commitTimer) { clearTimeout(commitTimer); commitTimer = null; }
    committed = true;

    const isTouch = e.pointerType === 'touch';
    const tapDur = isTouch ? 400 : TAP_MAX_DURATION;
    const tapDist = isTouch ? 30 : TAP_MAX_DISTANCE;
    const wasTap = (Date.now() - t0) < tapDur && dist < tapDist;
    if (wasTap) {
      if (eraserOn && raw.length > 0) {
        // Tap-to-erase: remove the nearest stroke under the tap point
        eraseAtPoint(raw[0], cvs);
        drawing = false;
        raw = [];
        return;
      }
      // Draw a dot at the tap point
      if (raw.length > 0) {
        const dotPt = raw[0];
        const dotRaw = [dotPt, { x: dotPt.x, y: dotPt.y }];
        const zones = getCardZones();
        const segments = clipToZones(dotRaw, zones);
        const undoEntries: { fid: number; count: number }[] = [];
        for (const [fid, segs] of segments) {
          const f = state().frames.find((fr) => fr.id === fid);
          if (!f) continue;
          if (!f.scribbles) f.scribbles = [];
          for (const seg of segs) {
            f.scribbles.push({ color: activeColor, width: activeWidth, points: seg });
          }
          undoEntries.push({ fid, count: segs.length });
        }
        if (undoEntries.length > 0) {
          undoStack.push({ type: 'draw', drawEntries: undoEntries });
          if (undoStack.length > UNDO_LIMIT) undoStack.shift();
          for (const entry of undoEntries) {
            const fr = state().frames.find((x) => x.id === entry.fid);
            if (fr?.serverFrameId) markFrameDirty(fr.serverFrameId);
          }
          bumpRenderTick();
          void flushSyncNow();
        }
      }
      drawing = false;
      raw = [];
      renderAllScribbles(cvs);
      return;
    }

    if (raw.length >= 2) {
      if (eraserOn) {
        eraseWithPath(raw, cvs);
      } else {
        const zones = getCardZones();
        const segments = clipToZones(raw, zones);
        const undoEntries: { fid: number; count: number }[] = [];
        for (const [fid, segs] of segments) {
          const f = state().frames.find((fr) => fr.id === fid);
          if (!f) continue;
          if (!f.scribbles) f.scribbles = [];
          for (const seg of segs) {
            f.scribbles.push({ color: activeColor, width: activeWidth, points: seg });
          }
          undoEntries.push({ fid, count: segs.length });
        }
        if (undoEntries.length > 0) {
          undoStack.push({ type: 'draw', drawEntries: undoEntries });
          if (undoStack.length > UNDO_LIMIT) undoStack.shift();
          // Mark each modified frame dirty so sync detects in-place mutation
          for (const entry of undoEntries) {
            const fr = state().frames.find((x) => x.id === entry.fid);
            if (fr?.serverFrameId) markFrameDirty(fr.serverFrameId);
          }
          bumpRenderTick();
          void flushSyncNow();
        }
      }
    }

    drawing = false;
    committed = false;
    raw = [];
    renderAllScribbles(cvs);
  }

  cvs.addEventListener('pointerdown', onDown);
  cvs.addEventListener('pointermove', onMove);
  cvs.addEventListener('pointerup', onUp);
  cvs.addEventListener('pointercancel', () => { cancelDrawing(); });

  // ─── Touch events (two-finger scroll / pinch) ──────────────────
  // The canvas has touch-action:none, so the browser won't perform any
  // default gestures. We handle scroll + pinch-zoom programmatically here.
  // stopPropagation prevents the overview.ts handler on scrollParent from
  // ALSO handling these events (which caused the "wacky" double-zoom).

  function touchDist(a: Touch, b: Touch): number {
    return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }

  cvs.addEventListener('touchstart', (e) => {
    if (!state().scribbleMode) return; // let events pass through when scribble off
    // Always stop propagation in scribble mode — prevents overview.ts
    // pan handler from moving the view while the user tries to draw.
    e.stopPropagation();

    if (e.touches.length >= 2) {
      if (drawing) cancelDrawing();
      twoFingerActive = true;
      twoFingerIntent = getZoomState().scale > 1.02 ? 'pinch' : 'undecided';
      scrollAccum = 0;
      cumulativeMidDy = 0;

      const a = e.touches[0], b = e.touches[1];
      lastMidX = (a.clientX + b.clientX) / 2;
      lastMidY = (a.clientY + b.clientY) / 2;
      lastPinchDist = touchDist(a, b);
      startPinchDist = lastPinchDist;
    }
  }, { passive: true });

  cvs.addEventListener('touchmove', (e) => {
    if (twoFingerActive && e.touches.length >= 2) {
      e.preventDefault();
      e.stopPropagation();

      const a = e.touches[0], b = e.touches[1];
      const midX = (a.clientX + b.clientX) / 2;
      const midY = (a.clientY + b.clientY) / 2;
      const curDist = touchDist(a, b);

      // Decide intent using CUMULATIVE movement (stable, not jitter-prone)
      cumulativeMidDy += Math.abs(midY - lastMidY);
      if (twoFingerIntent === 'undecided') {
        const cumulativePinchRatio = Math.abs(curDist / startPinchDist - 1);
        // Fingers spread/pinch > 15% from start → pinch intent
        if (cumulativePinchRatio > 0.15) twoFingerIntent = 'pinch';
        // Vertical travel > 6px without significant pinch → scroll intent
        else if (cumulativeMidDy > 6 && cumulativePinchRatio < 0.05) {
          twoFingerIntent = 'scroll';
          // Replay accumulated vertical delta so scroll starts immediately
          scrollAccum = lastMidY - midY;
        }
      }

      const scrollEl = document.getElementById('overviewScroll');

      if (twoFingerIntent === 'scroll') {
        // Pure two-finger scroll (not zoomed) — scroll the page viewport
        scrollAccum += lastMidY - midY;
        const px = Math.round(scrollAccum);
        if (px !== 0) { window.scrollBy(0, px); scrollAccum -= px; }
      } else if (twoFingerIntent === 'pinch' || getZoomState().scale > 1.02) {
        // Pinch zoom + pan
        const zs = getZoomState();
        const scaleRatio = curDist / lastPinchDist;
        let newScale = zs.scale * scaleRatio;
        newScale = Math.max(1, Math.min(2.5, newScale));

        if (scrollEl) {
          const sp = scrollEl.getBoundingClientRect();
          const lastCx = lastMidX - sp.left;
          const lastCy = lastMidY - sp.top + scrollEl.scrollTop;
          const contentX = (lastCx - zs.tx) / zs.scale;
          const contentY = (lastCy - zs.ty) / zs.scale;
          const cx = midX - sp.left;
          const cy = midY - sp.top + scrollEl.scrollTop;
          const tx = cx - contentX * newScale;
          const ty = cy - contentY * newScale;
          setZoomState(newScale, tx, ty);
        }
        twoFingerIntent = 'pinch'; // lock to pinch once zooming starts
      }
      // Undecided — don't scroll yet, wait for intent to lock in

      lastMidX = midX;
      lastMidY = midY;
      lastPinchDist = curDist;
      return;
    }

    // Single touch in scribble mode: stop propagation to prevent overview.ts
    // pan handler from shifting the zoomed view while drawing.
    if (state().scribbleMode && e.touches.length === 1) {
      e.stopPropagation();
      if (drawing && committed) e.preventDefault();
    }
  }, { passive: false });

  cvs.addEventListener('touchend', (e) => {
    if (state().scribbleMode) e.stopPropagation();
    if (e.touches.length < 2 && twoFingerActive) {
      twoFingerActive = false;
      // Snap back to 1x if near
      const zs = getZoomState();
      if (zs.scale < 1.05 && zs.scale > 1) {
        setZoomState(1, 0, 0);
      }
    }
  }, { passive: true });

  cvs.addEventListener('touchcancel', () => {
    twoFingerActive = false;
    cancelDrawing();
  }, { passive: true });
}

// ─── Public helpers ──────────────────────────────────────────────────

export function refreshScribbleOverlays(): void {
  const cvs = document.querySelector('.scribble-page-canvas') as HTMLCanvasElement | null;
  if (cvs) renderAllScribbles(cvs);
}

export function clearFrameScribbles(fid: number): void {
  const f = state().frames.find((fr) => fr.id === fid);
  if (f && f.scribbles && f.scribbles.length > 0) {
    f.scribbles = [];
    bumpRenderTick();
    void flushSyncNow();
  }
  refreshScribbleOverlays();
}

export function cleanupScribble(): void {
  document.getElementById('scribbleToolbar')?.remove();
  document.querySelector('.scribble-page-canvas')?.remove();
}

// Legacy export (no longer used)
export function wireScribbleDrawingForCanvas(_cvs: HTMLCanvasElement, _fid: number): void {}

// Export pipelines — PDF (jsPDF), PPTX (pptxgenjs), per-frame images (jszip).
// Replaces CDN globals with NPM imports.

import jsPDF from 'jspdf';
// @ts-ignore — pptxgenjs ships its own bundled types
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { state, useStore, DEFAULT_STRIP_DEFS, createDefaultExportMeta, SETUP_COLORS } from '../store/state';
import type { Frame, StripType, ExportMeta, SortBreak, TableData } from '../store/state';
import { rasterizeMain, rasterizeVersion, versionHasContent, canvasToBlob, withBakedBorder } from './rasterize';
import { showToast } from './modals';
import { fhTrack } from './tracking';
import { getCurrentProject, flushSyncNow } from './currentProject';
import { registerPdfFont, PDF_FONT } from './pdfFont';
import { getVisibleFrames } from './groups';
import { getStripVersions, getStripActiveTab } from './helpers';

// iOS detection (covers iPad in desktop-UA mode too).
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * Text imported from a PDF keeps that document's exotic whitespace — NBSP,
 * thin/hair/six-per-em spaces, zero-width joiners. jsPDF only breaks lines at a
 * plain 0x20, so a run glued together by those characters becomes one giant
 * unbreakable word and shoots straight off the edge of the frame.
 * Fold them all down to ordinary spaces before measuring or drawing.
 */
function normalizeForPdf(text: string): string {
  if (!text) return '';
  return text
    // every Unicode space separator -> plain space
    .replace(/[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g, ' ')
    // zero-width characters carry no width but block word breaks
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    // normalise line endings so real newlines survive
    .replace(/\r\n?/g, '\n');
}

/**
 * Lay a plain run of characters into a column of the given width.
 *
 * Pours the text in and breaks whenever it reaches the edge, exactly like a
 * text box would. The user's own line breaks are honoured. A word too wide to
 * fit on any line is split mid-word rather than allowed to stick out. Every
 * break simply pushes the rest of the text down a line.
 *
 * We do the fitting ourselves with getTextWidth — the same measurement used to
 * draw — so what we count and what we render can never disagree. Callers must
 * set the font size before calling.
 */
function hardWrapLines(pdf: any, text: string, maxW: number): string[] {
  const out: string[] = [];
  if (maxW <= 0) return out;

  for (const para of normalizeForPdf(text).split('\n')) {
    if (!para.trim()) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(' ')) {
      if (!word) continue;
      const candidate = line ? line + ' ' + word : word;
      if (pdf.getTextWidth(candidate) <= maxW) {
        line = candidate;
        continue;
      }
      // Doesn't fit on the current line — close it and start fresh
      if (line) {
        out.push(line);
        line = '';
      }
      if (pdf.getTextWidth(word) <= maxW) {
        line = word;
        continue;
      }
      // Single word wider than the column: cut it wherever it reaches the edge
      let buf = '';
      for (const ch of word) {
        if (buf && pdf.getTextWidth(buf + ch) > maxW) {
          out.push(buf);
          buf = ch;
        } else {
          buf += ch;
        }
      }
      line = buf;
    }
    if (line) out.push(line);
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// On iOS we can't auto-pop the share sheet after async work (the user
// gesture has expired). Instead, after generation we present a small modal
// with a Save/Share button — tapping that is a fresh gesture, and we call
// navigator.share({files}) which opens iOS's native share sheet.
//
// On non-iOS we just trigger a direct download as before.
function offerSave(blob: Blob, filename: string): void {
  if (!isIOS) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  const overlay = document.createElement('div');
  overlay.className = 'confirm-modal';
  overlay.innerHTML = `
    <div class="confirm-modal-box">
      <p style="font-family:var(--mono);font-size:12px;color:var(--text-muted);margin-bottom:6px;">Ready to save</p>
      <p style="font-size:14px;color:var(--text);margin-bottom:18px;word-break:break-all;">${escapeHtml(filename)}</p>
      <div class="confirm-modal-btns">
        <button class="btn" data-action="cancel">Cancel</button>
        <button class="btn btn-accent" data-action="share">Save / Share</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const cleanup = () => {
    overlay.remove();
  };
  (overlay.querySelector('[data-action="cancel"]') as HTMLButtonElement).addEventListener('click', cleanup);
  (overlay.querySelector('[data-action="share"]') as HTMLButtonElement).addEventListener('click', async () => {
    const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
    if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: filename } as ShareData);
      } catch {
        // user cancelled or share failed — silent
      }
      cleanup();
      return;
    }
    // Fallback for older iOS / Web Share unavailable: open in new tab so
    // user can long-press → Save Image / Add to Files.
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    cleanup();
  });
}

/** Build a full version label: "FrameLabel / vX" */
function fullVerLabel(fLabel: string, vLabel: string): string {
  return fLabel ? `${fLabel} / ${vLabel}` : vLabel;
}

/** Build strip picker (radio for double = single-select, checkbox for overview = multi-select) */
export function buildStripPicker(containerId: string, mode: 'radio' | 'checkbox', radioName?: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  const s = state();
  const defs = s.stripDefs || DEFAULT_STRIP_DEFS;
  let html = '';
  defs.forEach((def, i) => {
    const inputType = mode === 'radio' ? 'radio' : 'checkbox';
    const checked = i === 0 ? 'checked' : '';
    const nameAttr = mode === 'radio' && radioName ? `name="${radioName}"` : '';
    html += `<label class="exp-strip-opt">
      <input type="${inputType}" ${nameAttr} value="${def.id}" ${checked} data-strip="${def.id}">
      <span>${escapeHtml(def.buttonLabel)}</span>
    </label>`;
  });
  container.innerHTML = html;
}

/** Get currently selected strip IDs from a strip picker */
function getSelectedStrips(containerId: string): StripType[] {
  const container = document.getElementById(containerId);
  if (!container) return ['ver'];
  const checked = container.querySelectorAll('input:checked');
  return Array.from(checked).map(el => (el as HTMLInputElement).value as StripType);
}

/** Build the multi-strip version picker with per-strip sections and action buttons */
function buildVersionPickerForStrips(wrapperId: string, strips: StripType[]): void {
  const wrap = document.getElementById(wrapperId);
  if (!wrap) return;
  wrap.innerHTML = '';
  const s = state();
  const defs = s.stripDefs || DEFAULT_STRIP_DEFS;
  const frames = s.frames.filter((f) => !f.hidden);

  for (const stripId of strips) {
    const def = defs.find(d => d.id === stripId);
    const stripLabel = def ? def.buttonLabel : stripId;
    const section = document.createElement('div');
    section.className = 'exp-ver-section';
    section.dataset.strip = stripId;

    // Header
    let headerHTML = `<div class="exp-ver-section-header">${escapeHtml(stripLabel)}</div>`;

    // Action buttons
    headerHTML += `<div class="exp-ver-actions">
      <button data-action="starred-only" data-strip="${stripId}">Starred only</button>
      <button data-action="active-only" data-strip="${stripId}">Active only</button>
      <button data-action="all-visible" data-strip="${stripId}">All visible (excl. hidden)</button>
      <button data-action="select-all" data-strip="${stripId}">Select all</button>
      <button data-action="deselect-all" data-strip="${stripId}">Deselect all</button>
    </div>`;

    section.innerHTML = headerHTML;

    // Per-frame checkboxes still exist (the renderers look them up by data-fid /
    // data-vi) but are not shown — the action buttons above drive them instead.
    const rowsWrap = document.createElement('div');
    rowsWrap.className = 'exp-ver-rows';
    frames.forEach((f) => {
      const vs = getStripVersions(f.id, stripId as StripType);
      const nonEmpty = vs.map((v, i) => ({ v, i })).filter((o) => versionHasContent(o.v));
      if (nonEmpty.length === 0) return;
      const row = document.createElement('div');
      row.className = 'exp-frame-row';
      const fLabel = f.label ? f.label : `frame ${s.frames.indexOf(f) + 1}`;
      let html = `<div class="exp-frame-row-label">${escapeHtml(fLabel)}</div><div class="exp-frame-row-versions">`;
      nonEmpty.forEach((o) => {
        const isHidden = !!(o.v as any).hidden;
        html += `<label${isHidden ? ' class="exp-ver-hidden"' : ''}><input type="checkbox" data-fid="${f.id}" data-vi="${o.i}" data-strip="${stripId}" ${isHidden ? '' : 'checked'}> ${escapeHtml(o.v.label)}</label>`;
      });
      html += '</div>';
      row.innerHTML = html;
      rowsWrap.appendChild(row);
    });
    section.appendChild(rowsWrap);

    wrap.appendChild(section);
  }

  // Reflect the default selection (all visible versions) on the buttons
  wrap.querySelectorAll('.exp-ver-actions').forEach((row) => {
    const btn = row.querySelector('[data-action="all-visible"]');
    if (btn) btn.classList.add('active');
  });

  // Wire action buttons
  wrap.querySelectorAll('.exp-ver-actions button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const action = el.dataset.action!;
      const strip = el.dataset.strip!;
      const sectionEl = el.closest('.exp-ver-section')!;
      const cbs = sectionEl.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;
      // Show which mode this strip is in
      sectionEl.querySelectorAll('.exp-ver-actions button').forEach((b) => b.classList.remove('active'));
      el.classList.add('active');

      if (action === 'starred-only') {
        const ss = state();
        cbs.forEach(cb => {
          const fid = +cb.dataset.fid!;
          const vi = +cb.dataset.vi!;
          const vs = getStripVersions(fid, strip as StripType);
          const v = vs[vi];
          cb.checked = !!(v && (v as any).starred);
        });
      } else if (action === 'active-only') {
        cbs.forEach(cb => cb.checked = false);
        const ss = state();
        const framesFilt = ss.frames.filter(f => !f.hidden);
        framesFilt.forEach(f => {
          const ai = getStripActiveTab(f.id, strip as StripType);
          const cb = sectionEl.querySelector(`input[data-fid="${f.id}"][data-vi="${ai}"]`) as HTMLInputElement | null;
          if (cb) cb.checked = true;
        });
      } else if (action === 'all-visible') {
        // Check visible versions, uncheck hidden ones
        const ss = state();
        cbs.forEach(cb => {
          const fid = +cb.dataset.fid!;
          const vi = +cb.dataset.vi!;
          const vs = getStripVersions(fid, strip as StripType);
          const v = vs[vi];
          cb.checked = !(v && (v as any).hidden);
        });
      } else if (action === 'select-all') {
        // Rebuild this section including hidden versions and check all
        const ss = state();
        const framesFilt = ss.frames.filter(f => !f.hidden);
        sectionEl.querySelectorAll('.exp-frame-row').forEach(r => r.remove());
        framesFilt.forEach(f => {
          const vs = getStripVersions(f.id, strip as StripType);
          const nonEmpty = vs.map((v, i) => ({ v, i })).filter(o => versionHasContent(o.v));
          if (nonEmpty.length === 0) return;
          const row = document.createElement('div');
          row.className = 'exp-frame-row';
          const fLabel = f.label ? f.label : `frame ${ss.frames.indexOf(f) + 1}`;
          let html = `<div class="exp-frame-row-label">${escapeHtml(fLabel)}</div><div class="exp-frame-row-versions">`;
          nonEmpty.forEach(o => {
            html += `<label><input type="checkbox" data-fid="${f.id}" data-vi="${o.i}" data-strip="${strip}" checked> ${escapeHtml(o.v.label)}</label>`;
          });
          html += '</div>';
          row.innerHTML = html;
          sectionEl.appendChild(row);
        });
      } else if (action === 'deselect-all') {
        cbs.forEach(cb => cb.checked = false);
      }
    });
  });
}

export function buildVersionPicker(): void {
  // Get selected strips from overview picker
  const strips = getSelectedStrips('exportOverviewStripPicker');
  buildVersionPickerForStrips('exportVersionPicker', strips.length ? strips : ['ver']);
}

export function buildPptxVersionPicker(): void {
  const strips = getSelectedStrips('pptxOverviewStripPicker');
  buildVersionPickerForStrips('pptxVersionPicker', strips.length ? strips : ['ver']);
}

// ── Group picker for export modals ──

function buildGroupPicker(containerId: string, radioName: string): void {
  const s = state();
  const container = document.getElementById(containerId);
  const wrap = document.getElementById(containerId + 'Wrap');
  if (!container || !wrap) return;

  // Only show if groups exist
  if (!s.groups.length) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'block';

  const activeGid = s.activeGroupId;
  let html = `<label class="exp-group-opt">
    <input type="radio" name="${radioName}" value="all" ${activeGid === null ? 'checked' : ''}>
    <span>ALL (${s.frames.length})</span>
  </label>`;

  for (const g of s.groups) {
    const count = g.frameIds.filter(id => s.frames.some(f => f.id === id)).length;
    html += `<label class="exp-group-opt">
      <input type="radio" name="${radioName}" value="${g.id}" ${g.id === activeGid ? 'checked' : ''}>
      <span>${escapeHtml(g.name)} (${count})</span>
    </label>`;
  }
  container.innerHTML = html;
}

function getExportGroupName(radioName: string): string | null {
  const s = state();
  const selected = (document.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement)?.value;
  if (!selected || selected === 'all') return 'ALL';
  const gid = parseInt(selected);
  const group = s.groups.find(g => g.id === gid);
  return group ? group.name : null;
}

function withGroupSuffix(projectName: string, radioName: string): string {
  const groupName = getExportGroupName(radioName);
  return groupName ? `${projectName} / ${groupName}` : projectName;
}

/** True when a specific group (not ALL) is selected in the export picker */
function isGroupSelected(radioName: string): boolean {
  const val = (document.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement)?.value;
  return !!val && val !== 'all';
}

function getExportFrames(radioName: string): Frame[] {
  const s = state();
  const selected = (document.querySelector(`input[name="${radioName}"]:checked`) as HTMLInputElement)?.value;
  if (!selected || selected === 'all') return s.frames;
  const gid = parseInt(selected);
  const group = s.groups.find(g => g.id === gid);
  if (!group) return s.frames;
  const frameMap = new Map(s.frames.map(f => [f.id, f]));
  return group.frameIds.map(id => frameMap.get(id)).filter((f): f is Frame => !!f);
}

/**
 * Re-sequence frames for the Sort By layout and return the matching breaks.
 * '__storyflow__' keeps the natural frame order and uses storyFlowBreaks.
 */
function getSortedExportFrames(orderId: string, pool: Frame[]): { frames: Frame[]; breaks: SortBreak[] } {
  const s = state();
  if (orderId === '__storyflow__') {
    return { frames: pool, breaks: [...(s.storyFlowBreaks || [])] };
  }
  const order = s.sortOrders.find((o) => o.id === orderId);
  if (!order) return { frames: pool, breaks: [] };
  const byId = new Map(pool.map((f) => [f.id, f]));
  const seq = order.frameOrder.map((id) => byId.get(id)).filter((f): f is Frame => !!f);
  // Any frame missing from the saved order still gets exported, appended at the end
  const seen = new Set(seq.map((f) => f.id));
  for (const f of pool) if (!seen.has(f.id)) seq.push(f);
  return { frames: seq, breaks: [...(order.breaks || [])] };
}

/**
 * A frame's NEEDS as label/value pairs, built exactly the way the on-screen
 * SORT BY view builds them (sortOrder.ts): one line per TABLE - not per tab -
 * with counters shown as "total (n NAME + n NAME)".
 */
function needsPairsFor(fid: number, tabs: import('../store/state').NeedTab[]): { k: string; v: string }[] {
  const fn = state().frameNeeds[fid];
  const out: { k: string; v: string }[] = [];
  if (!fn) return out;
  for (const tab of tabs) {
    for (const table of tab.tables) {
      if (table.type === 'counter') {
        const items: { name: string; count: number }[] = [];
        let total = 0;
        for (const item of table.items) {
          const c = fn.counters?.[item.id] || 0;
          if (c > 0) {
            items.push({ name: item.name, count: c });
            total += c;
          }
        }
        if (items.length) {
          const breakdown = items.map((i) => `${i.count} ${i.name}`).join(' + ');
          out.push({ k: table.name, v: `${total} (${breakdown})` });
        }
      } else {
        const on = table.items.filter((it) => fn.toggles?.[it.id]).map((it) => it.name);
        if (on.length) out.push({ k: table.name, v: on.join(', ') });
      }
    }
  }
  return out;
}

/** The same two columns the SORT BY view shows - split by tab, as it does. */
function needsColumns(fid: number): [{ k: string; v: string }[], { k: string; v: string }[]] {
  const tabs = state().needDefinitions.tabs || [];
  const mid = Math.ceil(tabs.length / 2);
  return [needsPairsFor(fid, tabs.slice(0, mid)), needsPairsFor(fid, tabs.slice(mid))];
}

/** Flat version for the layouts that print NEEDS as running text. */
function needsLines(fid: number): string[] {
  const s = state();
  const lines = needsPairsFor(fid, s.needDefinitions.tabs || []).map((p) => `${p.k}: ${p.v}`);
  const fn = s.frameNeeds[fid];
  if (fn) {
    const locs = s.needDefinitions.locations.filter((l) => fn.locationToggles?.[l.id]).map((l) => l.name);
    if (locs.length) lines.push(`LOCATION: ${locs.join(', ')}`);
    for (const tab of s.needDefinitions.tabs || []) {
      const memo = (fn.memos?.[tab.id] || '').trim();
      if (memo) lines.push(`${tab.name}: ${memo}`);
    }
  }
  return lines;
}

/** A frame's NOTES as either wrapped text or a table, whichever the user set. */
function noteContent(fid: number): { text: string; table: TableData | null } {
  const s = state();
  const fn = s.frameNotes[fid];
  if (!fn) return { text: '', table: null };
  if (fn.mode === 'table') return { text: '', table: fn.tableData || null };
  return { text: (fn.noteText || '').trim(), table: null };
}

/** Sort-order picker — STORY FLOW plus every saved shooting order. */
function buildSortOrderPicker(containerId: string, radioName: string): void {
  const container = document.getElementById(containerId);
  if (!container) return;
  const s = state();
  let html = `<label class="exp-strip-opt">
    <input type="radio" name="${radioName}" value="__storyflow__" checked>
    <span>STORY FLOW</span>
  </label>`;
  for (const o of s.sortOrders) {
    html += `<label class="exp-strip-opt">
      <input type="radio" name="${radioName}" value="${o.id}">
      <span>${escapeHtml(o.name)}</span>
    </label>`;
  }
  container.innerHTML = html;
}

/** Current date and time, used as the default header date. */
function todayStr(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} / ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * Size a header input to its own text (roughly content + 10%) instead of
 * stretching it to a fixed column, and keep it in step as the user types.
 */
/** Fill the four header inputs from saved state, falling back to placeholders. */
function populateMetaFields(prefix: string): void {
  const s = state();
  const m = s.exportMeta || createDefaultExportMeta();
  const set = (id: string, val: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (!el) return;
    if (!el.value) el.value = val;
  };
  // Earlier builds auto-filled these from the sort order / account name, so a
  // stored value isn't proof the user typed it. Treat those machine-generated
  // values as empty so the real defaults show through once.
  const autoOrder = new Set<string>(['STORY FLOW', ...s.sortOrders.map((o) => o.name)]);
  const savedOrder = autoOrder.has(m.shootingOrder) ? '' : m.shootingOrder;
  const ownerName = ((getCurrentProject() as any)?.ownerName || '').trim();
  const savedUser = ownerName && m.userName === ownerName ? '' : m.userName;

  set(`${prefix}MetaOrder`, savedOrder || 'SHOOTING BOARD');
  set(`${prefix}MetaUser`, savedUser || 'YOUR NAME');
  set(`${prefix}MetaVersion`, m.version || 'VERSION v1');
  // The date describes THIS export, so it always refreshes rather than carrying
  // over whatever was stamped on the previous one.
  const dateEl = document.getElementById(`${prefix}MetaDate`) as HTMLInputElement | null;
  if (dateEl) dateEl.value = todayStr();
}

/** Read the four header inputs and remember them on the project. */
function readMetaFields(prefix: string): ExportMeta {
  const get = (id: string) => ((document.getElementById(id) as HTMLInputElement | null)?.value || '').trim();
  const meta: ExportMeta = {
    shootingOrder: get(`${prefix}MetaOrder`),
    userName: get(`${prefix}MetaUser`),
    version: get(`${prefix}MetaVersion`),
    date: get(`${prefix}MetaDate`),
  };
  useStore.setState({ exportMeta: meta });
  void flushSyncNow();
  return meta;
}

export function openExportModal(): void {
  const s = state();
  if (!s.frames.length) {
    showToast('No frames to export');
    return;
  }
  document.getElementById('exportModal')!.classList.remove('hidden');
  const nameInput = document.getElementById('exportProjectName') as HTMLInputElement;
  if (!nameInput.value) nameInput.value = getCurrentProject().name || s.lastPdfName || 'Storyboard';
  populateMetaFields('export');
  buildGroupPicker('exportGroupPicker', 'exportGroup');
  buildStripPicker('exportDoubleStripPicker', 'radio', 'exportDoubleStrip');
  buildStripPicker('exportOverviewStripPicker', 'checkbox');
  buildSortOrderPicker('exportSortOrderPicker', 'exportSortOrder');
  buildVersionPicker();
  const layout = (document.querySelector('input[name="exportLayout"]:checked') as HTMLInputElement).value;
  updateExportVisibility(layout, 'export');
}

export function updateExportVisibility(layout: string, prefix: string): void {
  const isDouble = layout === 'double';
  const isOverview = layout === 'overview';
  const isSortBy = layout === 'sortby';
  const show = (id: string, on: boolean) => {
    const el = document.getElementById(id) as HTMLElement | null;
    if (el) el.style.display = on ? 'block' : 'none';
  };
  show(`${prefix}DoubleStripWrap`, isDouble);
  show(`${prefix}SortOrderWrap`, isSortBy);
  // Sort By fixes its own strips (VERSN + SKETCH, mirroring the on-screen row)
  // and always prints NEEDS, so neither picker applies there.
  show(`${prefix}OverviewStripWrap`, isOverview);
  show(`${prefix}VersionPickerWrap`, isOverview);
  // NEEDS / NOTES apply to Double Strip and Full Overview
  show(`${prefix}NeedsToggleWrap`, isDouble || isOverview);
  show(`${prefix}NotesToggleWrap`, isDouble || isOverview);
  // 3×2 always prints descriptions, and Sort By has neither toggle
  show(`${prefix}TextToggleWrap`, isDouble || isOverview);
  show(`${prefix}HiddenToggleWrap`, !isSortBy);
}

export function openPptxModal(): void {
  const s = state();
  if (!s.frames.length) {
    showToast('No frames to export');
    return;
  }
  document.getElementById('pptxModal')!.classList.remove('hidden');
  const nameInput = document.getElementById('pptxProjectName') as HTMLInputElement;
  if (!nameInput.value) nameInput.value = getCurrentProject().name || s.lastPdfName || 'Storyboard';
  populateMetaFields('pptx');
  buildGroupPicker('pptxGroupPicker', 'pptxGroup');
  buildStripPicker('pptxDoubleStripPicker', 'radio', 'pptxDoubleStrip');
  buildStripPicker('pptxOverviewStripPicker', 'checkbox');
  buildSortOrderPicker('pptxSortOrderPicker', 'pptxSortOrder');
  buildPptxVersionPicker();
  const layout = (document.querySelector('input[name="pptxLayout"]:checked') as HTMLInputElement).value;
  updateExportVisibility(layout, 'pptx');
}

export async function runExport(): Promise<void> {
  fhTrack('export_pdf');
  const s = state();
  const layout = (document.querySelector('input[name="exportLayout"]:checked') as HTMLInputElement).value;
  // 3×2 always prints descriptions; Sort By prints none
  const includeText =
    layout === 'grid3x2' ? true : layout === 'sortby' ? false : (document.getElementById('exportIncludeText') as HTMLInputElement).checked;
  const includeNeeds =
    layout === 'sortby' ? true : (document.getElementById('exportIncludeNeeds') as HTMLInputElement)?.checked ?? false;
  const includeNotes = (document.getElementById('exportIncludeNotes') as HTMLInputElement)?.checked ?? false;
  const paperLetter = (document.getElementById('exportPaperLetter') as HTMLInputElement).checked;
  // Header prints the project name alone — the group only tags the filename
  const projectName = ((document.getElementById('exportProjectName') as HTMLInputElement).value || 'Storyboard').trim();
  const fileBase = withGroupSuffix(projectName, 'exportGroup');
  const meta = readMetaFields('export');
  const sortOrderId =
    (document.querySelector('input[name="exportSortOrder"]:checked') as HTMLInputElement)?.value || '__storyflow__';

  const includeHidden = (document.getElementById('exportIncludeHidden') as HTMLInputElement)?.checked ?? false;
  let exportFrames = getExportFrames('exportGroup');
  // Hidden filter only applies to ALL — inside a group, all member frames export
  if (!includeHidden && !isGroupSelected('exportGroup')) exportFrames = exportFrames.filter((f: Frame) => !f.hidden);
  // Sort By re-sequences the frames and carries section breaks
  let sortBreaks: SortBreak[] = [];
  if (layout === 'sortby') {
    const seq = getSortedExportFrames(sortOrderId, exportFrames);
    exportFrames = seq.frames;
    sortBreaks = seq.breaks;
  }
  // Use local variable — NEVER shadow s.frames on the live store (autosave/sync would capture the subset)
  const frames = exportFrames;

  document.getElementById('exportModal')!.classList.add('hidden');
  showToast('Generating PDF…');

  const paper = paperLetter ? 'letter' : 'a4';
  const orient = layout === 'double' || layout === 'sortby' ? 'portrait' : 'landscape';
  const pdf = new jsPDF({ orientation: orient, unit: 'mm', format: paper });
  registerPdfFont(pdf);
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const MARGIN = 8;
  // Header block: title line + two small meta rows + rule. Deliberately tight
  // so it takes as little off the content area as possible.
  const HEADER_H = 10.5;   // meta rows finish ~9.2mm in, so this is just clear of them
  const FOOTER_H = 2;   // page number is drawn below this band, at pageH - MARGIN/2
  const FRAME_BORDER_PT = 2;
  const LABEL_H = 4.5;

  /**
   * Page header — project name centred and bold, then two rows of free-text
   * meta (shooting order / user name, version / date), then a hairline rule.
   * Page number is drawn small at the bottom right.
   */
  function drawHeader(pageNum: number, totalPages: number) {
    const topY = MARGIN;
    // Project name — centred, bold
    pdf.setTextColor(20);
    pdf.setFont(PDF_FONT, 'bold');
    pdf.setFontSize(10);
    pdf.text(projectName, pageW / 2, topY + 2.6, { align: 'center' });

    // Meta rows — small, grey, outer-aligned
    pdf.setFont(PDF_FONT, 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(120);
    const row1Y = topY + 6.4;
    const row2Y = topY + 9.2;
    if (meta.shootingOrder) pdf.text(meta.shootingOrder, MARGIN, row1Y);
    if (meta.userName) pdf.text(meta.userName, pageW - MARGIN, row1Y, { align: 'right' });
    if (meta.version) pdf.text(meta.version, MARGIN, row2Y);
    if (meta.date) pdf.text(meta.date, pageW - MARGIN, row2Y, { align: 'right' });

    // Page number — small, bottom right
    pdf.setFontSize(7);
    pdf.setTextColor(140);
    const label = totalPages > 0 ? `${pageNum} / ${totalPages}` : `${pageNum}`;
    pdf.text(label, pageW - MARGIN, pageH - MARGIN / 2, { align: 'right' });
    pdf.setTextColor(30);
  }

  /** Repaint every page's footer once the real total is known. */
  function stampPageNumbers() {
    const total = pdf.getNumberOfPages();
    for (let p = 1; p <= total; p++) {
      pdf.setPage(p);
      pdf.setFillColor(255, 255, 255);
      pdf.rect(pageW - MARGIN - 24, pageH - MARGIN / 2 - 3.2, 24, 4.5, 'F');
      pdf.setFont(PDF_FONT, 'normal');
      pdf.setFontSize(7);
      pdf.setTextColor(140);
      pdf.text(`${p} / ${total}`, pageW - MARGIN, pageH - MARGIN / 2, { align: 'right' });
    }
  }

  function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    // Pin BOTH family and size: getTextWidth measures with whatever font is
    // current, so a leftover bold from a label would mis-measure every line.
    pdf.setFont(PDF_FONT, 'normal');
    pdf.setFontSize(fontSize);
    return hardWrapLines(pdf, text || '', maxWidth);
  }

  async function drawFrameTile(
    x: number,
    y: number,
    w: number,
    h: number,
    canvas: HTMLCanvasElement,
    text: string,
    textHeight: number,
    textMaxW?: number
  ) {
    // Border is baked into the bitmap so it stays part of the picture
    const img = withBakedBorder(canvas).toDataURL('image/jpeg', 0.92);
    pdf.addImage(img, 'JPEG', x, y, w, h, undefined, 'FAST');
    if (textHeight > 0 && text) {
      pdf.setTextColor(30);
      const fontSize = 8;
      pdf.setFontSize(fontSize);
      const tw = textMaxW || w;
      const lines = wrapText(text, tw, fontSize);
      // Same line metric measureTextH uses, so measured layouts lose nothing
      const lineStep = fontSize * 0.45 + 0.5;
      // Never draw past the space reserved for this tile — otherwise a long
      // description runs down into the frame below it.
      const maxLines = Math.max(0, Math.floor((textHeight - 4.5) / lineStep + 0.001));
      const shown = lines.slice(0, maxLines);
      if (shown.length && lines.length > maxLines) {
        // Mark the clipped tail so it's clear the text continues
        const last = shown.length - 1;
        let t = shown[last];
        while (t.length > 1 && pdf.getTextWidth(t + '…') > tw) t = t.slice(0, -1);
        shown[last] = t + '…';
      }
      let ty = y + h + 4.5;
      for (const line of shown) {
        pdf.text(line, x, ty);
        ty += lineStep;
      }
    }
  }

  function drawFrameLabel(x: number, y: number, label: string) {
    if (!label) return;
    pdf.setTextColor(0);
    pdf.setFont(PDF_FONT, 'bold');
    pdf.setFontSize(7.5);
    pdf.text(label, x, y - 1.2);
    pdf.setFont(PDF_FONT, 'normal');
  }

  function measureTextH(text: string, maxW: number, fontSize: number): number {
    if (!text) return 0;
    pdf.setFontSize(fontSize);
    const lines = hardWrapLines(pdf, text, maxW);
    const lineHeight = fontSize * 0.45 + 0.5;
    return 4.5 + lines.length * lineHeight;
  }

  const TABLE_FONT = 7;
  const TABLE_ROW_H = 5;
  const TABLE_HEADER_H = 6;
  const TABLE_PAD = 1.5;

  function tableHasContent(td: any): boolean {
    if (!td) return false;
    if (td.headers && td.headers.some((h: string) => h && h.trim())) return true;
    if (td.rows && td.rows.some((r: string[]) => r.some((c: string) => c && c.trim()))) return true;
    return false;
  }

  function measureTableH(td: any): number {
    if (!td) return 0;
    const dataRows = td.rows ? td.rows.filter((r: string[]) => r.some((c: string) => c && c.trim())).length : 0;
    const hasHeaders = td.headers && td.headers.some((h: string) => h && h.trim());
    if (!hasHeaders && dataRows === 0) return 0;
    return (hasHeaders ? TABLE_HEADER_H : 0) + dataRows * TABLE_ROW_H + 2;
  }

  function drawTableInPDF(x: number, y: number, maxW: number, td: any): number {
    if (!td) return 0;
    const hasHeaders = td.headers && td.headers.some((h: string) => h && h.trim());
    const dataRows = td.rows ? td.rows.filter((r: string[]) => r.some((c: string) => c && c.trim())) : [];
    if (!hasHeaders && dataRows.length === 0) return 0;
    const cols = td.headers ? td.headers.length : 3;
    const colW = maxW / cols;
    let curY = y;

    if (hasHeaders) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(x, curY, maxW, TABLE_HEADER_H, 'F');
      pdf.setTextColor(0);
      pdf.setFont(PDF_FONT, 'bold');
      pdf.setFontSize(TABLE_FONT);
      for (let c = 0; c < cols; c++) {
        const text = (td.headers[c] || '').trim();
        if (text) pdf.text(text, x + c * colW + TABLE_PAD, curY + TABLE_HEADER_H - 1.8);
      }
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.3);
      pdf.rect(x, curY, maxW, TABLE_HEADER_H);
      for (let c = 1; c < cols; c++) pdf.line(x + c * colW, curY, x + c * colW, curY + TABLE_HEADER_H);
      curY += TABLE_HEADER_H;
    }

    pdf.setFont(PDF_FONT, 'normal');
    pdf.setFontSize(TABLE_FONT);
    for (const row of dataRows) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(x, curY, maxW, TABLE_ROW_H, 'F');
      pdf.setTextColor(0);
      for (let c = 0; c < cols; c++) {
        const text = (row[c] || '').trim();
        if (text) {
          const clipped = hardWrapLines(pdf, text, colW - 2 * TABLE_PAD)[0] || '';
          pdf.text(clipped, x + c * colW + TABLE_PAD, curY + TABLE_ROW_H - 1.5);
        }
      }
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.3);
      pdf.rect(x, curY, maxW, TABLE_ROW_H);
      for (let c = 1; c < cols; c++) pdf.line(x + c * colW, curY, x + c * colW, curY + TABLE_ROW_H);
      curY += TABLE_ROW_H;
    }
    return curY - y;
  }

  /** NEEDS / NOTES block used by the Double Strip layout. */
  function drawDoubleExtras(f: Frame, x: number, y: number, maxW: number): void {
    let cy = y;
    if (includeNeeds) {
      const lines = needsLines(f.id);
      if (lines.length) {
        pdf.setFont(PDF_FONT, 'normal');
        pdf.setFontSize(6.5);
        pdf.setTextColor(70);
        for (const raw of lines) {
          for (const line of hardWrapLines(pdf, raw, maxW)) {
            pdf.text(line, x, cy + 2.4);
            cy += 3.3;
          }
        }
        cy += 1.5;
      }
    }
    if (includeNotes) {
      const nc = noteContent(f.id);
      if (nc.table && tableHasContent(nc.table)) {
        drawTableInPDF(x, cy, maxW, nc.table);
      } else if (nc.text) {
        pdf.setFont(PDF_FONT, 'normal');
        pdf.setFontSize(7);
        pdf.setTextColor(50);
        for (const line of hardWrapLines(pdf, nc.text, maxW)) {
          pdf.text(line, x, cy + 2.6);
          cy += 3.5;
        }
      }
    }
    pdf.setTextColor(30);
  }

  function calcMainGrid(extraTop = 0) {
    const cols = 3,
      rows = 2;
    const contentW = pageW - 2 * MARGIN;
    const contentH = pageH - 2 * MARGIN - HEADER_H - FOOTER_H - extraTop;
    const gutterX = 4;
    const ref = s.frames[0] || { cropW: 16, cropH: 9 };
    const aspect = ref.cropW / ref.cropH;
    const cellW = (contentW - gutterX * (cols - 1)) / cols;
    let fW = cellW * 0.95,
      fH = fW / aspect;
    // Reserve a real text band under each tile so descriptions have room and
    // don't have to be clipped at the first line.
    const minGutter = includeText ? 15 : 6;
    let gutterY = (contentH - rows * (LABEL_H + fH)) / rows;
    if (gutterY < minGutter) {
      gutterY = minGutter;
      fH = (contentH - rows * (LABEL_H + gutterY)) / rows;
      fW = fH * aspect;
    }
    const textH = includeText ? Math.max(0, gutterY - 2) : 0;
    const gridW = cols * fW + (cols - 1) * gutterX;
    const centreX = MARGIN + (contentW - gridW) / 2;
    const startY = MARGIN + HEADER_H + extraTop;
    return { cols, rows, frameW: fW, frameH: fH, textH, gutterX, gutterY, startX: centreX, startY };
  }

  /** Portrait mode: 5 tall (9:16) frames side by side on one landscape page. */
  function calcPortraitGrid() {
    const cols = 5;
    const contentW = pageW - 2 * MARGIN;
    const contentH = pageH - 2 * MARGIN - HEADER_H - FOOTER_H;
    const gutterX = 4;
    const aspect = 540 / 960; // 9:16
    const availW = contentW - gutterX * (cols - 1);
    let fW = availW / cols;
    let fH = fW / aspect;
    // If frames are too tall, constrain by height
    if (fH + LABEL_H > contentH) {
      fH = contentH - LABEL_H;
      fW = fH * aspect;
    }
    const gridW = cols * fW + (cols - 1) * gutterX;
    const centreX = MARGIN + (contentW - gridW) / 2;
    const startY = MARGIN + HEADER_H;
    return { cols, frameW: fW, frameH: fH, gutterX, startX: centreX, startY };
  }

  function calcDoubleGrid() {
    const contentW = pageW - 2 * MARGIN;
    const contentH = pageH - 2 * MARGIN - HEADER_H - FOOTER_H;
    const pairGap = 4;
    const ref = s.frames[0] || { cropW: 16, cropH: 9 };
    const aspect = ref.cropW / ref.cropH;
    const pairW = contentW * 0.9;
    const frameW = (pairW - pairGap) / 2;
    let fW = frameW * 0.95,
      fH = fW / aspect;
    const rows = 4;
    let gutterY = (contentH - rows * (LABEL_H + fH)) / rows;
    if (gutterY < 4) {
      gutterY = 4;
      fH = (contentH - rows * (LABEL_H + gutterY)) / rows;
      fW = fH * aspect;
    }
    const textH = includeText ? Math.min(gutterY - 2, 12) : 0;
    const pairActualW = fW * 2 + pairGap;
    const startX = MARGIN + (contentW - pairActualW) / 2;
    const startY = MARGIN + HEADER_H;
    return { rows, frameW: fW, frameH: fH, textH, gutterY, pairGap, startX, startY };
  }

  function calcOverviewGrid() {
    const contentW = pageW - 2 * MARGIN;
    const contentH = pageH - 2 * MARGIN - HEADER_H - FOOTER_H;
    const ref = s.frames[0] || { cropW: 16, cropH: 9 };
    const aspect = ref.cropW / ref.cropH;
    const mainGap = 4;
    const vGapX = mainGap;
    const vGapY = mainGap;
    const mainTextH = 0;
    const mainMaxW = contentW * 0.48 * 0.95;
    let mainW = mainMaxW,
      mainH = mainW / aspect;
    let rowGap = (contentH - 2 * (LABEL_H + mainH)) / 2;
    if (rowGap < 5) {
      rowGap = 5;
      mainH = (contentH - 2 * (LABEL_H + rowGap)) / 2;
      mainW = mainH * aspect;
    }
    let verCellH = (mainH - vGapY) / 2;
    let verCellW = verCellH * aspect;
    const totalRowW = mainW + mainGap + verCellW * 2 + vGapX;
    if (totalRowW > contentW) {
      const scale = contentW / totalRowW;
      mainW *= scale;
      mainH *= scale;
      verCellH = (mainH - vGapY) / 2;
      verCellW = verCellH * aspect;
      rowGap = (contentH - 2 * (LABEL_H + mainH)) / 2;
    }
    const blockH = mainH + LABEL_H;
    const actualW = mainW + mainGap + verCellW * 2 + vGapX;
    const centreX = MARGIN + (contentW - actualW) / 2;
    return {
      mainW,
      mainH,
      mainTextH,
      verCellW,
      verCellH,
      vGapX,
      vGapY,
      mainGap,
      blockH,
      rowGap,
      contentH,
      startX: centreX,
      startY: MARGIN + HEADER_H,
    };
  }

  let page = 0,
    totalPages = 0;

  if (layout === 'grid3x2' && s.portraitMode) {
    // Portrait mode: 5 tall frames per landscape page
    const g = calcPortraitGrid();
    const perPage = g.cols; // 5 per page
    totalPages = Math.ceil(frames.length / perPage);
    for (let i = 0; i < frames.length; i++) {
      const slot = i % perPage;
      if (slot === 0) {
        if (i > 0) pdf.addPage();
        page++;
        drawHeader(page, totalPages);
      }
      const col = slot;
      const x = g.startX + col * (g.frameW + g.gutterX);
      const y = g.startY + LABEL_H;
      const f = frames[i];
      const cvs = await rasterizeMain(f);
      await drawFrameTile(x, y, g.frameW, g.frameH, cvs, '', 0);
      drawFrameLabel(x, y, f.label || `${i + 1}`);
    }
  } else if (layout === 'grid3x2') {
    // FIXED layout. Pictures always keep the same size; the caption band under
    // each one is a fixed height. Text that doesn't fit is simply not drawn —
    // one long description must never resize the page or push into a neighbour.
    const cols = 3,
      rows = 2;
    const contentW = pageW - 2 * MARGIN;
    const contentH = pageH - 2 * MARGIN - HEADER_H - FOOTER_H;
    const gutterX = 4;
    const ROW_GAP = 3;
    const LINE_STEP = 8 * 0.45 + 0.5;
    const TEXT_LINES = 5; // caption room, in lines
    const g3ref = s.frames[0] || { cropW: 16, cropH: 9 };
    const g3aspect = g3ref.cropW / g3ref.cropH;
    const cellW = (contentW - gutterX * (cols - 1)) / cols;

    const rowAvail = (contentH - (rows - 1) * ROW_GAP) / rows;
    const textH = includeText ? 4.5 + TEXT_LINES * LINE_STEP : 0;
    // Picture fits the column, but never taller than the row minus label+caption
    const fH = Math.max(10, Math.min(cellW / g3aspect, rowAvail - LABEL_H - textH));
    const fW = Math.min(cellW, fH * g3aspect);
    const gridW = cols * fW + (cols - 1) * gutterX;
    const startX = MARGIN + (contentW - gridW) / 2;
    const startY = MARGIN + HEADER_H;
    const rowH = rowAvail + ROW_GAP;
    const perPage = cols * rows;

    totalPages = Math.ceil(frames.length / perPage) || 1;
    for (let i = 0; i < frames.length; i++) {
      const slot = i % perPage;
      if (slot === 0) {
        if (i > 0) pdf.addPage();
        page++;
        drawHeader(page, totalPages);
      }
      const col = slot % cols,
        row = Math.floor(slot / cols);
      const x = startX + col * (fW + gutterX);
      const y = startY + row * rowH + LABEL_H;
      const f = frames[i];
      const cvs = await rasterizeMain(f);
      await drawFrameTile(x, y, fW, fH, cvs, f.textContent || '', textH);
      drawFrameLabel(x, y, f.label || '');
    }
  } else if (layout === 'sortby') {
    // Portrait. Each frame is a card mirroring the on-screen SORT BY row.
    // The view's grid is `44px 25% 17% 1fr 30px` with 6px gaps on a ~876px
    // card, so those become the proportions below. The arrows column is
    // dropped (nothing to click in a PDF) and its width goes to NEEDS.
    const contentW = pageW - 2 * MARGIN;
    const bottomY = pageH - MARGIN - FOOTER_H;
    const PAD_T = 2.2, PAD_R = 2.4, PAD_L = 0.8;   // .sort-card padding 8/9/8/3 px
    const GAP = contentW * 0.0068;                  // 6px of 876
    const CARD_GAP = 1.6;
    const sbRef = s.frames[0] || { cropW: 16, cropH: 9 };
    const sbAspect = sbRef.cropW / sbRef.cropH;

    const gridW = contentW - PAD_L - PAD_R;
    const numW = gridW * 0.050;      // 44px
    const mainW = gridW * 0.25;      // 25%
    const verW = gridW * 0.17;       // 17%
    const needsW = gridW - numW - mainW - verW - GAP * 3;
    const mainH = mainW / sbAspect;
    const verH = verW / sbAspect;
    const colW = (needsW - GAP) / 2;

    let cursorY = MARGIN + HEADER_H;
    page = 1;
    drawHeader(page, 0);

    const breakAt = new Map<number, string>();
    for (const b of sortBreaks) {
      const t = (b.text || '').trim();
      if (t) breakAt.set(b.position, t);
    }

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];

      const capLines = f.textContent ? hardWrapLines(pdf, f.textContent, mainW).length : 0;
      const capH = capLines ? 1.2 + capLines * 3.2 : 0;
      const [col1, col2] = needsColumns(f.id);
      // Count real rendered lines per column, since a long value wraps
      pdf.setFontSize(7);
      const colLines = (pairs: { k: string; v: string }[]) =>
        pairs.reduce((n, pr) => {
          pdf.setFont(PDF_FONT, 'bold');
          const kW = pdf.getTextWidth(`${pr.k} `);
          pdf.setFont(PDF_FONT, 'normal');
          return n + hardWrapLines(pdf, pr.v, Math.max(8, colW - kW)).length;
        }, 0);
      const textH = Math.max(colLines(col1), colLines(col2)) * 3.9;
      const cardH = Math.max(mainH + capH, verH * 2 + GAP, textH) + PAD_T * 2;

      const title = breakAt.get(i);
      const BREAK_H = 5.6;                    // .sort-break-card: 4px pad + 14px text + 4px pad
      if (cursorY + (title ? BREAK_H + CARD_GAP : 0) + cardH + CARD_GAP > bottomY) {
        pdf.addPage();
        page++;
        drawHeader(page, 0);
        cursorY = MARGIN + HEADER_H;
      }

      if (title) {
        // .sort-break-card — full-width grey bar, #808080 on a #666 border
        pdf.setFillColor(128, 128, 128);
        pdf.setDrawColor(102);
        pdf.setLineWidth(0.25);
        pdf.roundedRect(MARGIN, cursorY, contentW, BREAK_H, 1.2, 1.2, 'FD');
        // .sort-break-text — transparent, no border, white semibold.
        // (The inset box in the CSS is .sort-break-active only, i.e. while a
        // break is selected for reordering — not its resting state.)
        pdf.setFont(PDF_FONT, 'bold');
        pdf.setFontSize(9);
        pdf.setTextColor(255);
        const tTxt = hardWrapLines(pdf, title, contentW * 0.6)[0] || title;
        pdf.text(tTxt, MARGIN + 2.6, cursorY + BREAK_H / 2 + 1.2);
        pdf.setFont(PDF_FONT, 'normal');
        pdf.setTextColor(30);
        cursorY += BREAK_H + CARD_GAP;
      }

      // .sort-card — #d9d9d9 fill, 1px #aaa border, 4px radius
      pdf.setFillColor(217, 217, 217);
      pdf.setDrawColor(170);
      pdf.setLineWidth(0.25);
      pdf.roundedRect(MARGIN, cursorY, contentW, cardH, 1.2, 1.2, 'FD');

      const innerY = cursorY + PAD_T;
      let x = MARGIN + PAD_L;

      // Number column, matching .sort-card-col-num: label number on top, any
      // trailing text under it, and the SETUP pill pinned to the bottom
      // (margin-top:auto in the view). Everything is centred and clipped to
      // the column, never wrapped past it.
      const lp = (f.label || '').match(/^(\d+[A-Za-z]?\.?)\s*(.*)/);
      const labelNum = lp ? lp[1] : f.label || '';
      const labelExtra = lp ? lp[2] : '';
      const numCx = x + numW / 2;
      const clipTo = (t: string, w: number) => {
        if (pdf.getTextWidth(t) <= w) return t;
        let out = t;
        while (out.length > 1 && pdf.getTextWidth(out + '…') > w) out = out.slice(0, -1);
        return out + '…';
      };

      // .sort-card-num — 13px, weight 500, #333
      pdf.setFont(PDF_FONT, 'normal');
      pdf.setFontSize(8);
      pdf.setTextColor(51);
      pdf.text(clipTo(labelNum, numW), numCx, innerY + 2.9, { align: 'center' });

      // .sort-card-extra — 8px, black, directly beneath
      if (labelExtra) {
        pdf.setFontSize(5);
        pdf.setTextColor(0);
        let ly = innerY + 5.6;
        for (const line of hardWrapLines(pdf, labelExtra, numW)) {
          if (ly > innerY + cardH - PAD_T * 2 - 3.4) break;   // leave room for the pill
          pdf.text(line, numCx, ly, { align: 'center' });
          ly += 2.3;
        }
      }

      // .sort-card-pill — setup name, white on the setup colour, at the bottom
      const setup = f.setupId ? s.setups.find((su) => su.id === f.setupId) : null;
      if (setup) {
        const hex = SETUP_COLORS[setup.colorIndex]?.hex || '#999';
        const r = parseInt(hex.slice(1, 3), 16),
          g2 = parseInt(hex.slice(3, 5), 16),
          b = parseInt(hex.slice(5, 7), 16);
        pdf.setFontSize(5);
        const pillTxt = clipTo(setup.name, numW - 1.4);
        const pillW = Math.min(numW, pdf.getTextWidth(pillTxt) + 1.6);
        const pillH = 2.6;
        const pillY = cursorY + cardH - PAD_T - pillH;
        pdf.setFillColor(r, g2, b);
        pdf.roundedRect(numCx - pillW / 2, pillY, pillW, pillH, 1.3, 1.3, 'F');
        // White text unless the swatch is very light, where it would vanish
        const lum = (0.299 * r + 0.587 * g2 + 0.114 * b) / 255;
        pdf.setTextColor(lum > 0.7 ? 30 : 255);
        pdf.text(pillTxt, numCx, pillY + 1.85, { align: 'center' });
      }
      x += numW + GAP;

      // MAIN — the only image with an outline in the view (2px black)
      const mainCvs = await rasterizeMain(f);
      const mainImg = withBakedBorder(mainCvs).toDataURL('image/jpeg', 0.92);
      pdf.addImage(mainImg, 'JPEG', x, innerY, mainW, mainH, undefined, 'FAST');
      if (capLines) {
        pdf.setFont(PDF_FONT, 'normal');
        pdf.setFontSize(6.5);
        pdf.setTextColor(40);
        let cy = innerY + mainH + 1.2;
        for (const line of hardWrapLines(pdf, f.textContent, mainW)) {
          pdf.text(line, x, cy + 2.2);
          cy += 3.2;
        }
      }
      x += mainW + GAP;

      // VERSN then SKETCH stacked — first version of each, no outline
      let vy = innerY;
      for (const sid of ['ver', 'floor'] as StripType[]) {
        const v = getStripVersions(f.id, sid)[0];
        if (v && versionHasContent(v)) {
          const vc = await rasterizeVersion(v, f.cropW, f.cropH);
          pdf.addImage(vc.toDataURL('image/jpeg', 0.92), 'JPEG', x, vy, verW, verH, undefined, 'FAST');
        }
        vy += verH + GAP;
      }
      x += verW + GAP;

      // NEEDS — two columns, bold table name then its values
      pdf.setFontSize(7);
      [col1, col2].forEach((colPairs, c) => {
        const cx = x + c * (colW + GAP);
        let cy = innerY;
        for (const pr of colPairs) {
          pdf.setFont(PDF_FONT, 'bold');
          pdf.setTextColor(20);
          const kTxt = `${pr.k} `;
          pdf.text(kTxt, cx, cy + 2.6);
          const tx = cx + pdf.getTextWidth(kTxt);
          pdf.setFont(PDF_FONT, 'normal');
          pdf.setTextColor(60);
          // First line sits beside the label; any continuation wraps to the
          // column's full width underneath, and the NEXT entry starts below
          // all of them rather than overlapping.
          const firstW = Math.max(8, colW - (tx - cx));
          const all = hardWrapLines(pdf, pr.v, firstW);
          if (all.length) pdf.text(all[0], tx, cy + 2.6);
          cy += 3.9;
          if (all.length > 1) {
            const rest = hardWrapLines(pdf, all.slice(1).join(' '), colW);
            for (const line of rest) {
              pdf.text(line, cx, cy + 2.6);
              cy += 3.9;
            }
          }
        }
      });
      pdf.setTextColor(30);
      pdf.setFont(PDF_FONT, 'normal');

      cursorY += cardH + CARD_GAP;
    }
    totalPages = page;
  } else if (layout === 'double') {
    const g = calcDoubleGrid();
    const dblStrips = getSelectedStrips('exportDoubleStripPicker');
    const dblStrip: StripType = dblStrips[0] || 'ver';
    const dblDef = (s.stripDefs || DEFAULT_STRIP_DEFS).find(d => d.id === dblStrip);
    const dblStripName = dblDef ? dblDef.defaultFrameLabel : dblStrip;
    const dblMode = (document.querySelector('input[name="exportDoubleMode"]:checked') as HTMLInputElement)?.value || 'starred';
    const perPage = g.rows;
    totalPages = Math.ceil(frames.length / perPage);
    for (let i = 0; i < frames.length; i++) {
      const slot = i % perPage;
      if (slot === 0) {
        if (i > 0) pdf.addPage();
        page++;
        drawHeader(page, totalPages);
      }
      const rowY = g.startY + slot * (LABEL_H + g.frameH + g.gutterY) + LABEL_H;
      const f = frames[i];
      const fLabel = f.label || `${i + 1}`;
      const vers = getStripVersions(f.id, dblStrip);
      const ver = dblMode === 'starred'
        ? vers.find(v => versionHasContent(v) && (v as any).starred)
        : vers[getStripActiveTab(f.id, dblStrip)];
      const mainCvs = await rasterizeMain(f);
      const fX1 = g.startX;
      await drawFrameTile(fX1, rowY, g.frameW, g.frameH, mainCvs, f.textContent || '', g.textH, g.frameW - 2);
      drawFrameLabel(fX1, rowY, fLabel);
      if (ver && versionHasContent(ver)) {
        const verCvs = await rasterizeVersion(ver, f.cropW, f.cropH);
        const fX2 = g.startX + g.frameW + g.pairGap;
        await drawFrameTile(fX2, rowY, g.frameW, g.frameH, verCvs, '', 0);
        drawFrameLabel(fX2, rowY, fullVerLabel(f.label || `${i + 1}`, `${dblStripName} ${ver.label || ''}`));
      }
      // NEEDS / NOTES sit under the version column so they never cover the images
      if (includeNeeds || includeNotes) {
        drawDoubleExtras(f, g.startX + g.frameW + g.pairGap, rowY + g.frameH + 2, g.frameW);
      }
    }
  } else if (layout === 'overview') {
    const g = calcOverviewGrid();
    const ovStrips = getSelectedStrips('exportOverviewStripPicker');
    const ovStripIds: StripType[] = ovStrips.length ? ovStrips : ['ver'];
    const stripDefs = s.stripDefs || DEFAULT_STRIP_DEFS;
    // frames is already filtered by includeHidden checkbox — don't filter again
    const visibleFrames = frames;

    // Collect versions grouped by strip (each strip starts a new row in export)
    type StripVerGroup = { stripName: string; vers: { v: any; label: string }[] };
    const frameStripGroups: StripVerGroup[][] = visibleFrames.map((f) => {
      const groups: StripVerGroup[] = [];
      for (const sid of ovStripIds) {
        const def = stripDefs.find(d => d.id === sid);
        const sName = def ? def.defaultFrameLabel : sid;
        const vGroup: { v: any; label: string }[] = [];
        const allVers = getStripVersions(f.id, sid);
        allVers.forEach((v, vi) => {
          if (!versionHasContent(v)) return;
          const cb = document.querySelector(`#exportVersionPicker input[data-fid="${f.id}"][data-vi="${vi}"][data-strip="${sid}"]`) as HTMLInputElement | null;
          if (cb && !cb.checked) return;
          const fIdx = visibleFrames.indexOf(f);
          vGroup.push({ v, label: fullVerLabel(f.label || `${fIdx + 1}`, `${sName} ${v.label || `v${vi + 1}`}`) });
        });
        if (vGroup.length > 0) groups.push({ stripName: sName, vers: vGroup });
      }
      return groups;
    });

    // Count version rows for strip groups (each strip starts on a new row)
    function stripGroupRows(groups: StripVerGroup[]): number {
      let rows = 0;
      for (const sg of groups) { rows += Math.ceil(sg.vers.length / 2); }
      return rows;
    }

    function frameTextH(f: any) {
      if (!includeText || !f.textContent) return 0;
      return measureTextH(f.textContent, g.mainW, 8);
    }
    /** Height of the NEEDS + NOTES block printed under a frame's main image. */
    function frameTableExH(f: any) {
      let h = 0;
      if (includeNeeds) {
        const lines = needsLines(f.id);
        if (lines.length) h += measureTextH(lines.join('\n'), g.mainW, 7) + 2;
      }
      if (includeNotes) {
        const nc = noteContent(f.id);
        if (nc.table && tableHasContent(nc.table)) h += measureTableH(nc.table) + 2;
        else if (nc.text) h += measureTextH(nc.text, g.mainW, 7.5) + 2;
      }
      return h;
    }

    /** Draw the NEEDS + NOTES block, returning the height consumed. */
    function drawFrameExtras(f: any, x: number, y: number, maxW: number): number {
      let cy = y;
      if (includeNeeds) {
        const lines = needsLines(f.id);
        if (lines.length) {
          pdf.setFont(PDF_FONT, 'normal');
          pdf.setFontSize(7);
          pdf.setTextColor(70);
          for (const raw of lines) {
            for (const line of hardWrapLines(pdf, raw, maxW)) {
              pdf.text(line, x, cy + 2.6);
              cy += 3.65;
            }
          }
          cy += 2;
        }
      }
      if (includeNotes) {
        const nc = noteContent(f.id);
        if (nc.table && tableHasContent(nc.table)) {
          drawTableInPDF(x, cy, maxW, nc.table);
          cy += measureTableH(nc.table) + 2;
        } else if (nc.text) {
          pdf.setFont(PDF_FONT, 'normal');
          pdf.setFontSize(7.5);
          pdf.setTextColor(50);
          for (const line of hardWrapLines(pdf, nc.text, maxW)) {
            pdf.text(line, x, cy + 2.8);
            cy += 3.9;
          }
          cy += 2;
        }
      }
      pdf.setTextColor(30);
      return cy - y;
    }

    // Version row height
    const vRowH = g.verCellH + g.vGapY;
    // Max version rows per page (4 rows = 8 versions in 2 cols)
    const maxVRows = Math.min(4, Math.floor((g.contentH - LABEL_H) / vRowH));

    // Each strip gets its own page(s). If a strip overflows, continue on next page.
    function splitStripGroupsIntoChunks(groups: StripVerGroup[]): StripVerGroup[][] {
      const chunks: StripVerGroup[][] = [];
      for (const sg of groups) {
        const sgRows = Math.ceil(sg.vers.length / 2);
        if (sgRows <= maxVRows) {
          // Fits on one page
          chunks.push([sg]);
        } else {
          // Split this strip's versions across multiple pages
          for (let v = 0; v < sg.vers.length; v += maxVRows * 2) {
            chunks.push([{ stripName: sg.stripName, vers: sg.vers.slice(v, v + maxVRows * 2) }]);
          }
        }
      }
      return chunks.length > 0 ? chunks : [[]];
    }

    // Build page items
    type OvPageItem = { fIdx: number; stripGroups: StripVerGroup[]; neededH: number; txtH: number; tblH: number; showMain: boolean };
    const pages: OvPageItem[][] = [];
    let currentPage: OvPageItem[] = [];
    let usedH = 0;

    for (let i = 0; i < visibleFrames.length; i++) {
      const f = visibleFrames[i];
      const groups = frameStripGroups[i];
      const txtH = frameTextH(f);
      const tblH = frameTableExH(f);
      const chunks = splitStripGroupsIntoChunks(groups);

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const isFirst = ci === 0;
        const chunkRows = stripGroupRows(chunk);
        const verSideH = LABEL_H + chunkRows * vRowH;
        const mainSideH = isFirst ? (g.mainH + LABEL_H + txtH + tblH) : 0;
        const neededH = Math.max(verSideH, mainSideH);
        const gapIfNotFirst = currentPage.length > 0 ? g.rowGap : 0;
        if (currentPage.length > 0 && usedH + gapIfNotFirst + neededH > g.contentH) {
          pages.push(currentPage);
          currentPage = [];
          usedH = 0;
        }
        currentPage.push({ fIdx: i, stripGroups: chunk, neededH, txtH: isFirst ? txtH : 0, tblH: isFirst ? tblH : 0, showMain: isFirst });
        usedH += (usedH > 0 ? g.rowGap : 0) + neededH;
      }
    }
    if (currentPage.length) pages.push(currentPage);
    totalPages = pages.length;

    // Render pages
    for (let pi = 0; pi < pages.length; pi++) {
      if (pi > 0) pdf.addPage();
      page = pi + 1;
      drawHeader(page, totalPages);
      let curY = g.startY;
      for (const item of pages[pi]) {
        const f = visibleFrames[item.fIdx];
        const mainX = g.startX;

        // Draw main frame only on the first page for this frame
        if (item.showMain) {
          const mainY = curY + LABEL_H;
          const mainCvs = await rasterizeMain(f);
          await drawFrameTile(mainX, mainY, g.mainW, g.mainH, mainCvs, f.textContent || '', item.txtH, g.mainW - 2);
          drawFrameLabel(mainX, mainY, f.label || `${item.fIdx + 1}`);
          drawFrameExtras(f, mainX, mainY + g.mainH + item.txtH + 2, g.mainW);
        }

        // Draw versions — each strip starts on a new row
        const verStartX = mainX + g.mainW + g.mainGap;
        let vRow = 0;
        for (const sg of item.stripGroups) {
          for (let vi = 0; vi < sg.vers.length; vi++) {
            const vc = vi % 2;
            const row = vRow + Math.floor(vi / 2);
            const vx = verStartX + vc * (g.verCellW + g.vGapX);
            const vy = curY + LABEL_H + row * vRowH;
            const entry = sg.vers[vi];
            const vCanvas = await rasterizeVersion(entry.v, f.cropW, f.cropH);
            await drawFrameTile(vx, vy, g.verCellW, g.verCellH, vCanvas, '', 0);
            drawFrameLabel(vx, vy, entry.label);
          }
          vRow += Math.ceil(sg.vers.length / 2);
        }
        curY += item.neededH + g.rowGap;
      }
    }
  }

  // Repaint footers now that the true page count is known
  stampPageNumbers();

  const now = new Date();
  const fname = `${fileBase.replace(/[^\w\-]+/g, '_')}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.pdf`;
  offerSave(pdf.output('blob') as Blob, fname);
  showToast('PDF ready');
}

export async function runPptxExport(): Promise<void> {
  fhTrack('export_pptx');
  const s = state();
  const layout = (document.querySelector('input[name="pptxLayout"]:checked') as HTMLInputElement).value;
  // 3x2 always prints descriptions; Sort By prints none
  const includeText =
    layout === 'grid3x2' ? true : layout === 'sortby' ? false : (document.getElementById('pptxIncludeText') as HTMLInputElement).checked;
  const includeNeeds =
    layout === 'sortby' ? true : (document.getElementById('pptxIncludeNeeds') as HTMLInputElement)?.checked ?? false;
  const includeNotes = (document.getElementById('pptxIncludeNotes') as HTMLInputElement)?.checked ?? false;
  // Header prints the project name alone — the group only tags the filename
  const projectName = ((document.getElementById('pptxProjectName') as HTMLInputElement).value || 'Storyboard').trim();
  const fileBase = withGroupSuffix(projectName, 'pptxGroup');
  const meta = readMetaFields('pptx');
  const sortOrderId =
    (document.querySelector('input[name="pptxSortOrder"]:checked') as HTMLInputElement)?.value || '__storyflow__';

  const pptxIncludeHidden = (document.getElementById('pptxIncludeHidden') as HTMLInputElement)?.checked ?? false;
  let exportFrames = getExportFrames('pptxGroup');
  if (!pptxIncludeHidden && !isGroupSelected('pptxGroup')) exportFrames = exportFrames.filter((f: Frame) => !f.hidden);
  let sortBreaks: SortBreak[] = [];
  if (layout === 'sortby') {
    const seq = getSortedExportFrames(sortOrderId, exportFrames);
    exportFrames = seq.frames;
    sortBreaks = seq.breaks;
  }
  // Use local variable — NEVER shadow s.frames on the live store
  const frames = exportFrames;

  document.getElementById('pptxModal')!.classList.add('hidden');
  showToast('Generating presentation…');

  const pptx: any = new (PptxGenJS as any)();
  // Sort By prints portrait like the PDF; the other layouts stay widescreen.
  const sbPortrait = layout === 'sortby';
  if (sbPortrait) {
    // True A4 portrait (210x297mm), not the 16:9 slide turned on its side -
    // that gave a 1:1.78 page, far taller than a sheet of paper.
    pptx.defineLayout({ name: 'FH_A4_PORTRAIT', width: 8.27, height: 11.69 });
    pptx.layout = 'FH_A4_PORTRAIT';
  } else {
    pptx.layout = 'LAYOUT_WIDE';
  }
  const SLIDE_W = sbPortrait ? 8.27 : 13.333;
  const SLIDE_H = sbPortrait ? 11.69 : 7.5;
  pptx.title = projectName;

  /**
   * PowerPoint text boxes overflow their box instead of clipping, so a long
   * description would run into the frame below. Trim the string to what
   * actually fits in the given box.
   */
  /**
   * Largest font size (down to a floor) at which the whole caption still fits
   * the box. Nothing is ever removed - PowerPoint keeps the full, editable text
   * and we simply set it smaller. Paired with fit:'shrink' so it stays fitted
   * if the user edits it later.
   */
  function fitFontSize(text: string, wIn: number, hIn: number, maxPt = 8, minPt = 5): number {
    if (!text) return maxPt;
    for (let pt = maxPt; pt >= minPt; pt -= 0.5) {
      const lineIn = (pt * 1.3) / 72;
      const charW = (pt * 0.52) / 72;
      const perLine = Math.max(4, Math.floor(wIn / charW));
      let count = 0;
      for (const para of text.split(/\r?\n/)) {
        count += Math.max(1, Math.ceil(para.length / perLine));
      }
      if (count * lineIn <= hIn) return pt;
    }
    return minPt;
  }

  let slideNo = 0;

  function newSlide() {
    const sl = pptx.addSlide();
    sl.background = { color: 'FFFFFF' };
    return sl;
  }

  /**
   * Draw a whole SORT BY card - background, number, pill, images, NEEDS - onto
   * a single canvas. PptxGenJS cannot create native PowerPoint groups, so the
   * only way to make a card move as one object is to flatten it to a picture.
   */
  async function renderSortCardCanvas(
    f: Frame,
    wIn: number,
    opts: { dpi?: number } = {}
  ): Promise<{ canvas: HTMLCanvasElement; hIn: number }> {
    const DPI = opts.dpi || 160;
    const W = Math.round(wIn * DPI);
    const px = (inches: number) => inches * DPI;

    // Same proportions as the PDF card / the on-screen grid
    const PAD = px(0.06);
    const GAP = W * 0.0068;
    const numW = W * 0.05;
    const mainW = W * 0.25;
    const verW = W * 0.17;
    const needsW = W - numW - mainW - verW - GAP * 3 - PAD * 2;
    const colW = (needsW - GAP) / 2;
    const mainH = mainW / aspect;
    const verH = verW / aspect;

    const F_NUM = Math.round(px(0.11));
    const F_SMALL = Math.round(px(0.07));
    const F_TXT = Math.round(px(0.097));
    const LINE = F_TXT * 1.45;

    // Measure first so the canvas is exactly tall enough
    const probe = document.createElement('canvas').getContext('2d')!;
    const wrap = (text: string, maxW: number, font: string): string[] => {
      probe.font = font;
      const out: string[] = [];
      for (const para of (text || '').split(/\r?\n/)) {
        let line = '';
        for (const word of para.split(' ')) {
          const cand = line ? line + ' ' + word : word;
          if (probe.measureText(cand).width <= maxW) line = cand;
          else {
            if (line) out.push(line);
            line = word;
          }
        }
        if (line) out.push(line);
      }
      return out;
    };
    const fontTxt = `${F_TXT}px "DM Sans", sans-serif`;
    const fontTxtB = `600 ${F_TXT}px "DM Sans", sans-serif`;

    const [c1, c2] = needsColumns(f.id);
    const colLines = (pairs: { k: string; v: string }[]) =>
      pairs.reduce((n, pr) => {
        probe.font = fontTxtB;
        const kW = probe.measureText(`${pr.k} `).width;
        return n + Math.max(1, wrap(pr.v, Math.max(20, colW - kW), fontTxt).length);
      }, 0);
    const capLines = f.textContent ? wrap(f.textContent, mainW, `${F_SMALL}px "DM Sans", sans-serif`) : [];
    const capH = capLines.length ? capLines.length * F_SMALL * 1.4 + px(0.02) : 0;
    const textH = Math.max(colLines(c1), colLines(c2)) * LINE;
    const H = Math.round(Math.max(mainH + capH, verH * 2 + GAP, textH) + PAD * 2);

    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const ctx = c.getContext('2d')!;

    // Card: #d9d9d9 fill, #aaa border, rounded
    const r = px(0.04);
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(W, 0, W, H, r);
    ctx.arcTo(W, H, 0, H, r);
    ctx.arcTo(0, H, 0, 0, r);
    ctx.arcTo(0, 0, W, 0, r);
    ctx.closePath();
    ctx.fillStyle = '#d9d9d9';
    ctx.fill();
    ctx.strokeStyle = '#aaaaaa';
    ctx.lineWidth = Math.max(1, px(0.006));
    ctx.stroke();

    let x = PAD;
    const iy = PAD;

    // Number, trailing text, setup pill
    const lp = (f.label || '').match(/^(\d+[A-Za-z]?\.?)\s*(.*)/);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#333333';
    ctx.font = `500 ${F_NUM}px "DM Sans", sans-serif`;
    let numTxt = lp ? lp[1] : f.label || '';
    while (numTxt.length > 1 && ctx.measureText(numTxt).width > numW) numTxt = numTxt.slice(0, -1);
    ctx.fillText(numTxt, x + numW / 2, iy);
    if (lp && lp[2]) {
      ctx.font = `${F_SMALL}px "DM Sans", sans-serif`;
      ctx.fillStyle = '#000';
      let ly = iy + F_NUM * 1.25;
      for (const line of wrap(lp[2], numW, ctx.font)) {
        if (ly > H - PAD - F_SMALL * 3) break;
        ctx.fillText(line, x + numW / 2, ly);
        ly += F_SMALL * 1.35;
      }
    }
    const setup = f.setupId ? s.setups.find((su) => su.id === f.setupId) : null;
    if (setup) {
      const hex = SETUP_COLORS[setup.colorIndex]?.hex || '#999999';
      const pillH = F_SMALL * 1.9;
      const pillY = H - PAD - pillH;
      ctx.beginPath();
      const pr2 = pillH / 2;
      ctx.moveTo(x + pr2, pillY);
      ctx.arcTo(x + numW, pillY, x + numW, pillY + pillH, pr2);
      ctx.arcTo(x + numW, pillY + pillH, x, pillY + pillH, pr2);
      ctx.arcTo(x, pillY + pillH, x, pillY, pr2);
      ctx.arcTo(x, pillY, x + numW, pillY, pr2);
      ctx.closePath();
      ctx.fillStyle = hex;
      ctx.fill();
      const rr = parseInt(hex.slice(1, 3), 16),
        gg = parseInt(hex.slice(3, 5), 16),
        bb = parseInt(hex.slice(5, 7), 16);
      ctx.fillStyle = (0.299 * rr + 0.587 * gg + 0.114 * bb) / 255 > 0.7 ? '#1e1e1e' : '#ffffff';
      ctx.font = `${F_SMALL}px "DM Sans", sans-serif`;
      let pTxt = setup.name;
      while (pTxt.length > 1 && ctx.measureText(pTxt).width > numW - px(0.03)) pTxt = pTxt.slice(0, -1);
      ctx.fillText(pTxt, x + numW / 2, pillY + pillH * 0.22);
    }
    x += numW + GAP;

    // MAIN (bordered) + caption
    const mainCvs = withBakedBorder(await rasterizeMain(f));
    ctx.drawImage(mainCvs, x, iy, mainW, mainH);
    if (capLines.length) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#282828';
      ctx.font = `${F_SMALL}px "DM Sans", sans-serif`;
      let cy2 = iy + mainH + px(0.02);
      for (const line of capLines) {
        ctx.fillText(line, x, cy2);
        cy2 += F_SMALL * 1.4;
      }
    }
    x += mainW + GAP;

    // VERSN + SKETCH stacked, unbordered
    let vy = iy;
    for (const sid of ['ver', 'floor'] as StripType[]) {
      const v = getStripVersions(f.id, sid)[0];
      if (v && versionHasContent(v)) {
        const vc = await rasterizeVersion(v, f.cropW, f.cropH);
        ctx.drawImage(vc, x, vy, verW, verH);
      }
      vy += verH + GAP;
    }
    x += verW + GAP;

    // NEEDS, two columns, wrapped values pushing the next entry down
    ctx.textAlign = 'left';
    [c1, c2].forEach((pairs, ci) => {
      const cx = x + ci * (colW + GAP);
      let ry = iy;
      for (const pr of pairs) {
        ctx.font = fontTxtB;
        ctx.fillStyle = '#141414';
        const kTxt = `${pr.k} `;
        ctx.fillText(kTxt, cx, ry);
        const kW = ctx.measureText(kTxt).width;
        ctx.font = fontTxt;
        ctx.fillStyle = '#3c3c3c';
        const lines = wrap(pr.v, Math.max(20, colW - kW), fontTxt);
        if (lines.length) ctx.fillText(lines[0], cx + kW, ry);
        ry += LINE;
        for (const extra of wrap(lines.slice(1).join(' '), colW, fontTxt)) {
          ctx.fillText(extra, cx, ry);
          ry += LINE;
        }
      }
    });

    return { canvas: c, hIn: H / DPI };
  }

  /** How many lines a string takes in a box of the given width, at fontPt. */
  function pptxLineCount(text: string, wIn: number, fontPt: number): number {
    if (!text) return 1;
    const charW = (fontPt * 0.52) / 72;
    const perLine = Math.max(4, Math.floor(wIn / charW));
    return Math.max(1, Math.ceil(text.length / perLine));
  }

  /** Same header block as the PDF: centred bold title + two meta rows + rule. */
  function addSlideHeader(sl: any) {
    slideNo++;
    // Box hugs the title and is centred as a whole, rather than a full-width
    // slab that merely centres its text.
    const titleW = Math.min(SLIDE_W - 0.8, Math.max(1.2, ((projectName.length * 12 * 0.68) / 72) * 1.2 + 0.2));
    sl.addText(projectName, {
      x: (SLIDE_W - titleW) / 2, y: 0.06, w: titleW, h: 0.24,
      fontSize: 12, bold: true, color: '141414', fontFace: 'Arial', align: 'center', margin: 0,
    });
    const rowOpts = { h: 0.15, fontSize: 6, color: '787878', fontFace: 'Arial', margin: 0 };
    // Each box is sized to its own text. Previously every one was a fixed 6in
    // slab, so a short value like "v1" carried a box a third of the slide wide.
    // Width of the text plus 20% headroom. Caps are wider than lowercase, so the
    // per-character estimate leans generous - a wrapped header line looks far
    // worse than a slightly roomy box.
    const metaW = (t: string) => Math.min(SLIDE_W * 0.42, Math.max(0.4, ((t.length * 6 * 0.68) / 72) * 1.2 + 0.1));
    const L = 0.4;
    const R = SLIDE_W - 0.4;
    if (meta.shootingOrder) sl.addText(meta.shootingOrder, { ...rowOpts, x: L, y: 0.30, w: metaW(meta.shootingOrder), align: 'left' });
    if (meta.userName) sl.addText(meta.userName, { ...rowOpts, x: R - metaW(meta.userName), y: 0.30, w: metaW(meta.userName), align: 'right' });
    if (meta.version) sl.addText(meta.version, { ...rowOpts, x: L, y: 0.44, w: metaW(meta.version), align: 'left' });
    if (meta.date) sl.addText(meta.date, { ...rowOpts, x: R - metaW(meta.date), y: 0.44, w: metaW(meta.date), align: 'right' });
    sl.addText(String(slideNo), {
      x: SLIDE_W - 1.4, y: SLIDE_H - 0.42, w: 1, h: 0.22,
      fontSize: 7, color: '8C8C8C', fontFace: 'Arial', align: 'right',
    });
  }

  async function rasterizeWithBorder(canvas: HTMLCanvasElement, _borderPx?: number) {
    // Same baked 2% border the PDF uses, so the two formats look identical
    return withBakedBorder(canvas);
  }

  const SW = SLIDE_W,
    SH = SLIDE_H;
  const MARGIN = 0.4;
  const ref = frames[0] || { cropW: 16, cropH: 9 };
  const aspect = ref.cropW / ref.cropH;

  function canvasToBase64(cvs: HTMLCanvasElement) {
    return cvs.toDataURL('image/jpeg', 0.92).split(',')[1];
  }

  if (layout === 'grid3x2' && s.portraitMode) {
    // Portrait mode: 5 tall frames side by side per slide
    const cols = 5;
    const pAspect = 540 / 960;
    const gapX = 0.15;
    const availW = SW - 2 * MARGIN - gapX * (cols - 1);
    let fW = availW / cols;
    let fH = fW / pAspect;
    if (fH > SH - 1.0) {
      fH = SH - 1.0;
      fW = fH * pAspect;
    }
    const gridW = cols * fW + (cols - 1) * gapX;
    const startX = (SW - gridW) / 2;
    const perPage = cols;
    for (let i = 0; i < frames.length; i++) {
      const slot = i % perPage;
      let slide;
      if (slot === 0) {
        slide = newSlide();
        addSlideHeader(slide);
      } else {
        slide = pptx.slides[pptx.slides.length - 1];
      }
      const col = slot;
      const x = startX + col * (fW + gapX);
      const y = 0.7;
      const f = frames[i];
      const cvs = await rasterizeWithBorder(await rasterizeMain(f));
      const label = f.label || `${i + 1}`;
      slide.addText(label, { x, y: y - 0.02, w: fW, h: 0.2, fontSize: 7, bold: true, color: '000000', fontFace: 'Arial', valign: 'bottom', margin: 0 });
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(cvs), x, y: y + 0.2, w: fW, h: fH });
    }
  } else if (layout === 'grid3x2') {
    // FIXED layout, mirroring the PDF. PowerPoint text boxes do NOT clip their
    // contents, so an over-long caption would spill down the slide — the text
    // is therefore trimmed to what the box can actually hold.
    const cols = 3,
      rows = 2;
    const LABEL_IN = 0.2;
    const ROW_GAP_IN = 0.1;
    const TOP_IN = 0.95;
    const FONT = 8;
    const TEXT_LINES = 5;
    const lineIn = (FONT * 1.3) / 72;
    const textH = includeText ? TEXT_LINES * lineIn : 0;
    const cellW = (SW - 2 * MARGIN - 0.3 * (cols - 1)) / cols;
    const bandH = (SH - TOP_IN - MARGIN - (rows - 1) * ROW_GAP_IN) / rows;
    const fH = Math.max(0.6, Math.min(cellW / aspect, bandH - LABEL_IN - textH));
    const fW = Math.min(cellW, fH * aspect);
    const rowH = bandH + ROW_GAP_IN;
    const perPage = cols * rows;

    for (let i = 0; i < frames.length; i++) {
      const slot = i % perPage;
      let slide;
      if (slot === 0) {
        slide = newSlide();
        addSlideHeader(slide);
      } else {
        slide = pptx.slides[pptx.slides.length - 1];
      }
      const col = slot % cols,
        row = Math.floor(slot / cols);
      const x = MARGIN + col * (cellW + 0.3);
      const y = TOP_IN + row * rowH;
      const f = frames[i];
      const cvs = await rasterizeWithBorder(await rasterizeMain(f));
      slide.addText(f.label || '', { x, y: y - 0.02, w: fW, h: LABEL_IN, fontSize: 7, bold: true, color: '000000', fontFace: 'Arial', valign: 'bottom', align: 'left', margin: 0 });
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(cvs), x, y: y + LABEL_IN, w: fW, h: fH });
      if (includeText && f.textContent) {
        slide.addText(f.textContent, {
          x, y: y + LABEL_IN + fH + 0.04, w: fW, h: textH,
          fontSize: fitFontSize(f.textContent, fW, textH, FONT),
          color: '333333', fontFace: 'Arial', valign: 'top', wrap: true, fit: 'shrink', align: 'left', margin: 0,
        });
      }
    }
  } else if (layout === 'sortby') {
    // Portrait slides. Each frame card is flattened to a single picture so it
    // selects and moves as one object in Keynote / PowerPoint (PptxGenJS has
    // no API for real groups). Breaks stay as editable shapes.
    const contentW = SW - 2 * MARGIN;
    const bottomY = SH - MARGIN - 0.3;
    const CARD_GAP = 0.05;
    const BREAK_H = 0.26;

    const breakAt = new Map<number, string>();
    for (const b of sortBreaks) {
      const t = (b.text || '').trim();
      if (t) breakAt.set(b.position, t);
    }

    const HEADER_BOTTOM = 0.68;   // meta rows end at ~0.6in

    let slide = newSlide();
    addSlideHeader(slide);
    let cy = HEADER_BOTTOM;

    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      const { canvas: cardCvs, hIn } = await renderSortCardCanvas(f, contentW);
      const title = breakAt.get(i);

      if (cy + (title ? BREAK_H + CARD_GAP : 0) + hIn + CARD_GAP > bottomY) {
        slide = newSlide();
        addSlideHeader(slide);
        cy = HEADER_BOTTOM;
      }

      if (title) {
        slide.addShape('roundRect', {
          x: MARGIN, y: cy, w: contentW, h: BREAK_H,
          fill: { color: '808080' }, line: { color: '666666', width: 0.5 }, rectRadius: 0.03,
        });
        slide.addText(title, {
          x: MARGIN + 0.1, y: cy, w: contentW * 0.6, h: BREAK_H,
          fontSize: 9, bold: true, color: 'FFFFFF', fontFace: 'Arial', valign: 'middle', margin: 0,
        });
        cy += BREAK_H + CARD_GAP;
      }

      slide.addImage({
        data: 'image/png;base64,' + cardCvs.toDataURL('image/png').split(',')[1],
        x: MARGIN, y: cy, w: contentW, h: hIn,
      });
      cy += hIn + CARD_GAP;
    }
  } else if (layout === 'double') {
    const pptxDblStrips = getSelectedStrips('pptxDoubleStripPicker');
    const pptxDblStrip: StripType = pptxDblStrips[0] || 'ver';
    const pptxDblDef = (s.stripDefs || DEFAULT_STRIP_DEFS).find(d => d.id === pptxDblStrip);
    const pptxDblName = pptxDblDef ? pptxDblDef.defaultFrameLabel : pptxDblStrip;
    const pptxDblMode = (document.querySelector('input[name="pptxDoubleMode"]:checked') as HTMLInputElement)?.value || 'starred';
    const pairsPerSlide = 4;
    const pairCols = 2;
    const pairRows = 2;
    const pairW = (SW - 2 * MARGIN - 0.4) / pairCols;
    const fW = (pairW - 0.15) / 2;
    const fH = fW / aspect;
    const rowH = (SH - 0.8) / pairRows;
    for (let i = 0; i < frames.length; i++) {
      const slot = i % pairsPerSlide;
      let slide;
      if (slot === 0) {
        slide = newSlide();
        addSlideHeader(slide);
      } else {
        slide = pptx.slides[pptx.slides.length - 1];
      }
      const pc = slot % pairCols,
        pr = Math.floor(slot / pairCols);
      const baseX = MARGIN + pc * (pairW + 0.4);
      const baseY = 0.55 + pr * rowH;
      const f = frames[i];
      const label = f.label || `${i + 1}`;
      const mainCvs = await rasterizeWithBorder(await rasterizeMain(f));
      slide.addText(label, { x: baseX, y: baseY - 0.02, w: fW, h: 0.18, fontSize: 7, bold: true, color: '000000', fontFace: 'Arial', valign: 'bottom', margin: 0 });
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(mainCvs), x: baseX, y: baseY + 0.18, w: fW, h: fH });
      const vers = getStripVersions(f.id, pptxDblStrip);
      const ver = pptxDblMode === 'starred'
        ? vers.find(v => versionHasContent(v) && (v as any).starred)
        : vers[getStripActiveTab(f.id, pptxDblStrip)];
      if (ver && versionHasContent(ver)) {
        const verCvs = await rasterizeWithBorder(await rasterizeVersion(ver, f.cropW, f.cropH));
        const vx = baseX + fW + 0.15;
        const verFullLabel = fullVerLabel(f.label || `${i + 1}`, `${pptxDblName} ${ver.label || ''}`);
        slide.addText(verFullLabel, { x: vx, y: baseY - 0.02, w: fW, h: 0.18, fontSize: 7, bold: true, color: '000000', fontFace: 'Arial', valign: 'bottom', margin: 0 });
        slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(verCvs), x: vx, y: baseY + 0.18, w: fW, h: fH });
      }
      if (includeText && f.textContent) {
        slide.addText(f.textContent, { x: baseX, y: baseY + 0.18 + fH + 0.05, w: pairW, h: 0.5, fontSize: 6, color: '333333', fontFace: 'Arial', valign: 'top', wrap: true, margin: 0 });
      }
    }
  } else if (layout === 'overview') {
    const pptxOvStrips = getSelectedStrips('pptxOverviewStripPicker');
    const pptxOvStripIds: StripType[] = pptxOvStrips.length ? pptxOvStrips : ['ver'];
    const pptxStripDefs = s.stripDefs || DEFAULT_STRIP_DEFS;
    // frames is already filtered by includeHidden checkbox — don't filter again
    const visibleFrames = frames;

    const mainW = (SW - 2 * MARGIN) * 0.48;
    const mainH = mainW / aspect;
    const mainX = MARGIN;
    const mainY = 0.7;
    const vGap = 0.12;
    const gridX = mainX + mainW + 0.2;
    const gridW = SW - MARGIN - gridX;
    const vCols = 2;
    const vCellW = (gridW - vGap) / vCols;
    const vCellH = vCellW / aspect;
    const vRowH = vCellH + vGap + 0.2;
    const maxVRows = Math.min(4, Math.floor((SH - mainY - 0.3) / vRowH));

    type PptxStripGroup = { stripName: string; vers: { v: any; fullLabel: string }[] };

    for (let i = 0; i < visibleFrames.length; i++) {
      const f = visibleFrames[i];
      const label = f.label || `${i + 1}`;

      // Collect versions grouped by strip
      const stripGroups: PptxStripGroup[] = [];
      for (const sid of pptxOvStripIds) {
        const def = pptxStripDefs.find(d => d.id === sid);
        const sName = def ? def.defaultFrameLabel : sid;
        const vGroup: { v: any; fullLabel: string }[] = [];
        const allVers = getStripVersions(f.id, sid);
        allVers.forEach((v, vi) => {
          if (!versionHasContent(v)) return;
          const cb = document.querySelector(`#pptxVersionPicker input[data-fid="${f.id}"][data-vi="${vi}"][data-strip="${sid}"]`) as HTMLInputElement | null;
          if (cb && !cb.checked) return;
          vGroup.push({ v, fullLabel: fullVerLabel(f.label || `${i + 1}`, `${sName} ${v.label || `v${vi + 1}`}`) });
        });
        if (vGroup.length > 0) stripGroups.push({ stripName: sName, vers: vGroup });
      }

      // Each strip gets its own slide(s). If a strip overflows, continue on next slide.
      const chunks: PptxStripGroup[][] = [];
      for (const sg of stripGroups) {
        const sgRows = Math.ceil(sg.vers.length / 2);
        if (sgRows <= maxVRows) {
          chunks.push([sg]);
        } else {
          for (let v = 0; v < sg.vers.length; v += maxVRows * 2) {
            chunks.push([{ stripName: sg.stripName, vers: sg.vers.slice(v, v + maxVRows * 2) }]);
          }
        }
      }
      if (chunks.length === 0) chunks.push([]);

      const mainCvs = await rasterizeWithBorder(await rasterizeMain(f));
      const mainB64 = 'image/jpeg;base64,' + canvasToBase64(mainCvs);

      for (let ci = 0; ci < chunks.length; ci++) {
        const chunk = chunks[ci];
        const isFirst = ci === 0;
        const slide = newSlide();
        addSlideHeader(slide);

        // Main frame only on the first slide for this frame
        if (isFirst) {
          slide.addText(label, { x: mainX, y: mainY - 0.22, w: mainW, h: 0.2, fontSize: 8, bold: true, color: '000000', fontFace: 'Arial', valign: 'bottom', margin: 0 });
          slide.addImage({ data: mainB64, x: mainX, y: mainY, w: mainW, h: mainH });
          let belowY = mainY + mainH + 0.1;
          if (includeText && f.textContent) {
            slide.addText(f.textContent, { x: mainX, y: belowY, w: mainW, h: 1.2, fontSize: 7, color: '333333', fontFace: 'Arial', valign: 'top', wrap: true, margin: 0 });
            belowY += 1.2;
          }
          if (includeNeeds) {
            const nl = needsLines(f.id);
            if (nl.length) {
              slide.addText(nl.join('\n'), { x: mainX, y: belowY, w: mainW, h: 0.9, fontSize: 6.5, color: '555555', fontFace: 'Arial', valign: 'top', wrap: true, margin: 0 });
              belowY += 0.9;
            }
          }
          if (includeNotes) {
            const nc = noteContent(f.id);
            if (nc.table) {
              const td = nc.table;
              const hasHeaders = td.headers && td.headers.some((h) => h && h.trim());
              const dataRows = td.rows ? td.rows.filter((r) => r.some((c) => c && c.trim())) : [];
              if (hasHeaders || dataRows.length > 0) {
                const tblRows: any[] = [];
                if (hasHeaders) tblRows.push(td.headers.map((h) => ({ text: h || '', options: { bold: true, fontSize: 6, color: '000000', fill: { color: 'E8E8E8' } } })));
                for (const row of dataRows) tblRows.push(row.map((c) => ({ text: c || '', options: { fontSize: 6, color: '000000' } })));
                if (tblRows.length > 0) {
                  slide.addTable(tblRows, { x: mainX, y: belowY, w: mainW, border: { type: 'solid', color: '000000', pt: 0.5 }, colW: Array(td.headers.length).fill(mainW / td.headers.length), fontFace: 'Arial', fontSize: 6, color: '000000', autoPage: false });
                }
              }
            } else if (nc.text) {
              slide.addText(nc.text, { x: mainX, y: belowY, w: mainW, h: 0.9, fontSize: 7, color: '333333', fontFace: 'Arial', valign: 'top', wrap: true, margin: 0 });
            }
          }
        }

        // Versions — each strip starts on a new row
        let vRow = 0;
        for (const sg of chunk) {
          for (let vi = 0; vi < sg.vers.length; vi++) {
            const vc = vi % vCols;
            const row = vRow + Math.floor(vi / 2);
            const vx = gridX + vc * (vCellW + vGap);
            const vy = mainY + row * vRowH;
            const entry = sg.vers[vi];
            const vCanvas = await rasterizeWithBorder(await rasterizeVersion(entry.v, f.cropW, f.cropH), 2);
            slide.addText(entry.fullLabel, { x: vx, y: vy - 0.18, w: vCellW, h: 0.16, fontSize: 6, bold: true, color: '000000', fontFace: 'Arial', valign: 'bottom', margin: 0 });
            slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(vCanvas), x: vx, y: vy, w: vCellW, h: vCellH });
          }
          vRow += Math.ceil(sg.vers.length / 2);
        }
      }
    }
  }

  const now = new Date();
  const fname = `${fileBase.replace(/[^\w\-]+/g, '_')}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const blob = (await pptx.write({ outputType: 'blob' })) as Blob;
  offerSave(blob, fname + '.pptx');
  showToast('Presentation ready');
}

export function openImageExportModal(): void {
  const s = state();
  if (!s.frames.length) {
    showToast('No frames to export');
    return;
  }
  document.getElementById('imageExportModal')!.classList.remove('hidden');
  const nameInput = document.getElementById('imageExportProjectName') as HTMLInputElement;
  if (!nameInput.value) nameInput.value = getCurrentProject().name || s.lastPdfName || 'Storyboard';
  buildGroupPicker('imageGroupPicker', 'imageGroup');
  buildStripPicker('imageStripPicker', 'checkbox');
  // Add MAIN as first checkbox (checked by default)
  const imgStripContainer = document.getElementById('imageStripPicker');
  if (imgStripContainer) {
    const mainOpt = document.createElement('label');
    mainOpt.className = 'exp-strip-opt';
    mainOpt.innerHTML = '<input type="checkbox" value="main" data-strip="main" checked> <span>MAIN</span>';
    imgStripContainer.insertBefore(mainOpt, imgStripContainer.firstChild);
  }
}

export async function runImageExport(): Promise<void> {
  fhTrack('export_images');
  const s = state();
  const nameInput = document.getElementById('imageExportProjectName') as HTMLInputElement;
  const baseName = ((nameInput?.value || s.lastPdfName || 'PROJECT_NAME')).replace(/[^\w\-]+/g, '_');
  const groupName = getExportGroupName('imageGroup');
  const projectName = groupName ? `${baseName}_${groupName.replace(/[^\w\-]+/g, '_')}` : baseName;
  const zip = new JSZip();
  const imgIncludeHiddenMain = (document.getElementById('imageIncludeHiddenMain') as HTMLInputElement)?.checked ?? false;
  let exportFrames = getExportFrames('imageGroup');
  if (!imgIncludeHiddenMain && !isGroupSelected('imageGroup')) exportFrames = exportFrames.filter((f: Frame) => !f.hidden);
  document.getElementById('imageExportModal')?.classList.add('hidden');
  showToast('Generating images…');

  const imageScope = (document.querySelector('input[name="imageVersionScope"]:checked') as HTMLInputElement)?.value || 'starred';
  const selStrips = getSelectedStrips('imageStripPicker');
  const includeMain = selStrips.includes('main' as StripType);
  const stripDefs = s.stripDefs || DEFAULT_STRIP_DEFS;
  const stripIds: StripType[] = selStrips.filter((s: any) => s !== 'main') as StripType[];

  for (let i = 0; i < exportFrames.length; i++) {
    const f = exportFrames[i];
    const label = (f.label || `${i + 1}`).replace(/[^\w\-]+/g, '_');
    const prefix = `${projectName}_${label}`;
    if (includeMain) {
      const mainCvs = withBakedBorder(await rasterizeMain(f));
      zip.file(`${prefix}.jpg`, await canvasToBlob(mainCvs), { binary: true });
    }
    for (const sid of stripIds) {
      const def = stripDefs.find(d => d.id === sid);
      if (!def) continue;
      const stripVers = getStripVersions(f.id, def.id as StripType);
      const sName = def.defaultFrameLabel;
      for (let vi = 0; vi < stripVers.length; vi++) {
        const v = stripVers[vi];
        if (!versionHasContent(v)) continue;
        if (imageScope === 'starred' && !(v as any).starred) continue;
        if (imageScope === 'active' && vi !== getStripActiveTab(f.id, def.id as StripType)) continue;
        // 'all' includes everything (no filter)
        const vLabel = v.label || `${def.prefix}${vi + 1}`;
        const verCvs = withBakedBorder(await rasterizeVersion(v, f.cropW, f.cropH));
        zip.file(`${prefix}_${sName}_${vLabel}.jpg`, await canvasToBlob(verCvs), { binary: true });
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  offerSave(blob, `${projectName}_images.zip`);
  showToast('Images ready');
}

// ---------------------------------------------------------------------------
// Portrait (9:16) export
// ---------------------------------------------------------------------------

let _portraitExportMode: 'pdf' | 'pptx' = 'pdf';

export function openPortraitExportModal(mode: 'pdf' | 'pptx'): void {
  _portraitExportMode = mode;
  const s = state();
  if (!s.frames.length) {
    showToast('No frames to export');
    return;
  }
  document.getElementById('portraitExportTitle')!.textContent =
    mode === 'pdf' ? 'Export 9:16 as PDF' : 'Export 9:16 as Keynote / PowerPoint';
  const nameInput = document.getElementById('portraitExportName') as HTMLInputElement;
  if (!nameInput.value) nameInput.value = getCurrentProject().name || s.lastPdfName || 'Storyboard';
  buildGroupPicker('portraitGroupPicker', 'portraitGroup');
  buildStripPicker('portraitStripPicker', 'checkbox');
  // Default: first strip checked
  const firstCb = document.querySelector('#portraitStripPicker input[type="checkbox"]') as HTMLInputElement | null;
  if (firstCb && !document.querySelector('#portraitStripPicker input:checked')) firstCb.checked = true;
  document.getElementById('portraitExportModal')!.classList.remove('hidden');
}

export async function runPortraitExport(): Promise<void> {
  if (_portraitExportMode === 'pptx') {
    await runPortraitPptxExport();
  } else {
    await runPortraitPdfExport();
  }
}

async function runPortraitPdfExport(): Promise<void> {
  fhTrack('export_portrait_pdf');
  const s = state();
  const includeHiddenFrames = (document.getElementById('portraitIncludeHidden') as HTMLInputElement)?.checked ?? false;
  const versionScope = (document.querySelector('input[name="portraitVersionScope"]:checked') as HTMLInputElement)?.value || 'visible';
  const includeText = (document.getElementById('portraitIncludeText') as HTMLInputElement).checked;
  const includeTable = (document.getElementById('portraitIncludeTable') as HTMLInputElement).checked;
  const paperLetter = (document.getElementById('portraitPaperLetter') as HTMLInputElement).checked;
  const projectName = withGroupSuffix(((document.getElementById('portraitExportName') as HTMLInputElement).value || 'Storyboard').trim(), 'portraitGroup');

  document.getElementById('portraitExportModal')!.classList.add('hidden');
  showToast('Generating PDF…');

  const paper = paperLetter ? 'letter' : 'a4';
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: paper });
  registerPdfFont(pdf);
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const MARGIN = 8;
  const HEADER_H = 8;
  const FOOTER_H = 6;
  const FRAME_BORDER_PT = 2;

  let exportFrames = getExportFrames('portraitGroup');
  if (!includeHiddenFrames && !isGroupSelected('portraitGroup')) exportFrames = exportFrames.filter((f: Frame) => !f.hidden);
  const frames = exportFrames;

  // Selected strips
  const selStrips = getSelectedStrips('portraitStripPicker');
  const stripIds: StripType[] = selStrips.length ? selStrips : ['ver'];
  const stripDefs = s.stripDefs || DEFAULT_STRIP_DEFS;

  function drawHeader(pageNum: number, totalPages: number) {
    pdf.setTextColor(90);
    pdf.setFont(PDF_FONT, 'normal');
    pdf.setFontSize(9);
    pdf.text(projectName, MARGIN, MARGIN + 2);
    pdf.setFontSize(8);
    pdf.text(`${pageNum} / ${totalPages}`, pageW - MARGIN, pageH - MARGIN / 2, { align: 'right' });
  }

  function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    // Pin BOTH family and size: getTextWidth measures with whatever font is
    // current, so a leftover bold from a label would mis-measure every line.
    pdf.setFont(PDF_FONT, 'normal');
    pdf.setFontSize(fontSize);
    return hardWrapLines(pdf, text || '', maxWidth);
  }

  // Layout: 5 columns (1 main + 4 versions), one frame per page
  const COLS = 5;
  const contentW = pageW - 2 * MARGIN;
  const gutterX = 3;
  const colW = (contentW - gutterX * (COLS - 1)) / COLS;
  const aspect = 9 / 16;
  let frameW = colW;
  let frameH = frameW / aspect;
  const maxFrameH = pageH - 2 * MARGIN - HEADER_H - FOOTER_H - 20; // leave room for text/table
  if (frameH > maxFrameH) {
    frameH = maxFrameH;
    frameW = frameH * aspect;
  }

  const TABLE_FONT = 7;
  const TABLE_ROW_H = 4.5;
  const TABLE_HEADER_H = 5.5;
  const TABLE_PAD = 1.5;

  function tableHasContent(td: any): boolean {
    if (!td) return false;
    if (td.headers && td.headers.some((h: string) => h && h.trim())) return true;
    if (td.rows && td.rows.some((r: string[]) => r.some((c: string) => c && c.trim()))) return true;
    return false;
  }

  function drawTable(x: number, y: number, maxW: number, td: any): number {
    if (!td) return 0;
    const hasHeaders = td.headers && td.headers.some((h: string) => h && h.trim());
    const dataRows = td.rows ? td.rows.filter((r: string[]) => r.some((c: string) => c && c.trim())) : [];
    if (!hasHeaders && dataRows.length === 0) return 0;
    const cols = td.headers ? td.headers.length : 3;
    const cW = maxW / cols;
    let curY = y;
    if (hasHeaders) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(x, curY, maxW, TABLE_HEADER_H, 'F');
      pdf.setTextColor(0);
      pdf.setFont(PDF_FONT, 'bold');
      pdf.setFontSize(TABLE_FONT);
      for (let c = 0; c < cols; c++) {
        const text = (td.headers[c] || '').trim();
        if (text) pdf.text(text, x + c * cW + TABLE_PAD, curY + TABLE_HEADER_H - 1.8);
      }
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.3);
      pdf.rect(x, curY, maxW, TABLE_HEADER_H);
      for (let c = 1; c < cols; c++) pdf.line(x + c * cW, curY, x + c * cW, curY + TABLE_HEADER_H);
      curY += TABLE_HEADER_H;
    }
    pdf.setFont(PDF_FONT, 'normal');
    pdf.setFontSize(TABLE_FONT);
    for (const row of dataRows) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(x, curY, maxW, TABLE_ROW_H, 'F');
      pdf.setTextColor(0);
      for (let c = 0; c < cols; c++) {
        const text = (row[c] || '').trim();
        if (text) {
          const clipped = hardWrapLines(pdf, text, cW - 2 * TABLE_PAD)[0] || '';
          pdf.text(clipped, x + c * cW + TABLE_PAD, curY + TABLE_ROW_H - 1.3);
        }
      }
      pdf.setDrawColor(0);
      pdf.setLineWidth(0.3);
      pdf.rect(x, curY, maxW, TABLE_ROW_H);
      for (let c = 1; c < cols; c++) pdf.line(x + c * cW, curY, x + c * cW, curY + TABLE_ROW_H);
      curY += TABLE_ROW_H;
    }
    return curY - y;
  }

  // Collect versions from selected strips for each frame
  let pageIdx = 0;
  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi];
    const frameLabel = f.label || `${fi + 1}`;
    const LABEL_H = 4.5;
    const framesY = MARGIN + HEADER_H + LABEL_H + 2;
    const startX = MARGIN + (contentW - (COLS * frameW + (COLS - 1) * gutterX)) / 2;

    // Rasterize main frame once (reused across all pages for this frame)
    const mainCvs = await rasterizeMain(f);
    const mainImg = withBakedBorder(mainCvs).toDataURL('image/jpeg', 0.92);

    // Gather versions grouped by strip — each strip starts on a new page
    type PdfPortraitStripGroup = { vers: { v: any; label: string }[] };
    const stripGroups: PdfPortraitStripGroup[] = [];
    for (const sid of stripIds) {
      const def = stripDefs.find(d => d.id === sid);
      const sName = def ? def.defaultFrameLabel : sid;
      const allVers = getStripVersions(f.id, sid);
      const group: { v: any; label: string }[] = [];
      allVers.forEach((v, vi) => {
        if (!versionHasContent(v)) return;
        if (versionScope === 'starred' && !(v as any).starred) return;
        if (versionScope === 'visible' && (v as any).hidden) return;
        group.push({ v, label: fullVerLabel(frameLabel, `${sName} ${v.label || `v${vi + 1}`}`) });
      });
      if (group.length > 0) stripGroups.push({ vers: group });
    }

    // If no versions at all, still emit one page with just the main frame
    if (stripGroups.length === 0) stripGroups.push({ vers: [] });

    let isFirstPageForFrame = true;
    for (const sg of stripGroups) {
      const pagesForStrip = Math.max(1, Math.ceil(sg.vers.length / 4));
      for (let pageOff = 0; pageOff < pagesForStrip; pageOff++) {
        if (pageIdx > 0) pdf.addPage();
        pageIdx++;
        drawHeader(pageIdx, -1);

        // Column 0: Main frame (always shown)
        pdf.setTextColor(0);
        pdf.setFont(PDF_FONT, 'bold');
        pdf.setFontSize(7.5);
        pdf.text(frameLabel, startX, framesY - 1.2);
        pdf.addImage(mainImg, 'JPEG', startX, framesY, frameW, frameH, undefined, 'FAST');

        // Columns 1–4: Versions for this page batch
        const batchStart = pageOff * 4;
        for (let vi = 0; vi < 4; vi++) {
          const col = vi + 1;
          const x = startX + col * (frameW + gutterX);
          const vIdx = batchStart + vi;
          if (vIdx < sg.vers.length) {
            const entry = sg.vers[vIdx];
            pdf.setTextColor(100);
            pdf.setFont(PDF_FONT, 'normal');
            pdf.setFontSize(7);
            pdf.text(entry.label, x, framesY - 1.2);

            const verCvs = await rasterizeVersion(entry.v, f.cropW, f.cropH);
            const verImg = withBakedBorder(verCvs).toDataURL('image/jpeg', 0.92);
            pdf.addImage(verImg, 'JPEG', x, framesY, frameW, frameH, undefined, 'FAST');
          }
        }

        // Text & table only on the very first page for this frame
        if (isFirstPageForFrame) {
        let curY = framesY + frameH + 6;
        if (includeText && f.textContent) {
          pdf.setTextColor(30);
          pdf.setFont(PDF_FONT, 'normal');
          pdf.setFontSize(8);
          const lines = wrapText(f.textContent, contentW, 8);
          const lineH = 3.5;
          for (const line of lines) {
            if (curY + lineH > pageH - MARGIN - FOOTER_H) break;
            pdf.text(line, MARGIN, curY);
            curY += lineH;
          }
          curY += 2;
        }
        if (includeTable && f.tableData && tableHasContent(f.tableData)) {
          drawTable(startX, curY, frameW, f.tableData);
        }
        isFirstPageForFrame = false;
      }
    }
    }
  }

  // Fix page numbers now that we know the total
  const totalPages = pageIdx;
  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p);
    // Overwrite page number area
    pdf.setFillColor(255, 255, 255);
    pdf.rect(pageW - MARGIN - 20, pageH - MARGIN / 2 - 4, 20, 6, 'F');
    pdf.setTextColor(90);
    pdf.setFont(PDF_FONT, 'normal');
    pdf.setFontSize(8);
    pdf.text(`${p} / ${totalPages}`, pageW - MARGIN, pageH - MARGIN / 2, { align: 'right' });
  }

  const now = new Date();
  const fname = `${projectName.replace(/[^\w\-]+/g, '_')}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.pdf`;
  offerSave(pdf.output('blob') as Blob, fname);
  showToast('PDF ready');
}

async function runPortraitPptxExport(): Promise<void> {
  fhTrack('export_portrait_pptx');
  const s = state();
  const includeHiddenFrames = (document.getElementById('portraitIncludeHidden') as HTMLInputElement)?.checked ?? false;
  const versionScope = (document.querySelector('input[name="portraitVersionScope"]:checked') as HTMLInputElement)?.value || 'visible';
  const includeText = (document.getElementById('portraitIncludeText') as HTMLInputElement).checked;
  const includeTable = (document.getElementById('portraitIncludeTable') as HTMLInputElement).checked;
  const projectName = withGroupSuffix(((document.getElementById('portraitExportName') as HTMLInputElement).value || 'Storyboard').trim(), 'portraitGroup');

  document.getElementById('portraitExportModal')!.classList.add('hidden');
  showToast('Generating presentation…');

  const pptx: any = new (PptxGenJS as any)();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 × 7.5 in — landscape
  pptx.title = projectName;

  const SW = 13.333, SH = 7.5;
  const MARGIN = 0.4;

  function newSlide() {
    const sl = pptx.addSlide();
    sl.background = { color: 'FFFFFF' };
    return sl;
  }

  function rasterizeWithBorder(canvas: HTMLCanvasElement, _borderPx?: number) {
    // Same baked 2% border as every other export
    return withBakedBorder(canvas);
  }

  function canvasToBase64(cvs: HTMLCanvasElement) {
    return cvs.toDataURL('image/jpeg', 0.92).split(',')[1];
  }

  let exportFrames = getExportFrames('portraitGroup');
  if (!includeHiddenFrames && !isGroupSelected('portraitGroup')) exportFrames = exportFrames.filter((f: Frame) => !f.hidden);
  const frames = exportFrames;
  const selStrips = getSelectedStrips('portraitStripPicker');
  const stripIds: StripType[] = selStrips.length ? selStrips : ['ver'];
  const stripDefs = s.stripDefs || DEFAULT_STRIP_DEFS;

  const COLS = 5;
  const gapX = 0.12;
  const pAspect = 9 / 16;
  const availW = SW - 2 * MARGIN - gapX * (COLS - 1);
  let fW = availW / COLS;
  let fH = fW / pAspect;
  const maxH = SH - 1.8; // room for header + text below
  if (fH > maxH) {
    fH = maxH;
    fW = fH * pAspect;
  }
  const gridW = COLS * fW + (COLS - 1) * gapX;
  const startX = (SW - gridW) / 2;

  for (let fi = 0; fi < frames.length; fi++) {
    const f = frames[fi];
    const frameLabel = f.label || `${fi + 1}`;
    const framesY = 0.7;

    // Rasterize main frame once
    const mainCvs = rasterizeWithBorder(await rasterizeMain(f));
    const mainB64 = 'image/jpeg;base64,' + canvasToBase64(mainCvs);

    // Gather versions grouped by strip — each strip starts on a new slide
    type PptxPortraitSG = { vers: { v: any; label: string }[] };
    const stripGroups: PptxPortraitSG[] = [];
    for (const sid of stripIds) {
      const def = stripDefs.find(d => d.id === sid);
      const sName = def ? def.defaultFrameLabel : sid;
      const allVers = getStripVersions(f.id, sid);
      const group: { v: any; label: string }[] = [];
      allVers.forEach((v, vi) => {
        if (!versionHasContent(v)) return;
        if (versionScope === 'starred' && !(v as any).starred) return;
        if (versionScope === 'visible' && (v as any).hidden) return;
        group.push({ v, label: fullVerLabel(frameLabel, `${sName} ${v.label || `v${vi + 1}`}`) });
      });
      if (group.length > 0) stripGroups.push({ vers: group });
    }
    if (stripGroups.length === 0) stripGroups.push({ vers: [] });

    let isFirstSlideForFrame = true;
    for (const sg of stripGroups) {
      const slidesForStrip = Math.max(1, Math.ceil(sg.vers.length / 4));
      for (let pageOff = 0; pageOff < slidesForStrip; pageOff++) {
        const slide = newSlide();
        slide.addText(projectName, { x: MARGIN, y: 0.12, w: SW - 2 * MARGIN, h: 0.25, fontSize: 9, color: '666666', fontFace: 'Arial', margin: 0 });

        // Column 0: Main frame (always shown)
        slide.addText(frameLabel, { x: startX, y: framesY - 0.22, w: fW, h: 0.2, fontSize: 8, bold: true, color: '000000', fontFace: 'Arial', valign: 'bottom', margin: 0 });
        slide.addImage({ data: mainB64, x: startX, y: framesY, w: fW, h: fH });

        // Columns 1–4: Versions for this batch
        const batchStart = pageOff * 4;
        for (let vi = 0; vi < 4; vi++) {
          const col = vi + 1;
          const x = startX + col * (fW + gapX);
          const vIdx = batchStart + vi;
          if (vIdx < sg.vers.length) {
            const entry = sg.vers[vIdx];
            slide.addText(entry.label, { x, y: framesY - 0.22, w: fW, h: 0.2, fontSize: 7, color: '888888', fontFace: 'Arial', valign: 'bottom', margin: 0 });
            const verCvs = rasterizeWithBorder(await rasterizeVersion(entry.v, f.cropW, f.cropH));
            slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(verCvs), x, y: framesY, w: fW, h: fH });
          }
        }

        // Text & table only on the very first slide for this frame
        if (isFirstSlideForFrame) {
          let curY = framesY + fH + 0.22;
          if (includeText && f.textContent) {
            slide.addText(f.textContent, { x: MARGIN, y: curY, w: SW - 2 * MARGIN, h: 0.6, fontSize: 8, color: '222222', fontFace: 'Arial', valign: 'top', wrap: true, margin: 0 });
            curY += 0.65;
          }
          if (includeTable && f.tableData) {
            const td = f.tableData as any;
            const hasHeaders = td.headers && td.headers.some((h: string) => h && h.trim());
            const dataRows = td.rows ? td.rows.filter((r: string[]) => r.some((c: string) => c && c.trim())) : [];
            if (hasHeaders || dataRows.length > 0) {
              const tblRows: any[] = [];
              if (hasHeaders) {
                tblRows.push(td.headers.map((h: string) => ({ text: h || '', options: { bold: true, fontSize: 7, fontFace: 'Arial', color: '000000' } })));
              }
              for (const row of dataRows) {
                tblRows.push(row.map((c: string) => ({ text: c || '', options: { fontSize: 7, fontFace: 'Arial', color: '333333' } })));
              }
              if (tblRows.length > 0) {
                const tblW = fW;
                slide.addTable(tblRows, {
                  x: startX, y: curY, w: tblW,
                  border: { type: 'solid', pt: 0.5, color: '999999' },
                  rowH: 0.25,
                  colW: Array(tblRows[0].length).fill(tblW / tblRows[0].length),
                });
              }
            }
          }
          isFirstSlideForFrame = false;
        }
      }
    }
  }

  const blob = await pptx.write({ outputType: 'blob' }) as Blob;
  const now = new Date();
  const fname = `${projectName.replace(/[^\w\-]+/g, '_')}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.pptx`;
  offerSave(blob, fname);
  showToast('Presentation ready');
}

export function openPortraitImageExportModal(): void {
  const s = state();
  if (!s.frames.length) {
    showToast('No frames to export');
    return;
  }
  const nameInput = document.getElementById('portraitImageExportName') as HTMLInputElement;
  if (!nameInput.value) nameInput.value = getCurrentProject().name || s.lastPdfName || 'Storyboard';
  buildGroupPicker('portraitImageGroupPicker', 'portraitImageGroup');
  buildStripPicker('portraitImageStripPicker', 'checkbox');
  // Add MAIN as first checkbox (checked by default)
  const container = document.getElementById('portraitImageStripPicker');
  if (container) {
    const mainOpt = document.createElement('label');
    mainOpt.className = 'exp-strip-opt';
    mainOpt.innerHTML = '<input type="checkbox" value="main" data-strip="main" checked> <span>MAIN</span>';
    container.insertBefore(mainOpt, container.firstChild);
  }
  document.getElementById('portraitImageExportModal')!.classList.remove('hidden');
}

export async function runPortraitImageExport(): Promise<void> {
  fhTrack('export_portrait_images');
  const s = state();
  const baseName = ((document.getElementById('portraitImageExportName') as HTMLInputElement)?.value || 'Storyboard').replace(/[^\w\-]+/g, '_');
  const groupName = getExportGroupName('portraitImageGroup');
  const projectName = groupName ? `${baseName}_${groupName.replace(/[^\w\-]+/g, '_')}` : baseName;
  let exportFrames = getExportFrames('portraitImageGroup');
  const pImgIncludeHiddenMain = (document.getElementById('portraitImageIncludeHiddenMain') as HTMLInputElement)?.checked ?? false;
  if (!pImgIncludeHiddenMain && !isGroupSelected('portraitImageGroup')) exportFrames = exportFrames.filter((f: Frame) => !f.hidden);
  document.getElementById('portraitImageExportModal')!.classList.add('hidden');
  showToast('Generating images…');

  const imageScope = (document.querySelector('input[name="portraitImageVersionScope"]:checked') as HTMLInputElement)?.value || 'starred';
  const selStrips = getSelectedStrips('portraitImageStripPicker');
  const includeMain = selStrips.includes('main' as StripType);
  const stripDefs = s.stripDefs || DEFAULT_STRIP_DEFS;
  const stripIds: StripType[] = selStrips.filter((s: any) => s !== 'main') as StripType[];

  const zip = new JSZip();
  for (let i = 0; i < exportFrames.length; i++) {
    const f = exportFrames[i];
    const label = (f.label || `${i + 1}`).replace(/[^\w\-]+/g, '_');
    const prefix = `${projectName}_${label}`;
    if (includeMain) {
      const mainCvs = withBakedBorder(await rasterizeMain(f));
      zip.file(`${prefix}.jpg`, await canvasToBlob(mainCvs), { binary: true });
    }
    for (const sid of stripIds) {
      const def = stripDefs.find(d => d.id === sid);
      if (!def) continue;
      const stripVers = getStripVersions(f.id, def.id as StripType);
      const sName = def.defaultFrameLabel;
      for (let vi = 0; vi < stripVers.length; vi++) {
        const v = stripVers[vi];
        if (!versionHasContent(v)) continue;
        if (imageScope === 'starred' && !(v as any).starred) continue;
        if (imageScope === 'active' && vi !== getStripActiveTab(f.id, def.id as StripType)) continue;
        // 'all' includes everything (no filter)
        const vLabel = v.label || `${def.prefix}${vi + 1}`;
        const verCvs = withBakedBorder(await rasterizeVersion(v, f.cropW, f.cropH));
        zip.file(`${prefix}_${sName}_${vLabel}.jpg`, await canvasToBlob(verCvs), { binary: true });
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  offerSave(blob, `${projectName}_images.zip`);
  showToast('Images ready');
}

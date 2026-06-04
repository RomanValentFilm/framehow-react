// Export pipelines — PDF (jsPDF), PPTX (pptxgenjs), per-frame images (jszip).
// Replaces CDN globals with NPM imports.

import jsPDF from 'jspdf';
// @ts-ignore — pptxgenjs ships its own bundled types
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { state, useStore, DEFAULT_STRIP_DEFS } from '../store/state';
import type { Frame, StripType } from '../store/state';
import { rasterizeMain, rasterizeVersion, versionHasContent, canvasToBlob } from './rasterize';
import { showToast } from './modals';
import { fhTrack } from './tracking';
import { getCurrentProject } from './currentProject';
import { getVisibleFrames } from './groups';
import { getStripVersions, getStripActiveTab } from './helpers';

// iOS detection (covers iPad in desktop-UA mode too).
const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

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

    // Version rows per frame (hidden versions included but unchecked)
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
      section.appendChild(row);
    });

    wrap.appendChild(section);
  }

  // Wire action buttons
  wrap.querySelectorAll('.exp-ver-actions button').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const el = e.target as HTMLElement;
      const action = el.dataset.action!;
      const strip = el.dataset.strip!;
      const sectionEl = el.closest('.exp-ver-section')!;
      const cbs = sectionEl.querySelectorAll('input[type="checkbox"]') as NodeListOf<HTMLInputElement>;

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

export function openExportModal(): void {
  const s = state();
  if (!s.frames.length) {
    showToast('No frames to export');
    return;
  }
  document.getElementById('exportModal')!.classList.remove('hidden');
  const nameInput = document.getElementById('exportProjectName') as HTMLInputElement;
  if (!nameInput.value) nameInput.value = getCurrentProject().name || s.lastPdfName || 'Storyboard';
  buildGroupPicker('exportGroupPicker', 'exportGroup');
  buildStripPicker('exportDoubleStripPicker', 'radio', 'exportDoubleStrip');
  buildStripPicker('exportOverviewStripPicker', 'checkbox');
  buildVersionPicker();
  const layout = (document.querySelector('input[name="exportLayout"]:checked') as HTMLInputElement).value;
  updateExportVisibility(layout, 'export');
}

export function updateExportVisibility(layout: string, prefix: string): void {
  const isDouble = layout === 'double';
  const isOverview = layout === 'overview';
  (document.getElementById(`${prefix}DoubleStripWrap`) as HTMLElement).style.display = isDouble ? 'block' : 'none';
  (document.getElementById(`${prefix}OverviewStripWrap`) as HTMLElement).style.display = isOverview ? 'block' : 'none';
  (document.getElementById(`${prefix}TableToggleWrap`) as HTMLElement).style.display = isOverview ? 'block' : 'none';
  (document.getElementById(`${prefix}VersionPickerWrap`) as HTMLElement).style.display = isOverview ? 'block' : 'none';
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
  buildGroupPicker('pptxGroupPicker', 'pptxGroup');
  buildStripPicker('pptxDoubleStripPicker', 'radio', 'pptxDoubleStrip');
  buildStripPicker('pptxOverviewStripPicker', 'checkbox');
  buildPptxVersionPicker();
  const layout = (document.querySelector('input[name="pptxLayout"]:checked') as HTMLInputElement).value;
  updateExportVisibility(layout, 'pptx');
}

export async function runExport(): Promise<void> {
  fhTrack('export_pdf');
  const s = state();
  const layout = (document.querySelector('input[name="exportLayout"]:checked') as HTMLInputElement).value;
  const includeText = (document.getElementById('exportIncludeText') as HTMLInputElement).checked;
  const includeTable = (document.getElementById('exportIncludeTable') as HTMLInputElement).checked;
  const paperLetter = (document.getElementById('exportPaperLetter') as HTMLInputElement).checked;
  const projectName = withGroupSuffix(((document.getElementById('exportProjectName') as HTMLInputElement).value || 'Storyboard').trim(), 'exportGroup');

  const versionInclude: Record<number, boolean[]> = {};
  document.querySelectorAll('#exportVersionPicker input[type="checkbox"]').forEach((cb) => {
    const el = cb as HTMLInputElement;
    const fid = +el.dataset.fid!,
      vi = +el.dataset.vi!;
    if (!versionInclude[fid]) versionInclude[fid] = [];
    versionInclude[fid][vi] = el.checked;
  });

  const includeHidden = (document.getElementById('exportIncludeHidden') as HTMLInputElement)?.checked ?? false;
  let exportFrames = getExportFrames('exportGroup');
  // Hidden filter only applies to ALL — inside a group, all member frames export
  if (!includeHidden && !isGroupSelected('exportGroup')) exportFrames = exportFrames.filter((f: Frame) => !f.hidden);
  // Use local variable — NEVER shadow s.frames on the live store (autosave/sync would capture the subset)
  const frames = exportFrames;

  document.getElementById('exportModal')!.classList.add('hidden');
  showToast('Generating PDF…');

  const paper = paperLetter ? 'letter' : 'a4';
  const orient = layout === 'double' ? 'portrait' : 'landscape';
  const pdf = new jsPDF({ orientation: orient, unit: 'mm', format: paper });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  const MARGIN = 8;
  const HEADER_H = 8;
  const FOOTER_H = 6;
  const FRAME_BORDER_PT = 2;
  const LABEL_H = 4.5;

  function drawHeader(pageNum: number, totalPages: number) {
    pdf.setTextColor(90);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(projectName, MARGIN, MARGIN + 2);
    pdf.setFontSize(8);
    pdf.text(`${pageNum} / ${totalPages}`, pageW - MARGIN, pageH - MARGIN / 2, { align: 'right' });
  }

  function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    pdf.setFontSize(fontSize);
    return pdf.splitTextToSize(text || '', maxWidth);
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
    const img = canvas.toDataURL('image/jpeg', 0.92);
    pdf.addImage(img, 'JPEG', x, y, w, h, undefined, 'FAST');
    pdf.setDrawColor(0);
    pdf.setLineWidth(FRAME_BORDER_PT * 0.353);
    pdf.rect(x, y, w, h);
    if (textHeight > 0 && text) {
      pdf.setTextColor(30);
      const fontSize = 8;
      pdf.setFontSize(fontSize);
      const tw = textMaxW || w;
      const lines = wrapText(text, tw, fontSize);
      const lineHeight = fontSize * 0.45;
      let ty = y + h + 4.5;
      for (const line of lines) {
        pdf.text(line, x, ty);
        ty += lineHeight + 0.5;
      }
    }
  }

  function drawFrameLabel(x: number, y: number, label: string) {
    if (!label) return;
    pdf.setTextColor(0);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(7.5);
    pdf.text(label, x, y - 1.2);
    pdf.setFont('helvetica', 'normal');
  }

  function measureTextH(text: string, maxW: number, fontSize: number): number {
    if (!text) return 0;
    pdf.setFontSize(fontSize);
    const lines = pdf.splitTextToSize(text, maxW);
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
      pdf.setFont('helvetica', 'bold');
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

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(TABLE_FONT);
    for (const row of dataRows) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(x, curY, maxW, TABLE_ROW_H, 'F');
      pdf.setTextColor(0);
      for (let c = 0; c < cols; c++) {
        const text = (row[c] || '').trim();
        if (text) {
          const clipped = pdf.splitTextToSize(text, colW - 2 * TABLE_PAD)[0] || '';
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

  function calcMainGrid() {
    const cols = 3,
      rows = 2;
    const contentW = pageW - 2 * MARGIN;
    const contentH = pageH - 2 * MARGIN - HEADER_H - FOOTER_H;
    const gutterX = 4;
    const ref = s.frames[0] || { cropW: 16, cropH: 9 };
    const aspect = ref.cropW / ref.cropH;
    const cellW = (contentW - gutterX * (cols - 1)) / cols;
    let fW = cellW * 0.95,
      fH = fW / aspect;
    let gutterY = (contentH - rows * (LABEL_H + fH)) / rows;
    if (gutterY < 6) {
      gutterY = 6;
      fH = (contentH - rows * (LABEL_H + gutterY)) / rows;
      fW = fH * aspect;
    }
    const textH = includeText ? Math.min(gutterY - 2, 14) : 0;
    const gridW = cols * fW + (cols - 1) * gutterX;
    const centreX = MARGIN + (contentW - gridW) / 2;
    const startY = MARGIN + HEADER_H;
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

  if (layout === 'main' && s.portraitMode) {
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
  } else if (layout === 'main') {
    const g = calcMainGrid();
    const perPage = g.cols * g.rows;
    totalPages = Math.ceil(frames.length / perPage);
    for (let i = 0; i < frames.length; i++) {
      const slot = i % perPage;
      if (slot === 0) {
        if (i > 0) pdf.addPage();
        page++;
        drawHeader(page, totalPages);
      }
      const col = slot % g.cols,
        row = Math.floor(slot / g.cols);
      const x = g.startX + col * (g.frameW + g.gutterX);
      const y = g.startY + row * (LABEL_H + g.frameH + g.gutterY) + LABEL_H;
      const f = frames[i];
      const cvs = await rasterizeMain(f);
      await drawFrameTile(x, y, g.frameW, g.frameH, cvs, f.textContent || '', g.textH);
      drawFrameLabel(x, y, f.label || `${i + 1}`);
    }
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
    function frameTableExH(f: any) {
      if (!includeTable || !tableHasContent(f.tableData)) return 0;
      return measureTableH(f.tableData) + 2;
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
          if (includeTable && tableHasContent(f.tableData)) {
            const tableY = mainY + g.mainH + item.txtH + 2;
            drawTableInPDF(mainX, tableY, g.mainW, f.tableData);
          }
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

  const now = new Date();
  const fname = `${projectName.replace(/[^\w\-]+/g, '_')}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.pdf`;
  offerSave(pdf.output('blob') as Blob, fname);
  showToast('PDF ready');
}

export async function runPptxExport(): Promise<void> {
  fhTrack('export_pptx');
  const s = state();
  const layout = (document.querySelector('input[name="pptxLayout"]:checked') as HTMLInputElement).value;
  const includeText = (document.getElementById('pptxIncludeText') as HTMLInputElement).checked;
  const includeTable = (document.getElementById('pptxIncludeTable') as HTMLInputElement).checked;
  const projectName = withGroupSuffix(((document.getElementById('pptxProjectName') as HTMLInputElement).value || 'Storyboard').trim(), 'pptxGroup');

  const versionInclude: Record<number, boolean[]> = {};
  document.querySelectorAll('#pptxVersionPicker input[type="checkbox"]').forEach((cb) => {
    const el = cb as HTMLInputElement;
    const fid = +el.dataset.fid!,
      vi = +el.dataset.vi!;
    if (!versionInclude[fid]) versionInclude[fid] = [];
    versionInclude[fid][vi] = el.checked;
  });

  const pptxIncludeHidden = (document.getElementById('pptxIncludeHidden') as HTMLInputElement)?.checked ?? false;
  let exportFrames = getExportFrames('pptxGroup');
  if (!pptxIncludeHidden && !isGroupSelected('pptxGroup')) exportFrames = exportFrames.filter((f: Frame) => !f.hidden);
  // Use local variable — NEVER shadow s.frames on the live store
  const frames = exportFrames;

  document.getElementById('pptxModal')!.classList.add('hidden');
  showToast('Generating presentation…');

  const pptx: any = new (PptxGenJS as any)();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title = projectName;

  function newSlide() {
    const sl = pptx.addSlide();
    sl.background = { color: 'FFFFFF' };
    return sl;
  }

  async function rasterizeWithBorder(canvas: HTMLCanvasElement, borderPx?: number) {
    const c2 = document.createElement('canvas');
    c2.width = canvas.width;
    c2.height = canvas.height;
    const ctx = c2.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = borderPx || 4;
    ctx.strokeRect(0, 0, c2.width, c2.height);
    return c2;
  }

  const SW = 13.333,
    SH = 7.5;
  const MARGIN = 0.4;
  const ref = frames[0] || { cropW: 16, cropH: 9 };
  const aspect = ref.cropW / ref.cropH;

  function canvasToBase64(cvs: HTMLCanvasElement) {
    return cvs.toDataURL('image/jpeg', 0.92).split(',')[1];
  }

  if (layout === 'main' && s.portraitMode) {
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
        slide.addText(projectName, { x: MARGIN, y: 0.15, w: SW - 2 * MARGIN, h: 0.3, fontSize: 9, color: '666666', fontFace: 'Helvetica' });
      } else {
        slide = pptx.slides[pptx.slides.length - 1];
      }
      const col = slot;
      const x = startX + col * (fW + gapX);
      const y = 0.7;
      const f = frames[i];
      const cvs = await rasterizeWithBorder(await rasterizeMain(f));
      const label = f.label || `${i + 1}`;
      slide.addText(label, { x, y: y - 0.02, w: fW, h: 0.2, fontSize: 7, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(cvs), x, y: y + 0.2, w: fW, h: fH });
    }
  } else if (layout === 'main') {
    const cols = 3,
      rows = 2;
    const cellW = (SW - 2 * MARGIN - 0.3 * (cols - 1)) / cols;
    const fW = cellW * 0.95;
    const fH = fW / aspect;
    const cellH = (SH - 2 * MARGIN - 0.2) / rows;
    const textH = includeText ? 0.4 : 0;
    const perPage = cols * rows;
    for (let i = 0; i < frames.length; i++) {
      const slot = i % perPage;
      let slide;
      if (slot === 0) {
        slide = newSlide();
        slide.addText(projectName, { x: MARGIN, y: 0.15, w: SW - 2 * MARGIN, h: 0.3, fontSize: 9, color: '666666', fontFace: 'Helvetica' });
      } else {
        slide = pptx.slides[pptx.slides.length - 1];
      }
      const col = slot % cols,
        row = Math.floor(slot / cols);
      const x = MARGIN + col * (cellW + 0.3);
      const y = 0.5 + row * cellH;
      const f = frames[i];
      const cvs = await rasterizeWithBorder(await rasterizeMain(f));
      const label = f.label || `${i + 1}`;
      slide.addText(label, { x, y: y - 0.02, w: fW, h: 0.2, fontSize: 7, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(cvs), x, y: y + 0.2, w: fW, h: fH });
      if (includeText && f.textContent) {
        slide.addText(f.textContent, { x, y: y + 0.2 + fH + 0.05, w: fW, h: textH, fontSize: 6, color: '333333', fontFace: 'Helvetica', valign: 'top', wrap: true });
      }
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
        slide.addText(projectName, { x: MARGIN, y: 0.15, w: SW - 2 * MARGIN, h: 0.3, fontSize: 9, color: '666666', fontFace: 'Helvetica' });
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
      slide.addText(label, { x: baseX, y: baseY - 0.02, w: fW, h: 0.18, fontSize: 7, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(mainCvs), x: baseX, y: baseY + 0.18, w: fW, h: fH });
      const vers = getStripVersions(f.id, pptxDblStrip);
      const ver = pptxDblMode === 'starred'
        ? vers.find(v => versionHasContent(v) && (v as any).starred)
        : vers[getStripActiveTab(f.id, pptxDblStrip)];
      if (ver && versionHasContent(ver)) {
        const verCvs = await rasterizeWithBorder(await rasterizeVersion(ver, f.cropW, f.cropH));
        const vx = baseX + fW + 0.15;
        const verFullLabel = fullVerLabel(f.label || `${i + 1}`, `${pptxDblName} ${ver.label || ''}`);
        slide.addText(verFullLabel, { x: vx, y: baseY - 0.02, w: fW, h: 0.18, fontSize: 7, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
        slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(verCvs), x: vx, y: baseY + 0.18, w: fW, h: fH });
      }
      if (includeText && f.textContent) {
        slide.addText(f.textContent, { x: baseX, y: baseY + 0.18 + fH + 0.05, w: pairW, h: 0.5, fontSize: 6, color: '333333', fontFace: 'Helvetica', valign: 'top', wrap: true });
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
        slide.addText(projectName, { x: MARGIN, y: 0.15, w: SW - 2 * MARGIN, h: 0.3, fontSize: 9, color: '666666', fontFace: 'Helvetica' });

        // Main frame only on the first slide for this frame
        if (isFirst) {
          slide.addText(label, { x: mainX, y: mainY - 0.22, w: mainW, h: 0.2, fontSize: 8, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
          slide.addImage({ data: mainB64, x: mainX, y: mainY, w: mainW, h: mainH });
          let belowY = mainY + mainH + 0.1;
          if (includeText && f.textContent) {
            slide.addText(f.textContent, { x: mainX, y: belowY, w: mainW, h: 1.2, fontSize: 7, color: '333333', fontFace: 'Helvetica', valign: 'top', wrap: true });
            belowY += 1.2;
          }
          if (includeTable && f.tableData) {
            const td = f.tableData;
            const hasHeaders = td.headers && td.headers.some((h) => h && h.trim());
            const dataRows = td.rows ? td.rows.filter((r) => r.some((c) => c && c.trim())) : [];
            if (hasHeaders || dataRows.length > 0) {
              const tblRows: any[] = [];
              if (hasHeaders) tblRows.push(td.headers.map((h) => ({ text: h || '', options: { bold: true, fontSize: 6, color: '000000', fill: { color: 'E8E8E8' } } })));
              for (const row of dataRows) tblRows.push(row.map((c) => ({ text: c || '', options: { fontSize: 6, color: '000000' } })));
              if (tblRows.length > 0) {
                slide.addTable(tblRows, { x: mainX, y: belowY, w: mainW, border: { type: 'solid', color: '000000', pt: 0.5 }, colW: Array(td.headers.length).fill(mainW / td.headers.length), fontFace: 'Helvetica', fontSize: 6, color: '000000', autoPage: false });
              }
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
            slide.addText(entry.fullLabel, { x: vx, y: vy - 0.18, w: vCellW, h: 0.16, fontSize: 6, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
            slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(vCanvas), x: vx, y: vy, w: vCellW, h: vCellH });
          }
          vRow += Math.ceil(sg.vers.length / 2);
        }
      }
    }
  }

  const now = new Date();
  const fname = `${projectName.replace(/[^\w\-]+/g, '_')}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
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
      const mainCvs = await rasterizeMain(f);
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
        const verCvs = await rasterizeVersion(v, f.cropW, f.cropH);
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
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(projectName, MARGIN, MARGIN + 2);
    pdf.setFontSize(8);
    pdf.text(`${pageNum} / ${totalPages}`, pageW - MARGIN, pageH - MARGIN / 2, { align: 'right' });
  }

  function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
    pdf.setFontSize(fontSize);
    return pdf.splitTextToSize(text || '', maxWidth);
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
      pdf.setFont('helvetica', 'bold');
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
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(TABLE_FONT);
    for (const row of dataRows) {
      pdf.setFillColor(255, 255, 255);
      pdf.rect(x, curY, maxW, TABLE_ROW_H, 'F');
      pdf.setTextColor(0);
      for (let c = 0; c < cols; c++) {
        const text = (row[c] || '').trim();
        if (text) {
          const clipped = pdf.splitTextToSize(text, cW - 2 * TABLE_PAD)[0] || '';
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
    const mainImg = mainCvs.toDataURL('image/jpeg', 0.92);

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
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(7.5);
        pdf.text(frameLabel, startX, framesY - 1.2);
        pdf.addImage(mainImg, 'JPEG', startX, framesY, frameW, frameH, undefined, 'FAST');
        pdf.setDrawColor(0);
        pdf.setLineWidth(FRAME_BORDER_PT * 0.353);
        pdf.rect(startX, framesY, frameW, frameH);

        // Columns 1–4: Versions for this page batch
        const batchStart = pageOff * 4;
        for (let vi = 0; vi < 4; vi++) {
          const col = vi + 1;
          const x = startX + col * (frameW + gutterX);
          const vIdx = batchStart + vi;
          if (vIdx < sg.vers.length) {
            const entry = sg.vers[vIdx];
            pdf.setTextColor(100);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(7);
            pdf.text(entry.label, x, framesY - 1.2);

            const verCvs = await rasterizeVersion(entry.v, f.cropW, f.cropH);
            const verImg = verCvs.toDataURL('image/jpeg', 0.92);
            pdf.addImage(verImg, 'JPEG', x, framesY, frameW, frameH, undefined, 'FAST');
            pdf.setDrawColor(0);
            pdf.setLineWidth(FRAME_BORDER_PT * 0.353);
            pdf.rect(x, framesY, frameW, frameH);
          }
        }

        // Text & table only on the very first page for this frame
        if (isFirstPageForFrame) {
        let curY = framesY + frameH + 6;
        if (includeText && f.textContent) {
          pdf.setTextColor(30);
          pdf.setFont('helvetica', 'normal');
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
    pdf.setFont('helvetica', 'normal');
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

  function rasterizeWithBorder(canvas: HTMLCanvasElement, borderPx?: number) {
    const c2 = document.createElement('canvas');
    c2.width = canvas.width;
    c2.height = canvas.height;
    const ctx = c2.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = borderPx || 4;
    ctx.strokeRect(0, 0, c2.width, c2.height);
    return c2;
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
        slide.addText(projectName, { x: MARGIN, y: 0.12, w: SW - 2 * MARGIN, h: 0.25, fontSize: 9, color: '666666', fontFace: 'Helvetica' });

        // Column 0: Main frame (always shown)
        slide.addText(frameLabel, { x: startX, y: framesY - 0.22, w: fW, h: 0.2, fontSize: 8, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
        slide.addImage({ data: mainB64, x: startX, y: framesY, w: fW, h: fH });

        // Columns 1–4: Versions for this batch
        const batchStart = pageOff * 4;
        for (let vi = 0; vi < 4; vi++) {
          const col = vi + 1;
          const x = startX + col * (fW + gapX);
          const vIdx = batchStart + vi;
          if (vIdx < sg.vers.length) {
            const entry = sg.vers[vIdx];
            slide.addText(entry.label, { x, y: framesY - 0.22, w: fW, h: 0.2, fontSize: 7, color: '888888', fontFace: 'Helvetica', valign: 'bottom' });
            const verCvs = rasterizeWithBorder(await rasterizeVersion(entry.v, f.cropW, f.cropH));
            slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(verCvs), x, y: framesY, w: fW, h: fH });
          }
        }

        // Text & table only on the very first slide for this frame
        if (isFirstSlideForFrame) {
          let curY = framesY + fH + 0.22;
          if (includeText && f.textContent) {
            slide.addText(f.textContent, { x: MARGIN, y: curY, w: SW - 2 * MARGIN, h: 0.6, fontSize: 8, color: '222222', fontFace: 'Helvetica', valign: 'top', wrap: true });
            curY += 0.65;
          }
          if (includeTable && f.tableData) {
            const td = f.tableData as any;
            const hasHeaders = td.headers && td.headers.some((h: string) => h && h.trim());
            const dataRows = td.rows ? td.rows.filter((r: string[]) => r.some((c: string) => c && c.trim())) : [];
            if (hasHeaders || dataRows.length > 0) {
              const tblRows: any[] = [];
              if (hasHeaders) {
                tblRows.push(td.headers.map((h: string) => ({ text: h || '', options: { bold: true, fontSize: 7, fontFace: 'Helvetica', color: '000000' } })));
              }
              for (const row of dataRows) {
                tblRows.push(row.map((c: string) => ({ text: c || '', options: { fontSize: 7, fontFace: 'Helvetica', color: '333333' } })));
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
      const mainCvs = await rasterizeMain(f);
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
        const verCvs = await rasterizeVersion(v, f.cropW, f.cropH);
        zip.file(`${prefix}_${sName}_${vLabel}.jpg`, await canvasToBlob(verCvs), { binary: true });
      }
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  offerSave(blob, `${projectName}_images.zip`);
  showToast('Images ready');
}

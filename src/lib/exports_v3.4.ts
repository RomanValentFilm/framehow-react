// Export pipelines — PDF (jsPDF), PPTX (pptxgenjs), per-frame images (jszip).
// Replaces CDN globals with NPM imports.

import jsPDF from 'jspdf';
// @ts-ignore — pptxgenjs ships its own bundled types
import PptxGenJS from 'pptxgenjs';
import JSZip from 'jszip';
import { state, useStore } from '../store/state';
import { rasterizeMain, rasterizeVersion, versionHasContent, canvasToBlob } from './rasterize';
import { showToast } from './modals';
import { fhTrack } from './tracking';

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

export function buildVersionPicker(): void {
  const wrap = document.getElementById('exportVersionPicker')!;
  wrap.innerHTML = '';
  const s = state();
  s.frames
    .filter((f) => !f.hidden)
    .forEach((f) => {
      const vs = s.versions[f.id] || [];
      const nonEmpty = vs.map((v, i) => ({ v, i })).filter((o) => versionHasContent(o.v));
      if (nonEmpty.length === 0) return;
      const row = document.createElement('div');
      row.className = 'exp-frame-row';
      const labelText = f.label ? f.label : `frame ${s.frames.indexOf(f) + 1}`;
      let html = `<div class="exp-frame-row-label">${labelText}</div><div class="exp-frame-row-versions">`;
      nonEmpty.forEach((o) => {
        html += `<label><input type="checkbox" data-fid="${f.id}" data-vi="${o.i}" checked> ${o.v.label}</label>`;
      });
      html += '</div>';
      row.innerHTML = html;
      wrap.appendChild(row);
    });
}

export function buildPptxVersionPicker(): void {
  const wrap = document.getElementById('pptxVersionPicker')!;
  wrap.innerHTML = '';
  const s = state();
  s.frames
    .filter((f) => !f.hidden)
    .forEach((f) => {
      const vs = s.versions[f.id] || [];
      const nonEmpty = vs.map((v, i) => ({ v, i })).filter((o) => versionHasContent(o.v));
      if (nonEmpty.length === 0) return;
      const row = document.createElement('div');
      row.className = 'exp-frame-row';
      const labelText = f.label ? f.label : `frame ${s.frames.indexOf(f) + 1}`;
      let html = `<div class="exp-frame-row-label">${labelText}</div><div class="exp-frame-row-versions">`;
      nonEmpty.forEach((o) => {
        html += `<label><input type="checkbox" data-fid="${f.id}" data-vi="${o.i}" checked> ${o.v.label}</label>`;
      });
      html += '</div>';
      row.innerHTML = html;
      wrap.appendChild(row);
    });
}

export function openExportModal(): void {
  const s = state();
  if (!s.frames.length) {
    showToast('No frames to export');
    return;
  }
  document.getElementById('exportModal')!.classList.remove('hidden');
  const nameInput = document.getElementById('exportProjectName') as HTMLInputElement;
  if (!nameInput.value) nameInput.value = s.lastPdfName || 'Storyboard';
  buildVersionPicker();
  const layout = (document.querySelector('input[name="exportLayout"]:checked') as HTMLInputElement).value;
  const isOverview = layout === 'overview';
  (document.getElementById('exportTableToggleWrap') as HTMLElement).style.display = isOverview ? 'block' : 'none';
  (document.getElementById('exportVersionPickerWrap') as HTMLElement).style.display = isOverview ? 'block' : 'none';
}

export function openPptxModal(): void {
  const s = state();
  if (!s.frames.length) {
    showToast('No frames to export');
    return;
  }
  document.getElementById('pptxModal')!.classList.remove('hidden');
  const nameInput = document.getElementById('pptxProjectName') as HTMLInputElement;
  if (!nameInput.value) nameInput.value = s.lastPdfName || 'Storyboard';
  buildPptxVersionPicker();
  const layout = (document.querySelector('input[name="pptxLayout"]:checked') as HTMLInputElement).value;
  const isOverview = layout === 'overview';
  (document.getElementById('pptxTableToggleWrap') as HTMLElement).style.display = isOverview ? 'block' : 'none';
  (document.getElementById('pptxVersionPickerWrap') as HTMLElement).style.display = isOverview ? 'block' : 'none';
}

export async function runExport(): Promise<void> {
  fhTrack('export_pdf');
  const s = state();
  const layout = (document.querySelector('input[name="exportLayout"]:checked') as HTMLInputElement).value;
  const includeText = (document.getElementById('exportIncludeText') as HTMLInputElement).checked;
  const includeTable = (document.getElementById('exportIncludeTable') as HTMLInputElement).checked;
  const paperLetter = (document.getElementById('exportPaperLetter') as HTMLInputElement).checked;
  const projectName = ((document.getElementById('exportProjectName') as HTMLInputElement).value || 'Storyboard').trim();

  const versionInclude: Record<number, boolean[]> = {};
  document.querySelectorAll('#exportVersionPicker input[type="checkbox"]').forEach((cb) => {
    const el = cb as HTMLInputElement;
    const fid = +el.dataset.fid!,
      vi = +el.dataset.vi!;
    if (!versionInclude[fid]) versionInclude[fid] = [];
    versionInclude[fid][vi] = el.checked;
  });

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
    totalPages = Math.ceil(s.frames.length / perPage);
    for (let i = 0; i < s.frames.length; i++) {
      const slot = i % perPage;
      if (slot === 0) {
        if (i > 0) pdf.addPage();
        page++;
        drawHeader(page, totalPages);
      }
      const col = slot;
      const x = g.startX + col * (g.frameW + g.gutterX);
      const y = g.startY + LABEL_H;
      const f = s.frames[i];
      const cvs = await rasterizeMain(f);
      await drawFrameTile(x, y, g.frameW, g.frameH, cvs, '', 0);
      drawFrameLabel(x, y, f.label || `${i + 1}`);
    }
  } else if (layout === 'main') {
    const g = calcMainGrid();
    const perPage = g.cols * g.rows;
    totalPages = Math.ceil(s.frames.length / perPage);
    for (let i = 0; i < s.frames.length; i++) {
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
      const f = s.frames[i];
      const cvs = await rasterizeMain(f);
      await drawFrameTile(x, y, g.frameW, g.frameH, cvs, f.textContent || '', g.textH);
      drawFrameLabel(x, y, f.label || `${i + 1}`);
    }
  } else if (layout === 'double') {
    const g = calcDoubleGrid();
    const perPage = g.rows;
    totalPages = Math.ceil(s.frames.length / perPage);
    for (let i = 0; i < s.frames.length; i++) {
      const slot = i % perPage;
      if (slot === 0) {
        if (i > 0) pdf.addPage();
        page++;
        drawHeader(page, totalPages);
      }
      const rowY = g.startY + slot * (LABEL_H + g.frameH + g.gutterY) + LABEL_H;
      const f = s.frames[i];
      const ai = s.activeTab[f.id] || 0;
      const ver = (s.versions[f.id] || [])[ai] || { strokes: [], bgImage: null, type: 'empty' as const };
      const mainCvs = await rasterizeMain(f);
      const fX1 = g.startX;
      await drawFrameTile(fX1, rowY, g.frameW, g.frameH, mainCvs, f.textContent || '', g.textH, g.frameW - 2);
      drawFrameLabel(fX1, rowY, f.label || `${i + 1}`);
      if (versionHasContent(ver as any)) {
        const verCvs = await rasterizeVersion(ver as any, f.cropW, f.cropH);
        const fX2 = g.startX + g.frameW + g.pairGap;
        await drawFrameTile(fX2, rowY, g.frameW, g.frameH, verCvs, '', 0);
        drawFrameLabel(fX2, rowY, (ver as any).label || `v${ai + 1}`);
      }
    }
  } else if (layout === 'overview') {
    const g = calcOverviewGrid();
    const visibleFrames = s.frames.filter((f) => !f.hidden);
    const frameVers = visibleFrames.map((f) => {
      const allVers = s.versions[f.id] || [];
      const incl = versionInclude[f.id] || [];
      return allVers.filter((v, vi) => versionHasContent(v) && incl[vi] !== false);
    });
    function blockRowsFor(vers: any[]) {
      return Math.max(1, Math.ceil(vers.length / 4));
    }
    function frameTextH(f: any) {
      if (!includeText || !f.textContent) return 0;
      return measureTextH(f.textContent, g.mainW, 8);
    }
    function frameTableExH(f: any) {
      if (!includeTable || !tableHasContent(f.tableData)) return 0;
      return measureTableH(f.tableData) + 2;
    }
    const pages: any[] = [];
    let currentPage: any[] = [];
    let usedH = 0;
    for (let i = 0; i < visibleFrames.length; i++) {
      const f = visibleFrames[i];
      const rows = blockRowsFor(frameVers[i]);
      const blockBaseH = rows * g.blockH + (rows - 1) * g.rowGap;
      const txtH = frameTextH(f);
      const tblH = frameTableExH(f);
      const mainSideH = g.mainH + LABEL_H + txtH + tblH;
      const neededH = Math.max(blockBaseH, mainSideH);
      const gapIfNotFirst = currentPage.length > 0 ? g.rowGap : 0;
      if (currentPage.length > 0 && usedH + gapIfNotFirst + neededH > g.contentH) {
        pages.push(currentPage);
        currentPage = [];
        usedH = 0;
      }
      currentPage.push({ fIdx: i, vers: frameVers[i], neededH, txtH, tblH });
      usedH += (usedH > 0 ? g.rowGap : 0) + neededH;
    }
    if (currentPage.length) pages.push(currentPage);
    totalPages = pages.length;

    for (let pi = 0; pi < pages.length; pi++) {
      if (pi > 0) pdf.addPage();
      page = pi + 1;
      drawHeader(page, totalPages);
      let curY = g.startY;
      for (const item of pages[pi]) {
        const f = visibleFrames[item.fIdx];
        const vers = item.vers;
        const mainX = g.startX;
        const mainY = curY + LABEL_H;
        const mainCvs = await rasterizeMain(f);
        await drawFrameTile(mainX, mainY, g.mainW, g.mainH, mainCvs, f.textContent || '', item.txtH, g.mainW - 2);
        drawFrameLabel(mainX, mainY, f.label || `${item.fIdx + 1}`);

        if (includeTable && tableHasContent(f.tableData)) {
          const tableY = mainY + g.mainH + item.txtH + 2;
          drawTableInPDF(mainX, tableY, g.mainW, f.tableData);
        }

        const verStartX = mainX + g.mainW + g.mainGap;
        for (let vi = 0; vi < vers.length; vi++) {
          const blockRow = Math.floor(vi / 4);
          const localIdx = vi % 4;
          const vc = localIdx % 2;
          const vr = Math.floor(localIdx / 2);
          const blockTopY = curY + blockRow * (g.blockH + g.rowGap) + LABEL_H;
          const vx = verStartX + vc * (g.verCellW + g.vGapX);
          const vy = blockTopY + vr * (g.verCellH + g.vGapY);
          const v = vers[vi];
          const vCanvas = await rasterizeVersion(v, f.cropW, f.cropH);
          await drawFrameTile(vx, vy, g.verCellW, g.verCellH, vCanvas, '', 0);
          drawFrameLabel(vx, vy, v.label || `v${vi + 1}`);
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
  const projectName = ((document.getElementById('pptxProjectName') as HTMLInputElement).value || 'Storyboard').trim();

  const versionInclude: Record<number, boolean[]> = {};
  document.querySelectorAll('#pptxVersionPicker input[type="checkbox"]').forEach((cb) => {
    const el = cb as HTMLInputElement;
    const fid = +el.dataset.fid!,
      vi = +el.dataset.vi!;
    if (!versionInclude[fid]) versionInclude[fid] = [];
    versionInclude[fid][vi] = el.checked;
  });

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
  const ref = s.frames[0] || { cropW: 16, cropH: 9 };
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
    for (let i = 0; i < s.frames.length; i++) {
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
      const f = s.frames[i];
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
    for (let i = 0; i < s.frames.length; i++) {
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
      const f = s.frames[i];
      const cvs = await rasterizeWithBorder(await rasterizeMain(f));
      const label = f.label || `${i + 1}`;
      slide.addText(label, { x, y: y - 0.02, w: fW, h: 0.2, fontSize: 7, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(cvs), x, y: y + 0.2, w: fW, h: fH });
      if (includeText && f.textContent) {
        slide.addText(f.textContent, { x, y: y + 0.2 + fH + 0.05, w: fW, h: textH, fontSize: 6, color: '333333', fontFace: 'Helvetica', valign: 'top', wrap: true });
      }
    }
  } else if (layout === 'double') {
    const pairsPerSlide = 4;
    const pairCols = 2;
    const pairRows = 2;
    const pairW = (SW - 2 * MARGIN - 0.4) / pairCols;
    const fW = (pairW - 0.15) / 2;
    const fH = fW / aspect;
    const rowH = (SH - 0.8) / pairRows;
    for (let i = 0; i < s.frames.length; i++) {
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
      const f = s.frames[i];
      const label = f.label || `${i + 1}`;
      const mainCvs = await rasterizeWithBorder(await rasterizeMain(f));
      slide.addText(label, { x: baseX, y: baseY - 0.02, w: fW, h: 0.18, fontSize: 7, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(mainCvs), x: baseX, y: baseY + 0.18, w: fW, h: fH });
      const ai = s.activeTab[f.id] || 0;
      const ver = (s.versions[f.id] || [])[ai];
      if (ver && versionHasContent(ver)) {
        const verCvs = await rasterizeWithBorder(await rasterizeVersion(ver, f.cropW, f.cropH));
        const vx = baseX + fW + 0.15;
        slide.addText(ver.label || `v${ai + 1}`, { x: vx, y: baseY - 0.02, w: fW, h: 0.18, fontSize: 7, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
        slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(verCvs), x: vx, y: baseY + 0.18, w: fW, h: fH });
      }
      if (includeText && f.textContent) {
        slide.addText(f.textContent, { x: baseX, y: baseY + 0.18 + fH + 0.05, w: pairW, h: 0.5, fontSize: 6, color: '333333', fontFace: 'Helvetica', valign: 'top', wrap: true });
      }
    }
  } else if (layout === 'overview') {
    const visibleFrames = s.frames.filter((f) => !f.hidden);
    for (let i = 0; i < visibleFrames.length; i++) {
      const f = visibleFrames[i];
      const allVers = s.versions[f.id] || [];
      const incl = versionInclude[f.id] || [];
      const vers = allVers.filter((v, vi) => versionHasContent(v) && incl[vi] !== false);

      const slide = newSlide();
      slide.addText(projectName, { x: MARGIN, y: 0.15, w: SW - 2 * MARGIN, h: 0.3, fontSize: 9, color: '666666', fontFace: 'Helvetica' });

      const label = f.label || `${i + 1}`;
      const mainW = (SW - 2 * MARGIN) * 0.48;
      const mainH = mainW / aspect;
      const mainX = MARGIN;
      const mainY = 0.7;
      slide.addText(label, { x: mainX, y: mainY - 0.22, w: mainW, h: 0.2, fontSize: 8, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
      const mainCvs = await rasterizeWithBorder(await rasterizeMain(f));
      slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(mainCvs), x: mainX, y: mainY, w: mainW, h: mainH });

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
          if (hasHeaders) {
            tblRows.push(td.headers.map((h) => ({ text: h || '', options: { bold: true, fontSize: 6, color: '000000', fill: { color: 'E8E8E8' } } })));
          }
          for (const row of dataRows) {
            tblRows.push(row.map((c) => ({ text: c || '', options: { fontSize: 6, color: '000000' } })));
          }
          if (tblRows.length > 0) {
            slide.addTable(tblRows, {
              x: mainX,
              y: belowY,
              w: mainW,
              border: { type: 'solid', color: '000000', pt: 0.5 },
              colW: Array(td.headers.length).fill(mainW / td.headers.length),
              fontFace: 'Helvetica',
              fontSize: 6,
              color: '000000',
              autoPage: false,
            });
          }
        }
      }

      if (vers.length > 0) {
        const vGap = 0.12;
        const gridX = mainX + mainW + 0.2;
        const gridW = SW - MARGIN - gridX;
        const vCols = 2;
        const vCellW = (gridW - vGap) / vCols;
        const vCellH = vCellW / aspect;
        for (let vi = 0; vi < vers.length; vi++) {
          const vc = vi % vCols;
          const vr = Math.floor(vi / vCols);
          const vx = gridX + vc * (vCellW + vGap);
          const vy = mainY + vr * (vCellH + vGap + 0.2);
          if (vy + vCellH > SH - 0.3) break;
          const v = vers[vi];
          const vCanvas = await rasterizeWithBorder(await rasterizeVersion(v, f.cropW, f.cropH), 2);
          slide.addText(v.label || `v${vi + 1}`, { x: vx, y: vy - 0.18, w: vCellW, h: 0.16, fontSize: 6, bold: true, color: '000000', fontFace: 'Helvetica', valign: 'bottom' });
          slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(vCanvas), x: vx, y: vy, w: vCellW, h: vCellH });
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

export async function runImageExport(): Promise<void> {
  fhTrack('export_images');
  showToast('Generating images…');
  const s = state();
  const projectName = (s.lastPdfName || 'PROJECT_NAME').replace(/[^\w\-]+/g, '_');
  const zip = new JSZip();
  const visibleFrames = s.frames.filter((f) => !f.hidden);

  for (let i = 0; i < visibleFrames.length; i++) {
    const f = visibleFrames[i];
    const label = (f.label || `${i + 1}`).replace(/[^\w\-]+/g, '_');
    const prefix = `${projectName}_${label}`;
    const mainCvs = await rasterizeMain(f);
    zip.file(`${prefix}.jpg`, await canvasToBlob(mainCvs), { binary: true });
    const vers = s.versions[f.id] || [];
    for (let vi = 0; vi < vers.length; vi++) {
      const v = vers[vi];
      if (!versionHasContent(v)) continue;
      const vLabel = v.label || `v${vi + 1}`;
      const verCvs = await rasterizeVersion(v, f.cropW, f.cropH);
      zip.file(`${prefix}_${vLabel}.jpg`, await canvasToBlob(verCvs), { binary: true });
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
  if (!nameInput.value) nameInput.value = s.lastPdfName || 'Storyboard';
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
  const includeHidden = (document.getElementById('portraitIncludeHidden') as HTMLInputElement).checked;
  const includeText = (document.getElementById('portraitIncludeText') as HTMLInputElement).checked;
  const includeTable = (document.getElementById('portraitIncludeTable') as HTMLInputElement).checked;
  const paperLetter = (document.getElementById('portraitPaperLetter') as HTMLInputElement).checked;
  const projectName = ((document.getElementById('portraitExportName') as HTMLInputElement).value || 'Storyboard').trim();

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

  const frames = includeHidden ? s.frames : s.frames.filter(f => !f.hidden);

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

  const totalPages = frames.length;
  for (let fi = 0; fi < frames.length; fi++) {
    if (fi > 0) pdf.addPage();
    const f = frames[fi];
    const pageNum = fi + 1;
    drawHeader(pageNum, totalPages);

    const label = f.label || `${fi + 1}`;
    const vers = s.versions[f.id] || [];

    // Draw label above frames
    const framesY = MARGIN + HEADER_H + 5;
    pdf.setTextColor(0);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(9);
    pdf.text(label, MARGIN, framesY - 1.5);

    // Column 0: Main frame
    const startX = MARGIN + (contentW - (COLS * frameW + (COLS - 1) * gutterX)) / 2;
    const mainCvs = await rasterizeMain(f);
    const mainImg = mainCvs.toDataURL('image/jpeg', 0.92);
    pdf.addImage(mainImg, 'JPEG', startX, framesY, frameW, frameH, undefined, 'FAST');
    pdf.setDrawColor(0);
    pdf.setLineWidth(FRAME_BORDER_PT * 0.353);
    pdf.rect(startX, framesY, frameW, frameH);
    // "MAIN" sub-label
    pdf.setTextColor(120);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.text('MAIN', startX, framesY + frameH + 3);

    // Columns 1–4: Versions
    for (let vi = 0; vi < 4; vi++) {
      const col = vi + 1;
      const x = startX + col * (frameW + gutterX);
      if (vi < vers.length && versionHasContent(vers[vi])) {
        const verCvs = await rasterizeVersion(vers[vi], f.cropW, f.cropH);
        const verImg = verCvs.toDataURL('image/jpeg', 0.92);
        pdf.addImage(verImg, 'JPEG', x, framesY, frameW, frameH, undefined, 'FAST');
        pdf.setDrawColor(0);
        pdf.setLineWidth(FRAME_BORDER_PT * 0.353);
        pdf.rect(x, framesY, frameW, frameH);
        // Version sub-label
        pdf.setTextColor(120);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(6);
        const vLabel = vers[vi].label || `V${vi + 1}`;
        pdf.text(vLabel, x, framesY + frameH + 3);
      } else {
        // Empty slot — light dashed border
        pdf.setDrawColor(180);
        pdf.setLineWidth(0.3);
        pdf.rect(x, framesY, frameW, frameH);
      }
    }

    // Text below frames
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

    // Table below text
    if (includeTable && f.tableData && tableHasContent(f.tableData)) {
      drawTable(MARGIN, curY, contentW, f.tableData);
    }
  }

  const now = new Date();
  const fname = `${projectName.replace(/[^\w\-]+/g, '_')}_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.pdf`;
  offerSave(pdf.output('blob') as Blob, fname);
  showToast('PDF ready');
}

async function runPortraitPptxExport(): Promise<void> {
  fhTrack('export_portrait_pptx');
  const s = state();
  const includeHidden = (document.getElementById('portraitIncludeHidden') as HTMLInputElement).checked;
  const includeText = (document.getElementById('portraitIncludeText') as HTMLInputElement).checked;
  const includeTable = (document.getElementById('portraitIncludeTable') as HTMLInputElement).checked;
  const projectName = ((document.getElementById('portraitExportName') as HTMLInputElement).value || 'Storyboard').trim();

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

  const frames = includeHidden ? s.frames : s.frames.filter(f => !f.hidden);
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
    const slide = newSlide();
    const label = f.label || `${fi + 1}`;
    const vers = s.versions[f.id] || [];

    // Project name header
    slide.addText(projectName, { x: MARGIN, y: 0.12, w: SW - 2 * MARGIN, h: 0.25, fontSize: 9, color: '666666', fontFace: 'Helvetica' });
    // Frame label
    slide.addText(label, { x: MARGIN, y: 0.42, w: 3, h: 0.22, fontSize: 10, bold: true, color: '000000', fontFace: 'Helvetica' });

    const framesY = 0.7;

    // Column 0: Main
    const mainCvs = rasterizeWithBorder(await rasterizeMain(f));
    slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(mainCvs), x: startX, y: framesY, w: fW, h: fH });
    slide.addText('MAIN', { x: startX, y: framesY + fH + 0.02, w: fW, h: 0.15, fontSize: 6, color: '888888', fontFace: 'Helvetica' });

    // Columns 1–4: Versions
    for (let vi = 0; vi < 4; vi++) {
      const col = vi + 1;
      const x = startX + col * (fW + gapX);
      if (vi < vers.length && versionHasContent(vers[vi])) {
        const verCvs = rasterizeWithBorder(await rasterizeVersion(vers[vi], f.cropW, f.cropH));
        slide.addImage({ data: 'image/jpeg;base64,' + canvasToBase64(verCvs), x, y: framesY, w: fW, h: fH });
        const vLabel = vers[vi].label || `V${vi + 1}`;
        slide.addText(vLabel, { x, y: framesY + fH + 0.02, w: fW, h: 0.15, fontSize: 6, color: '888888', fontFace: 'Helvetica' });
      } else {
        // Empty slot placeholder
        slide.addShape('rect' as any, { x, y: framesY, w: fW, h: fH, line: { color: 'CCCCCC', width: 0.5 } });
      }
    }

    // Text below
    let curY = framesY + fH + 0.22;
    if (includeText && f.textContent) {
      slide.addText(f.textContent, { x: MARGIN, y: curY, w: SW - 2 * MARGIN, h: 0.6, fontSize: 8, color: '222222', fontFace: 'Helvetica', valign: 'top', wrap: true });
      curY += 0.65;
    }

    // Table below text
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
          slide.addTable(tblRows, {
            x: MARGIN, y: curY, w: SW - 2 * MARGIN,
            border: { type: 'solid', pt: 0.5, color: '999999' },
            rowH: 0.25,
            colW: Array(tblRows[0].length).fill((SW - 2 * MARGIN) / tblRows[0].length),
          });
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

export async function runPortraitImageExport(): Promise<void> {
  fhTrack('export_portrait_images');
  showToast('Generating images…');
  const s = state();
  const projectName = (s.lastPdfName || 'PROJECT_NAME').replace(/[^\w\-]+/g, '_');
  const zip = new JSZip();
  const visibleFrames = s.frames.filter((f) => !f.hidden);

  for (let i = 0; i < visibleFrames.length; i++) {
    const f = visibleFrames[i];
    const label = (f.label || `${i + 1}`).replace(/[^\w\-]+/g, '_');
    const prefix = `${projectName}_${label}`;
    const mainCvs = await rasterizeMain(f);
    zip.file(`${prefix}.jpg`, await canvasToBlob(mainCvs), { binary: true });
    const vers = s.versions[f.id] || [];
    for (let vi = 0; vi < vers.length; vi++) {
      const v = vers[vi];
      if (!versionHasContent(v)) continue;
      const vLabel = v.label || `v${vi + 1}`;
      const verCvs = await rasterizeVersion(v, f.cropW, f.cropH);
      zip.file(`${prefix}_${vLabel}.jpg`, await canvasToBlob(verCvs), { binary: true });
    }
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  offerSave(blob, `${projectName}_images.zip`);
  showToast('Images ready');
}

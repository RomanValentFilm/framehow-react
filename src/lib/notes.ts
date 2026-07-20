/**
 * Notes strip — renders inline notes cards in its own column.
 * Each card has a Note/Table toggle: free-text note or editable table.
 */

import { state, useStore, createDefaultFrameNoteState } from '../store/state';
import type { FrameNoteState, TableData } from '../store/state';
import { showVerLabelEdit } from './modals';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Ensure per-frame note state exists (lazy init). */
export function ensureFrameNote(fid: number): FrameNoteState {
  const s = state();
  if (!s.frameNotes[fid]) {
    s.frameNotes[fid] = createDefaultFrameNoteState();
  }
  return s.frameNotes[fid];
}

/** Debounced sync — calls flushSyncNow after 5 s inactivity. */
let _debounceSyncTimer: ReturnType<typeof setTimeout> | null = null;
function debouncedSync() {
  if (_debounceSyncTimer) clearTimeout(_debounceSyncTimer);
  _debounceSyncTimer = setTimeout(() => {
    _debounceSyncTimer = null;
    const flush = (window as any).__fh_flushSyncNow;
    if (flush) flush();
  }, 5000);
}

/** Flush the debounced sync immediately (on blur / mode switch). */
export function flushDebouncedNoteSync() {
  if (_debounceSyncTimer) {
    clearTimeout(_debounceSyncTimer);
    _debounceSyncTimer = null;
  }
  const flush = (window as any).__fh_flushSyncNow;
  if (flush) flush();
}

/** Clipboard for copy/paste of note content. */
let _copiedNoteState: { mode: 'note' | 'table'; noteText: string; tableData: TableData } | null = null;

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Render ───────────────────────────────────────────────────────────

/** Build the full notes card element for a frame. */
export function buildNotesCard(fid: number): HTMLElement {
  const div = document.createElement('div');
  div.className = 'notes-card';
  div.dataset.notesFid = String(fid);
  renderNotesCard(div, fid);
  return div;
}

/** Render / re-render notes card content. */
export function renderNotesCard(div: HTMLElement, fid: number): void {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  if (!f) return;

  // Hidden state — label + Un-Hide, dimmed background
  if (f.hidden && s.activeGroupId === null) {
    div.style.background = 'rgba(51,51,51,0.4)';
    div.style.borderColor = 'rgba(255,255,255,0.12)';
    const frameLabel = f.label || String(fid);
    div.innerHTML = `
      <div class="notes-header">
        <span class="frame-label-tag notes-label-combo">${escapeHtml(frameLabel)}</span>
        <button class="btn" data-notes-unhide="${fid}" style="margin-left:auto;font-size:10px;padding:2px 10px;">Un-Hide</button>
      </div>`;
    div.querySelector(`[data-notes-unhide="${fid}"]`)?.addEventListener('click', () => {
      const currentF = state().frames.find((fr: any) => fr.id === fid);
      if (currentF) currentF.hidden = false;
      bumpRenderTick();
      div.style.background = '';
      div.style.borderColor = '';
      (window as any).__fh_renderAll?.();
      flushDebouncedNoteSync();
    });
    return;
  }
  div.style.background = '';
  div.style.borderColor = '';

  const fn = ensureFrameNote(fid);
  const frameLabel = f.label || String(fid);
  const isNote = fn.mode === 'note';

  // Content body — note or table
  const bodyHTML = isNote
    ? `<textarea class="notes-textarea" data-notes-text="${fid}" placeholder="Note for this frame..." spellcheck="false" autocomplete="one-time-code">${escapeHtml(fn.noteText)}</textarea>`
    : renderNotesTable(fid, fn.tableData);

  div.innerHTML = `
    <div class="notes-header">
      <span class="frame-label-tag notes-label-combo" data-notes-editlabel="${fid}">${escapeHtml(frameLabel)}&thinsp;<span class="notes-label-part">${escapeHtml(fn.label)}</span></span>
      <button class="vtab pictxt-btn notes-mode-btn" data-notes-modetoggle="${fid}">${isNote ? '<span class="ptt-bold">Note</span>/Table' : 'Note/<span class="ptt-bold">Table</span>'}</button>
    </div>
    <div class="notes-body">
      ${bodyHTML}
    </div>
    <div class="notes-action-row">
      <button class="act-btn" data-notes-act="copy" data-notes-actfid="${fid}">Copy Note</button>
      <button class="act-btn${_copiedNoteState ? '' : ' disabled'}" data-notes-act="paste" data-notes-actfid="${fid}">Paste</button>
      <button class="act-btn" data-notes-act="reset" data-notes-actfid="${fid}">Reset</button>
      ${!isNote ? '<button class="act-btn notes-tbl-settings-btn" data-notes-tblsettings="' + fid + '">Table Settings</button>' : ''}
    </div>
  `;

  // Re-apply body height cap stored by syncCardHeights
  const storedH = div.dataset.notesBodyH;
  if (storedH) {
    const nb = div.querySelector('.notes-body') as HTMLElement | null;
    if (nb) { nb.style.flex = 'none'; nb.style.height = storedH + 'px'; }
  }

  wireNotesCard(div, fid);
}

/** Render table HTML for note card. */
function renderNotesTable(fid: number, td: TableData): string {
  const colCount = td.headers.length;
  // Build colgroup with stored or equal widths
  let h = '<div class="notes-table-wrap"><table class="notes-table" data-notes-tblfid="' + fid + '"><colgroup>';
  for (let c = 0; c < colCount; c++) {
    const w = td.colWidths?.[c] ?? Math.round(10000 / colCount) / 100;
    h += '<col style="width:' + w + '%">';
  }
  h += '</colgroup><thead><tr>';
  for (let c = 0; c < colCount; c++) {
    h += '<th><input type="text" value="' + escapeHtml(td.headers[c]) + '" placeholder="Col ' + (c + 1) + '" data-col="' + c + '" autocomplete="one-time-code" spellcheck="false">';
    // Resize handle on right edge (not on last column)
    if (c < colCount - 1) h += '<span class="notes-col-resize" data-resize-col="' + c + '"></span>';
    h += '</th>';
  }
  h += '</tr></thead><tbody>';
  for (let r = 0; r < td.rows.length; r++) {
    h += '<tr>';
    for (let c = 0; c < colCount; c++) {
      h += '<td><textarea rows="1" data-row="' + r + '" data-col="' + c + '" autocomplete="one-time-code" spellcheck="false">' + escapeHtml(td.rows[r]?.[c] || '') + '</textarea></td>';
    }
    h += '</tr>';
  }
  h += '</tbody></table>';
  h += '<div class="notes-table-actions">';
  h += '<button class="notes-table-addrow" data-notes-addrow="' + fid + '" title="Add row"><span class="notes-add-plus">+</span> row</button>';
  h += '<button class="notes-table-delrow" data-notes-delrow="' + fid + '" title="Remove last row"><span class="notes-add-plus">&minus;</span> row</button>';
  h += '<span class="notes-table-actions-sep"></span>';
  h += '<button class="notes-table-addcol" data-notes-addcol="' + fid + '" title="Add column"><span class="notes-add-plus">+</span> col</button>';
  h += '<button class="notes-table-delcol" data-notes-delcol="' + fid + '" title="Remove last column"><span class="notes-add-plus">&minus;</span> col</button>';
  h += '</div></div>';
  return h;
}

// ─── Save table from DOM ─────────────────────────────────────────────

/** Read table DOM inputs back into the FrameNoteState. */
function saveNotesTableFromDOM(tbl: HTMLElement): void {
  const fid = parseInt(tbl.dataset.notesTblfid!);
  const fn = state().frameNotes[fid];
  if (!fn) return;
  const headers: string[] = [];
  tbl.querySelectorAll('thead input').forEach((inp) => headers.push((inp as HTMLInputElement).value));
  const rows: string[][] = [];
  tbl.querySelectorAll('tbody tr').forEach((tr) => {
    const cells: string[] = [];
    tr.querySelectorAll('textarea').forEach((ta) => cells.push((ta as HTMLTextAreaElement).value));
    rows.push(cells);
  });
  // Save column widths from colgroup
  const colWidths: number[] = [];
  tbl.querySelectorAll('colgroup col').forEach((col) => {
    const w = parseFloat((col as HTMLElement).style.width);
    colWidths.push(isNaN(w) ? 0 : w);
  });
  fn.tableData = { headers, rows, colWidths };
}

/** Save all open notes tables in DOM. */
export function saveOpenNotesTableEdits(): void {
  document.querySelectorAll('.notes-table[data-notes-tblfid]').forEach((tbl) =>
    saveNotesTableFromDOM(tbl as HTMLElement)
  );
}

// ─── Event Wiring ─────────────────────────────────────────────────────

function wireNotesCard(container: HTMLElement, fid: number): void {
  // Mode toggle: Note ↔ Table
  container.querySelectorAll('[data-notes-modetoggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fn = ensureFrameNote(fid);
      // Save current content before switching
      if (fn.mode === 'table') {
        const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
        if (tbl) saveNotesTableFromDOM(tbl);
      } else {
        const ta = container.querySelector('.notes-textarea') as HTMLTextAreaElement | null;
        if (ta) fn.noteText = ta.value;
      }
      fn.mode = fn.mode === 'note' ? 'table' : 'note';
      bumpRenderTick();
      renderNotesCard(container, fid);
      flushDebouncedNoteSync();
    });
  });

  // Note textarea — input + blur
  container.querySelectorAll('[data-notes-text]').forEach((ta) => {
    ta.addEventListener('input', () => {
      const fn = ensureFrameNote(fid);
      fn.noteText = (ta as HTMLTextAreaElement).value;
      bumpRenderTick();
      debouncedSync();
    });
    ta.addEventListener('blur', () => flushDebouncedNoteSync());
  });

  // Table cell inputs — debounced sync
  container.querySelectorAll('.notes-table textarea, .notes-table input').forEach((el) => {
    el.addEventListener('input', () => {
      const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
      if (tbl) saveNotesTableFromDOM(tbl);
      bumpRenderTick();
      debouncedSync();
    });
    el.addEventListener('blur', () => flushDebouncedNoteSync());
  });

  // Column resize handles (mouse + touch)
  container.querySelectorAll('.notes-col-resize').forEach((handle) => {
    const startDrag = (startX: number) => {
      const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
      if (!tbl) return;
      const colIdx = parseInt((handle as HTMLElement).dataset.resizeCol!);
      const cols = tbl.querySelectorAll('colgroup col');
      const colL = cols[colIdx] as HTMLElement;
      const colR = cols[colIdx + 1] as HTMLElement;
      if (!colL || !colR) return;
      const tblW = tbl.getBoundingClientRect().width;
      const startLPct = parseFloat(colL.style.width) || (100 / cols.length);
      const startRPct = parseFloat(colR.style.width) || (100 / cols.length);
      const sumPct = startLPct + startRPct;
      const minPct = 8; // minimum column width %

      const onMove = (clientX: number) => {
        const dx = clientX - startX;
        const dxPct = (dx / tblW) * 100;
        let newL = startLPct + dxPct;
        let newR = startRPct - dxPct;
        if (newL < minPct) { newL = minPct; newR = sumPct - minPct; }
        if (newR < minPct) { newR = minPct; newL = sumPct - minPct; }
        colL.style.width = newL.toFixed(2) + '%';
        colR.style.width = newR.toFixed(2) + '%';
      };

      const onEnd = () => {
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('touchmove', onTouchMove);
        document.removeEventListener('touchend', onTouchEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        saveNotesTableFromDOM(tbl);
        bumpRenderTick();
        flushDebouncedNoteSync();
      };

      const onMouseMove = (e: MouseEvent) => { e.preventDefault(); onMove(e.clientX); };
      const onMouseUp = () => onEnd();
      const onTouchMove = (e: TouchEvent) => { e.preventDefault(); onMove(e.touches[0].clientX); };
      const onTouchEnd = () => onEnd();

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('touchmove', onTouchMove, { passive: false });
      document.addEventListener('touchend', onTouchEnd);
    };

    handle.addEventListener('mousedown', (e: Event) => { e.preventDefault(); startDrag((e as MouseEvent).clientX); });
    handle.addEventListener('touchstart', (e: Event) => { e.preventDefault(); startDrag((e as TouchEvent).touches[0].clientX); }, { passive: false });
  });

  // Add row
  container.querySelectorAll('[data-notes-addrow]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fn = ensureFrameNote(fid);
      // Save current DOM state first
      const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
      if (tbl) saveNotesTableFromDOM(tbl);
      const colCount = fn.tableData.headers.length;
      fn.tableData.rows.push(new Array(colCount).fill(''));
      bumpRenderTick();
      renderNotesCard(container, fid);
      flushDebouncedNoteSync();
    });
  });

  // Add column
  container.querySelectorAll('[data-notes-addcol]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fn = ensureFrameNote(fid);
      // Save current DOM state first
      const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
      if (tbl) saveNotesTableFromDOM(tbl);
      fn.tableData.headers.push('');
      for (const row of fn.tableData.rows) {
        row.push('');
      }
      bumpRenderTick();
      renderNotesCard(container, fid);
      flushDebouncedNoteSync();
    });
  });

  // Remove last row
  container.querySelectorAll('[data-notes-delrow]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fn = ensureFrameNote(fid);
      const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
      if (tbl) saveNotesTableFromDOM(tbl);
      if (fn.tableData.rows.length > 1) {
        fn.tableData.rows.pop();
        bumpRenderTick();
        renderNotesCard(container, fid);
        flushDebouncedNoteSync();
      }
    });
  });

  // Remove last column
  container.querySelectorAll('[data-notes-delcol]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fn = ensureFrameNote(fid);
      const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
      if (tbl) saveNotesTableFromDOM(tbl);
      if (fn.tableData.headers.length > 1) {
        fn.tableData.headers.pop();
        for (const row of fn.tableData.rows) row.pop();
        if (fn.tableData.colWidths) fn.tableData.colWidths.pop();
        bumpRenderTick();
        renderNotesCard(container, fid);
        flushDebouncedNoteSync();
      }
    });
  });

  // Copy / Paste / Reset action buttons
  container.querySelectorAll('[data-notes-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = (btn as HTMLElement).dataset.notesAct!;
      const fn = ensureFrameNote(fid);

      if (action === 'copy') {
        // Save current DOM state before copying
        if (fn.mode === 'table') {
          const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
          if (tbl) saveNotesTableFromDOM(tbl);
        } else {
          const ta = container.querySelector('.notes-textarea') as HTMLTextAreaElement | null;
          if (ta) fn.noteText = ta.value;
        }
        _copiedNoteState = {
          mode: fn.mode,
          noteText: fn.noteText,
          tableData: { headers: [...fn.tableData.headers], rows: fn.tableData.rows.map((r) => [...r]) },
        };
        rerenderAllNotesCards();
        const newBtn = container.querySelector('[data-notes-act="copy"]') as HTMLElement | null;
        if (newBtn) {
          newBtn.textContent = 'Copied!';
          newBtn.style.background = '#888';
          newBtn.style.color = '#fff';
          setTimeout(() => { newBtn.textContent = 'Copy Note'; newBtn.style.background = ''; newBtn.style.color = ''; }, 600);
        }
        return;
      }

      if (action === 'paste' && _copiedNoteState) {
        fn.mode = _copiedNoteState.mode;
        fn.noteText = _copiedNoteState.noteText;
        fn.tableData = { headers: [..._copiedNoteState.tableData.headers], rows: _copiedNoteState.tableData.rows.map((r) => [...r]) };
        bumpRenderTick();
        renderNotesCard(container, fid);
        flushDebouncedNoteSync();
        return;
      }

      if (action === 'reset') {
        fn.mode = 'note';
        fn.noteText = '';
        fn.tableData = { headers: ['', '', ''], rows: [['', '', ''], ['', '', ''], ['', '', '']] };
        bumpRenderTick();
        renderNotesCard(container, fid);
        flushDebouncedNoteSync();
        return;
      }
    });
  });

  // Table Settings button
  container.querySelectorAll('[data-notes-tblsettings]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const fn = ensureFrameNote(fid);
      // Save current DOM state first
      const tbl = container.querySelector('.notes-table[data-notes-tblfid]') as HTMLElement | null;
      if (tbl) saveNotesTableFromDOM(tbl);
      openTableSettingsModal(fid, fn);
    });
  });

  // Label editing via modal (project-wide rename, matches needs pattern)
  container.querySelectorAll('[data-notes-editlabel]').forEach((el) => {
    el.addEventListener('click', async () => {
      const s = state();
      const f = s.frames.find((fr) => fr.id === fid);
      if (!f) return;
      const fn = ensureFrameNote(fid);
      const result = await showVerLabelEdit(f.label || String(fid), fn.label);
      if (result === null) return;
      // Update label on ALL frames' notes (project-wide rename)
      const allNotes = s.frameNotes;
      for (const key of Object.keys(allNotes)) {
        allNotes[+key].label = result;
      }
      bumpRenderTick();
      rerenderAllNotesCards();
      flushDebouncedNoteSync();
    });
  });
}

/** Open Table Settings modal — share table structure across all notes. */
function openTableSettingsModal(sourceFid: number, sourceFn: FrameNoteState): void {
  let includeFirstRow = true;
  let includeFirstCol = true;

  // Build overlay
  const overlay = document.createElement('div');
  overlay.className = 'notes-tbl-settings-overlay';

  const renderModal = () => {
    overlay.innerHTML = `
      <div class="notes-tbl-settings-modal">
        <p class="notes-tbl-settings-desc">Share this table's rows &amp; columns in other notes</p>
        <label class="notes-tbl-settings-opt">
          <span class="notes-tbl-settings-dot${includeFirstRow ? ' on' : ''}" data-tblset="row"></span>
          <span>Include first row's text</span>
        </label>
        <label class="notes-tbl-settings-opt">
          <span class="notes-tbl-settings-dot${includeFirstCol ? ' on' : ''}" data-tblset="col"></span>
          <span>Include first column's text</span>
        </label>
        <div class="notes-tbl-settings-btns">
          <button class="act-btn" data-tblset-action="ok">OK</button>
          <button class="act-btn" data-tblset-action="cancel">Cancel</button>
        </div>
      </div>
    `;
    // Wire toggles
    overlay.querySelectorAll('[data-tblset]').forEach((dot) => {
      dot.addEventListener('click', () => {
        const which = (dot as HTMLElement).dataset.tblset;
        if (which === 'row') includeFirstRow = !includeFirstRow;
        if (which === 'col') includeFirstCol = !includeFirstCol;
        renderModal();
      });
    });
    // Wire OK / Cancel
    overlay.querySelector('[data-tblset-action="cancel"]')?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('[data-tblset-action="ok"]')?.addEventListener('click', () => {
      applyTableStructure(sourceFid, sourceFn, includeFirstRow, includeFirstCol);
      overlay.remove();
    });
  };

  renderModal();
  document.body.appendChild(overlay);
}

/** Apply table structure from source note to all other notes in the project. */
function applyTableStructure(sourceFid: number, sourceFn: FrameNoteState, includeFirstRow: boolean, includeFirstCol: boolean): void {
  const s = state();
  const td = sourceFn.tableData;
  const colCount = td.headers.length;
  const rowCount = td.rows.length;
  const colWidths = td.colWidths ? [...td.colWidths] : undefined;

  for (const f of s.frames) {
    if (f.id === sourceFid) continue;
    const fn = ensureFrameNote(f.id);
    // Copy table structure but keep current mode (don't force table view)
    // Build new table data with same structure
    const newHeaders: string[] = [];
    for (let c = 0; c < colCount; c++) {
      if (includeFirstRow) {
        newHeaders.push(td.headers[c]);
      } else {
        newHeaders.push(fn.tableData.headers[c] ?? '');
      }
    }
    const newRows: string[][] = [];
    for (let r = 0; r < rowCount; r++) {
      const row: string[] = [];
      for (let c = 0; c < colCount; c++) {
        if (c === 0 && includeFirstCol) {
          row.push(td.rows[r]?.[0] ?? '');
        } else {
          // Preserve existing content if it exists at this position
          row.push(fn.tableData.rows[r]?.[c] ?? '');
        }
      }
      newRows.push(row);
    }
    fn.tableData = { headers: newHeaders, rows: newRows, colWidths: colWidths ? [...colWidths] : undefined };
  }

  bumpRenderTick();
  rerenderAllNotesCards();
  flushDebouncedNoteSync();
}

function bumpRenderTick() {
  const s = state();
  useStore.setState({ renderTick: s.renderTick + 1 });
}

/** Re-render every visible notes card. */
export function rerenderAllNotesCards() {
  bumpRenderTick();
  document.querySelectorAll('.notes-card[data-notes-fid]').forEach((el) => {
    const fid = parseInt((el as HTMLElement).dataset.notesFid!);
    if (!isNaN(fid)) renderNotesCard(el as HTMLElement, fid);
  });
}

/** Check if a frame has any note content (for has-content indicator). */
export function frameHasNoteContent(fid: number): boolean {
  const fn = state().frameNotes[fid];
  if (!fn) return false;
  if (fn.noteText.length > 0) return true;
  // Check table for user-entered content only — skip headers (first row)
  // and first column since those can be copied via Table Settings.
  const td = fn.tableData;
  for (let r = 0; r < td.rows.length; r++) {
    for (let c = 1; c < td.rows[r].length; c++) {
      if (td.rows[r][c].length > 0) return true;
    }
  }
  return false;
}

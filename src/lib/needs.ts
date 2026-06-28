/**
 * Needs strip — renders inline needs cards in its own column.
 * Handles toggles, counters, tab switching, memos, location, setup pill.
 */

import { state, useStore, createDefaultFrameNeedState } from '../store/state';
import type { FrameNeedState, NeedTable } from '../store/state';
import { showVerLabelEdit } from './modals';

// ─── Helpers ──────────────────────────────────────────────────────────

/** Ensure per-frame need state exists (lazy init). */
export function ensureFrameNeeds(fid: number): FrameNeedState {
  const s = state();
  if (!s.frameNeeds[fid]) {
    s.frameNeeds[fid] = createDefaultFrameNeedState();
  }
  return s.frameNeeds[fid];
}

/** Debounced sync helper — calls flushSyncNow after 5 s inactivity. */
let _debounceSyncTimer: ReturnType<typeof setTimeout> | null = null;
export function debouncedSync() {
  if (_debounceSyncTimer) clearTimeout(_debounceSyncTimer);
  _debounceSyncTimer = setTimeout(() => {
    _debounceSyncTimer = null;
    const flush = (window as any).__fh_flushSyncNow;
    if (flush) flush();
  }, 5000);
}

/** Flush the debounced sync immediately (call on Enter / blur). */
export function flushDebouncedSync() {
  if (_debounceSyncTimer) {
    clearTimeout(_debounceSyncTimer);
    _debounceSyncTimer = null;
  }
  const flush = (window as any).__fh_flushSyncNow;
  if (flush) flush();
}

// ─── Render ───────────────────────────────────────────────────────────

/** Build the full needs card HTML for a frame. */
export function buildNeedsCard(fid: number): HTMLElement {
  const div = document.createElement('div');
  div.className = 'needs-card';
  div.dataset.needsFid = String(fid);
  renderNeedsCard(div, fid);
  return div;
}

/** Render / re-render needs card content. */
export function renderNeedsCard(div: HTMLElement, fid: number): void {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  if (!f) return;

  const ft = ensureFrameNeeds(fid);
  const defs = s.needDefinitions;
  const activeTab = defs.tabs.find((t) => t.id === ft.activeTabId) || defs.tabs[0];
  if (!activeTab) {
    div.innerHTML = '<div class="needs-empty">No tabs defined</div>';
    return;
  }

  // Frame label (e.g. "3B") in red
  const frameLabel = f.label || String(fid);

  // Tab bar
  const tabsHTML = defs.tabs.map((tab) => {
    const isActive = tab.id === activeTab.id;
    return `<button class="needs-tab${isActive ? ' needs-tab-active' : ''}" data-needs-tab="${tab.id}" data-needs-fid="${fid}">${escapeHtml(tab.name)}</button>`;
  }).join('');

  // Tables for active tab
  const tablesHTML = activeTab.tables.map((table) => renderTable(fid, ft, table)).join('');

  // Location toggles
  const locationHTML = defs.locations.length ? renderLocationSection(fid, ft, defs) : '';

  // Setup pill
  const setupHTML = renderSetupPill(fid, f, s);

  // Memo for this tab
  const memoText = ft.memos[activeTab.id] || '';

  div.innerHTML = `
    <div class="needs-header">
      <span class="frame-label-tag needs-label-combo" data-needs-editlabel="${fid}">${escapeHtml(frameLabel)}&thinsp;<span class="needs-label-part">${escapeHtml(ft.label)}</span></span>
    </div>
    <div class="needs-tabs">${tabsHTML}</div>
    <div class="needs-body">
      <div class="needs-tables">${tablesHTML}</div>
    </div>
    <div class="needs-bottom">
      <div class="needs-bottom-left">
        ${locationHTML}
        ${setupHTML}
      </div>
      <div class="needs-bottom-right">
        <div class="needs-memo">
          <textarea class="needs-memo-input" data-needs-memo="${fid}" data-needs-memo-tab="${activeTab.id}" placeholder="memo" spellcheck="false" autocomplete="one-time-code">${escapeHtml(memoText)}</textarea>
        </div>
      </div>
    </div>
  `;

  wireNeedsCard(div, fid);
}

/** Render a single table (toggle or counter type). */
function renderTable(fid: number, ft: FrameNeedState, table: NeedTable): string {
  // Sort items: toggled-ON first, then OFF
  const sortedItems = [...table.items].sort((a, b) => {
    const aOn = table.type === 'toggle' ? (ft.toggles[a.id] || false) : ((ft.counters[a.id] || 0) > 0);
    const bOn = table.type === 'toggle' ? (ft.toggles[b.id] || false) : ((ft.counters[b.id] || 0) > 0);
    if (aOn && !bOn) return -1;
    if (!aOn && bOn) return 1;
    return 0;
  });

  let dividerInserted = false;
  const rowsHTML = sortedItems.map((item) => {
    const isOn = table.type === 'counter'
      ? (ft.counters[item.id] || 0) > 0
      : (ft.toggles[item.id] || false);

    // Insert divider between last ON and first OFF item
    let divider = '';
    if (!isOn && !dividerInserted) {
      // Only show divider if at least one item before this was ON
      const hasAnyOn = sortedItems.some((i) =>
        table.type === 'counter' ? (ft.counters[i.id] || 0) > 0 : (ft.toggles[i.id] || false)
      );
      if (hasAnyOn) divider = '<div class="needs-divider"></div>';
      dividerInserted = true;
    }

    if (table.type === 'counter') {
      const count = ft.counters[item.id] || 0;
      return `${divider}
        <div class="needs-row${isOn ? ' needs-row-on' : ''}">
          <button class="needs-delete-x" data-needs-deleteitem="${item.id}" data-needs-deletetable="${table.id}">&times;</button>
          <input type="number" class="needs-counter-input" data-needs-counter="${item.id}" data-needs-fid="${fid}" value="${count}" min="0" max="999" autocomplete="one-time-code">
          <span class="needs-item-name" data-needs-itemid="${item.id}" data-needs-tableid="${table.id}">${escapeHtml(item.name)}</span>
        </div>`;
    }
    return `${divider}
      <div class="needs-row${isOn ? ' needs-row-on' : ''}">
        <button class="needs-delete-x" data-needs-deleteitem="${item.id}" data-needs-deletetable="${table.id}">&times;</button>
        <button class="needs-dot${isOn ? ' needs-dot-on' : ''}" data-needs-toggle="${item.id}" data-needs-fid="${fid}"></button>
        <span class="needs-item-name" data-needs-itemid="${item.id}" data-needs-tableid="${table.id}">${escapeHtml(item.name)}</span>
      </div>`;
  }).join('');

  return `
    <div class="needs-table" data-needs-table="${table.id}">
      <div class="needs-table-header" data-needs-tableid="${table.id}">${escapeHtml(table.name)}</div>
      <div class="needs-table-rows">${rowsHTML}</div>
      <div class="needs-table-actions">
        <button class="needs-add-btn" data-needs-additem="${table.id}"></button>
        <button class="needs-remove-btn" data-needs-toggledelete="${table.id}"></button>
      </div>
    </div>`;
}

/** Render location toggle section. */
function renderLocationSection(fid: number, ft: FrameNeedState, defs: { locations: { id: string; name: string }[] }): string {
  const items = defs.locations.map((loc) => {
    const isOn = ft.locationToggles[loc.id] || false;
    return `<div class="needs-row${isOn ? ' needs-row-on' : ''}">
      <button class="needs-dot${isOn ? ' needs-dot-on' : ''}" data-needs-loctoggle="${loc.id}" data-needs-fid="${fid}"></button>
      <span class="needs-item-name">${escapeHtml(loc.name)}</span>
    </div>`;
  }).join('');
  return `<div class="needs-location">
    <div class="needs-table-header">LOCATION</div>
    ${items}
  </div>`;
}

/** Render setup pill (shows which setup this frame belongs to). */
function renderSetupPill(fid: number, f: any, s: any): string {
  if (!f.setupId) return '';
  const setup = s.setups.find((su: any) => su.id === f.setupId);
  if (!setup) return '';
  const col = setup.color || { hex: '#666' };
  return `<div class="needs-setup-pill" style="background:${col.hex}">${escapeHtml(setup.name)}</div>`;
}

// ─── Event Wiring ─────────────────────────────────────────────────────

function wireNeedsCard(container: HTMLElement, fid: number): void {
  // Tab switching
  container.querySelectorAll('[data-needs-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = (btn as HTMLElement).dataset.needsTab!;
      const ft = ensureFrameNeeds(fid);
      ft.activeTabId = tabId;
      bumpAndRerender(container, fid);
    });
  });

  // Toggle dots
  container.querySelectorAll('[data-needs-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const itemId = (btn as HTMLElement).dataset.needsToggle!;
      const ft = ensureFrameNeeds(fid);
      ft.toggles[itemId] = !ft.toggles[itemId];
      bumpAndRerender(container, fid);
      flushDebouncedSync();
    });
  });

  // Counter inputs
  container.querySelectorAll('[data-needs-counter]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const itemId = (inp as HTMLInputElement).dataset.needsCounter!;
      const val = Math.max(0, Math.min(999, parseInt((inp as HTMLInputElement).value) || 0));
      const ft = ensureFrameNeeds(fid);
      ft.counters[itemId] = val;
      bumpRenderTick();
      debouncedSync();
    });
    inp.addEventListener('blur', () => flushDebouncedSync());
    inp.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        (inp as HTMLInputElement).blur();
        flushDebouncedSync();
      }
    });
  });

  // Location toggles
  container.querySelectorAll('[data-needs-loctoggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const locId = (btn as HTMLElement).dataset.needsLoctoggle!;
      const ft = ensureFrameNeeds(fid);
      ft.locationToggles[locId] = !ft.locationToggles[locId];
      bumpAndRerender(container, fid);
      flushDebouncedSync();
    });
  });

  // Memo textarea
  container.querySelectorAll('[data-needs-memo]').forEach((ta) => {
    ta.addEventListener('input', () => {
      const tabId = (ta as HTMLTextAreaElement).dataset.needsMemoTab!;
      const ft = ensureFrameNeeds(fid);
      ft.memos[tabId] = (ta as HTMLTextAreaElement).value;
      debouncedSync();
    });
    ta.addEventListener('blur', () => flushDebouncedSync());
  });

  // Add item buttons
  container.querySelectorAll('[data-needs-additem]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tableId = (btn as HTMLElement).dataset.needsAdditem!;
      const defs = state().needDefinitions;
      // Find the table across all tabs
      for (const tab of defs.tabs) {
        const table = tab.tables.find((t) => t.id === tableId);
        if (table) {
          const newId = 'ti_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
          // Smart default: detect pattern from last item (e.g. "DAY 3" → "DAY 4")
          const lastItem = table.items[table.items.length - 1];
          let defaultName = `${table.name} ${table.items.length + 1}`;
          if (lastItem) {
            const m = lastItem.name.match(/^(.+?)[\s ]+(\d+)$/);
            if (m) {
              defaultName = `${m[1]} ${parseInt(m[2]) + 1}`;
            }
          }
          table.items.push({ id: newId, name: defaultName });
          // Re-render ALL visible needs cards (item is project-wide)
          rerenderAllNeedsCards();
          flushDebouncedSync();
          break;
        }
      }
    });
  });

  // Toggle delete mode — "-" button shows/hides × on rows
  container.querySelectorAll('[data-needs-toggledelete]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tableId = (btn as HTMLElement).dataset.needsToggledelete!;
      const tableEl = container.querySelector(`.needs-table[data-needs-table="${tableId}"]`);
      if (tableEl) tableEl.classList.toggle('needs-delete-mode');
    });
  });

  // Delete item — × button removes item from needDefinitions (project-wide)
  container.querySelectorAll('[data-needs-deleteitem]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const itemId = (btn as HTMLElement).dataset.needsDeleteitem!;
      const tableId = (btn as HTMLElement).dataset.needsDeletetable!;
      const defs = state().needDefinitions;
      for (const tab of defs.tabs) {
        const table = tab.tables.find((t) => t.id === tableId);
        if (table) {
          table.items = table.items.filter((i) => i.id !== itemId);
          break;
        }
      }
      rerenderAllNeedsCards();
      flushDebouncedSync();
    });
  });

  // Needs label editing via modal (matches version card behaviour)
  container.querySelectorAll('[data-needs-editlabel]').forEach((el) => {
    el.addEventListener('click', async () => {
      const s = state();
      const f = s.frames.find((fr) => fr.id === fid);
      if (!f) return;
      const ft = ensureFrameNeeds(fid);
      const result = await showVerLabelEdit(f.label || String(fid), ft.label);
      if (result === null) return;
      // Update label on ALL frames' needs (project-wide rename)
      const allNeeds = s.frameNeeds;
      for (const key of Object.keys(allNeeds)) {
        allNeeds[+key].label = result;
      }
      bumpRenderTick();
      rerenderAllNeedsCards();
      flushDebouncedSync();
    });
  });

  // Inline item name editing — click name span → input → save project-wide
  // Taps in the first 12px from the left edge are ignored (dead zone near toggle)
  container.querySelectorAll('.needs-item-name[data-needs-itemid]').forEach((span) => {
    span.addEventListener('click', (e) => {
      const el = span as HTMLElement;
      const rect = el.getBoundingClientRect();
      if ((e as MouseEvent).clientX - rect.left < 12) return; // too close to toggle
      if (el.querySelector('input')) return; // already editing
      const itemId = el.dataset.needsItemid!;
      const tableId = el.dataset.needsTableid!;
      const currentName = el.textContent || '';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'needs-inline-edit';
      input.value = currentName;
      input.autocomplete = 'one-time-code';
      input.spellcheck = false;

      el.textContent = '';
      el.appendChild(input);
      input.focus();
      input.select();

      const commit = () => {
        const newName = (input.value.trim() || currentName).toUpperCase();
        // Find item in needDefinitions and rename (project-wide)
        const defs = state().needDefinitions;
        for (const tab of defs.tabs) {
          const table = tab.tables.find((t) => t.id === tableId);
          if (table) {
            const item = table.items.find((i) => i.id === itemId);
            if (item) item.name = newName;
            break;
          }
        }
        rerenderAllNeedsCards();
        flushDebouncedSync();
      };

      let committed = false;
      input.addEventListener('blur', () => { if (!committed) { committed = true; commit(); } });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { committed = true; commit(); }
        if (e.key === 'Escape') { committed = true; el.textContent = currentName; }
      });
    });
  });

  // Inline table header editing — click header → input → save project-wide
  container.querySelectorAll('.needs-table-header[data-needs-tableid]').forEach((hdr) => {
    hdr.addEventListener('click', () => {
      const el = hdr as HTMLElement;
      if (el.querySelector('input')) return;
      const tableId = el.dataset.needsTableid!;
      const currentName = el.textContent || '';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'needs-inline-edit needs-inline-edit-header';
      input.value = currentName;
      input.autocomplete = 'one-time-code';
      input.spellcheck = false;

      el.textContent = '';
      el.appendChild(input);
      input.focus();
      input.select();

      const commit = () => {
        const newName = (input.value.trim() || currentName).toUpperCase();
        const defs = state().needDefinitions;
        for (const tab of defs.tabs) {
          const table = tab.tables.find((t) => t.id === tableId);
          if (table) { table.name = newName; break; }
        }
        rerenderAllNeedsCards();
        flushDebouncedSync();
      };

      let committed = false;
      input.addEventListener('blur', () => { if (!committed) { committed = true; commit(); } });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { committed = true; commit(); }
        if (e.key === 'Escape') { committed = true; el.textContent = currentName; }
      });
    });
  });

  // Inline tab name editing — double-click tab button → input → save project-wide
  container.querySelectorAll('[data-needs-tab]').forEach((btn) => {
    btn.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      const el = btn as HTMLElement;
      if (el.querySelector('input')) return;
      const tabId = el.dataset.needsTab!;
      const currentName = el.textContent || '';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'needs-inline-edit needs-inline-edit-tab';
      input.value = currentName;
      input.autocomplete = 'one-time-code';
      input.spellcheck = false;

      el.textContent = '';
      el.appendChild(input);
      input.focus();
      input.select();

      const commit = () => {
        const newName = (input.value.trim() || currentName).toUpperCase();
        const defs = state().needDefinitions;
        const tab = defs.tabs.find((t) => t.id === tabId);
        if (tab) tab.name = newName;
        rerenderAllNeedsCards();
        flushDebouncedSync();
      };

      let committed = false;
      input.addEventListener('blur', () => { if (!committed) { committed = true; commit(); } });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { committed = true; commit(); }
        if (e.key === 'Escape') { committed = true; el.textContent = currentName; }
      });
    });
  });
}

function bumpRenderTick() {
  const s = state();
  useStore.setState({ renderTick: s.renderTick + 1 });
}

function bumpAndRerender(container: HTMLElement, fid: number) {
  bumpRenderTick();
  renderNeedsCard(container, fid);
}

/** Re-render every visible needs card (needed when project-wide definitions change). */
function rerenderAllNeedsCards() {
  bumpRenderTick();
  document.querySelectorAll('.needs-card[data-needs-fid]').forEach((el) => {
    const fid = parseInt((el as HTMLElement).dataset.needsFid!);
    if (!isNaN(fid)) renderNeedsCard(el as HTMLElement, fid);
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

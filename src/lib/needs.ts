/**
 * Needs strip — renders inline needs cards in its own column.
 * Handles toggles, counters, tab switching, memos, location, setup pill.
 */

import { state, useStore, createDefaultFrameNeedState } from '../store/state';
import type { FrameNeedState, NeedTable } from '../store/state';

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
      <span class="needs-frame-label">${escapeHtml(frameLabel)}</span>
      <span class="needs-label" contenteditable="true" data-needs-labelinput="${fid}" spellcheck="false" autocomplete="one-time-code">${escapeHtml(ft.label)}</span>
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

  const rowsHTML = sortedItems.map((item) => {
    if (table.type === 'counter') {
      const count = ft.counters[item.id] || 0;
      const isOn = count > 0;
      return `
        <div class="needs-row${isOn ? ' needs-row-on' : ''}">
          <input type="number" class="needs-counter-input" data-needs-counter="${item.id}" data-needs-fid="${fid}" value="${count}" min="0" max="999" autocomplete="one-time-code">
          <span class="needs-item-name">${escapeHtml(item.name)}</span>
        </div>`;
    }
    const isOn = ft.toggles[item.id] || false;
    return `
      <div class="needs-row${isOn ? ' needs-row-on' : ''}">
        <button class="needs-dot${isOn ? ' needs-dot-on' : ''}" data-needs-toggle="${item.id}" data-needs-fid="${fid}"></button>
        <span class="needs-item-name">${escapeHtml(item.name)}</span>
      </div>`;
  }).join('');

  return `
    <div class="needs-table" data-needs-table="${table.id}">
      <div class="needs-table-header">${escapeHtml(table.name)}</div>
      <div class="needs-table-rows">${rowsHTML}</div>
      <button class="needs-add-btn" data-needs-additem="${table.id}">+</button>
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
          const defaultName = `${table.name} ${table.items.length + 1}`;
          table.items.push({ id: newId, name: defaultName });
          // Re-render ALL visible needs cards (item is project-wide)
          rerenderAllNeedsCards();
          flushDebouncedSync();
          break;
        }
      }
    });
  });

  // Frame label editing
  container.querySelectorAll('[data-needs-labelinput]').forEach((el) => {
    el.addEventListener('input', () => {
      const ft = ensureFrameNeeds(fid);
      ft.label = (el as HTMLElement).textContent?.trim() || 'needs';
      debouncedSync();
    });
    el.addEventListener('blur', () => flushDebouncedSync());
    el.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        e.preventDefault();
        (el as HTMLElement).blur();
        flushDebouncedSync();
      }
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

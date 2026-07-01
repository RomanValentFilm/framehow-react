// Sort Order — custom frame orderings for production scheduling.
// Imperative DOM pattern matching setups.ts.

import { state, useStore, bumpRenderTick, SETUP_COLORS } from '../store/state';
import type { SortOrder, SortBreak, Frame } from '../store/state';
import { flushSyncNow } from './currentProject';
import { getStripVersions } from './helpers';
import { getVisibleFrames } from './groups';
import { rasterizeVersion, versionHasContent } from './rasterize';

// ─── Helpers ──────────────────────────────────────────────────────────

function genId(prefix: string, n: number): string {
  return `${prefix}_${n}`;
}

/** Get frames in a sort order's sequence, filtered by active group. */
function getOrderedFrames(order: SortOrder): Frame[] {
  const s = state();
  const visible = new Set(getVisibleFrames().map((f) => f.id));
  const frameMap = new Map(s.frames.map((f) => [f.id, f]));
  const result: Frame[] = [];
  for (const fid of order.frameOrder) {
    const f = frameMap.get(fid);
    if (f && visible.has(f.id)) result.push(f);
  }
  return result;
}

// ─── Toggle dropdown ──────────────────────────────────────────────────

export function toggleSortDropdown(): void {
  const s = state();
  const dropdown = document.getElementById('sortDropdown');
  if (!dropdown) return;

  // If dropdown is already visible, just hide it
  if (dropdown.style.display !== 'none') {
    dropdown.style.display = 'none';
    dropdown.innerHTML = '';
    if (!s.sortEditingId) {
      // No frame-set view open — fully exit sort mode
      useStore.setState({ sortMode: false });
      document.getElementById('sortByBtn')?.classList.remove('active');
    }
    return;
  }

  // Close setup mode if open
  if (s.setupMode) {
    const setupBtn = document.getElementById('setupsBtn');
    if (setupBtn) setupBtn.click();
  }

  useStore.setState({ sortMode: true });

  // Deactivate all other buttons — only SORT BY should be active
  document.querySelectorAll('.view-btn.active, .strip-toggle.active').forEach((b) => {
    if ((b as HTMLElement).id !== 'sortByBtn') b.classList.remove('active');
  });

  const sortBtn = document.getElementById('sortByBtn');
  sortBtn?.classList.add('active');
  dropdown.style.display = '';

  // Position dropdown below the SORT BY button
  if (sortBtn) {
    const rect = sortBtn.getBoundingClientRect();
    dropdown.style.left = `${rect.left}px`;
    dropdown.style.top = `${rect.bottom}px`;
  }

  renderDropdown(dropdown);

  // Close on outside click
  setTimeout(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If edit view is now open, remove this handler — edit view has its own close logic
      const editView = document.getElementById('sortEditView');
      if (editView && editView.style.display !== 'none') {
        document.removeEventListener('click', handler);
        return;
      }
      if (!dropdown.contains(target) && target.id !== 'sortByBtn' && !target.closest('#sortByBtn')) {
        closeSortMode();
        document.removeEventListener('click', handler);
      }
    };
    document.addEventListener('click', handler);
  }, 10);
}

export function closeSortMode(): void {
  useStore.setState({ sortMode: false, sortEditingId: null });
  const dropdown = document.getElementById('sortDropdown');
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
  const editView = document.getElementById('sortEditView');
  if (editView) { editView.style.display = 'none'; editView.innerHTML = ''; }
  document.getElementById('sortByBtn')?.classList.remove('active');

  // Restore normal content
  const columns = document.querySelector('.columns') as HTMLElement | null;
  if (columns) columns.style.display = '';

  // Restore strip button active states
  const s = state();
  document.querySelectorAll('.strip-toggle').forEach((b) => {
    const strip = (b as HTMLElement).dataset.strip;
    if (strip && (s.activeStrips as string[]).includes(strip)) {
      b.classList.add('active');
    }
  });
  if (s.needsStripVisible) {
    document.getElementById('needsStripBtn')?.classList.add('active');
  }
}

// ─── Dropdown rendering ───────────────────────────────────────────────

function renderDropdown(el: HTMLElement): void {
  const s = state();
  const activeId = s.activeSortOrderId;

  // Find existing shooting order (if user already created one)
  const shootingOrder = s.sortOrders.find((o) => o.name === 'SHOOTING ORDER');
  const shootingId = shootingOrder ? shootingOrder.id : '__shooting_new__';

  let html = `<div class="sort-dd-inner">`;

  // Story flow (always first)
  html += `
    <div class="sort-dd-item${activeId === null ? ' sort-dd-selected' : ''}" data-sort-id="__storyflow__">
      <div class="sort-dd-item-left">
        <div class="sort-dd-title">STORY FLOW</div>
        <div class="sort-dd-hint">Your narrative sequence, as edited</div>
      </div>
    </div>`;

  // Shooting order (always visible)
  html += `
    <div class="sort-dd-item${activeId === shootingId ? ' sort-dd-selected' : ''}" data-sort-id="${shootingId}">
      <div class="sort-dd-item-left">
        <div class="sort-dd-title-row">
          <span class="sort-dd-title">SHOOTING ORDER</span>
          <span class="sort-dd-edit" data-sort-edit="${shootingId}">EDIT</span>
        </div>
        <div class="sort-dd-hint">Frame order as set in EDIT</div>
      </div>
    </div>`;

  // Other custom orders (exclude the default shooting order)
  for (const order of s.sortOrders.filter((o) => o.name !== 'SHOOTING ORDER')) {
    html += `
      <div class="sort-dd-item${activeId === order.id ? ' sort-dd-selected' : ''}" data-sort-id="${order.id}">
        <div class="sort-dd-item-left">
          <div class="sort-dd-title-row">
            <span class="sort-dd-title">${order.name}</span>
            <span class="sort-dd-edit" data-sort-edit="${order.id}">EDIT</span>
          </div>
          <div class="sort-dd-hint">Frame order as set in EDIT</div>
        </div>
      </div>`;
  }

  // Add order
  html += `
    <div class="sort-dd-item sort-dd-add" data-sort-action="add">
      <span>+ ADD ORDER</span>
    </div>`;

  html += `</div>`;
  el.innerHTML = html;

  // Wire events — clicking any order opens its frame-set view
  el.querySelectorAll('.sort-dd-item[data-sort-id]').forEach((item) => {
    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('sort-dd-edit') || target.closest('.sort-dd-edit')) return;
      const id = (item as HTMLElement).dataset.sortId!;
      openOrderView(id);
    });
  });

  el.querySelectorAll('.sort-dd-edit').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const orderId = (btn as HTMLElement).dataset.sortEdit!;
      openOrderView(orderId);
    });
  });

  el.querySelector('.sort-dd-add')?.addEventListener('click', () => {
    addNewOrder();
  });
}

/** Open frame-set view for any order — handles story flow + auto-creates shooting order */
function openOrderView(orderId: string): void {
  if (orderId === '__shooting_new__') {
    // Auto-create shooting order on first click
    const s = state();
    const id = genId('sort', s.nextSortOrderId);
    const frameOrder = getVisibleFrames().map((f) => f.id);
    const newOrder: SortOrder = {
      id,
      name: 'SHOOTING ORDER',
      description: 'Frame order as set in EDIT',
      frameOrder,
      breaks: [],
    };
    useStore.setState({
      sortOrders: [...s.sortOrders, newOrder],
      activeSortOrderId: id,
      nextSortOrderId: s.nextSortOrderId + 1,
    });
    bumpRenderTick();
    void flushSyncNow();
    openSortEditView(id);
    return;
  }

  if (orderId === '__storyflow__') {
    useStore.setState({ activeSortOrderId: null });
  } else {
    useStore.setState({ activeSortOrderId: orderId });
  }
  bumpRenderTick();
  void flushSyncNow();
  openSortEditView(orderId);
}

// ─── Add new order ────────────────────────────────────────────────────

function addNewOrder(): void {
  const s = state();
  const id = genId('sort', s.nextSortOrderId);
  const frameOrder = getVisibleFrames().map((f) => f.id);
  const newOrder: SortOrder = {
    id,
    name: 'SHOOTING ORDER',
    description: 'Frame order as set in EDIT',
    frameOrder,
    breaks: [],
  };
  useStore.setState({
    sortOrders: [...s.sortOrders, newOrder],
    activeSortOrderId: id,
    nextSortOrderId: s.nextSortOrderId + 1,
  });
  bumpRenderTick();
  void flushSyncNow();

  // Open edit view for the new order
  openSortEditView(id);
}

// ─── Sort edit view (frame sets) ──────────────────────────────────────

function openSortEditView(orderId: string): void {
  const dropdown = document.getElementById('sortDropdown');
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }

  const editView = document.getElementById('sortEditView');
  if (!editView) return;

  // Hide normal content (columns area)
  const columns = document.querySelector('.columns') as HTMLElement | null;
  if (columns) columns.style.display = 'none';

  useStore.setState({ sortEditingId: orderId });
  editView.style.display = '';
  window.scrollTo(0, 0); // Start at top so toolbar is visible
  renderSortEditView(editView, orderId);
}

function renderSortEditView(el: HTMLElement, orderId: string): void {
  const s = state();

  let frames: Frame[];
  let order: SortOrder | null = null;
  let orderName: string;

  if (orderId === '__storyflow__') {
    frames = getVisibleFrames();
    orderName = 'STORY FLOW';
  } else {
    order = s.sortOrders.find((o) => o.id === orderId) || null;
    if (!order) { closeSortMode(); return; }
    frames = getOrderedFrames(order);
    orderName = order.name;
  }

  const activeReorderFid = (el as any).__activeReorderFid as number | null ?? null;

  let html = `<div class="sort-edit-inner">`;

  // Header — breadcrumb only, no DONE button (exit via SORT BY or other view buttons)
  html += `
    <div class="sort-edit-header">
      <div class="sort-edit-header-left">
        <span class="sort-edit-label">SORT BY</span>
        <span class="sort-edit-sep">&rsaquo;</span>
        ${orderId === '__storyflow__'
          ? `<span class="sort-edit-name-static">${orderName}</span>`
          : `<input class="sort-edit-name" value="${orderName}" data-sort-rename="${orderId}" />`
        }
      </div>
    </div>`;

  // Frame sets
  let orderIdx = 0;
  for (const f of frames) {
    // Check for breaks before this position (custom orders only)
    if (order) {
      const breaksHere = order.breaks.filter((b) => b.position === orderIdx);
      for (const brk of breaksHere) {
        html += renderBreakCard(brk, activeReorderFid);
      }
    }

    html += renderFrameSetCard(f, orderIdx, activeReorderFid);
    orderIdx++;
  }

  // Trailing breaks (custom orders only)
  if (order) {
    const trailingBreaks = order.breaks.filter((b) => b.position >= orderIdx);
    for (const brk of trailingBreaks) {
      html += renderBreakCard(brk, activeReorderFid);
    }
  }

  // Add break button (custom orders only)
  if (order) {
    html += `
      <div class="sort-edit-footer">
        <button class="sort-edit-add-break" data-sort-action="addbreak">+ Add break</button>
      </div>`;
  }

  html += `</div>`;
  el.innerHTML = html;

  // Wire events
  wireEditViewEvents(el, orderId);

  // Fill in sketch images that need rasterization (async, non-blocking)
  void fillSketchImages(el);
}

function renderFrameSetCard(f: Frame, idx: number, activeReorderFid: number | null): string {
  const s = state();
  const isActive = activeReorderFid === f.id;
  const setup = f.setupId ? s.setups.find((su) => su.id === f.setupId) : null;
  const setupColor = setup ? SETUP_COLORS[setup.colorIndex]?.hex || '#999' : '';
  const setupName = setup ? setup.name : '';

  // Get first version image and first sketch image
  const verVersions = getStripVersions(f.id, 'ver');
  const sketchVersions = getStripVersions(f.id, 'floor');
  const verImg = verVersions?.[0]?.bgImage || '';
  const sketchVer = sketchVersions?.[0];
  const sketchImg = sketchVer?.bgImage || '';
  const sketchHasStrokes = !sketchImg && versionHasContent(sketchVer);

  // Get frame text content (from strokes text type)
  const textStroke = (f.strokes || []).find((st: any) => st.type === 'text');
  const descText = textStroke ? (textStroke as any).text || '' : (f.textContent || '');

  // Parse label — number part vs extra text
  const labelParts = f.label.match(/^(\d+[A-Za-z]?\.?)\s*(.*)/);
  const labelNum = labelParts ? labelParts[1] : f.label;
  const labelExtra = labelParts ? labelParts[2] : '';

  // Needs info (simplified — show toggled-on items)
  const needsHtml = renderNeedsInfo(f.id);

  return `
    <div class="sort-card${isActive ? ' sort-card-active' : ''}" data-sort-fid="${f.id}" data-sort-idx="${idx}">
      <div class="sort-card-grid">
        <div class="sort-card-col-num">
          <span class="sort-card-num">${labelNum}</span>
          ${labelExtra ? `<span class="sort-card-extra">${labelExtra}</span>` : ''}
          ${setupName ? `<span class="sort-card-pill" style="background:${setupColor}">${setupName}</span>` : ''}
        </div>
        <div class="sort-card-col-main">
          <div class="sort-card-main-img">
            ${f.src ? `<img src="${f.src}" />` : `<div class="sort-card-empty">MAIN</div>`}
          </div>
          <div class="sort-card-desc">${descText}</div>
        </div>
        <div class="sort-card-col-strips">
          <div class="sort-card-strip-img">
            ${verImg ? `<img src="${verImg}" />` : `<div class="sort-card-empty">VERSN</div>`}
          </div>
          <div class="sort-card-strip-img" ${sketchHasStrokes ? `data-sketch-fid="${f.id}"` : ''}>
            ${sketchImg ? `<img src="${sketchImg}" />` : sketchHasStrokes ? `<div class="sort-card-empty sort-sketch-placeholder">SKETCH</div>` : `<div class="sort-card-empty">SKETCH</div>`}
          </div>
        </div>
        <div class="sort-card-col-needs">${needsHtml}</div>
        <div class="sort-card-col-arrows${isActive ? ' sort-col-active' : ''}">
          ${isActive
            ? `<span class="sort-arrow" data-sort-move="up" data-sort-fid="${f.id}">&#9650;</span>
               <span class="sort-done-btn" data-sort-deactivate="${f.id}">DONE</span>
               <span class="sort-arrow" data-sort-move="down" data-sort-fid="${f.id}">&#9660;</span>`
            : `<button class="sort-arrows-combined" data-sort-activate="${f.id}">
                 <span>&#9650;</span><span>&#9660;</span>
               </button>`
          }
        </div>
      </div>
    </div>`;
}

function renderBreakCard(brk: SortBreak, activeReorderFid: number | null): string {
  return `
    <div class="sort-break-card" data-break-id="${brk.id}">
      <div class="sort-break-left">
        <span class="sort-break-icon">&#9749;</span>
        <input class="sort-break-text" value="${brk.text}" data-break-rename="${brk.id}" />
      </div>
      <div class="sort-break-arrows">
        <span class="sort-arrow" data-break-move="up" data-break-id="${brk.id}">&#9650;</span>
        <span class="sort-arrow" data-break-move="down" data-break-id="${brk.id}">&#9660;</span>
      </div>
    </div>`;
}

function renderNeedsInfo(fid: number): string {
  const s = state();
  const frameNeeds = s.frameNeeds[fid];
  if (!frameNeeds) return '';

  const defs = s.needDefinitions;
  const tabs = defs.tabs || [];
  if (tabs.length === 0) return '';

  // Split tabs into two sub-columns
  const midpoint = Math.ceil(tabs.length / 2);
  const col1Tabs = tabs.slice(0, midpoint);
  const col2Tabs = tabs.slice(midpoint);

  const renderColumn = (columnTabs: typeof tabs): string => {
    let lines = '';
    for (const tab of columnTabs) {
      for (const table of tab.tables) {
        if (table.type === 'counter') {
          // Counter type — show total and breakdown
          const items: { name: string; count: number }[] = [];
          let total = 0;
          for (const item of table.items) {
            const count = frameNeeds.counters?.[item.id] || 0;
            if (count > 0) {
              items.push({ name: item.name, count });
              total += count;
            }
          }
          if (items.length > 0) {
            const breakdown = items.map((i) => `${i.count} ${i.name}`).join(' + ');
            lines += `<div class="sort-needs-line"><span class="sort-needs-cat-name">${table.name}</span>${total} (${breakdown})</div>`;
          }
        } else {
          // Toggle type — show comma-separated active items
          const onItems: string[] = [];
          for (const item of table.items) {
            if (frameNeeds.toggles?.[item.id]) {
              onItems.push(item.name);
            }
          }
          if (onItems.length > 0) {
            lines += `<div class="sort-needs-line"><span class="sort-needs-cat-name">${table.name}</span>${onItems.join(', ')}</div>`;
          }
        }
      }
    }
    return lines;
  };

  const col1Html = renderColumn(col1Tabs);
  const col2Html = renderColumn(col2Tabs);
  if (!col1Html && !col2Html) return '';

  let html = `<div class="sort-needs-cols">`;
  html += `<div class="sort-needs-col">${col1Html}</div>`;
  if (col2Html) {
    html += `<div class="sort-needs-col">${col2Html}</div>`;
  }
  html += `</div>`;
  return html;
}

/** Async: rasterize sketch strokes for cards that need it */
async function fillSketchImages(el: HTMLElement): Promise<void> {
  const containers = el.querySelectorAll('[data-sketch-fid]');
  for (const container of Array.from(containers)) {
    const fid = parseInt((container as HTMLElement).dataset.sketchFid!, 10);
    const f = state().frames.find((fr) => fr.id === fid);
    if (!f) continue;
    const vers = getStripVersions(fid, 'floor');
    const ver = vers?.[0];
    if (!ver) continue;
    try {
      const canvas = await rasterizeVersion(ver, f.cropW || 960, f.cropH || 540, 1);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      // Replace placeholder with rasterized image
      const placeholder = container.querySelector('.sort-sketch-placeholder');
      if (placeholder) placeholder.remove();
      const img = document.createElement('img');
      img.src = dataUrl;
      container.appendChild(img);
    } catch { /* skip if rasterization fails */ }
  }
}

// ─── Edit view event wiring ───────────────────────────────────────────

function wireEditViewEvents(el: HTMLElement, orderId: string): void {
  // Rename order
  const nameInput = el.querySelector('.sort-edit-name') as HTMLInputElement | null;
  if (nameInput) {
    nameInput.addEventListener('change', () => {
      const s = state();
      const orders = s.sortOrders.map((o) =>
        o.id === orderId ? { ...o, name: nameInput.value } : o
      );
      useStore.setState({ sortOrders: orders });
      bumpRenderTick();
      void flushSyncNow();
    });
  }

  // Combined button — activate card for reordering
  el.querySelectorAll('[data-sort-activate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fid = parseInt((btn as HTMLElement).dataset.sortActivate!, 10);
      (el as any).__activeReorderFid = fid;
      renderSortEditView(el, orderId);
    });
  });

  // Arrow clicks — move frame up/down (only shown when active)
  el.querySelectorAll('.sort-arrow[data-sort-move]').forEach((arrow) => {
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      const dir = (arrow as HTMLElement).dataset.sortMove!;
      const fid = parseInt((arrow as HTMLElement).dataset.sortFid!, 10);
      moveFrame(orderId, fid, dir as 'up' | 'down');
      renderSortEditView(el, orderId);
    });
  });

  // Done button on active card
  el.querySelectorAll('[data-sort-deactivate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      (el as any).__activeReorderFid = null;
      renderSortEditView(el, orderId);
    });
  });

  // Add break
  el.querySelector('[data-sort-action="addbreak"]')?.addEventListener('click', () => {
    addBreak(orderId);
    renderSortEditView(el, orderId);
  });

  // Break rename
  el.querySelectorAll('.sort-break-text').forEach((input) => {
    (input as HTMLInputElement).addEventListener('change', () => {
      const brkId = (input as HTMLElement).dataset.breakRename!;
      const s = state();
      const orders = s.sortOrders.map((o) => {
        if (o.id !== orderId) return o;
        return {
          ...o,
          breaks: o.breaks.map((b) =>
            b.id === brkId ? { ...b, text: (input as HTMLInputElement).value } : b
          ),
        };
      });
      useStore.setState({ sortOrders: orders });
      bumpRenderTick();
      void flushSyncNow();
    });
  });

  // Break move
  el.querySelectorAll('.sort-arrow[data-break-move]').forEach((arrow) => {
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      const dir = (arrow as HTMLElement).dataset.breakMove!;
      const brkId = (arrow as HTMLElement).dataset.breakId!;
      moveBreak(orderId, brkId, dir as 'up' | 'down');
      renderSortEditView(el, orderId);
    });
  });

  // Drag & drop
  setupDragAndDrop(el, orderId);
}

// ─── Reorder logic ────────────────────────────────────────────────────

function moveFrame(orderId: string, fid: number, dir: 'up' | 'down'): void {
  const s = state();
  if (orderId === '__storyflow__') {
    // Move in actual frames array
    const frames = [...s.frames];
    const idx = frames.findIndex((f) => f.id === fid);
    if (idx < 0) return;
    const newIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= frames.length) return;
    [frames[idx], frames[newIdx]] = [frames[newIdx], frames[idx]];
    useStore.setState({ frames });
    bumpRenderTick();
    void flushSyncNow();
    return;
  }
  const orders = s.sortOrders.map((o) => {
    if (o.id !== orderId) return o;
    const arr = [...o.frameOrder];
    const idx = arr.indexOf(fid);
    if (idx < 0) return o;
    const newIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= arr.length) return o;
    [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
    return { ...o, frameOrder: arr };
  });
  useStore.setState({ sortOrders: orders });
  bumpRenderTick();
  void flushSyncNow();
}

function addBreak(orderId: string): void {
  const s = state();
  const order = s.sortOrders.find((o) => o.id === orderId);
  if (!order) return;
  const breakId = `brk_${Date.now()}`;
  const position = order.frameOrder.length; // add at end
  const newBreak: SortBreak = { id: breakId, text: 'BREAK', position };
  const orders = s.sortOrders.map((o) =>
    o.id === orderId ? { ...o, breaks: [...o.breaks, newBreak] } : o
  );
  useStore.setState({ sortOrders: orders });
  bumpRenderTick();
  void flushSyncNow();
}

function moveBreak(orderId: string, breakId: string, dir: 'up' | 'down'): void {
  const s = state();
  const orders = s.sortOrders.map((o) => {
    if (o.id !== orderId) return o;
    return {
      ...o,
      breaks: o.breaks.map((b) => {
        if (b.id !== breakId) return b;
        const newPos = dir === 'up' ? b.position - 1 : b.position + 1;
        return { ...b, position: Math.max(0, Math.min(o.frameOrder.length, newPos)) };
      }),
    };
  });
  useStore.setState({ sortOrders: orders });
  bumpRenderTick();
  void flushSyncNow();
}

// ─── Drag & drop ──────────────────────────────────────────────────────

function setupDragAndDrop(el: HTMLElement, orderId: string): void {
  const cards = el.querySelectorAll('.sort-card');
  cards.forEach((card) => {
    const cardEl = card as HTMLElement;
    let startY = 0;
    let dragging = false;
    let dragClone: HTMLElement | null = null;

    const onStart = (clientY: number) => {
      startY = clientY;
      dragging = false;

      const onMove = (moveY: number) => {
        if (!dragging && Math.abs(moveY - startY) > 8) {
          dragging = true;
          cardEl.classList.add('sort-card-dragging');
          // Create visual clone for drag feedback
          dragClone = cardEl.cloneNode(true) as HTMLElement;
          dragClone.classList.add('sort-card-drag-clone');
          dragClone.style.position = 'fixed';
          dragClone.style.width = `${cardEl.offsetWidth}px`;
          dragClone.style.pointerEvents = 'none';
          dragClone.style.zIndex = '9999';
          dragClone.style.opacity = '0.85';
          document.body.appendChild(dragClone);
        }
        if (dragging && dragClone) {
          dragClone.style.top = `${moveY - 30}px`;
          dragClone.style.left = `${cardEl.getBoundingClientRect().left}px`;
        }
      };

      const onEnd = (endY: number) => {
        if (dragging) {
          cardEl.classList.remove('sort-card-dragging');
          if (dragClone) { dragClone.remove(); dragClone = null; }

          // Find drop target by Y position
          const fid = parseInt(cardEl.dataset.sortFid!, 10);
          const allCards = Array.from(el.querySelectorAll('.sort-card'));
          let targetIdx = -1;
          for (let i = 0; i < allCards.length; i++) {
            const rect = allCards[i].getBoundingClientRect();
            if (endY < rect.top + rect.height / 2) {
              targetIdx = i;
              break;
            }
          }
          if (targetIdx < 0) targetIdx = allCards.length - 1;

          // Reorder
          const s = state();
          if (orderId === '__storyflow__') {
            const frames = [...s.frames];
            const fromIdx = frames.findIndex((fr) => fr.id === fid);
            if (fromIdx >= 0) {
              const [moved] = frames.splice(fromIdx, 1);
              frames.splice(targetIdx, 0, moved);
              useStore.setState({ frames });
            }
          } else {
            const orders = s.sortOrders.map((o) => {
              if (o.id !== orderId) return o;
              const arr = [...o.frameOrder];
              const fromIdx = arr.indexOf(fid);
              if (fromIdx < 0) return o;
              arr.splice(fromIdx, 1);
              arr.splice(targetIdx, 0, fid);
              return { ...o, frameOrder: arr };
            });
            useStore.setState({ sortOrders: orders });
          }
          bumpRenderTick();
          void flushSyncNow();
          renderSortEditView(el, orderId);
        }
        document.removeEventListener('mousemove', mouseMove);
        document.removeEventListener('mouseup', mouseUp);
        document.removeEventListener('touchmove', touchMove);
        document.removeEventListener('touchend', touchEnd);
      };

      const mouseMove = (e: MouseEvent) => onMove(e.clientY);
      const mouseUp = (e: MouseEvent) => onEnd(e.clientY);
      const touchMove = (e: TouchEvent) => { e.preventDefault(); onMove(e.touches[0].clientY); };
      const touchEnd = (e: TouchEvent) => onEnd(e.changedTouches[0].clientY);

      document.addEventListener('mousemove', mouseMove);
      document.addEventListener('mouseup', mouseUp);
      document.addEventListener('touchmove', touchMove, { passive: false });
      document.addEventListener('touchend', touchEnd);
    };

    cardEl.addEventListener('mousedown', (e) => {
      if ((e.target as HTMLElement).closest('.sort-arrow, .sort-done-btn, input')) return;
      onStart(e.clientY);
    });
    cardEl.addEventListener('touchstart', (e) => {
      if ((e.target as HTMLElement).closest('.sort-arrow, .sort-done-btn, input')) return;
      onStart(e.touches[0].clientY);
    }, { passive: true });
  });
}

// Sort Order — custom frame orderings for production scheduling.
// Imperative DOM pattern matching setups.ts.

import { state, useStore, bumpRenderTick, SETUP_COLORS } from '../store/state';
import type { SortOrder, SortBreak, Frame } from '../store/state';
import { flushSyncNow } from './currentProject';
import { getStripVersions } from './helpers';
import { getVisibleFrames } from './groups';
import { rasterizeMain, rasterizeVersion, versionHasContent } from './rasterize';

// ─── Helpers ──────────────────────────────────────────────────────────

function genId(prefix: string, n: number): string {
  return `${prefix}_${n}`;
}

/** Add a newly created frame to all existing sort orders (appended at end). */
export function addFrameToSortOrders(frameId: number, afterFrameId?: number): void {
  const s = state();
  if (!s.sortOrders.length) return;
  const updated = s.sortOrders.map((o) => {
    if (o.frameOrder.includes(frameId)) return o; // already present
    const newOrder = [...o.frameOrder];
    if (afterFrameId !== undefined) {
      const afterIdx = newOrder.indexOf(afterFrameId);
      if (afterIdx >= 0) {
        newOrder.splice(afterIdx + 1, 0, frameId);
      } else {
        newOrder.push(frameId);
      }
    } else {
      newOrder.push(frameId);
    }
    return { ...o, frameOrder: newOrder };
  });
  useStore.setState({ sortOrders: updated });
}

/** Remove a deleted frame from all sort orders. */
export function removeFrameFromSortOrders(frameId: number): void {
  const s = state();
  if (!s.sortOrders.length) return;
  const updated = s.sortOrders.map((o) => {
    if (!o.frameOrder.includes(frameId)) return o;
    return {
      ...o,
      frameOrder: o.frameOrder.filter((id) => id !== frameId),
      breaks: o.breaks.map((b) => {
        // Adjust break positions if needed
        const removedIdx = o.frameOrder.indexOf(frameId);
        if (b.position > removedIdx) return { ...b, position: b.position - 1 };
        return b;
      }),
    };
  });
  useStore.setState({ sortOrders: updated });
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
  const activeBreakId = (el as any).__activeBreakId as string | null ?? null;

  let html = `<div class="sort-edit-inner">`;

  // Header — breadcrumb + ADD BREAK button for custom orders
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
      <button class="sort-edit-add-break-btn" data-sort-action="addbreak">ADD BREAK</button>
    </div>`;

  // Frame sets
  let orderIdx = 0;
  for (const f of frames) {
    // Check for breaks before this position
    const breaks = order ? order.breaks : (s.storyFlowBreaks || []);
    const breaksHere = breaks.filter((b) => b.position === orderIdx);
    for (const brk of breaksHere) {
      html += renderBreakCard(brk, activeBreakId);
    }

    html += renderFrameSetCard(f, orderIdx, activeReorderFid);
    orderIdx++;
  }

  // Trailing breaks
  {
    const breaks = order ? order.breaks : (s.storyFlowBreaks || []);
    const trailingBreaks = breaks.filter((b) => b.position >= orderIdx);
    for (const brk of trailingBreaks) {
      html += renderBreakCard(brk, activeBreakId);
    }
  }

  html += `</div>`;
  el.innerHTML = html;

  // Wire events
  wireEditViewEvents(el, orderId);

  // No auto-focus. Input is readonly in HTML; tap handler removes readonly + focuses with preventScroll.

  // Fill in sketch images that need rasterization (async, non-blocking)
  void fillRasterizedImages(el);
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
  const verVer = verVersions?.[0];
  const verImg = verVer?.bgImage || '';
  const verHasStrokes = (verVer?.strokes || []).length > 0;
  const sketchVer = sketchVersions?.[0];
  const sketchImg = sketchVer?.bgImage || '';
  const sketchHasStrokes = versionHasContent(sketchVer) && (!sketchImg || (sketchVer?.strokes || []).length > 0);
  const mainHasStrokes = (f.strokes || []).length > 0;

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
          <div class="sort-card-main-img" ${mainHasStrokes ? `data-raster-main="${f.id}"` : ''}>
            ${f.src ? `<img src="${f.src}" />` : mainHasStrokes ? `<div class="sort-card-empty sort-main-placeholder">MAIN</div>` : `<div class="sort-card-empty">MAIN</div>`}
          </div>
          <div class="sort-card-desc">${descText}</div>
        </div>
        <div class="sort-card-col-strips">
          <div class="sort-card-strip-img" ${verHasStrokes ? `data-raster-ver="${f.id}"` : ''}>
            ${verImg ? `<img src="${verImg}" />` : verHasStrokes ? `<div class="sort-card-empty sort-ver-placeholder">VERSN</div>` : `<div class="sort-card-empty">VERSN</div>`}
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

function renderBreakCard(brk: SortBreak, activeBreakId: string | null): string {
  const isActive = activeBreakId === brk.id;
  return `
    <div class="sort-break-card${isActive ? ' sort-break-active' : ''}" data-break-id="${brk.id}">
      <input class="sort-break-text" value="${brk.text}" data-break-rename="${brk.id}" placeholder="BREAK NAME" readonly />
      <div class="sort-break-arrows${isActive ? ' sort-col-active' : ''}">
        ${isActive
          ? `<span class="sort-arrow sort-break-arrow" data-break-move="up" data-break-id="${brk.id}">&#9650;</span>
             <span class="sort-done-btn sort-break-done" data-break-deactivate="${brk.id}">DONE</span>
             <span class="sort-arrow sort-break-arrow" data-break-move="down" data-break-id="${brk.id}">&#9660;</span>
             <span class="sort-break-delete-btn" data-break-delete="${brk.id}">DEL</span>`
          : `<button class="sort-arrows-combined sort-break-combined" data-break-activate="${brk.id}">
               <span>&#9650;</span><span>&#9660;</span>
             </button>`
        }
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

/** Async: rasterize images with stroke overlays for sort cards (MAIN, VERSN, SKETCH) */
async function fillRasterizedImages(el: HTMLElement): Promise<void> {
  const s = state();

  // MAIN frames with strokes — replace raw f.src or placeholder with composited image
  const mainContainers = el.querySelectorAll('[data-raster-main]');
  for (const container of Array.from(mainContainers)) {
    const fid = parseInt((container as HTMLElement).dataset.rasterMain!, 10);
    const f = s.frames.find((fr) => fr.id === fid);
    if (!f) continue;
    try {
      const canvas = await rasterizeMain(f, 1);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const placeholder = container.querySelector('.sort-main-placeholder');
      const existingImg = container.querySelector('img');
      if (placeholder) {
        placeholder.remove();
        const img = document.createElement('img');
        img.src = dataUrl;
        container.appendChild(img);
      } else if (existingImg) {
        existingImg.src = dataUrl;
      }
    } catch { /* skip */ }
  }

  // VERSN with strokes — replace raw ver.bgImage or placeholder with composited image
  const verContainers = el.querySelectorAll('[data-raster-ver]');
  for (const container of Array.from(verContainers)) {
    const fid = parseInt((container as HTMLElement).dataset.rasterVer!, 10);
    const vers = getStripVersions(fid, 'ver');
    const ver = vers?.[0];
    const f = s.frames.find((fr) => fr.id === fid);
    if (!ver || !f) continue;
    try {
      const canvas = await rasterizeVersion(ver, f.cropW || 960, f.cropH || 540, 1);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      const placeholder = container.querySelector('.sort-ver-placeholder');
      const existingImg = container.querySelector('img');
      if (placeholder) {
        placeholder.remove();
        const img = document.createElement('img');
        img.src = dataUrl;
        container.appendChild(img);
      } else if (existingImg) {
        existingImg.src = dataUrl;
      }
    } catch { /* skip */ }
  }

  // SKETCH with strokes (stroke-only or bgImage+strokes)
  const sketchContainers = el.querySelectorAll('[data-sketch-fid]');
  for (const container of Array.from(sketchContainers)) {
    const fid = parseInt((container as HTMLElement).dataset.sketchFid!, 10);
    const f = s.frames.find((fr) => fr.id === fid);
    if (!f) continue;
    const vers = getStripVersions(fid, 'floor');
    const ver = vers?.[0];
    if (!ver) continue;
    try {
      const canvas = await rasterizeVersion(ver, f.cropW || 960, f.cropH || 540, 1);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      // If there's a placeholder (stroke-only), replace it; if there's an img (bgImage+strokes), update src
      const placeholder = container.querySelector('.sort-sketch-placeholder');
      const existingImg = container.querySelector('img');
      if (placeholder) {
        placeholder.remove();
        const img = document.createElement('img');
        img.src = dataUrl;
        container.appendChild(img);
      } else if (existingImg) {
        existingImg.src = dataUrl;
      }
    } catch { /* skip */ }
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

  // Auto-deactivate active frame or break when tapping anywhere outside it
  const hasActiveFrame = (el as any).__activeReorderFid != null;
  const hasActiveBreak = (el as any).__activeBreakId != null;
  if (hasActiveFrame || hasActiveBreak) {
    el.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.closest('[data-sort-action="addbreak"]')) return; // don't deactivate on ADD BREAK
      const activeEl = hasActiveFrame
        ? el.querySelector('.sort-card-active')
        : el.querySelector('.sort-break-active');
      if (activeEl && !activeEl.contains(target)) {
        (el as any).__activeReorderFid = null;
        (el as any).__activeBreakId = null;
        renderSortEditView(el, orderId);
      }
    });
  }

  // Combined button — activate frame card for reordering (clears any active break)
  el.querySelectorAll('[data-sort-activate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const fid = parseInt((btn as HTMLElement).dataset.sortActivate!, 10);
      (el as any).__activeReorderFid = fid;
      (el as any).__activeBreakId = null;
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

  // Done button on active frame card
  el.querySelectorAll('[data-sort-deactivate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      (el as any).__activeReorderFid = null;
      renderSortEditView(el, orderId);
    });
  });

  // ─── Break events ───

  // ADD BREAK button in header
  el.querySelector('[data-sort-action="addbreak"]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    addBreak(orderId, el);
    renderSortEditView(el, orderId);
  });

  // Break activate (combined arrows button)
  el.querySelectorAll('[data-break-activate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const brkId = (btn as HTMLElement).dataset.breakActivate!;
      (el as any).__activeBreakId = brkId;
      (el as any).__activeReorderFid = null;
      renderSortEditView(el, orderId);
    });
  });

  // Break done button
  el.querySelectorAll('[data-break-deactivate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      (el as any).__activeBreakId = null;
      renderSortEditView(el, orderId);
    });
  });

  // Break delete button
  el.querySelectorAll('[data-break-delete]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const brkId = (btn as HTMLElement).dataset.breakDelete!;
      deleteBreak(orderId, brkId);
      (el as any).__activeBreakId = null;
      renderSortEditView(el, orderId);
    });
  });

  // Break rename — input is always readonly in HTML to prevent iOS scroll-to-input.
  // Different handling per device:
  const isPhone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  const hasTouchScreen = navigator.maxTouchPoints > 0;
  el.querySelectorAll('.sort-break-active .sort-break-text').forEach((input) => {
    const inp = input as HTMLInputElement;
    if (isPhone) {
      // iPhone: remove readonly on tap, let iOS handle focus + keyboard scroll naturally
      inp.addEventListener('touchstart', () => { inp.removeAttribute('readonly'); }, { passive: true });
      // When keyboard closes, slide break card to 25% from top of screen
      inp.addEventListener('blur', () => {
        const card = inp.closest('.sort-break-card');
        if (card) setTimeout(() => {
          const target = card.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.25;
          window.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
        }, 300);
      });
    } else if (hasTouchScreen) {
      // iPad: prevent iOS scroll, focus manually without scrolling
      inp.addEventListener('touchstart', (e) => {
        e.preventDefault();
        inp.removeAttribute('readonly');
        inp.focus({ preventScroll: true });
        useStore.setState({ scrollHideGuard: Date.now() + 1200 });
        // After 500ms, detect keyboard type:
        // - Software keyboard: viewport shrinks → scroll input into view
        // - Physical keyboard: viewport unchanged → scroll to 25% + hard-lock body
        setTimeout(() => {
          const vv = window.visualViewport;
          if (!vv) return;
          const rect = inp.getBoundingClientRect();
          if (rect.bottom > vv.height) {
            // Software keyboard covers input — scroll into view (don't touch, working)
            useStore.setState({ scrollHideGuard: Date.now() + 800 });
            inp.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } else {
            // Physical keyboard — scroll to 25% then freeze body with position:fixed
            const card = inp.closest('.sort-break-card');
            useStore.setState({ scrollHideGuard: Date.now() + 800 });
            const cardTop = card ? card.getBoundingClientRect().top + window.scrollY : window.scrollY;
            const lockY = Math.max(0, cardTop - window.innerHeight * 0.25);
            window.scrollTo(0, lockY);
            // position:fixed is the only iOS-proof scroll lock
            document.body.style.position = 'fixed';
            document.body.style.top = `-${lockY}px`;
            document.body.style.width = '100%';
            document.body.style.overflow = 'hidden';
          }
        }, 500);
      }, { passive: false });
      // Unlock body when input loses focus
      inp.addEventListener('blur', () => {
        if (document.body.style.position === 'fixed') {
          const lockY = Math.abs(parseInt(document.body.style.top || '0', 10));
          document.body.style.position = '';
          document.body.style.top = '';
          document.body.style.width = '';
          document.body.style.overflow = '';
          window.scrollTo(0, lockY);
        }
      });
    } else {
      // Desktop: just remove readonly on mousedown, native focus handles cursor position
      inp.addEventListener('mousedown', () => { inp.removeAttribute('readonly'); });
    }
  });
  el.querySelectorAll('.sort-break-text').forEach((input) => {
    (input as HTMLInputElement).addEventListener('change', () => {
      const brkId = (input as HTMLElement).dataset.breakRename!;
      const newText = (input as HTMLInputElement).value;
      const s = state();
      if (orderId === '__storyflow__') {
        const breaks = (s.storyFlowBreaks || []).map((b) =>
          b.id === brkId ? { ...b, text: newText } : b
        );
        useStore.setState({ storyFlowBreaks: breaks });
      } else {
        const orders = s.sortOrders.map((o) => {
          if (o.id !== orderId) return o;
          return {
            ...o,
            breaks: o.breaks.map((b) =>
              b.id === brkId ? { ...b, text: newText } : b
            ),
          };
        });
        useStore.setState({ sortOrders: orders });
      }
      bumpRenderTick();
      void flushSyncNow();
    });
  });

  // Break move arrows
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

function addBreak(orderId: string, editView: HTMLElement): void {
  const s = state();
  const breakId = `brk_${Date.now()}`;

  // Activate the new break for reordering
  (editView as any).__activeBreakId = breakId;
  (editView as any).__activeReorderFid = null;

  // Find the card closest to the viewport center — insert break there
  const viewMidY = window.innerHeight / 2;
  const cards = Array.from(editView.querySelectorAll('.sort-card')) as HTMLElement[];
  let position = Math.floor(cards.length / 2); // fallback
  let bestDist = Infinity;
  for (const card of cards) {
    const rect = card.getBoundingClientRect();
    const cardMid = rect.top + rect.height / 2;
    const dist = Math.abs(cardMid - viewMidY);
    if (dist < bestDist) {
      bestDist = dist;
      position = parseInt(card.dataset.sortIdx || '0', 10);
    }
  }

  const newBreak: SortBreak = { id: breakId, text: 'BREAK NAME', position };

  if (orderId === '__storyflow__') {
    useStore.setState({ storyFlowBreaks: [...(s.storyFlowBreaks || []), newBreak] });
  } else {
    const order = s.sortOrders.find((o) => o.id === orderId);
    if (!order) return;
    const orders = s.sortOrders.map((o) =>
      o.id === orderId ? { ...o, breaks: [...o.breaks, newBreak] } : o
    );
    useStore.setState({ sortOrders: orders });
  }
  bumpRenderTick();
  void flushSyncNow();
}

function deleteBreak(orderId: string, breakId: string): void {
  const s = state();
  if (orderId === '__storyflow__') {
    const breaks = (s.storyFlowBreaks || []).filter((b) => b.id !== breakId);
    useStore.setState({ storyFlowBreaks: breaks });
  } else {
    const orders = s.sortOrders.map((o) => {
      if (o.id !== orderId) return o;
      return { ...o, breaks: o.breaks.filter((b) => b.id !== breakId) };
    });
    useStore.setState({ sortOrders: orders });
  }
  bumpRenderTick();
  void flushSyncNow();
}

function moveBreak(orderId: string, breakId: string, dir: 'up' | 'down'): void {
  const s = state();
  if (orderId === '__storyflow__') {
    const maxPos = getVisibleFrames().length;
    const breaks = (s.storyFlowBreaks || []).map((b) => {
      if (b.id !== breakId) return b;
      const newPos = dir === 'up' ? b.position - 1 : b.position + 1;
      return { ...b, position: Math.max(0, Math.min(maxPos, newPos)) };
    });
    useStore.setState({ storyFlowBreaks: breaks });
  } else {
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
  }
  bumpRenderTick();
  void flushSyncNow();
}

// ─── Drag & drop (active card or break, with auto-scroll) ─────────────

function setupDragAndDrop(el: HTMLElement, orderId: string): void {
  // Find the active element — either a frame card or a break card
  const activeFrame = el.querySelector('.sort-card-active') as HTMLElement | null;
  const activeBreak = el.querySelector('.sort-break-active') as HTMLElement | null;
  const activeCard = activeFrame || activeBreak;
  if (!activeCard) return;

  const isBreakDrag = !!activeBreak;

  // All visual items (frame cards + break cards) in DOM order
  const allItems = Array.from(el.querySelectorAll('.sort-card, .sort-break-card')) as HTMLElement[];
  const activeItemIdx = allItems.indexOf(activeCard);
  if (activeItemIdx < 0) return;

  let startY = 0;
  let dragging = false;
  let dragClone: HTMLElement | null = null;
  let currentDropIdx = activeItemIdx;
  let lastMoveY = 0;
  let scrollRAF = 0;
  const itemDocMids: number[] = [];

  const EDGE_ZONE = 90;
  const SCROLL_SPEED = 8;

  const onStart = (clientY: number) => {
    startY = clientY;
    dragging = false;
    currentDropIdx = activeItemIdx;
    lastMoveY = clientY;

    const activeRect = activeCard.getBoundingClientRect();
    const draggedH = activeRect.height + 6;
    const cloneOffset = activeRect.height / 2;

    itemDocMids.length = 0;
    const sy = window.scrollY;
    for (const c of allItems) {
      const r = c.getBoundingClientRect();
      itemDocMids.push(r.top + sy + r.height / 2);
    }

    const shiftItems = (dropIdx: number) => {
      for (let i = 0; i < allItems.length; i++) {
        if (i === activeItemIdx) continue;
        let shift = 0;
        if (activeItemIdx < dropIdx) {
          if (i > activeItemIdx && i <= dropIdx) shift = -draggedH;
        } else if (activeItemIdx > dropIdx) {
          if (i >= dropIdx && i < activeItemIdx) shift = draggedH;
        }
        allItems[i].style.transform = shift ? `translateY(${shift}px)` : '';
      }
    };

    const updateDropIndex = () => {
      const touchDocY = lastMoveY + window.scrollY;
      let newDropIdx = activeItemIdx;

      // Scan downward: shift happens when finger passes each item's midpoint
      for (let i = activeItemIdx + 1; i < allItems.length; i++) {
        if (touchDocY >= itemDocMids[i]) {
          newDropIdx = i;
        } else {
          break;
        }
      }

      // Scan upward: only if we haven't moved down
      if (newDropIdx === activeItemIdx) {
        for (let i = activeItemIdx - 1; i >= 0; i--) {
          if (touchDocY < itemDocMids[i]) {
            newDropIdx = i;
          } else {
            break;
          }
        }
      }

      if (newDropIdx !== currentDropIdx) {
        currentDropIdx = newDropIdx;
        shiftItems(currentDropIdx);
      }
    };

    const autoScroll = () => {
      if (!dragging) return;
      const viewH = window.innerHeight;
      if (lastMoveY > viewH - EDGE_ZONE) {
        const intensity = Math.min((lastMoveY - (viewH - EDGE_ZONE)) / EDGE_ZONE, 1);
        window.scrollBy(0, Math.round(SCROLL_SPEED * intensity + 1));
        updateDropIndex();
      } else if (lastMoveY < EDGE_ZONE) {
        const intensity = Math.min((EDGE_ZONE - lastMoveY) / EDGE_ZONE, 1);
        window.scrollBy(0, -Math.round(SCROLL_SPEED * intensity + 1));
        updateDropIndex();
      }
      scrollRAF = requestAnimationFrame(autoScroll);
    };

    const onMove = (moveY: number) => {
      lastMoveY = moveY;
      if (!dragging && Math.abs(moveY - startY) > 10) {
        dragging = true;
        el.classList.add('sort-dragging');
        activeCard.classList.add('sort-card-dragging');
        dragClone = activeCard.cloneNode(true) as HTMLElement;
        dragClone.classList.add('sort-card-drag-clone');
        dragClone.style.position = 'fixed';
        dragClone.style.width = `${activeCard.offsetWidth}px`;
        dragClone.style.pointerEvents = 'none';
        dragClone.style.zIndex = '9999';
        document.body.appendChild(dragClone);
        scrollRAF = requestAnimationFrame(autoScroll);
      }
      if (dragging && dragClone) {
        dragClone.style.top = `${moveY - cloneOffset}px`;
        dragClone.style.left = `${activeCard.getBoundingClientRect().left}px`;
        updateDropIndex();
      }
    };

    const cleanup = () => {
      if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = 0; }
      document.removeEventListener('mousemove', mouseMove);
      document.removeEventListener('mouseup', mouseUp);
      document.removeEventListener('touchmove', touchMove);
      document.removeEventListener('touchend', touchEnd);
    };

    const onEnd = () => {
      for (const c of allItems) c.style.transform = '';
      cleanup();

      if (dragging) {
        el.classList.remove('sort-dragging');
        activeCard.classList.remove('sort-card-dragging');
        if (dragClone) { dragClone.remove(); dragClone = null; }

        if (currentDropIdx !== activeItemIdx) {
          // Build reordered visual list — source of truth for new arrangement
          const reordered = allItems.filter((_, i) => i !== activeItemIdx);
          reordered.splice(currentDropIdx, 0, activeCard);

          // Derive new frame order + new break positions from visual order
          const newFrameOrder: number[] = [];
          const newBreakPositions = new Map<string, number>();
          let fCount = 0;
          for (const item of reordered) {
            if (item.classList.contains('sort-card')) {
              newFrameOrder.push(parseInt(item.dataset.sortFid!, 10));
              fCount++;
            } else if (item.classList.contains('sort-break-card')) {
              newBreakPositions.set(item.dataset.breakId!, fCount);
            }
          }

          const s = state();
          if (orderId === '__storyflow__') {
            // Rearrange visible frames within s.frames, preserving non-visible frame positions
            const frames = [...s.frames];
            const visibleSet = new Set(newFrameOrder);
            const visibleSlots: number[] = [];
            for (let i = 0; i < frames.length; i++) {
              if (visibleSet.has(frames[i].id)) visibleSlots.push(i);
            }
            const frameById = new Map(frames.map((f) => [f.id, f]));
            for (let i = 0; i < newFrameOrder.length; i++) {
              frames[visibleSlots[i]] = frameById.get(newFrameOrder[i])!;
            }
            // Update break positions
            const newBreaks = (s.storyFlowBreaks || []).map((b) => {
              const pos = newBreakPositions.get(b.id);
              return pos !== undefined ? { ...b, position: pos } : b;
            });
            useStore.setState({ frames, storyFlowBreaks: newBreaks });
          } else {
            const orders = s.sortOrders.map((o) => {
              if (o.id !== orderId) return o;
              const newBreaks = o.breaks.map((b) => {
                const pos = newBreakPositions.get(b.id);
                return pos !== undefined ? { ...b, position: pos } : b;
              });
              return { ...o, frameOrder: newFrameOrder, breaks: newBreaks };
            });
            useStore.setState({ sortOrders: orders });
          }
          bumpRenderTick();
          void flushSyncNow();
        }
        renderSortEditView(el, orderId);
      }
    };

    const mouseMove = (e: MouseEvent) => onMove(e.clientY);
    const mouseUp = () => onEnd();
    const touchMove = (e: TouchEvent) => { e.preventDefault(); onMove(e.touches[0].clientY); };
    const touchEnd = () => onEnd();

    document.addEventListener('mousemove', mouseMove);
    document.addEventListener('mouseup', mouseUp);
    document.addEventListener('touchmove', touchMove, { passive: false });
    document.addEventListener('touchend', touchEnd);
  };

  activeCard.addEventListener('mousedown', (e) => {
    if ((e.target as HTMLElement).closest('.sort-arrow, .sort-done-btn, .sort-break-delete-btn, input')) return;
    onStart(e.clientY);
  });
  activeCard.addEventListener('touchstart', (e) => {
    if ((e.target as HTMLElement).closest('.sort-arrow, .sort-done-btn, .sort-break-delete-btn, input')) return;
    onStart(e.touches[0].clientY);
  }, { passive: true });
}

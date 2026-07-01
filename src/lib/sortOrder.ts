// Sort Order — custom frame orderings for production scheduling.
// Imperative DOM pattern matching setups.ts.

import { state, useStore, bumpRenderTick, SETUP_COLORS } from '../store/state';
import type { SortOrder, SortBreak, Frame } from '../store/state';
import { flushSyncNow } from './currentProject';
import { getStripVersions } from './helpers';

// ─── Helpers ──────────────────────────────────────────────────────────

function genId(prefix: string, n: number): string {
  return `${prefix}_${n}`;
}

/** Get frames in their current "story flow" order (respecting groups/visibility). */
function getVisibleFrames(): Frame[] {
  const s = state();
  return s.frames.filter((f) => !f.hidden);
}

/** Get frames in a sort order's sequence. */
function getOrderedFrames(order: SortOrder): Frame[] {
  const s = state();
  const frameMap = new Map(s.frames.map((f) => [f.id, f]));
  const result: Frame[] = [];
  for (const fid of order.frameOrder) {
    const f = frameMap.get(fid);
    if (f && !f.hidden) result.push(f);
  }
  return result;
}

// ─── Toggle dropdown ──────────────────────────────────────────────────

export function toggleSortDropdown(): void {
  const s = state();
  const dropdown = document.getElementById('sortDropdown');
  if (!dropdown) return;

  if (s.sortMode) {
    closeSortMode();
    return;
  }

  // Close setup mode if open
  if (s.setupMode) {
    const setupBtn = document.getElementById('setupsBtn');
    if (setupBtn) setupBtn.click();
  }

  useStore.setState({ sortMode: true });
  document.getElementById('sortByBtn')?.classList.add('active');
  dropdown.style.display = '';
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

function closeSortMode(): void {
  useStore.setState({ sortMode: false, sortEditingId: null });
  const dropdown = document.getElementById('sortDropdown');
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
  const editView = document.getElementById('sortEditView');
  if (editView) { editView.style.display = 'none'; editView.innerHTML = ''; }
  document.getElementById('sortByBtn')?.classList.remove('active');
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
    <div class="sort-dd-item" data-sort-id="__storyflow__">
      <div class="sort-dd-item-left">
        <div class="sort-dd-title">STORY FLOW</div>
        <div class="sort-dd-hint">Your narrative sequence, as edited</div>
      </div>
      ${activeId === null ? '<span class="sort-dd-check">&#10003;</span>' : ''}
    </div>`;

  // Shooting order (always visible)
  html += `
    <div class="sort-dd-item" data-sort-id="${shootingId}">
      <div class="sort-dd-item-left">
        <div class="sort-dd-title-row">
          <span class="sort-dd-title">SHOOTING ORDER</span>
          <span class="sort-dd-edit" data-sort-edit="${shootingId}">EDIT</span>
        </div>
        <div class="sort-dd-hint">Frame order as set in EDIT</div>
      </div>
      ${activeId === shootingId ? '<span class="sort-dd-check">&#10003;</span>' : ''}
    </div>`;

  // Other custom orders (exclude the default shooting order)
  for (const order of s.sortOrders.filter((o) => o.name !== 'SHOOTING ORDER')) {
    html += `
      <div class="sort-dd-item" data-sort-id="${order.id}">
        <div class="sort-dd-item-left">
          <div class="sort-dd-title-row">
            <span class="sort-dd-title">${order.name}</span>
            <span class="sort-dd-edit" data-sort-edit="${order.id}">EDIT</span>
          </div>
          <div class="sort-dd-hint">Frame order as set in EDIT</div>
        </div>
        ${activeId === order.id ? '<span class="sort-dd-check">&#10003;</span>' : ''}
      </div>`;
  }

  // Add order
  html += `
    <div class="sort-dd-item sort-dd-add" data-sort-action="add">
      <span class="sort-dd-plus">+</span>
      <span>Add order</span>
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

  useStore.setState({ sortEditingId: orderId });
  editView.style.display = '';
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

  // Header
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
      <button class="sort-edit-done-btn" data-sort-close>DONE</button>
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
  const sketchImg = sketchVersions?.[0]?.bgImage || '';

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
          <div class="sort-card-strip-img">
            ${sketchImg ? `<img src="${sketchImg}" />` : `<div class="sort-card-empty">SKETCH</div>`}
          </div>
        </div>
        <div class="sort-card-col-needs">${needsHtml}</div>
        <div class="sort-card-col-arrows">
          <span class="sort-arrow sort-arrow-up${isActive ? ' sort-arrow-active' : ''}" data-sort-move="up" data-sort-fid="${f.id}">&#9650;</span>
          ${isActive ? `<span class="sort-done-btn" data-sort-deactivate="${f.id}">DONE</span>` : ''}
          <span class="sort-arrow sort-arrow-down${isActive ? ' sort-arrow-active' : ''}" data-sort-move="down" data-sort-fid="${f.id}">&#9660;</span>
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
  let html = `<div class="sort-needs-grid">`;

  // Show up to 4 tabs in 2x2 grid
  const tabs = (defs.tabs || []).slice(0, 4);
  for (const tab of tabs) {
    // Collect toggled-on items across all tables in this tab
    const onItems: string[] = [];
    for (const table of tab.tables) {
      for (const item of table.items) {
        if (frameNeeds.toggles[item.id]) {
          onItems.push(item.name);
        }
      }
    }
    if (onItems.length === 0) continue;

    html += `
      <div class="sort-needs-cat">
        <div class="sort-needs-label">${tab.name}</div>
        ${onItems.slice(0, 3).map((it) => `<div class="sort-needs-item">${it}</div>`).join('')}
        ${onItems.length > 3 ? `<div class="sort-needs-item" style="color:#bbb">+${onItems.length - 3}</div>` : ''}
      </div>`;
  }

  html += `</div>`;
  return html;
}

// ─── Edit view event wiring ───────────────────────────────────────────

function wireEditViewEvents(el: HTMLElement, orderId: string): void {
  // Close button
  el.querySelector('[data-sort-close]')?.addEventListener('click', () => {
    closeSortMode();
    const renderAll = (window as any).__fh_renderAll;
    if (renderAll) renderAll();
  });

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

  // Arrow clicks — move frame up/down
  el.querySelectorAll('.sort-arrow[data-sort-move]').forEach((arrow) => {
    arrow.addEventListener('click', (e) => {
      e.stopPropagation();
      const dir = (arrow as HTMLElement).dataset.sortMove!;
      const fid = parseInt((arrow as HTMLElement).dataset.sortFid!, 10);

      // Activate card on first click
      if ((el as any).__activeReorderFid !== fid) {
        (el as any).__activeReorderFid = fid;
        renderSortEditView(el, orderId);
        return;
      }

      // Move frame
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

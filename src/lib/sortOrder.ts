// Sort Order — custom frame orderings for production scheduling.
// Imperative DOM pattern matching setups.ts.

import { state, useStore, bumpRenderTick, SETUP_COLORS } from '../store/state';
import type { SortOrder, SortBreak, Frame, NeedTable } from '../store/state';

// ─── Sort Bracket Types ──────────────────────────────────────────────

/** Tree node — selected goes right, remaining goes down. Like Finder folders. */
interface BracketNode {
  inputIds: number[];          // frames entering this node
  categoryId: string | null;   // 'setup' | needTable.id | null
  categoryName: string | null;
  itemId: string | null;       // setup.id | needItem.id | null
  itemName: string | null;
  matchedIds: number[];        // frames matching selection → right child
  right: BracketNode | null;   // next selection step (matched frames)
  down: BracketNode | null;    // remaining frames node (auto-created)
  expanded: boolean;           // is the remaining dropdown open?
}

/** Category option for the dropdown. */
interface CategoryOption {
  id: string;          // 'setup' | needTable.id
  name: string;        // 'SETUP' | table.name
  type: 'setup' | 'need';
}

/** Item option within a category. */
interface ItemOption {
  id: string;
  name: string;
  count: number;
  matchedIds: number[];
}

/** Full bracket state. */
interface BracketState {
  root: BracketNode;
}

// ─── Sort Bracket Logic ──────────────────────────────────────────────

/** Collect category IDs used along the path from root to this node (ancestors). */
/** Find exclusions for a target node's dropdown.
 *  - Right →: direct parent's item is grayed (available again after one column)
 *  - Down ↓: all items picked above in the same column are grayed
 *  - SHOOT DAY special: once used and we've gone right, entire category hidden for rest of branch
 *    (but in the first column, other SHOOT DAY items remain available)
 *  - Grayed items still show in dropdown but are not clickable */
function collectAncestorExclusions(root: BracketNode, target: BracketNode): { excludeCats: string[]; grayItems: string[] } {
  const excludeCats: string[] = [];
  const grayItems: string[] = [];

  // Build path from root to target
  const path: BracketNode[] = [];
  const walkPath = (n: BracketNode): boolean => {
    path.push(n);
    if (n === target) return true;
    if (n.right && walkPath(n.right)) return true;
    if (n.down && walkPath(n.down)) return true;
    path.pop();
    return false;
  };
  walkPath(root);

  // Find direct parent and how we got here
  let parent = null as BracketNode | null;
  let viaRight = false;
  const findParent = (n: BracketNode): boolean => {
    if (n.right === target) { parent = n; viaRight = true; return true; }
    if (n.down === target) { parent = n; viaRight = false; return true; }
    if (n.right && findParent(n.right)) return true;
    if (n.down && findParent(n.down)) return true;
    return false;
  };
  findParent(root);

  // SHOOT DAY: if any ancestor in the path used it AND we've crossed a right link,
  // gray out ALL shoot day items (visible but not clickable).
  let crossedRight = false;
  let shootDayUsed = false;
  for (let i = 0; i < path.length - 1; i++) {
    if (path[i].right === path[i + 1]) crossedRight = true;
    if (path[i].categoryId === 'tbl_shootday' && path[i].itemId) shootDayUsed = true;
  }
  if (crossedRight && shootDayUsed) {
    // Find all shoot day item IDs and gray them all
    const defs = state().needDefinitions;
    for (const tab of defs.tabs) {
      const tbl = tab.tables.find(t => t.id === 'tbl_shootday');
      if (tbl) { for (const item of tbl.items) grayItems.push(item.id); break; }
    }
  }

  const p = parent;
  if (p && p.itemId) {
    if (viaRight) {
      // Right branch: gray out only the direct parent's item
      grayItems.push(p.itemId);
    } else {
      // Down branch: gray out all items picked above in the same column
      for (let i = 0; i < path.length - 1; i++) {
        if (path[i].down === path[i + 1] && path[i].itemId) {
          grayItems.push(path[i].itemId!);
        }
      }
    }
  }

  return { excludeCats, grayItems };
}

/** Get available categories from NEEDS + SETUPs for a set of frames. */
function getAvailableCategories(frameIds: number[], excludeIds: string[] = []): CategoryOption[] {
  const s = state();
  const cats: CategoryOption[] = [];

  const defs = s.needDefinitions;
  const firstTab = defs.tabs[0];

  // First tab tables (SHOOT) come first
  if (firstTab) {
    for (const table of firstTab.tables) {
      if (excludeIds.includes(table.id)) continue;
      cats.push({ id: table.id, name: table.name, type: 'need' });
    }
  }

  // SETUP after first tab
  if (!excludeIds.includes('setup')) {
    cats.push({ id: 'setup', name: 'SETUP', type: 'setup' });
  }

  // Remaining tabs (TALENTS, GEAR, ART...)
  for (let i = 1; i < defs.tabs.length; i++) {
    const tab = defs.tabs[i];
    for (const table of tab.tables) {
      if (excludeIds.includes(table.id)) continue;
      cats.push({ id: table.id, name: table.name, type: 'need' });
    }
  }
  return cats;
}

/** Get items within a category with frame counts. */
function getItemsForCategory(categoryId: string, frameIds: number[]): ItemOption[] {
  const s = state();

  if (categoryId === 'setup') {
    const setupCounts = new Map<string, { name: string; ids: number[] }>();
    for (const fid of frameIds) {
      const f = s.frames.find((fr) => fr.id === fid);
      if (!f || !f.setupId) continue;
      const setup = s.setups.find((su) => su.id === f.setupId);
      if (!setup) continue;
      const entry = setupCounts.get(setup.id) || { name: setup.name, ids: [] };
      entry.ids.push(fid);
      setupCounts.set(setup.id, entry);
    }
    return Array.from(setupCounts.entries()).map(([id, { name, ids }]) => ({
      id, name, count: ids.length, matchedIds: ids,
    })).sort((a, b) => b.count - a.count);
  }

  const defs = s.needDefinitions;
  let table: NeedTable | undefined;
  for (const tab of defs.tabs) { table = tab.tables.find((t) => t.id === categoryId); if (table) break; }
  if (!table) return [];

  // First: check which items have EVER been toggled ON across ALL frames
  const allFrames = s.frames;
  const everToggled = new Set<string>();
  for (const item of table.items) {
    for (const f of allFrames) {
      const fn = s.frameNeeds[f.id];
      if (!fn) continue;
      if (table.type === 'counter') {
        if ((fn.counters?.[item.id] || 0) > 0) { everToggled.add(item.id); break; }
      } else {
        if (fn.toggles?.[item.id]) { everToggled.add(item.id); break; }
      }
    }
  }

  // Then: count only from the current branch's frameIds
  const items: ItemOption[] = [];
  for (const item of table.items) {
    if (!everToggled.has(item.id)) continue; // never toggled — don't show
    const matchedIds: number[] = [];
    for (const fid of frameIds) {
      const fn = s.frameNeeds[fid];
      if (!fn) continue;
      if (table.type === 'counter') {
        if ((fn.counters?.[item.id] || 0) > 0) matchedIds.push(fid);
      } else {
        if (fn.toggles?.[item.id]) matchedIds.push(fid);
      }
    }
    items.push({ id: item.id, name: item.name, count: matchedIds.length, matchedIds });
  }
  return items.sort((a, b) => b.count - a.count);
}

/** Get short frame label. */
function getFrameLabel(fid: number): string {
  const f = state().frames.find((fr) => fr.id === fid);
  if (!f) return String(fid);
  const m = f.label.match(/^(\d+[A-Za-z]?\.?)/);
  return m ? m[1] : f.label;
}

/** Create an empty bracket node for a set of frames. */
function createEmptyNode(inputIds: number[]): BracketNode {
  return {
    inputIds, categoryId: null, categoryName: null,
    itemId: null, itemName: null, matchedIds: [],
    right: null, down: null, expanded: false,
  };
}

/** Find a node in the tree by traversal. */
function findInTree(root: BracketNode, target: BracketNode, via: 'down' | 'right' | 'any'): { node: BracketNode; link: 'right' | 'down' } | null {
  const walk = (n: BracketNode): { node: BracketNode; link: 'right' | 'down' } | null => {
    if ((via === 'down' || via === 'any') && n.down === target) return { node: n, link: 'down' };
    if ((via === 'right' || via === 'any') && n.right === target) return { node: n, link: 'right' };
    if (n.right) { const r = walk(n.right); if (r) return r; }
    if (n.down) { const r = walk(n.down); if (r) return r; }
    return null;
  };
  return walk(root);
}

/** After swap, fix inputIds down the chain so dropdowns show correct items.
 *  matchedIds stay unchanged — groupings are preserved. */
function fixInputIds(node: BracketNode): void {
  if (!node.itemId) return;
  if (node.right) {
    node.right.inputIds = [...node.matchedIds];
    fixInputIds(node.right);
  }
  const remaining = node.inputIds.filter((id) => !node.matchedIds.includes(id));
  if (node.down) {
    node.down.inputIds = remaining;
    fixInputIds(node.down);
  }
}

/** Swap a node up — exchange it with its parent sibling in the same column.
 *  Groupings (matchedIds) stay the same, only schedule order changes.
 *  inputIds are fixed so dropdowns/re-selection work correctly. */
function swapUpInTree(bracketState: BracketState, target: BracketNode): void {
  const root = bracketState.root;
  const parentInfo = findInTree(root, target, 'down');
  if (!parentInfo) return;
  const parent = parentInfo.node;
  if (!parent.itemId || !target.itemId) return; // both must be selected
  const savedInputIds = [...parent.inputIds];
  const grandchild = target.down;

  if (parent === root) {
    target.down = parent;
    parent.down = grandchild;
    bracketState.root = target;
  } else {
    const anchorInfo = findInTree(root, parent, 'any');
    if (!anchorInfo) return;
    target.down = parent;
    parent.down = grandchild;
    if (anchorInfo.link === 'right') {
      anchorInfo.node.right = target;
    } else {
      anchorInfo.node.down = target;
    }
  }

  // Fix inputIds from swap point downward (matchedIds unchanged)
  target.inputIds = savedInputIds;
  fixInputIds(target);
}

// ─── Grid-based layout ───────────────────────────────────────────────

interface GridCell {
  row: number;
  col: number;
  type: 'selected' | 'remaining' | 'pending-closed' | 'pending-cat' | 'pending-item' | 'pills' | 'arrow';
  node: BracketNode;
  html: string;
}

/** Compute subtree height (rows needed) for a node.
 *  isDownChild = true adds 1 row for the swap button above this node. */
function subtreeHeight(node: BracketNode, isDownChild: boolean = false): number {
  // Single-frame pending nodes get auto-selected in layoutNode:
  // known height = 1 (red box) + swap row if down child. No right, no remaining.
  const willAutoSelect = !node.itemId && node.inputIds.length === 1;
  const swapH = (isDownChild && (!!node.itemId || willAutoSelect)) ? 1 : 0;
  if (!node.itemId && !willAutoSelect) return 1; // pending node = 1 row (no swap — no itemId)
  if (willAutoSelect) return 1 + swapH; // auto-selected: red box + optional swap

  // Right child height
  const rightH = node.right ? subtreeHeight(node.right) : 0;
  // Down child height — render if remainingIds > 0 OR node.down exists (post-swap)
  const remainingIds = node.inputIds.filter((id) => !node.matchedIds.includes(id));
  let downH = 0;
  if (remainingIds.length > 0 || node.down) {
    if (node.down && (node.down.itemId || node.down.expanded)) {
      downH = subtreeHeight(node.down, true);
    } else {
      downH = 1; // collapsed gray box or not yet created
    }
  }
  return Math.max(1, rightH) + downH + swapH;
}

/** Recursively lay out nodes into grid cells. */
function layoutNode(node: BracketNode, col: number, startRow: number, cells: GridCell[], nodeId: number[], root: BracketNode, isDownChild: boolean = false): void {
  const nid = nodeId[0]++;

  const MAX_SORT_COLS = 4; // columns 0-3 for sorting, column 4 for frame pills

  // Auto-select single-frame pending nodes — no choice to make
  if (!node.itemId && node.inputIds.length === 1) {
    node.categoryId = '__keep__';
    node.categoryName = 'KEEP ORDER';
    node.itemId = '__keep__';
    node.itemName = 'KEEP ORDER';
    node.matchedIds = [...node.inputIds];
  }

  if (!node.itemId) {
    const isRoot = node === root;
    if (!node.expanded) {
      // Closed gray box — triangle ◀ pointing toward count on right
      cells.push({
        row: startRow, col, type: 'pending-closed', node,
        html: `<div class="sort-bracket-gray-box" data-bn="${nid}" data-bact="expand"><span>REMAINING</span><span class="sort-bracket-rem-count">${node.inputIds.length} ◀</span></div>`,
      });
    } else {
      // Open — ▼ triangle pointing down at menu
      const { excludeCats, grayItems } = collectAncestorExclusions(root, node);
      const cats = getAvailableCategories(node.inputIds, excludeCats);
      let listHtml = `<div class="sort-bracket-dd-item sort-bracket-dd-keepasis" data-bn="${nid}" data-bact="keepasis"><span>KEEP ORDER</span><span class="sort-bracket-item-count">${node.inputIds.length}</span></div>`;
      for (const cat of cats) {
        const items = getItemsForCategory(cat.id, node.inputIds);
        if (items.length === 0) {
          listHtml += `<div class="sort-bracket-dd-group sort-bracket-dd-group-empty">${cat.name}</div>`;
          continue;
        }
        const allZero = items.every((item) => item.count === 0);
        listHtml += `<div class="sort-bracket-dd-group${allZero ? ' sort-bracket-dd-group-empty' : ''}">${cat.name}</div>`;
        for (const item of items) {
          const isGrayed = item.count === 0 || grayItems.includes(item.id);
          if (isGrayed) {
            listHtml += `<div class="sort-bracket-dd-item sort-bracket-dd-item-gray"><span>${item.name}</span><span class="sort-bracket-item-count">${item.count}</span></div>`;
          } else {
            listHtml += `<div class="sort-bracket-dd-item" data-bn="${nid}" data-bact="pick" data-bcat="${cat.id}" data-bcatn="${cat.name}" data-bid="${item.id}"><span>${item.name}</span><span class="sort-bracket-item-count">${item.count}</span></div>`;
          }
        }
      }
      cells.push({
        row: startRow, col, type: 'pending-cat', node,
        html: `<div class="sort-bracket-dropdown"><div class="sort-bracket-dd-header" data-bn="${nid}" data-bact="collapse"><span>REMAINING</span> <span class="sort-bracket-rem-count">${node.inputIds.length} ▼</span></div><div class="sort-bracket-dd-list">${listHtml}</div></div>`,
      });
    }
    // Always show frame pills in column 4 for pending nodes
    const pillsCol = MAX_SORT_COLS;
    const pillLabel = isRoot && !isDownChild ? 'to sort' : 'remaining';
    let pendPillsHtml = `<div class="sort-bracket-pills">`;
    for (const fid of node.inputIds) {
      pendPillsHtml += `<span class="sort-bracket-pill">${getFrameLabel(fid)}</span>`;
    }
    pendPillsHtml += `</div>`;
    cells.push({ row: startRow, col: pillsCol, type: 'pills', node, html: pendPillsHtml });
    return;
  }

  // Swap button — own grid row above the red box
  const showSwap = isDownChild && !!node.itemId;
  const contentRow = showSwap ? startRow + 1 : startRow;

  if (showSwap) {
    cells.push({
      row: startRow, col, type: 'selected', node,
      html: `<div class="sort-bracket-swap-btn" data-bn="${nid}" data-bact="swapup"><span class="sort-bracket-swap-label">swap</span><span class="sort-bracket-swap-arrows">▲▼</span></div>`,
    });
  }

  // Selected red box with ▶ triangle after it — at contentRow
  const hasRight = !!node.right || node.matchedIds.length > 0;
  cells.push({
    row: contentRow, col, type: 'selected', node,
    html: `<div class="sort-bracket-sel-wrap"><div class="sort-bracket-sel-box" data-bn="${nid}" data-bact="reselect"><span class="sort-bracket-sel-name">${node.itemName!.toUpperCase()}</span><span class="sort-bracket-sel-count">${node.matchedIds.length}</span></div>${hasRight ? '<span class="sort-bracket-harrow">▶</span>' : ''}</div>`,
  });

  // Right child or final pills — cap at MAX_SORT_COLS
  const atMaxCol = col >= MAX_SORT_COLS - 1;
  const rightH = node.right && !atMaxCol ? subtreeHeight(node.right) : 1;

  if (atMaxCol || !node.right) {
    // Show frame pills in the pills column
    if (node.matchedIds.length > 0) {
      const pillsCol = MAX_SORT_COLS;
      let pillsHtml = `<div class="sort-bracket-pills">`;
      for (const fid of node.matchedIds) {
        pillsHtml += `<span class="sort-bracket-pill">${getFrameLabel(fid)}</span>`;
      }
      pillsHtml += `</div>`;
      cells.push({ row: contentRow, col: pillsCol, type: 'pills', node, html: pillsHtml });
    }
  } else {
    layoutNode(node.right, col + 1, contentRow, cells, nodeId, root);
  }

  // Remaining (down) — placed below right-subtree rows
  // Check node.down too: after swap, remainingIds may be stale but down child exists
  const remainingIds = node.inputIds.filter((id) => !node.matchedIds.includes(id));
  if (remainingIds.length > 0 || node.down) {
    const remRow = contentRow + rightH;
    if (!node.down) {
      node.down = createEmptyNode(remainingIds);
    }
    layoutNode(node.down, col, remRow, cells, nodeId, root, true);
  }
}

/** Render the bracket area as a CSS grid. */
function renderBracketArea(bracketState: BracketState, _orderId: string): string {
  const cells: GridCell[] = [];
  const nodeId = [0]; // mutable counter
  layoutNode(bracketState.root, 0, 0, cells, nodeId, bracketState.root);

  // Find grid dimensions
  let maxRow = 0, maxCol = 0;
  for (const c of cells) {
    if (c.row > maxRow) maxRow = c.row;
    if (c.col > maxCol) maxCol = c.col;
  }

  // Build CSS grid — always 5 columns: 4 bracket + 1 pills (far right)
  const totalFrames = bracketState.root.inputIds.length;
  const colTemplate = '1fr 1fr 1fr 1fr 1.5fr';
  let html = `<div class="sort-bracket" style="display:grid;grid-template-columns:${colTemplate};gap:4px 0;align-items:start;">`;
  html += `<div style="grid-row:1;grid-column:1/5" class="sort-bracket-hint">click to sort ${totalFrames} frames by:</div>`;
  // Shift all rows down by 1 to make room for the hint

  for (const c of cells) {
    const style = `grid-row:${c.row + 2};grid-column:${c.col + 1}`;
    html += `<div style="${style}">${c.html}</div>`;
  }

  html += `</div>`;
  return html;
}

/** Wire bracket events — uses data-bn (node index) + data-bact (action). */
function wireBracketEvents(el: HTMLElement, bracketState: BracketState, orderId: string, editViewEl: HTMLElement): void {
  // Collect all nodes into a flat array matching layoutNode's traversal order
  const MAX_SORT_COLS = 4;
  const nodes: BracketNode[] = [];
  const collectNodes = (n: BracketNode, col: number = 0) => {
    nodes.push(n);
    if (!n.itemId) return; // pending node — no children rendered
    const atMaxCol = col >= MAX_SORT_COLS - 1;
    if (n.right && !atMaxCol) collectNodes(n.right, col + 1);
    if (n.down) collectNodes(n.down, col);
  };
  collectNodes(bracketState.root);

  // One-click pick: combined category + item selection
  el.querySelectorAll('[data-bact="pick"]').forEach((item) => {
    item.addEventListener('click', () => {
      const nid = parseInt((item as HTMLElement).dataset.bn!, 10);
      const catId = (item as HTMLElement).dataset.bcat!;
      const catName = (item as HTMLElement).dataset.bcatn!;
      const itemId = (item as HTMLElement).dataset.bid!;
      const node = nodes[nid];
      if (!node) return;
      // Set category + item in one go
      node.categoryId = catId;
      node.categoryName = catName;
      const items = getItemsForCategory(catId, node.inputIds);
      const sel = items.find((i) => i.id === itemId);
      if (!sel) return;
      node.itemId = sel.id;
      node.itemName = sel.name;
      node.matchedIds = sel.matchedIds;
      // Right child for sub-sorting matched frames
      if (sel.matchedIds.length > 1) {
        node.right = createEmptyNode(sel.matchedIds);
      }
      // Down child for remaining frames
      const rem = node.inputIds.filter((id) => !sel.matchedIds.includes(id));
      if (rem.length > 0) {
        node.down = createEmptyNode(rem);
      }
      rerenderBracket(editViewEl, bracketState, orderId);
    });
  });

  // Keep order — accept all frames as-is, show as pills
  el.querySelectorAll('[data-bact="keepasis"]').forEach((item) => {
    item.addEventListener('click', () => {
      const nid = parseInt((item as HTMLElement).dataset.bn!, 10);
      const node = nodes[nid];
      if (!node) return;
      node.categoryId = '__keep__';
      node.categoryName = 'KEEP ORDER';
      node.itemId = '__keep__';
      node.itemName = 'KEEP ORDER';
      node.matchedIds = [...node.inputIds];
      node.right = null;
      node.down = null;
      node.expanded = false;
      rerenderBracket(editViewEl, bracketState, orderId);
    });
  });

  // Expand gray box → open dropdown
  el.querySelectorAll('[data-bact="expand"]').forEach((item) => {
    item.addEventListener('click', () => {
      const nid = parseInt((item as HTMLElement).dataset.bn!, 10);
      const node = nodes[nid];
      if (!node) return;
      node.expanded = true;
      rerenderBracket(editViewEl, bracketState, orderId);
    });
  });

  // Collapse dropdown → back to gray box
  el.querySelectorAll('[data-bact="collapse"]').forEach((item) => {
    item.addEventListener('click', () => {
      const nid = parseInt((item as HTMLElement).dataset.bn!, 10);
      const node = nodes[nid];
      if (!node) return;
      node.expanded = false;
      rerenderBracket(editViewEl, bracketState, orderId);
    });
  });

  // Swap up — swap this node with its parent sibling in the column
  el.querySelectorAll('[data-bact="swapup"]').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      const nid = parseInt((item as HTMLElement).dataset.bn!, 10);
      const node = nodes[nid];
      if (!node) return;
      swapUpInTree(bracketState, node);
      rerenderBracket(editViewEl, bracketState, orderId);
    });
  });

  // Re-select (click selected box to change selection)
  el.querySelectorAll('[data-bact="reselect"]').forEach((item) => {
    item.addEventListener('click', () => {
      const nid = parseInt((item as HTMLElement).dataset.bn!, 10);
      const node = nodes[nid];
      if (!node || !node.categoryId) return;
      // Reset to combined dropdown — clear category + item + children
      node.categoryId = null;
      node.categoryName = null;
      node.itemId = null;
      node.itemName = null;
      node.matchedIds = [];
      node.right = null;
      node.down = null;
      node.expanded = true; // auto-open dropdown for immediate re-pick
      rerenderBracket(editViewEl, bracketState, orderId);
    });
  });
}

/** Re-render bracket area. */
function rerenderBracket(editViewEl: HTMLElement, bracketState: BracketState, orderId: string): void {
  const existing = editViewEl.querySelector('.sort-bracket');
  if (!existing) return;
  const bracketHtml = renderBracketArea(bracketState, orderId);
  const temp = document.createElement('div');
  temp.innerHTML = bracketHtml;
  const newBracket = temp.firstElementChild as HTMLElement;
  existing.replaceWith(newBracket);
  wireBracketEvents(newBracket, bracketState, orderId, editViewEl);
}

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
        </div>
        <div class="sort-dd-hint">Your custom frame order</div>
      </div>
    </div>`;

  // Other custom orders (exclude the default shooting order)
  for (const order of s.sortOrders.filter((o) => o.name !== 'SHOOTING ORDER')) {
    html += `
      <div class="sort-dd-item${activeId === order.id ? ' sort-dd-selected' : ''}" data-sort-id="${order.id}">
        <div class="sort-dd-item-left">
          <div class="sort-dd-title-row">
            <span class="sort-dd-title">${order.name}</span>
          </div>
          <div class="sort-dd-hint">Your custom frame order</div>
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
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.sortId!;
      openOrderView(id);
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
      description: 'Your custom frame order',
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
    description: 'Your custom frame order',
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
  const bracketActive = (el as any).__bracketActive as boolean ?? false;

  let html = `<div class="sort-edit-inner">`;

  // Header — breadcrumb + ADD BREAK button for custom orders
  html += `
    <div class="sort-edit-header">
      <div class="sort-edit-header-left">
        <span class="sort-edit-label">name:</span>
        <span class="sort-edit-sep">&rsaquo;</span>
        <span class="sort-edit-name-static" data-sort-namelabel="${orderId}">${orderName}</span>
        ${orderId !== '__storyflow__' ? `<input class="sort-edit-name sort-edit-name-hidden" value="${orderName}" data-sort-rename="${orderId}" />` : ''}
      </div>
      <div class="sort-edit-header-right">
        ${orderId !== '__storyflow__' ? (bracketActive
          ? `<button class="sort-edit-rename-btn sort-edit-save-btn" data-sort-action="rename">SAVE</button>`
          : `<button class="sort-edit-rename-btn" data-sort-action="rename">EDIT</button>`)
        : ''}
        <button class="sort-edit-add-break-btn" data-sort-action="addbreak">ADD BREAK</button>
      </div>
    </div>`;

  // Bracket area (hidden by default, shown when EDIT is active)
  if (bracketActive && orderId !== '__storyflow__') {
    const allFrameIds = frames.map((f) => f.id);
    let bracketState = (el as any).__bracketState as BracketState | undefined;
    if (!bracketState) {
      bracketState = { root: createEmptyNode(allFrameIds) };
      (el as any).__bracketState = bracketState;
    }
    html += renderBracketArea(bracketState, orderId);
  }

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
  // EDIT / SAVE button — toggles bracket area + rename input
  const nameLabel = el.querySelector('.sort-edit-name-static') as HTMLElement | null;
  const nameInput = el.querySelector('.sort-edit-name') as HTMLInputElement | null;
  const renameBtn = el.querySelector('[data-sort-action="rename"]') as HTMLElement | null;
  if (renameBtn && nameInput && nameLabel) {
    renameBtn.addEventListener('click', () => {
      const isSaving = renameBtn.textContent === 'SAVE';
      if (isSaving) {
        // Commit rename if changed
        const val = nameInput.value.trim();
        if (val) {
          nameLabel.textContent = val;
          const s = state();
          const orders = s.sortOrders.map((o) =>
            o.id === orderId ? { ...o, name: val } : o
          );
          useStore.setState({ sortOrders: orders });
          bumpRenderTick();
        }
        nameInput.classList.add('sort-edit-name-hidden');
        nameLabel.style.display = '';
        // Hide bracket and sync to cloud
        (el as any).__bracketActive = false;
        void flushSyncNow();
        renderSortEditView(el, orderId);
      } else {
        // Enter edit mode — show rename + bracket
        nameLabel.style.display = 'none';
        nameInput.classList.remove('sort-edit-name-hidden');
        nameInput.focus();
        // Show bracket
        (el as any).__bracketActive = true;
        renderSortEditView(el, orderId);
      }
    });
  }

  // Wire bracket events if bracket is visible
  const bracketEl = el.querySelector('.sort-bracket') as HTMLElement | null;
  if (bracketEl && (el as any).__bracketState) {
    wireBracketEvents(bracketEl, (el as any).__bracketState, orderId, el);
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

  // Done button on active frame card — sync when user finishes reordering
  el.querySelectorAll('[data-sort-deactivate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      (el as any).__activeReorderFid = null;
      void flushSyncNow();
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

  // Break done button — sync when user finishes reordering break
  el.querySelectorAll('[data-break-deactivate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      (el as any).__activeBreakId = null;
      void flushSyncNow();
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

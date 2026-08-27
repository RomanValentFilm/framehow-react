// Sort Order — custom frame orderings for production scheduling.
// Imperative DOM pattern matching setups.ts.

import { state, useStore, bumpRenderTick, SETUP_COLORS } from '../store/state';
import type { SortOrder, SortBreak, Frame, NeedTable, BracketNodeData } from '../store/state';
import { uniqueId } from './ids';
import { trace } from './syncTrace';

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

/** Convert BracketNode tree → serialisable BracketNodeData for persistence. */
function serializeBracket(node: BracketNode): BracketNodeData {
  const d: BracketNodeData = {
    inputIds: [...node.inputIds],
    matchedIds: [...node.matchedIds],
  };
  if (node.categoryId) d.categoryId = node.categoryId;
  if (node.categoryName) d.categoryName = node.categoryName;
  if (node.itemId) d.itemId = node.itemId;
  if (node.itemName) d.itemName = node.itemName;
  if (node.expanded) d.expanded = true;
  if (node.right) d.right = serializeBracket(node.right);
  if (node.down) d.down = serializeBracket(node.down);
  return d;
}

/** Restore BracketNode tree from persisted BracketNodeData. */
function deserializeBracket(d: BracketNodeData): BracketNode {
  return {
    inputIds: [...d.inputIds],
    categoryId: d.categoryId ?? null,
    categoryName: d.categoryName ?? null,
    itemId: d.itemId ?? null,
    itemName: d.itemName ?? null,
    matchedIds: [...d.matchedIds],
    right: d.right ? deserializeBracket(d.right) : null,
    down: d.down ? deserializeBracket(d.down) : null,
    expanded: d.expanded ?? false,
  };
}

/** Save bracket tree + snapshot into the SortOrder in the store. */
function persistBracketToOrder(orderId: string, bracketState: BracketState, sortedSnapshot: number[] | undefined): void {
  const s = state();
  const orders = s.sortOrders.map((o) => {
    if (o.id !== orderId) return o;
    return {
      ...o,
      bracketTree: serializeBracket(bracketState.root),
      sortedSnapshot: sortedSnapshot ? [...sortedSnapshot] : undefined,
    };
  });
  useStore.setState({ sortOrders: orders });
}

/** Sync the sort-edit header's sticky top to sit right below the last visible bar.
 *  Same pattern as syncDetailTop / syncDetailTopIPad in view.ts. */
function syncSortHeaderTop(): void {
  const header = document.querySelector('.sort-edit-header') as HTMLElement | null;
  if (!header) return;
  const detailBar = document.getElementById('detailBar');
  const viewBar = document.querySelector('.view-bar') as HTMLElement | null;
  // Find the last visible bar — detail-bar if visible, otherwise view-bar
  let anchor: HTMLElement | null = null;
  if (detailBar && getComputedStyle(detailBar).display !== 'none') {
    anchor = detailBar;
  } else if (viewBar && getComputedStyle(viewBar).display !== 'none') {
    anchor = viewBar;
  }
  if (anchor) {
    const anchorTop = parseFloat(getComputedStyle(anchor).top) || 0;
    header.style.top = (anchorTop + anchor.offsetHeight - 1) + 'px';
    // On touch devices with fixed bars, adjust sort-edit-view padding to clear them
    if (getComputedStyle(anchor).position === 'fixed') {
      const editView = document.getElementById('sortEditView');
      if (editView) editView.style.paddingTop = (anchorTop + anchor.offsetHeight) + 'px';
    }
  }
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

/** Sync bracket tree with current visible frames.
 *  - Adds new frames to root.inputIds (they cascade to "remaining" buckets via fixInputIds)
 *  - Removes deleted frames from the tree
 *  Returns true if any changes were made. */
function syncBracketWithVisibleFrames(root: BracketNode, visibleIds: number[]): boolean {
  const bracketIds = new Set(flattenBracketOrder(root));
  const visibleSet = new Set(visibleIds);
  let changed = false;
  // Add new frames not in bracket
  for (const id of visibleIds) {
    if (!bracketIds.has(id)) {
      root.inputIds.push(id);
      changed = true;
    }
  }
  // Remove deleted frames from bracket
  const removeFromNode = (node: BracketNode) => {
    const before = node.inputIds.length;
    node.inputIds = node.inputIds.filter((id) => visibleSet.has(id));
    node.matchedIds = node.matchedIds.filter((id) => visibleSet.has(id));
    if (node.inputIds.length !== before) changed = true;
    if (node.right) removeFromNode(node.right);
    if (node.down) removeFromNode(node.down);
  };
  removeFromNode(root);
  // Cascade inputIds through the tree so new frames land in correct remaining buckets
  if (changed) fixInputIds(root);
  return changed;
}

/** Detect which bracket nodes are "affected" by manual reordering.
 *  A node is affected if any of its matchedIds changed position relative to sortedSnapshot. */
function getAffectedNodes(root: BracketNode, sortedSnapshot: number[], currentOrder: number[]): Set<BracketNode> {
  const snapshotPos = new Map(sortedSnapshot.map((id, i) => [id, i]));
  const currentPos = new Map(currentOrder.map((id, i) => [id, i]));
  const movedIds = new Set<number>();
  for (const [id, pos] of currentPos) {
    if (snapshotPos.get(id) !== pos) movedIds.add(id);
  }
  const affected = new Set<BracketNode>();
  const walk = (node: BracketNode) => {
    if (node.itemId && node.matchedIds.some((id) => movedIds.has(id))) {
      affected.add(node);
    }
    if (node.right) walk(node.right);
    if (node.down) walk(node.down);
  };
  walk(root);
  return affected;
}

/** Verify all visible frame IDs are in the bracket tree. Returns missing IDs. */
function verifyBracketIntegrity(root: BracketNode, visibleIds: number[]): number[] {
  const bracketIds = new Set(flattenBracketOrder(root));
  return visibleIds.filter((id) => !bracketIds.has(id));
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
      // Will the down child be auto-selected in layoutNode? (single frame = swap + red box = 2 rows)
      const willAutoDown = (node.down && node.down.inputIds.length === 1) || (!node.down && remainingIds.length === 1);
      downH = willAutoDown ? 2 : 1;
    }
  }
  return Math.max(1, rightH) + downH + swapH;
}

/** Extract final frame order from the bracket tree (depth-first: right then down). */
function flattenBracketOrder(node: BracketNode): number[] {
  if (!node.itemId) {
    // Pending — not yet sorted, keep input order
    return [...node.inputIds];
  }
  const result: number[] = [];
  // Matched frames — refined by right subtree, or as-is
  if (node.right) {
    result.push(...flattenBracketOrder(node.right));
  } else {
    result.push(...node.matchedIds);
  }
  // Remaining frames — refined by down subtree
  if (node.down) {
    result.push(...flattenBracketOrder(node.down));
  }
  return result;
}

/** Recursively lay out nodes into grid cells. */
function layoutNode(node: BracketNode, col: number, startRow: number, cells: GridCell[], nodeId: number[], root: BracketNode, isDownChild: boolean = false, affectedNodes?: Set<BracketNode>): void {
  const nid = nodeId[0]++;

  const MAX_SORT_COLS = 4; // columns 0-3 for sorting, column 4 for frame pills

  // Auto-select single-frame pending nodes — determine naming from parent's category
  // Skip if expanded (user clicked reselect to pick a different category)
  if (!node.itemId && node.inputIds.length === 1 && !node.expanded) {
    let autoItemName = 'REMAINING';
    let autoCatId: string = '__remaining__';
    let autoCatName: string = 'REMAINING';
    let autoItemId: string = '__remaining__';

    // Check if the single remaining frame belongs to the same category as the parent
    const parentInfo = findInTree(root, node, 'down');
    if (parentInfo) {
      const parent = parentInfo.node;
      if (parent.categoryId && parent.categoryId !== '__keep__' && parent.categoryId !== '__remaining__') {
        const items = getItemsForCategory(parent.categoryId, node.inputIds);
        const matched = items.filter((it) => it.count > 0);
        if (matched.length === 1) {
          autoItemName = matched[0].name;
          autoItemId = matched[0].id;
          autoCatId = parent.categoryId;
          autoCatName = parent.categoryName || parent.categoryId;
        }
      }
    }

    node.categoryId = autoCatId;
    node.categoryName = autoCatName;
    node.itemId = autoItemId;
    node.itemName = autoItemName;
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
      const prevItemId = (node as any)._prevItemId as string | undefined;
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
          const isScrollTarget = prevItemId === item.id;
          if (isGrayed) {
            listHtml += `<div class="sort-bracket-dd-item sort-bracket-dd-item-gray${isScrollTarget ? ' sort-bracket-dd-scrollto' : ''}"><span>${item.name}</span><span class="sort-bracket-item-count">${item.count}</span></div>`;
          } else {
            listHtml += `<div class="sort-bracket-dd-item${isScrollTarget ? ' sort-bracket-dd-scrollto' : ''}" data-bn="${nid}" data-bact="pick" data-bcat="${cat.id}" data-bcatn="${cat.name}" data-bid="${item.id}"><span>${item.name}</span><span class="sort-bracket-item-count">${item.count}</span></div>`;
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
      pendPillsHtml += `<span class="sort-bracket-pill" data-fid="${fid}">${getFrameLabel(fid)}</span>`;
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
  const isAffected = affectedNodes?.has(node) ?? false;
  const affectedClass = isAffected ? ' sort-bracket-sel-affected' : '';
  cells.push({
    row: contentRow, col, type: 'selected', node,
    html: `<div class="sort-bracket-sel-wrap"><div class="sort-bracket-sel-box${affectedClass}" data-bn="${nid}" data-bact="reselect"><span class="sort-bracket-sel-name">${node.itemName!.toUpperCase()}</span><span class="sort-bracket-sel-count">${node.matchedIds.length}</span></div>${hasRight ? '<span class="sort-bracket-harrow">▶</span>' : ''}</div>`,
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
        pillsHtml += `<span class="sort-bracket-pill" data-fid="${fid}">${getFrameLabel(fid)}</span>`;
      }
      pillsHtml += `</div>`;
      cells.push({ row: contentRow, col: pillsCol, type: 'pills', node, html: pillsHtml });
    }
  } else {
    layoutNode(node.right, col + 1, contentRow, cells, nodeId, root, false, affectedNodes);
  }

  // Remaining (down) — placed below right-subtree rows
  // Check node.down too: after swap, remainingIds may be stale but down child exists
  const remainingIds = node.inputIds.filter((id) => !node.matchedIds.includes(id));
  if (remainingIds.length > 0 || node.down) {
    const remRow = contentRow + rightH;
    if (!node.down) {
      node.down = createEmptyNode(remainingIds);
    }
    layoutNode(node.down, col, remRow, cells, nodeId, root, true, affectedNodes);
  }
}

/** Render the bracket area as a CSS grid. */
function renderBracketArea(bracketState: BracketState, _orderId: string, affectedNodes?: Set<BracketNode>): string {
  const cells: GridCell[] = [];
  const nodeId = [0]; // mutable counter
  layoutNode(bracketState.root, 0, 0, cells, nodeId, bracketState.root, false, affectedNodes);

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

/** Check if a node has any descendant in the affected set. */
function hasAffectedDescendant(node: BracketNode, affectedNodes: Set<BracketNode>): boolean {
  if (node.right) {
    if (affectedNodes.has(node.right) || hasAffectedDescendant(node.right, affectedNodes)) return true;
  }
  if (node.down) {
    if (affectedNodes.has(node.down) || hasAffectedDescendant(node.down, affectedNodes)) return true;
  }
  return false;
}

/** Wire bracket events — uses data-bn (node index) + data-bact (action). */
function wireBracketEvents(el: HTMLElement, bracketState: BracketState, orderId: string, editViewEl: HTMLElement): void {
  const affectedNodes = (editViewEl as any).__affectedNodes as Set<BracketNode> | undefined;

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

      // If this node is affected by manual reordering, show per-node dialog
      if (affectedNodes?.has(node)) {
        showBranchConflictDialog(editViewEl, bracketState, orderId, node, nid);
        return;
      }

      // Check if this node has affected descendants — reselecting would redistribute their manual order
      if (affectedNodes && affectedNodes.size > 0 && hasAffectedDescendant(node, affectedNodes)) {
        showAncestorReselectWarning(editViewEl, bracketState, orderId, node);
        return;
      }

      // Unaffected node with no affected descendants — allow reselect directly
      (node as any)._prevItemId = node.itemId;
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

/** Show per-branch conflict dialog when clicking an affected node. */
function showBranchConflictDialog(editViewEl: HTMLElement, bracketState: BracketState, orderId: string, node: BracketNode, _nid: number): void {
  if (document.querySelector('.sort-bracket-confirm')) return;
  const modal = document.createElement('div');
  modal.className = 'sort-bracket-confirm';
  modal.innerHTML = `
    <div class="sort-bracket-confirm-inner" style="gap:14px;min-width:260px;">
      <div class="sort-bracket-confirm-text">You're about to overwrite your manual sorting:</div>
      <div class="sort-branch-options">
        <label class="sort-branch-option">
          <input type="radio" name="branchChoice" value="keep" checked />
          <span>Keep the frame order as is (no change)</span>
        </label>
        <label class="sort-branch-option">
          <input type="radio" name="branchChoice" value="overwrite" />
          <span>Overwrite the frame order with new rule</span>
        </label>
      </div>
      <div class="sort-bracket-confirm-btns">
        <button class="sort-bracket-confirm-yes">OK</button>
        <button class="sort-bracket-confirm-no">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  // OK button
  modal.querySelector('.sort-bracket-confirm-yes')!.addEventListener('click', (e) => {
    e.stopPropagation();
    const choice = (modal.querySelector('input[name="branchChoice"]:checked') as HTMLInputElement)?.value;
    modal.remove();

    if (choice === 'keep') {
      // Mark node as resolved — remove from affected set, undim
      const affected = (editViewEl as any).__affectedNodes as Set<BracketNode> | undefined;
      if (affected) {
        affected.delete(node);
        // If no more affected nodes, clear pendingConfirm entirely
        if (affected.size === 0) {
          (editViewEl as any).__pendingConfirm = false;
          (editViewEl as any).__affectedNodes = undefined;
        }
      }
      rerenderBracket(editViewEl, bracketState, orderId);
    } else {
      // Overwrite — re-apply bracket order for this node's frames, then open for reselect
      // First, pull frames back to bracket positions in frameOrder
      const s = state();
      const order = s.sortOrders.find((o) => o.id === orderId);
      const sortedSnapshot = (editViewEl as any).__sortedSnapshot as number[] | undefined;
      if (order && sortedSnapshot) {
        // Get the frame IDs this node controls
        const nodeFrameIds = new Set(node.matchedIds);
        // Rebuild frameOrder: for node's frames, use their bracket-snapshot positions
        const snapshotPos = new Map(sortedSnapshot.map((id, i) => [id, i]));
        const currentOrder = [...order.frameOrder];
        // Extract node's frames from current order
        const nodeFramesInOrder = currentOrder.filter((id) => nodeFrameIds.has(id));
        // Sort them by their snapshot position
        nodeFramesInOrder.sort((a, b) => (snapshotPos.get(a) ?? 0) - (snapshotPos.get(b) ?? 0));
        // Put them back
        let ni = 0;
        const newOrder = currentOrder.map((id) => nodeFrameIds.has(id) ? nodeFramesInOrder[ni++] : id);
        const orders = s.sortOrders.map((o) => o.id === orderId ? { ...o, frameOrder: newOrder } : o);
        useStore.setState({ sortOrders: orders });
        // Update snapshot to reflect the restored positions
        const visibleFrames = getOrderedFrames({ ...order, frameOrder: newOrder });
        const newSnapshot = visibleFrames.map((f) => f.id);
        (editViewEl as any).__sortedSnapshot = newSnapshot;
        bumpRenderTick();
      }
      // Remove from affected set
      const affected = (editViewEl as any).__affectedNodes as Set<BracketNode> | undefined;
      if (affected) {
        affected.delete(node);
        if (affected.size === 0) {
          (editViewEl as any).__pendingConfirm = false;
          (editViewEl as any).__affectedNodes = undefined;
        }
      }
      // Open node for reselect
      (node as any)._prevItemId = node.itemId;
      node.categoryId = null;
      node.categoryName = null;
      node.itemId = null;
      node.itemName = null;
      node.matchedIds = [];
      node.right = null;
      node.down = null;
      node.expanded = true;
      // Re-render the whole view to reflect both bracket and frame card changes
      renderSortEditView(editViewEl, orderId);
    }
  });

  // Cancel button
  modal.querySelector('.sort-bracket-confirm-no')!.addEventListener('click', (e) => {
    e.stopPropagation();
    modal.remove();
  });
}

/** Show warning when reselecting an unaffected node that has affected descendants. */
function showAncestorReselectWarning(editViewEl: HTMLElement, bracketState: BracketState, orderId: string, node: BracketNode): void {
  if (document.querySelector('.sort-bracket-confirm')) return;
  const modal = document.createElement('div');
  modal.className = 'sort-bracket-confirm';
  modal.innerHTML = `
    <div class="sort-bracket-confirm-inner" style="gap:14px;min-width:260px;">
      <div class="sort-bracket-confirm-text">This change will redistribute manually ordered frames. Continue?</div>
      <div class="sort-bracket-confirm-btns">
        <button class="sort-bracket-confirm-yes">Yes</button>
        <button class="sort-bracket-confirm-no">No</button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  modal.querySelector('.sort-bracket-confirm-yes')!.addEventListener('click', (e) => {
    e.stopPropagation();
    modal.remove();
    // Clear affected descendants from set
    const affected = (editViewEl as any).__affectedNodes as Set<BracketNode> | undefined;
    if (affected) {
      const clearAffected = (n: BracketNode) => {
        if (n.right) { affected.delete(n.right); clearAffected(n.right); }
        if (n.down) { affected.delete(n.down); clearAffected(n.down); }
      };
      clearAffected(node);
      if (affected.size === 0) {
        (editViewEl as any).__pendingConfirm = false;
        (editViewEl as any).__affectedNodes = undefined;
      }
    }
    // Proceed with reselect — reset node and open dropdown
    (node as any)._prevItemId = node.itemId;
    node.categoryId = null;
    node.categoryName = null;
    node.itemId = null;
    node.itemName = null;
    node.matchedIds = [];
    node.right = null;
    node.down = null;
    node.expanded = true;
    rerenderBracket(editViewEl, bracketState, orderId);
  });

  modal.querySelector('.sort-bracket-confirm-no')!.addEventListener('click', (e) => {
    e.stopPropagation();
    modal.remove();
  });
}

/** Show confirmation modal overlaying the bracket. */
function showBracketConfirmModal(editViewEl: HTMLElement, _bracketState: BracketState, orderId: string): void {
  // Don't show duplicate
  if (document.querySelector('.sort-bracket-confirm')) return;
  const modal = document.createElement('div');
  modal.className = 'sort-bracket-confirm';
  modal.innerHTML = `
    <div class="sort-bracket-confirm-inner">
      <div class="sort-bracket-confirm-text">Your previous frame order will be overwritten</div>
      <div class="sort-bracket-confirm-btns">
        <button class="sort-bracket-confirm-yes">Yes</button>
        <button class="sort-bracket-confirm-no">No</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.sort-bracket-confirm-yes')!.addEventListener('click', (e) => {
    e.stopPropagation();
    // Re-apply bracket order (overwrite manual changes, keep bracket as-is)
    const bs = (editViewEl as any).__bracketState as BracketState | undefined;
    if (bs) {
      const bracketOrder = flattenBracketOrder(bs.root);
      const s = state();
      const order = s.sortOrders.find((o) => o.id === orderId);
      if (order) {
        const visibleSet = new Set(getVisibleFrames().map((f) => f.id));
        const newFrameOrder: number[] = [];
        let bi = 0;
        for (const fid of order.frameOrder) {
          if (visibleSet.has(fid)) {
            if (bi < bracketOrder.length) newFrameOrder.push(bracketOrder[bi++]);
          } else {
            newFrameOrder.push(fid);
          }
        }
        while (bi < bracketOrder.length) newFrameOrder.push(bracketOrder[bi++]);
        const orders = s.sortOrders.map((o) =>
          o.id === orderId ? { ...o, frameOrder: newFrameOrder } : o
        );
        useStore.setState({ sortOrders: orders });
        // Persist bracket tree + snapshot
        persistBracketToOrder(orderId, bs, bracketOrder);
        bumpRenderTick();
        (editViewEl as any).__sortedSnapshot = bracketOrder;
      }
    }
    (editViewEl as any).__pendingConfirm = false;
    // Bracket stays ACTIVE — user can now edit it
    modal.remove();
    void flushSyncNow();
    renderSortEditView(editViewEl, orderId);
  });
  modal.querySelector('.sort-bracket-confirm-no')!.addEventListener('click', (e) => {
    e.stopPropagation();
    (editViewEl as any).__pendingConfirm = false;
    (editViewEl as any).__bracketActive = false;
    modal.remove();
    renderSortEditView(editViewEl, orderId);
  });
}

/** Reorder bracket pills to reflect current frame order — cross-row AND within-row. */
function reorderPillsByCurrentOrder(container: HTMLElement, sortedSnapshot: number[], currentOrder: number[]): void {
  const containers = Array.from(container.querySelectorAll('.sort-bracket-pills'));
  if (containers.length === 0) return;

  // Row sizes from original bracket grouping (before any moves)
  const sizes = containers.map((c) => c.querySelectorAll('.sort-bracket-pill[data-fid]').length);
  const rowForPos = (pos: number): number => {
    let cumul = 0;
    for (let r = 0; r < sizes.length; r++) {
      cumul += sizes[r];
      if (pos < cumul) return r;
    }
    return sizes.length - 1;
  };

  const snapshotPos = new Map(sortedSnapshot.map((id, i) => [id, i]));
  const currentPos = new Map(currentOrder.map((id, i) => [id, i]));

  // 1. Move pills whose row changed (cross-row)
  for (const id of currentOrder) {
    const oPos = snapshotPos.get(id);
    const cPos = currentPos.get(id);
    if (oPos === undefined || cPos === undefined) continue;
    if (rowForPos(oPos) === rowForPos(cPos)) continue;

    const pill = container.querySelector(`.sort-bracket-pill[data-fid="${id}"]`) as HTMLElement | null;
    if (!pill) continue;
    pill.remove();

    const target = containers[rowForPos(cPos)];
    if (!target) continue;
    target.appendChild(pill);
  }

  // 2. Within each row, sort pills by their position in currentOrder
  for (const rowEl of containers) {
    const pills = Array.from(rowEl.querySelectorAll('.sort-bracket-pill[data-fid]')) as HTMLElement[];
    if (pills.length < 2) continue;
    pills.sort((a, b) => {
      const aPos = currentPos.get(parseInt(a.dataset.fid!, 10)) ?? 999;
      const bPos = currentPos.get(parseInt(b.dataset.fid!, 10)) ?? 999;
      return aPos - bPos;
    });
    for (const p of pills) rowEl.appendChild(p);
  }
}

/** Mark pills red for frames that moved from their sorted position. */
function markMovedPills(container: HTMLElement, sortedSnapshot: number[], currentOrder: number[]): void {
  const snapshotPos = new Map(sortedSnapshot.map((id, i) => [id, i]));
  const currentPos = new Map(currentOrder.map((id, i) => [id, i]));
  const movedIds = new Set<number>();
  for (const [id, pos] of currentPos) {
    if (snapshotPos.get(id) !== pos) movedIds.add(id);
  }
  container.querySelectorAll('.sort-bracket-pill[data-fid]').forEach((pill) => {
    const fid = parseInt((pill as HTMLElement).dataset.fid!, 10);
    if (movedIds.has(fid)) pill.classList.add('sort-bracket-pill-moved');
  });
}

/** Re-render bracket area. */
function rerenderBracket(editViewEl: HTMLElement, bracketState: BracketState, orderId: string): void {
  const existing = editViewEl.querySelector('.sort-bracket');
  if (!existing) return;
  // Auto-sync: add new frames, remove deleted ones
  const visibleIds = getVisibleFrames().map((f) => f.id);
  syncBracketWithVisibleFrames(bracketState.root, visibleIds);
  // Recompute affected nodes after tree changes (node reselect may redistribute frames)
  const sortedSnapshot = (editViewEl as any).__sortedSnapshot as number[] | undefined;
  const pendingConfirm = (editViewEl as any).__pendingConfirm as boolean ?? false;
  if (pendingConfirm && sortedSnapshot) {
    const s = state();
    const order = s.sortOrders.find((o) => o.id === orderId);
    if (order) {
      const currentOrder = getOrderedFrames(order).map((f) => f.id);
      const freshAffected = getAffectedNodes(bracketState.root, sortedSnapshot, currentOrder);
      (editViewEl as any).__affectedNodes = freshAffected.size > 0 ? freshAffected : undefined;
      if (freshAffected.size === 0) {
        (editViewEl as any).__pendingConfirm = false;
      }
    }
  }
  const affectedNodes = (editViewEl as any).__affectedNodes as Set<BracketNode> | undefined;
  const bracketHtml = renderBracketArea(bracketState, orderId, affectedNodes);
  const temp = document.createElement('div');
  temp.innerHTML = bracketHtml;
  const newBracket = temp.firstElementChild as HTMLElement;
  existing.replaceWith(newBracket);
  wireBracketEvents(newBracket, bracketState, orderId, editViewEl);
  // Preserve red pills: reorder + mark moved after re-render
  if (sortedSnapshot) {
    const s = state();
    const order = s.sortOrders.find((o) => o.id === orderId);
    if (order) {
      const currentOrder = getOrderedFrames(order).map((f) => f.id);
      reorderPillsByCurrentOrder(newBracket, sortedSnapshot, currentOrder);
      markMovedPills(newBracket, sortedSnapshot, currentOrder);
    }
  }
  // Integrity check — ensure all frames remain in bracket
  const missing = verifyBracketIntegrity(bracketState.root, visibleIds);
  if (missing.length > 0) {
    console.warn('[Bracket integrity] Missing frame IDs:', missing);
  }
  // Persist bracket to IDB+cloud on every change so it survives browser close
  persistBracketToOrder(orderId, bracketState, sortedSnapshot);
  void flushSyncNow();
  // Scroll open dropdown to previously selected item
  // Scroll dropdown list to previously selected item (centered)
  const scrollTarget = newBracket.querySelector('.sort-bracket-dd-scrollto') as HTMLElement | null;
  if (scrollTarget) {
    const list = scrollTarget.closest('.sort-bracket-dd-list') as HTMLElement | null;
    if (list) {
      list.scrollTop = scrollTarget.offsetTop - list.offsetTop - list.clientHeight / 2 + scrollTarget.offsetHeight / 2;
    }
  }
}

import { flushSyncNow, pullNow } from './currentProject';
import { getStripVersions, escH } from './helpers';
import { getVisibleFrames, enterGroup } from './groups';
import { rasterizeMain, rasterizeVersion, versionHasContent } from './rasterize';

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * A counter here was the fault, not a detail of it (#322). Two devices apart
 * both counted from 1, so both called their first shooting order `sort_1` — and
 * the server holds one row per id, so one of the two orders simply stopped
 * existing. The number is kept only for the NAME the user reads.
 */
function genId(prefix: string, _n: number): string {
  return uniqueId(prefix);
}

/** Add a newly created frame to all existing sort orders (appended at end). */
export function addFrameToSortOrders(frameId: number, afterFrameId?: number): void {
  const s = state();

  // The story flow's breaks move down when a frame is put in above them (#338),
  // for the same reason they move up when one is deleted: the break stays in the
  // same place on screen. A shooting order needs none of this — a new frame is
  // appended at its end, below everything.
  if (afterFrameId !== undefined && (s.storyFlowBreaks?.length ?? 0) > 0) {
    const afterIdx = s.frames.findIndex((f) => f.id === afterFrameId);
    if (afterIdx >= 0) {
      useStore.setState({
        storyFlowBreaks: s.storyFlowBreaks.map((b) =>
          (b.position > afterIdx ? { ...b, position: b.position + 1 } : b)),
      });
    }
  }

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

  // THE STORY FLOW'S BREAKS SHIFT TOO (#338).
  //
  // A shooting order's breaks have always been moved up when a frame above them
  // was deleted. The story flow's were not — so deleting a frame above LUNCH
  // slid LUNCH down by one, and deleting enough of them left it hanging past the
  // last frame with nothing under it.
  //
  // A break sits where the user put it. If the frame above it goes, the break
  // has to come with it to stay in the same place on screen.
  const flowIdx = s.frames.findIndex((f) => f.id === frameId);
  if (flowIdx >= 0 && (s.storyFlowBreaks?.length ?? 0) > 0) {
    useStore.setState({
      storyFlowBreaks: s.storyFlowBreaks.map((b) =>
        (b.position > flowIdx ? { ...b, position: b.position - 1 } : b)),
    });
  }

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
  // Persist bracket state before closing so it survives reopen / browser close
  const editView = document.getElementById('sortEditView');
  if (editView) {
    const bracketState = (editView as any).__bracketState as BracketState | undefined;
    const sortedSnapshot = (editView as any).__sortedSnapshot as number[] | undefined;
    const editingId = state().sortEditingId;
    if (bracketState && editingId) {
      persistBracketToOrder(editingId, bracketState, sortedSnapshot);
    }
  }

  useStore.setState({ sortMode: false, sortEditingId: null });
  // ...and now ask for whatever arrived while the order was open (#380). The
  // fetching was held, not cancelled — this is where it catches up.
  pullNow();
  const dropdown = document.getElementById('sortDropdown');
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }
  if (editView) {
    // Clean up header-sync listeners
    if ((editView as any).__sortHeaderObserver) {
      ((editView as any).__sortHeaderObserver as MutationObserver).disconnect();
      (editView as any).__sortHeaderObserver = null;
    }
    if ((editView as any).__sortHeaderListeners) {
      window.removeEventListener('resize', syncSortHeaderTop);
      window.removeEventListener('scroll', syncSortHeaderTop);
      if ((editView as any).__sortOrientHandler) {
        window.removeEventListener('resize', (editView as any).__sortOrientHandler);
        (editView as any).__sortOrientHandler = null;
      }
      (editView as any).__sortHeaderListeners = false;
    }
    // Clean up beforeunload handler
    if ((editView as any).__sortUnloadHandler) {
      window.removeEventListener('beforeunload', (editView as any).__sortUnloadHandler);
      (editView as any).__sortUnloadHandler = null;
    }
    editView.style.display = 'none'; editView.innerHTML = '';
  }
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

/**
 * THE RED GROUP NAME AFTER AN ORDER'S NAME (#382).
 *
 * Roman: "when a shooting order is created in a group, it should be visible in
 * the normal SORT BY menu, marked with red text at the end of the name."
 *
 * Nothing at all for an order that belongs to the whole project — which is most
 * of them, and all of the ones made before #382.
 *
 * An order whose group has since been deleted keeps its groupId and finds
 * nothing here. It shows unmarked rather than saying the name of a group that
 * is gone, and it still opens: the frames are all still in the project.
 */
export function orderGroupName(order: SortOrder): string | null {
  if (order.groupId == null) return null;
  const group = state().groups.find((g) => g.id === order.groupId);
  return group ? group.name : null;
}

function groupSuffix(order: SortOrder): string {
  const name = orderGroupName(order);
  if (!name) return '';
  return ` <span class="sort-dd-group">/ ${escH(name)}</span>`;
}

/**
 * THE MENU IS IN TWO PARTS (#383).
 *
 * Roman: "we should have always at first position the STORY FLOW and all
 * shooting orders from ALL, then a black separator, and then the GROUP's story
 * flow and shooting order."
 *
 * Why it had to change: there is ONE list of orders for the whole project, and
 * an order made inside a group sat in it like any other. So the first order a
 * person made — inside a group — became the only one on show, and ALL had
 * nothing of its own left in the menu at all. "what's also missing in the SORT
 * BY is the shooting order of ALL."
 *
 * Above the line is the project: its story flow and every order belonging to no
 * group. Below it, every group: its own story flow, then its own orders. A
 * group's story flow is not a new thing — group.frameIds has always been the
 * group's own frame order — it simply had no way of being chosen until now.
 */
function renderDropdown(el: HTMLElement): void {
  const s = state();
  const activeId = s.activeSortOrderId;
  const here = s.activeGroupId;

  const ofGroup = (gid: number | null) =>
    s.sortOrders.filter((o) => (o.groupId ?? null) === gid);

  const orderLine = (order: SortOrder, deletable: boolean) => `
      <div class="sort-dd-item${activeId === order.id ? ' sort-dd-selected' : ''}" data-sort-id="${order.id}">
        <div class="sort-dd-item-left">
          <div class="sort-dd-title-row">
            <span class="sort-dd-title">${escH(order.name)}</span>${groupSuffix(order)}
          </div>
          <div class="sort-dd-hint">Your custom frame order</div>
        </div>
        ${deletable ? `<button class="sort-dd-delete" data-sort-delete="${order.id}" title="Delete order">&times;</button>` : ''}
      </div>`;

  const addLine = (gid: number | null) => `
      <div class="sort-dd-item sort-dd-add" data-sort-action="add"${gid === null ? '' : ` data-add-group="${gid}"`}>
        <span>+ ADD ORDER</span>
      </div>`;

  let html = `<div class="sort-dd-inner">`;

  // ── The project ────────────────────────────────────────────────────
  // Selected only when you are in ALL: story flow means "wherever I am", so in
  // a group it is the group's line below that is the one you are on.
  const onProjectFlow = activeId === null && here === null;
  html += `
    <div class="sort-dd-item${onProjectFlow ? ' sort-dd-selected' : ''}" data-sort-id="__storyflow__">
      <div class="sort-dd-item-left">
        <div class="sort-dd-title">STORY FLOW</div>
        <div class="sort-dd-hint">Your narrative sequence, as edited</div>
      </div>
    </div>`;

  const projectOrders = ofGroup(null);
  if (projectOrders.length === 0) {
    // Nothing of the project's own yet — the placeholder makes one on click.
    // It has to be here even when a group already has orders, or ALL has no way
    // of ever getting its first one.
    html += `
      <div class="sort-dd-item" data-sort-id="__shooting_new__">
        <div class="sort-dd-item-left">
          <div class="sort-dd-title-row">
            <span class="sort-dd-title">SHOOTING ORDER</span>
          </div>
          <div class="sort-dd-hint">Your custom frame order</div>
        </div>
      </div>`;
  } else {
    // The first one has no delete, as before: it is the one the app falls back
    // to and a person should not be able to leave the project with none.
    projectOrders.forEach((o, i) => { html += orderLine(o, i > 0); });
  }
  // ONE + ADD ORDER PER BLOCK (#383).
  //
  // There used to be a single one at the very bottom, which made an order in
  // whichever group you happened to be in. That was readable when the menu only
  // ever showed one set of orders. Now every group is on screen at once, a
  // button at the bottom cannot say what it would add to. Under each block it
  // can only mean one thing.
  html += addLine(null);

  // ── Each group ─────────────────────────────────────────────────────
  // ONE BREAK BEFORE EVERY GROUP. It started as a single line dividing the
  // project from the groups, which left two or three groups running together
  // as one column of names. Roman: "after each group has to be a dark break and
  // then another group."
  for (const g of s.groups) {
    html += `<div class="sort-dd-sep"></div>`;
    const onThisFlow = activeId === null && here === g.id;
    html += `
      <div class="sort-dd-item${onThisFlow ? ' sort-dd-selected' : ''}" data-sort-id="__storyflow__:${g.id}">
        <div class="sort-dd-item-left">
          <div class="sort-dd-title-row">
            <span class="sort-dd-title">STORY FLOW</span> <span class="sort-dd-group">/ ${escH(g.name)}</span>
          </div>
          <div class="sort-dd-hint">Your narrative sequence, as edited</div>
        </div>
      </div>`;
    for (const o of ofGroup(g.id)) html += orderLine(o, true);
    html += addLine(g.id);
  }

  html += `</div>`;
  el.innerHTML = html;

  // Wire delete buttons (stop propagation so it doesn't open the order)
  el.querySelectorAll('.sort-dd-delete').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const delId = (btn as HTMLElement).dataset.sortDelete!;
      // Confirmation modal
      if (document.querySelector('.sort-bracket-confirm')) return;
      const modal = document.createElement('div');
      modal.className = 'sort-bracket-confirm';
      modal.innerHTML = `
        <div class="sort-bracket-confirm-inner">
          <div class="sort-bracket-confirm-text">Are you sure you want to delete this shooting order?</div>
          <div class="sort-bracket-confirm-btns">
            <button class="sort-bracket-confirm-yes">Yes</button>
            <button class="sort-bracket-confirm-no">No</button>
          </div>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('.sort-bracket-confirm-yes')!.addEventListener('click', (ev) => {
        ev.stopPropagation();
        modal.remove();
        const s2 = state();
        const updated = s2.sortOrders.filter((o) => o.id !== delId);
        const newActive = s2.activeSortOrderId === delId ? null : s2.activeSortOrderId;
        useStore.setState({ sortOrders: updated, activeSortOrderId: newActive });
        bumpRenderTick();
        void flushSyncNow();
        renderDropdown(el);
      });
      modal.querySelector('.sort-bracket-confirm-no')!.addEventListener('click', (ev) => {
        ev.stopPropagation();
        modal.remove();
      });
    });
  });

  // Wire events — clicking any order opens its frame-set view
  el.querySelectorAll('.sort-dd-item[data-sort-id]').forEach((item) => {
    item.addEventListener('click', () => {
      const id = (item as HTMLElement).dataset.sortId!;
      openOrderView(id);
    });
  });

  // EACH + ADD ORDER ADDS TO ITS OWN BLOCK (#383). querySelector took only the
  // first one when there was only ever one; there is now one per block, and
  // each says which group it belongs to.
  el.querySelectorAll('.sort-dd-add').forEach((btn) => {
    btn.addEventListener('click', () => {
      const raw = (btn as HTMLElement).dataset.addGroup;
      const gid = raw === undefined ? null : Number(raw);
      // Go there first, so the order is built from that group's frames and is
      // stamped with it — addNewOrder reads both from where the app is.
      if (gid !== state().activeGroupId) enterGroup(gid);
      addNewOrder();
    });
  });
}

/** Open frame-set view for any order — handles story flow + auto-creates shooting order */
export function openOrderView(orderId: string): void {
  if (orderId === '__shooting_new__') {
    // Auto-create first shooting order on first click
    const s = state();
    const id = genId('sort', s.nextSortOrderId);
    const frameOrder = getVisibleFrames().map((f) => f.id);
    const newOrder: SortOrder = {
      id,
      name: 'SHOOTING ORDER 1',
      description: 'Your custom frame order',
      frameOrder,
      breaks: [],
      // frameOrder above came from getVisibleFrames(), so if a group is open
      // this order holds only that group's frames. Say so — and say nothing at
      // all when there is no group, see addNewOrder for why (#382).
      ...(s.activeGroupId !== null ? { groupId: s.activeGroupId } : {}),
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

  if (orderId === '__storyflow__' || orderId.startsWith('__storyflow__:')) {
    // A STORY FLOW BELONGS TO SOMEWHERE (#383).
    //
    // It used to be one line meaning "the flow of wherever I happen to be", so
    // choosing it did nothing at all — you stayed where you were. Roman: "when
    // you select story flow it does not take you to that flow."
    //
    // There is now one line per group plus the project's own, and choosing one
    // goes there: `__storyflow__` is the project, `__storyflow__:12` is group
    // 12. The flow itself is not new — group.frameIds has always been the
    // group's own frame order — it simply had no way of being chosen.
    const bit = orderId.slice('__storyflow__:'.length);
    const wantGroup = orderId === '__storyflow__' ? null : Number(bit);
    const stillThere = wantGroup === null
      || state().groups.some((g) => g.id === wantGroup);
    useStore.setState({ activeSortOrderId: null });
    // Through the app's one way of changing group, which redraws (#383).
    if (stillThere && wantGroup !== state().activeGroupId) enterGroup(wantGroup);
  } else {
    // PICKING A GROUP'S ORDER TAKES YOU INTO THAT GROUP (#382).
    //
    // Roman: "the moment the user selects it, it changes into that group view."
    // The order holds only that group's frames, so this is also what makes it
    // readable: without the switch you get a short list of frames sitting in
    // ALL with no explanation.
    //
    // The other way round is here for the same reason: picking a whole-project
    // order while a group is open goes back to ALL, otherwise the order is full
    // of frames the view is hiding. NOT SEPARATELY ASKED FOR — say so if it is
    // wrong and it comes straight back out.
    //
    // The group's name is in the view bar either way, put there by
    // updateGroupButtonState() on the redraw below.
    const order = state().sortOrders.find((o) => o.id === orderId);
    const wantGroup = order ? (order.groupId ?? null) : null;
    const goingSomewhereElse = order != null && wantGroup !== state().activeGroupId;
    // A group that has since been deleted is not somewhere to go. The order
    // still opens, in whatever view you are in.
    const groupStillThere = wantGroup === null
      || state().groups.some((g) => g.id === wantGroup);

    useStore.setState({ activeSortOrderId: orderId });
    // Through enterGroup, which is the app's one way of changing group and the
    // only thing that redraws the view bar with it (#383).
    if (goingSomewhereElse && groupStillThere) enterGroup(wantGroup);
  }
  bumpRenderTick();
  void flushSyncNow();
  openSortEditView(orderId);
}

// ─── Add new order ────────────────────────────────────────────────────

/**
 * + ADD ORDER.
 *
 * `name` is only ever passed by the test door (#382), and it exists so that an
 * order is never SENT under a name it is about to lose. Without it the door had
 * to make the order and rename it a moment later — but the making pushes, so
 * the placeholder name reached the server and the other device, and then
 * disappeared when the real name arrived. The random day caught exactly that:
 * `shooting order "SHOOTING ORDER 2" disappeared`.
 *
 * The button itself passes nothing and names orders as it always did.
 */
export function addNewOrder(name?: string): void {
  const s = state();
  const id = genId('sort', s.nextSortOrderId);
  const frameOrder = getVisibleFrames().map((f) => f.id);
  // Auto-increment name: SHOOTING ORDER 1 exists by default, so find next number
  const existingNames = s.sortOrders.map((o) => o.name);
  let num = 2;
  while (existingNames.includes(`SHOOTING ORDER ${num}`)) num++;
  const newOrder: SortOrder = {
    id,
    name: name ?? `SHOOTING ORDER ${num}`,
    description: 'Your custom frame order',
    frameOrder,
    breaks: [],
    // AN ORDER WITH NO GROUP CARRIES NO KEY AT ALL (#382).
    //
    // This said `groupId: s.activeGroupId`, which put `groupId: null` on every
    // ordinary order. The server is only sent the key when it is set, so the
    // same order was one shape here and another shape coming back — and the app
    // decides its settings have changed by comparing those. #337/#343 is the
    // same fault written up: change the SHAPE of a settings value and the app
    // thinks it has changed on every pass, pushes, and the two devices start
    // filing decisions against each other. The random day showed it as
    // `1 sort order decision(s) waiting` with each device keeping its own
    // frames and neither ever taking the other's.
    ...(s.activeGroupId !== null ? { groupId: s.activeGroupId } : {}),
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

export function openSortEditView(orderId: string): void {
  const dropdown = document.getElementById('sortDropdown');
  if (dropdown) { dropdown.style.display = 'none'; dropdown.innerHTML = ''; }

  const editView = document.getElementById('sortEditView');
  if (!editView) return;

  // Clear previous order's bracket state — each order has its own
  (editView as any).__bracketState = undefined;
  (editView as any).__sortedSnapshot = undefined;
  (editView as any).__bracketActive = false;
  (editView as any).__pendingConfirm = false;
  (editView as any).__activeReorderFid = null;
  (editView as any).__activeBreakId = null;

  // Hide normal content (columns area)
  const columns = document.querySelector('.columns') as HTMLElement | null;
  if (columns) columns.style.display = 'none';

  useStore.setState({ sortEditingId: orderId });
  editView.style.display = '';
  window.scrollTo(0, 0); // Start at top so toolbar is visible
  renderSortEditView(editView, orderId);

  // Persist bracket if browser closes mid-sort
  const unloadHandler = () => {
    const bs = (editView as any).__bracketState as BracketState | undefined;
    const snap = (editView as any).__sortedSnapshot as number[] | undefined;
    if (bs && orderId) persistBracketToOrder(orderId, bs, snap);
  };
  window.addEventListener('beforeunload', unloadHandler);
  (editView as any).__sortUnloadHandler = unloadHandler;

  // Keep sort-edit header synced on resize, scroll, and when detail-bar toggles
  if (!(editView as any).__sortHeaderListeners) {
    (editView as any).__sortHeaderListeners = true;
    window.addEventListener('resize', syncSortHeaderTop);
    window.addEventListener('scroll', syncSortHeaderTop, { passive: true } as any);
    // Watch for body.detail-open class changes so header repositions when detail-bar shows/hides
    const obs = new MutationObserver(() => syncSortHeaderTop());
    obs.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    (editView as any).__sortHeaderObserver = obs;
    // iPhone: show rotate overlay when switching to portrait while bracket is active
    const sortOrientHandler = () => {
      const isPhone = Math.min(window.innerWidth, window.innerHeight) <= 430;
      if (!isPhone) return;
      const ev = document.getElementById('sortEditView');
      if (!ev || !state().sortEditingId) return;
      if (window.innerHeight > window.innerWidth && (ev as any).__bracketActive) {
        // Rotated to portrait while bracket active — deactivate bracket, keep sort view
        (ev as any).__bracketActive = false;
        (ev as any).__pendingConfirm = false;
        renderSortEditView(ev, state().sortEditingId!);
        const overlay = document.getElementById('sortRotateMsg');
        if (overlay) {
          overlay.classList.add('show');
          const dismiss = () => { overlay.classList.remove('show'); };
          overlay.addEventListener('click', dismiss, { once: true });
          setTimeout(dismiss, 4000);
        }
      }
    };
    window.addEventListener('resize', sortOrientHandler);
    (editView as any).__sortOrientHandler = sortOrientHandler;
  }
}

/**
 * REDRAW THE OPEN SHOOTING ORDER, WITHOUT CLOSING IT (#357).
 *
 * A pull used to close the order you were editing before rebuilding the project,
 * so anything that made a change — naming a break, moving one, making a group —
 * pushed, pulled, and threw you out of the order and into 3x2. Roman reported it
 * three times in three different words.
 *
 * The order does have to be redrawn after a rebuild, because the frames it lists
 * are new objects. Redrawing it is all that was ever needed.
 */
export function refreshOpenSortView(): void {
  const orderId = state().sortEditingId;
  if (!orderId) return;
  const el = document.getElementById('sortEditView');
  if (!el || el.style.display === 'none') return;
  renderSortEditView(el, orderId);
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

  // SAY WHAT THIS VIEW IS ABOUT TO SHOW (#400).
  //
  // Roman: frames he had just made are missing from the story flow and from a
  // shooting order until he draws on them — and still missing after a reload.
  // Reading the code says that cannot happen: the story flow lists
  // getVisibleFrames() with no filter of any kind, and 3x2 lists the same thing
  // and hides MORE (hidden frames), yet 3x2 shows them.
  //
  // So the reading is wrong somewhere. This says which list it is building, how
  // many frames it has, and which frames the project holds that did NOT make it
  // into that list — which is the answer, whatever it turns out to be.
  {
    const inProject = state().frames;
    const shown = new Set(frames.map((f) => f.id));
    const missing = inProject.filter((f) => !shown.has(f.id));
    const g = state().activeGroupId;
    const gName = g === null ? 'ALL' : (state().groups.find((x) => x.id === g)?.name ?? `group ${g}`);
    trace(`sort view: ${orderId} · in ${gName} · showing ${frames.length} of ${inProject.length}`
      + (missing.length
        ? ` · MISSING: ${missing.map((f) => `${f.label || f.id}${f.serverFrameId ? '' : ' (no id)'}${f.hidden ? ' (hidden)' : ''}`).join(', ')}`
        : ' · none missing'));
  }

  const activeReorderFid = (el as any).__activeReorderFid as number | null ?? null;
  const activeBreakId = (el as any).__activeBreakId as string | null ?? null;
  const bracketActive = (el as any).__bracketActive as boolean ?? false;

  let html = `<div class="sort-edit-inner">`;

  // Detect manual reorder (compare to snapshot from last SORT NOW)
  const sortedSnapshot = (el as any).__sortedSnapshot as number[] | undefined;
  let hasManualChanges = false;
  if (sortedSnapshot) {
    const currentVisibleIds = frames.map((f) => f.id);
    hasManualChanges = sortedSnapshot.length !== currentVisibleIds.length ||
      sortedSnapshot.some((id, i) => id !== currentVisibleIds[i]);
  }

  // Header — breadcrumb + ADD BREAK button for custom orders
  // Name is always tappable to edit (independent of bracket state)
  html += `
    <div class="sort-edit-header">
      <div class="sort-edit-header-left">
        <span class="sort-edit-label">name:</span>
        <span class="sort-edit-sep">&rsaquo;</span>
        ${orderId !== '__storyflow__'
          ? `<span class="sort-edit-name-static" data-sort-namelabel="${orderId}">${orderName}</span>
             <input class="sort-edit-name sort-edit-name-hidden" value="${orderName}" data-sort-rename="${orderId}" />`
          : `<span class="sort-edit-name-static">${orderName}</span>`}
      </div>
      <div class="sort-edit-header-right">
        ${orderId !== '__storyflow__' ? (bracketActive
          ? `<div class="sort-edit-sort-wrap"><span class="sort-edit-sort-hint">sort frames by<br>bracket below</span><button class="sort-edit-rename-btn sort-edit-save-btn" data-sort-action="rename">SORT NOW</button></div>`
          : `<button class="sort-edit-rename-btn" data-sort-action="rename">EDIT ORDER</button>`)
        : ''}
        <button class="sort-edit-add-break-btn" data-sort-action="addbreak">ADD BREAK</button>
      </div>
    </div>`;

  // Bracket area — active (editable) or frozen (read-only after SORT NOW)
  // Restore persisted bracket from SortOrder if not already in DOM
  if (!(el as any).__bracketState && orderId !== '__storyflow__') {
    const persistedOrder = order;
    if (persistedOrder?.bracketTree) {
      (el as any).__bracketState = { root: deserializeBracket(persistedOrder.bracketTree) };
      if (persistedOrder.sortedSnapshot && !(el as any).__sortedSnapshot) {
        (el as any).__sortedSnapshot = [...persistedOrder.sortedSnapshot];
      }
    }
  }
  const bracketState = (el as any).__bracketState as BracketState | undefined;
  const pendingConfirm = (el as any).__pendingConfirm as boolean ?? false;
  if (bracketActive && orderId !== '__storyflow__') {
    const allFrameIds = frames.map((f) => f.id);
    let bs = bracketState;
    if (!bs) {
      bs = { root: createEmptyNode(allFrameIds) };
      (el as any).__bracketState = bs;
    }
    // Auto-sync: add new frames, remove deleted ones
    syncBracketWithVisibleFrames(bs.root, allFrameIds);
    // Compute affected nodes for per-branch conflict handling
    let affectedNodes: Set<BracketNode> | undefined;
    if (pendingConfirm && hasManualChanges && sortedSnapshot) {
      affectedNodes = getAffectedNodes(bs.root, sortedSnapshot, allFrameIds);
      // Store on el for wireBracketEvents to use
      (el as any).__affectedNodes = affectedNodes;
      html += `<div class="sort-bracket-warning">You modified the order manually</div>`;
    } else {
      (el as any).__affectedNodes = undefined;
    }
    html += renderBracketArea(bs, orderId, affectedNodes);
  } else if (bracketState && !bracketActive && orderId !== '__storyflow__') {
    // Auto-sync frozen bracket too
    syncBracketWithVisibleFrames(bracketState.root, frames.map((f) => f.id));
    // Frozen bracket — show read-only after SORT NOW
    if (hasManualChanges) {
      html += `<div class="sort-bracket-warning">You modified the order manually</div>`;
    }
    html += `<div class="sort-bracket-frozen">${renderBracketArea(bracketState, orderId)}</div>`;
  }

  // Frame sets — dimmed and non-interactive while bracket is active
  if (bracketActive) html += `<div class="sort-cards-dimmed">`;

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

  if (bracketActive) html += `</div>`;

  html += `</div>`;
  el.innerHTML = html;

  // Reorder pills to match current frame order, then mark moved ones red
  if (sortedSnapshot && hasManualChanges) {
    const bracketEl = el.querySelector('.sort-bracket-frozen') || el.querySelector('.sort-bracket');
    if (bracketEl) {
      reorderPillsByCurrentOrder(bracketEl as HTMLElement, sortedSnapshot, frames.map((f) => f.id));
      markMovedPills(bracketEl as HTMLElement, sortedSnapshot, frames.map((f) => f.id));
    }
  }

  // Wire events
  wireEditViewEvents(el, orderId);

  // No auto-focus. Input is readonly in HTML; tap handler removes readonly + focuses with preventScroll.

  // Fill in sketch images that need rasterization (async, non-blocking)
  void fillRasterizedImages(el);

  // Sync header sticky top to sit right below the last visible bar
  syncSortHeaderTop();
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
  // ─── Inline name editing (always available, independent of bracket) ───
  const nameLabel = el.querySelector('.sort-edit-name-static') as HTMLElement | null;
  const nameInput = el.querySelector('.sort-edit-name') as HTMLInputElement | null;
  if (nameLabel && nameInput && orderId !== '__storyflow__') {
    const commitName = () => {
      const val = nameInput.value.trim();
      if (val && val !== nameLabel.textContent) {
        nameLabel.textContent = val;
        const s = state();
        const orders = s.sortOrders.map((o) =>
          o.id === orderId ? { ...o, name: val } : o
        );
        useStore.setState({ sortOrders: orders });
        bumpRenderTick();
        void flushSyncNow();
      }
      nameInput.classList.add('sort-edit-name-hidden');
      nameLabel.classList.remove('sort-edit-name-hidden');
    };
    const isPhoneName = Math.min(window.innerWidth, window.innerHeight) <= 430;
    const hasTouchName = navigator.maxTouchPoints > 0;

    const showNameInput = (e: Event) => {
      e.stopPropagation();
      nameLabel.classList.add('sort-edit-name-hidden');
      nameInput.classList.remove('sort-edit-name-hidden');

      if (isPhoneName) {
        nameInput.focus();
        nameInput.select();
      } else if (hasTouchName) {
        // iPad: prevent iOS scroll, focus manually without scrolling
        e.preventDefault();
        nameInput.focus({ preventScroll: true });
        nameInput.select();
        useStore.setState({ scrollHideGuard: Date.now() + 1200 });
        setTimeout(() => {
          const vv = window.visualViewport;
          if (!vv) return;
          const rect = nameInput.getBoundingClientRect();
          if (rect.bottom > vv.height) {
            useStore.setState({ scrollHideGuard: Date.now() + 800 });
            nameInput.scrollIntoView({ block: 'center', behavior: 'smooth' });
          } else {
            // Physical keyboard — scroll header to 25% then freeze body
            const header = nameInput.closest('.sort-edit-header');
            useStore.setState({ scrollHideGuard: Date.now() + 800 });
            const headerTop = header ? header.getBoundingClientRect().top + window.scrollY : window.scrollY;
            const lockY = Math.max(0, headerTop - window.innerHeight * 0.25);
            window.scrollTo(0, lockY);
            document.body.style.position = 'fixed';
            document.body.style.top = `-${lockY}px`;
            document.body.style.width = '100%';
            document.body.style.overflow = 'hidden';
          }
        }, 500);
      } else {
        nameInput.focus();
        nameInput.select();
      }
    };

    nameLabel.addEventListener('click', showNameInput);

    nameInput.addEventListener('blur', () => {
      // Unlock body if it was locked for physical keyboard
      if (document.body.style.position === 'fixed') {
        const lockY = Math.abs(parseInt(document.body.style.top || '0', 10));
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.width = '';
        document.body.style.overflow = '';
        window.scrollTo(0, lockY);
      }
      commitName();
    });
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); }
      if (e.key === 'Escape') { nameInput.value = nameLabel.textContent || ''; nameInput.blur(); }
    });
  }

  // ─── EDIT / SORT NOW button — toggles bracket area ───
  const renameBtn = el.querySelector('[data-sort-action="rename"]') as HTMLElement | null;
  if (renameBtn) {
    renameBtn.addEventListener('click', () => {
      const isSorting = renameBtn.textContent === 'SORT NOW';
      if (isSorting) {
        const pendingConfirm = (el as any).__pendingConfirm as boolean ?? false;
        const bracketState = (el as any).__bracketState as BracketState | undefined;
        const s = state();

        // Build the final frame order from the bracket
        let newFrameOrder: number[] | null = null;
        let finalBracketOrder: number[] | undefined;
        const affectedNodes = (el as any).__affectedNodes as Set<BracketNode> | undefined;

        if (bracketState) {
          // Always get the raw bracket order (used for snapshot + non-affected frames)
          const rawBracketOrder = flattenBracketOrder(bracketState.root);

          if (pendingConfirm && affectedNodes && affectedNodes.size > 0) {
            // Hybrid: bracket order for unaffected, manual positions for affected frames
            const affectedFrameIds = new Set<number>();
            for (const node of affectedNodes) {
              for (const id of node.matchedIds) affectedFrameIds.add(id);
            }
            const order = s.sortOrders.find((o) => o.id === orderId);
            if (order) {
              const currentCardOrder = getOrderedFrames(order).map((f) => f.id);
              const manualQueue = currentCardOrder.filter((id) => affectedFrameIds.has(id));
              let mi = 0;
              finalBracketOrder = rawBracketOrder.map((id) => {
                if (affectedFrameIds.has(id)) return manualQueue[mi++] ?? id;
                return id;
              });
            } else {
              finalBracketOrder = rawBracketOrder;
            }
            // Snapshot = raw bracket order (not hybrid) so affected frames show as red pills
            (el as any).__sortedSnapshot = rawBracketOrder;
          } else {
            // No manual changes or all resolved — apply bracket order as-is
            finalBracketOrder = rawBracketOrder;
            (el as any).__sortedSnapshot = rawBracketOrder;
          }

          const order = s.sortOrders.find((o) => o.id === orderId);
          if (order) {
            const visibleSet = new Set(getVisibleFrames().map((f) => f.id));
            newFrameOrder = [];
            let bi = 0;
            for (const fid of order.frameOrder) {
              if (visibleSet.has(fid)) {
                if (bi < finalBracketOrder!.length) newFrameOrder.push(finalBracketOrder![bi++]);
              } else {
                newFrameOrder.push(fid);
              }
            }
            while (bi < finalBracketOrder!.length) newFrameOrder.push(finalBracketOrder![bi++]);
          }
        }

        // Clear pending state
        (el as any).__pendingConfirm = false;
        (el as any).__affectedNodes = undefined;

        const orders = s.sortOrders.map((o) => {
          if (o.id !== orderId) return o;
          const updated = { ...o };
          if (newFrameOrder) updated.frameOrder = newFrameOrder;
          return updated;
        });
        useStore.setState({ sortOrders: orders });
        if (bracketState) {
          persistBracketToOrder(orderId, bracketState, (el as any).__sortedSnapshot);
        }
        bumpRenderTick();

        // Freeze bracket (keep state, disable editing)
        (el as any).__bracketActive = false;
        void flushSyncNow();
        renderSortEditView(el, orderId);
      } else {
        // iPhone portrait: show rotate overlay instead of entering edit mode
        const isPhoneEdit = Math.min(window.innerWidth, window.innerHeight) <= 430;
        if (isPhoneEdit && window.innerHeight > window.innerWidth) {
          const overlay = document.getElementById('sortRotateMsg');
          if (overlay) {
            overlay.classList.add('show');
            const dismiss = () => { overlay.classList.remove('show'); };
            overlay.addEventListener('click', dismiss, { once: true });
            setTimeout(dismiss, 4000);
          }
          return;
        }
        // Enter edit mode
        (el as any).__bracketActive = true;
        if ((el as any).__bracketState) {
          // Existing bracket in DOM — keep it, require confirmation before modifying
          (el as any).__pendingConfirm = true;
        } else {
          // Try to restore persisted bracket from SortOrder
          const order = state().sortOrders.find((o) => o.id === orderId);
          if (order?.bracketTree) {
            (el as any).__bracketState = { root: deserializeBracket(order.bracketTree) };
            (el as any).__sortedSnapshot = order.sortedSnapshot ? [...order.sortedSnapshot] : undefined;
            (el as any).__pendingConfirm = true;
          } else {
            // First time — fresh bracket
            (el as any).__sortedSnapshot = undefined;
          }
        }
        renderSortEditView(el, orderId);
        // Scroll to top so bracket area is visible
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    });
  }

  // Wire bracket events if bracket is visible
  const bracketEl = el.querySelector('.sort-bracket') as HTMLElement | null;
  if (bracketEl && (el as any).__bracketState) {
    wireBracketEvents(bracketEl, (el as any).__bracketState, orderId, el);
  }

  // Wire pill thumbnail tooltips (bracket + frozen bracket)
  const pillContainer = el.querySelector('.sort-bracket, .sort-bracket-frozen') as HTMLElement | null;
  if (pillContainer) {
    const s = state();
    const hasTouchPill = navigator.maxTouchPoints > 0;
    let activeThumb: HTMLElement | null = null;

    const removeThumb = () => {
      if (activeThumb) { activeThumb.remove(); activeThumb = null; }
    };

    const showThumb = (pill: HTMLElement) => {
      removeThumb();
      const fid = parseInt(pill.dataset.fid!, 10);
      const f = s.frames.find((fr) => fr.id === fid);
      if (!f || !f.src) return;
      const img = document.createElement('img');
      img.className = 'sort-pill-thumb';
      img.src = f.src;
      // Position above or below depending on space
      const rect = pill.getBoundingClientRect();
      if (rect.top > 180) {
        img.classList.add('sort-pill-thumb-above');
      } else {
        img.classList.add('sort-pill-thumb-below');
      }
      pill.appendChild(img);
      activeThumb = img;
    };

    pillContainer.querySelectorAll('.sort-bracket-pill[data-fid]').forEach((pill) => {
      if (hasTouchPill) {
        pill.addEventListener('touchstart', (e) => {
          e.stopPropagation();
          if (activeThumb && activeThumb.parentElement === pill) {
            removeThumb();
          } else {
            showThumb(pill as HTMLElement);
          }
        }, { passive: true });
      } else {
        pill.addEventListener('mouseenter', () => showThumb(pill as HTMLElement));
        pill.addEventListener('mouseleave', removeThumb);
      }
    });

    // Dismiss on touch outside (iOS)
    if (hasTouchPill) {
      el.addEventListener('touchstart', (e) => {
        if (activeThumb && !(e.target as HTMLElement).closest('.sort-bracket-pill')) {
          removeThumb();
        }
      }, { passive: true });
    }
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
  // DONE has highest priority: always persist bracket + snapshot so reload restores this state.
  el.querySelectorAll('[data-sort-deactivate]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      (el as any).__activeReorderFid = null;
      const bs = (el as any).__bracketState as BracketState | undefined;
      if (bs) {
        const snap = (el as any).__sortedSnapshot as number[] | undefined;
        persistBracketToOrder(orderId, bs, snap);
      }
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

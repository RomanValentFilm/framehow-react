// Frame Groups — sidebar panel + create/edit overlay.
// v3.8: Group frames by locations, scenes, or cutdowns.

import { state, useStore } from '../store/state';
import { uniqueNumericId } from './ids';
import type { Frame, FrameGroup } from '../store/state';
import { rasterizeMain } from './rasterize';
import { escH } from './helpers';
import { flushSyncNow } from './currentProject';
import { closeSortMode } from './sortOrder';

let _sidebarEl: HTMLElement | null = null;
let _overlayEl: HTMLElement | null = null;

// ── Helper: get frames visible under current group filter ──
// When a group is active, returns frames in the group's own order (frameIds).
export function getVisibleFrames(): Frame[] {
  const s = state();
  if (s.activeGroupId === null) return s.frames;
  const group = s.groups.find(g => g.id === s.activeGroupId);
  if (!group) return s.frames;
  const frameMap = new Map(s.frames.map(f => [f.id, f]));
  return group.frameIds
    .map(id => frameMap.get(id))
    .filter((f): f is Frame => !!f);
}

// ── Auto-add a newly created frame to the active group ──
// Also positions the frame in s.frames (ALL order) right after `afterFid`.
export function addFrameToActiveGroup(newFid: number, afterFid: number): void {
  const s = state();
  if (s.activeGroupId === null) return;
  const group = s.groups.find(g => g.id === s.activeGroupId);
  if (!group) return;
  const afterIdx = group.frameIds.indexOf(afterFid);
  const newIds = [...group.frameIds];
  if (afterIdx >= 0) {
    newIds.splice(afterIdx + 1, 0, newFid);
  } else {
    newIds.push(newFid);
  }
  const newGroups = s.groups.map(g =>
    g.id === group.id ? { ...g, frameIds: newIds } : g
  );
  useStore.setState({ groups: newGroups });
}

// ── Hide a frame within a specific group (per-group, not global) ──
export function hideFrameInGroup(fid: number, groupId?: number): void {
  const s = state();
  const gid = groupId ?? s.activeGroupId;
  if (gid === null) return;
  const newGroups = s.groups.map(g => {
    if (g.id !== gid) return g;
    const hidden = g.hiddenFrameIds || [];
    if (hidden.includes(fid)) return g;
    return { ...g, hiddenFrameIds: [...hidden, fid] };
  });
  useStore.setState({ groups: newGroups });
  void flushSyncNow(); // GRP-6: hide frame in group
}

// ── Remove a frame from a specific group (not from the project) ──
export function removeFrameFromGroup(fid: number, groupId?: number): void {
  const s = state();
  const gid = groupId ?? s.activeGroupId;
  if (gid === null) return;
  const newGroups = s.groups.map(g =>
    g.id === gid ? { ...g, frameIds: g.frameIds.filter(id => id !== fid), hiddenFrameIds: (g.hiddenFrameIds || []).filter(id => id !== fid) } : g
  );
  useStore.setState({ groups: newGroups });
}

// ── Sync ALL order after reorder in a group ──
// Moves `fid` in s.frames to sit right after the frame above it in the group.
function syncAllOrderFromGroup(fid: number, group: { frameIds: number[] }): void {
  const s = state();
  const posInGroup = group.frameIds.indexOf(fid);
  if (posInGroup < 0) return;

  // Find the frame just above in the group
  let anchorFid: number | null = null;
  for (let i = posInGroup - 1; i >= 0; i--) {
    if (s.frames.some(f => f.id === group.frameIds[i])) {
      anchorFid = group.frameIds[i];
      break;
    }
  }

  // Remove fid from s.frames
  const frameIdx = s.frames.findIndex(f => f.id === fid);
  if (frameIdx < 0) return;
  const [frame] = s.frames.splice(frameIdx, 1);

  if (anchorFid !== null) {
    // Insert right after the anchor
    const anchorIdx = s.frames.findIndex(f => f.id === anchorFid);
    s.frames.splice(anchorIdx + 1, 0, frame);
  } else {
    // No anchor above → put at the start
    s.frames.unshift(frame);
  }
}

// ── Reorder a frame within the active group ──
export function reorderFrameInGroup(fid: number, direction: 'up' | 'down'): boolean {
  const s = state();
  if (s.activeGroupId === null) return false; // no group active, use default reorder
  const group = s.groups.find(g => g.id === s.activeGroupId);
  if (!group) return false;
  const idx = group.frameIds.indexOf(fid);
  if (idx < 0) return false;
  const newIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (newIdx < 0 || newIdx >= group.frameIds.length) return false;
  // Swap in place
  const newIds = [...group.frameIds];
  [newIds[idx], newIds[newIdx]] = [newIds[newIdx], newIds[idx]];
  const newGroups = s.groups.map(g =>
    g.id === group.id ? { ...g, frameIds: newIds } : g
  );
  useStore.setState({ groups: newGroups });
  // Group order is independent from ALL order — do NOT sync to s.frames.
  return true; // handled
}

/**
 * GO INTO A GROUP, OR BACK TO ALL. null means ALL (#382).
 *
 * This was two lines inside the sidebar's click handler, reachable only by
 * clicking. It is lifted out unchanged so the app has ONE place that switches
 * group — the sidebar calls it, picking a group's shooting order calls it, and
 * a test can call the same thing the person's finger calls rather than a copy
 * of it.
 */
export function enterGroup(groupId: number | null): void {
  useStore.setState({ activeGroupId: groupId });
  // AND REDRAW, HERE, ALWAYS (#383).
  //
  // Changing the group used to be two lines inside the sidebar's click handler,
  // and the handler called triggerRerender() itself afterwards. So the redraw
  // belonged to the button, not to the switch — and when #382 made the SORT BY
  // menu switch groups too, it changed the group and drew nothing. The frames
  // changed, the red name in the view bar did not appear, and the GROUP button
  // did not go red. Roman saw exactly that.
  //
  // bumpRenderTick() is not enough and never was: nothing in the app watches
  // that counter and redraws. Only calling renderAll rebuilds the bar.
  triggerRerender();
}

/**
 * MAKE A GROUP. Lifted out of the Save button for the same reason (#382).
 * Returns the new group's id.
 */
export function createGroup(name: string, frameIds: number[]): number {
  const s = state();
  const newGroup: FrameGroup = {
    id: uniqueNumericId(),               // never a per-device count (#322)
    name,
    frameIds: [...frameIds],
    hiddenFrameIds: [],
  };
  useStore.setState({
    groups: [...s.groups, newGroup],
    nextGroupId: s.nextGroupId + 1,
  });
  return newGroup.id;
}

// ── Update GROUP button + label in ViewBar ──
export function updateGroupButtonState(): void {
  const s = state();
  const groupBtn = document.querySelector('.view-btn[data-view="group"]') as HTMLElement | null;
  if (groupBtn) {
    if (s.activeGroupId !== null) {
      groupBtn.classList.add('group-active');
    } else {
      groupBtn.classList.remove('group-active');
    }
  }
  // Update or create the group label right after the GROUP button.
  let labelEl = document.getElementById('groupActiveLabel');
  if (s.activeGroupId !== null) {
    const group = s.groups.find(g => g.id === s.activeGroupId);
    const name = group ? group.name : '';
    if (!labelEl) {
      labelEl = document.createElement('span');
      labelEl.id = 'groupActiveLabel';
      labelEl.className = 'group-active-label';
      // Insert right after the GROUP button (before 3×2)
      if (groupBtn && groupBtn.parentNode) {
        groupBtn.parentNode.insertBefore(labelEl, groupBtn.nextSibling);
      }
    }
    labelEl.textContent = name;
  } else if (labelEl) {
    labelEl.remove();
  }
}

// ── Sidebar ──

export function toggleGroupSidebar(): void {
  if (_sidebarEl) {
    closeGroupSidebar();
    return;
  }
  openGroupSidebar();
}

function openGroupSidebar(): void {
  if (_sidebarEl) return;
  const sidebar = document.createElement('div');
  sidebar.className = 'group-sidebar';
  sidebar.innerHTML = buildSidebarHTML();
  document.body.appendChild(sidebar);
  _sidebarEl = sidebar;

  // Animate in
  requestAnimationFrame(() => sidebar.classList.add('open'));

  // Wire events
  wireSidebarEvents(sidebar);

  // Click outside to close
  sidebar.addEventListener('click', (e) => {
    if (e.target === sidebar) closeGroupSidebar();
  });
}

function buildSidebarHTML(): string {
  const s = state();
  const activeId = s.activeGroupId;

  let groupsHTML = '';
  for (const g of s.groups) {
    const isActive = g.id === activeId;
    const count = g.frameIds.filter(id => s.frames.some(f => f.id === id)).length;
    groupsHTML += `
      <div class="group-item${isActive ? ' active' : ''}" data-gid="${g.id}">
        <span class="group-name">${escH(g.name)}</span>
        <span class="group-edit-btn" data-edit="${g.id}">edit</span>
        <span class="group-count">${count}</span>
      </div>`;
  }

  return `
    <div class="group-sidebar-panel">
      <div class="group-sidebar-header">
        <span style="font-weight:700;font-size:15px;">Groups</span>
        <button class="group-close-btn" title="Close">&times;</button>
      </div>
      <div class="group-item${activeId === null ? ' active' : ''}" data-gid="all">
        <span class="group-name">${_fitting() ? 'ALL TALENTS' : 'ALL FRAMES'}</span>
        <span class="group-count">${s.frames.length}</span>
      </div>
      ${groupsHTML}
      <button class="group-new-btn">+ New Group</button>
      <div class="group-subtitle">${_fitting() ? 'Sort talents into groups' : 'Sort frames by locations, scenes, or cutdowns'}</div>
    </div>`;
}

/** FITTING projects speak about talents, not frames. */
const _fitting = (): boolean => state().projectType === 'fitting';

function wireSidebarEvents(sidebar: HTMLElement): void {
  // Close button
  sidebar.querySelector('.group-close-btn')?.addEventListener('click', closeGroupSidebar);

  // Select group
  sidebar.querySelectorAll('.group-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't trigger on edit button click
      if ((e.target as HTMLElement).closest('.group-edit-btn')) return;
      // Close sort mode if active (group selection exits the frame-set view)
      if (state().sortMode) closeSortMode();
      const gid = (el as HTMLElement).dataset.gid;
      enterGroup(gid === 'all' ? null : parseInt(gid!));
      closeGroupSidebar();
      triggerRerender();
    });
  });

  // Edit buttons
  sidebar.querySelectorAll('.group-edit-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const gid = parseInt((btn as HTMLElement).dataset.edit!);
      const group = state().groups.find(g => g.id === gid);
      if (group) openGroupEditor(group);
    });
  });

  // New group button
  sidebar.querySelector('.group-new-btn')?.addEventListener('click', () => {
    openGroupEditor(null);
  });
}

export function closeGroupSidebar(): void {
  if (!_sidebarEl) return;
  _sidebarEl.classList.remove('open');
  const el = _sidebarEl;
  setTimeout(() => el.remove(), 250);
  _sidebarEl = null;
}

// ── Group Editor Overlay ──

function openGroupEditor(existing: FrameGroup | null): void {
  if (_overlayEl) _overlayEl.remove();

  const s = state();
  const selectedIds = new Set(existing ? existing.frameIds : []);

  const overlay = document.createElement('div');
  overlay.className = 'group-editor-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:100001;background:rgba(0,0,0,0.75);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;';

  const box = document.createElement('div');
  box.className = 'group-editor-box';
  box.style.cssText =
    'background:#1e1e1e;border:1px solid #444;border-radius:14px;' +
    'padding:20px 24px;max-width:560px;width:100%;color:#fff;max-height:80vh;overflow-y:auto;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

  // Build frame thumbnails from ALL frames (not filtered by active group)
  let framesHTML = '';
  for (const f of s.frames) {
    const checked = selectedIds.has(f.id);
    const thumbSrc = f.src || '';
    const label = (f.label || `Frame ${f.id}`) + (f.hidden ? ' (hidden)' : '');
    const desc = f.textContent ? f.textContent.substring(0, 60) + (f.textContent.length > 60 ? '…' : '') : '';
    framesHTML += `
      <label class="group-frame-toggle" data-fid="${f.id}" style="
        display:flex;align-items:center;gap:12px;padding:8px 10px;
        border-radius:8px;cursor:pointer;
        background:${checked ? 'rgba(213,38,50,0.15)' : 'transparent'};
        border:1px solid ${checked ? '#d52632' : '#333'};
      ">
        <input type="checkbox" data-fid="${f.id}" ${checked ? 'checked' : ''} style="
          width:18px;height:18px;accent-color:#d52632;cursor:pointer;flex-shrink:0;
        ">
        ${thumbSrc
          ? `<img data-thumb-fid="${f.id}" src="${thumbSrc}" style="width:115px;height:77px;object-fit:cover;border-radius:4px;flex-shrink:0;">`
          : `<div style="width:115px;height:77px;background:#333;border-radius:4px;flex-shrink:0;"></div>`}
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${escH(label)}</div>
          ${desc ? `<div style="font-size:11px;color:#888;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escH(desc)}</div>` : ''}
        </div>
      </label>`;
  }

  box.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-weight:700;font-size:15px;margin-bottom:12px;">
        ${existing ? 'Edit Group' : 'New Group'}
      </div>
      <input type="text" class="group-name-input" value="${existing ? escH(existing.name) : ''}"
        placeholder="${_fitting() ? 'Group name (e.g. Scene 1, Main talents)' : 'Group name (e.g. Kitchen, Scene 2)'}" autocomplete="one-time-code"
        style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #555;
        background:#2a2a2a;color:#fff;font-size:14px;outline:none;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
    </div>
    <div style="display:flex;gap:8px;margin-bottom:10px;">
      <button class="group-select-all-btn" style="
        padding:6px 14px;border-radius:6px;border:1px solid #555;
        background:#2a2a2a;color:#ccc;font-size:12px;font-weight:500;cursor:pointer;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      ">Select All</button>
      <button class="group-deselect-all-btn" style="
        padding:6px 14px;border-radius:6px;border:1px solid #555;
        background:#2a2a2a;color:#ccc;font-size:12px;font-weight:500;cursor:pointer;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      ">Deselect All</button>
    </div>
    <div class="group-frames-list" style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
      ${framesHTML}
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      ${existing ? `<button class="group-delete-btn" style="
        padding:10px 18px;border-radius:8px;border:1px solid #d52632;
        background:transparent;color:#d52632;font-size:14px;font-weight:600;
        cursor:pointer;margin-right:auto;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      ">Delete</button>` : ''}
      <button class="group-cancel-btn" style="
        padding:10px 18px;border-radius:8px;border:1px solid #555;
        background:#2a2a2a;color:#ccc;font-size:14px;font-weight:500;cursor:pointer;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      ">Cancel</button>
      <button class="group-save-btn" style="
        padding:10px 18px;border-radius:8px;border:none;
        background:#d52632;color:#fff;font-size:14px;font-weight:600;cursor:pointer;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      ">Save</button>
    </div>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _overlayEl = overlay;

  // Focus name input
  const nameInput = box.querySelector('.group-name-input') as HTMLInputElement;
  setTimeout(() => nameInput.focus(), 100);

  // Async: render thumbnails with strokes overlaid
  for (const f of s.frames) {
    if (!f.src && (!f.strokes || !f.strokes.length)) continue;
    const img = box.querySelector(`img[data-thumb-fid="${f.id}"]`) as HTMLImageElement | null;
    if (!img) continue;
    rasterizeMain(f, 0.5).then(cvs => {
      try { img.src = cvs.toDataURL('image/jpeg', 0.7); } catch {}
    }).catch(() => {});
  }

  // Toggle visual feedback on checkboxes
  function updateToggleVisual(cb: Element) {
    const label = cb.closest('.group-frame-toggle') as HTMLElement;
    const checked = (cb as HTMLInputElement).checked;
    label.style.background = checked ? 'rgba(213,38,50,0.15)' : 'transparent';
    label.style.borderColor = checked ? '#d52632' : '#333';
  }
  box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => updateToggleVisual(cb));
  });

  // Select All / Deselect All
  box.querySelector('.group-select-all-btn')?.addEventListener('click', () => {
    box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      (cb as HTMLInputElement).checked = true;
      updateToggleVisual(cb);
    });
  });
  box.querySelector('.group-deselect-all-btn')?.addEventListener('click', () => {
    box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      (cb as HTMLInputElement).checked = false;
      updateToggleVisual(cb);
    });
  });

  // Cancel
  box.querySelector('.group-cancel-btn')?.addEventListener('click', () => closeEditor());
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeEditor(); });

  // Delete
  box.querySelector('.group-delete-btn')?.addEventListener('click', () => {
    if (existing) {
      const s = state();
      const newGroups = s.groups.filter(g => g.id !== existing.id);
      const newActiveId = s.activeGroupId === existing.id ? null : s.activeGroupId;
      useStore.setState({ groups: newGroups, activeGroupId: newActiveId });
      closeEditor();
      refreshSidebar();
      triggerRerender();
      void flushSyncNow(); // GRP-3: delete group → confirm
    }
  });

  // Save
  box.querySelector('.group-save-btn')?.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.style.borderColor = '#d52632';
      nameInput.focus();
      return;
    }
    const checkedIds: number[] = [];
    box.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
      checkedIds.push(parseInt((cb as HTMLElement).dataset.fid!));
    });

    const s = state();
    if (existing) {
      // Update existing
      const newGroups = s.groups.map(g =>
        g.id === existing.id ? { ...g, name, frameIds: checkedIds, hiddenFrameIds: [] } : g
      );
      useStore.setState({ groups: newGroups });
    } else {
      createGroup(name, checkedIds);
    }
    closeEditor();
    refreshSidebar();
    triggerRerender();
    void flushSyncNow(); // GRP-1/GRP-2: create or edit group → Save
  });
}

function closeEditor(): void {
  if (_overlayEl) {
    _overlayEl.remove();
    _overlayEl = null;
  }
}

function refreshSidebar(): void {
  if (!_sidebarEl) return;
  const panel = _sidebarEl.querySelector('.group-sidebar-panel');
  if (panel) {
    _sidebarEl.innerHTML = buildSidebarHTML();
    _sidebarEl.classList.add('open');
    wireSidebarEvents(_sidebarEl);
  }
}

function triggerRerender(): void {
  updateGroupButtonState();
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
}

// Frame Groups — sidebar panel + create/edit overlay.
// v3.8: Group frames by locations, scenes, or cutdowns.

import { state, useStore } from '../store/state';
import type { Frame, FrameGroup } from '../store/state';

let _sidebarEl: HTMLElement | null = null;
let _overlayEl: HTMLElement | null = null;

// ── Helper: get frames visible under current group filter ──
// When a group is active, returns frames in the group's own order (frameIds).
export function getVisibleFrames(): Frame[] {
  const s = state();
  if (s.activeGroupId === null) return s.frames;
  const group = s.groups.find(g => g.id === s.activeGroupId);
  if (!group) return s.frames;
  // Build a map for O(1) lookup
  const frameMap = new Map(s.frames.map(f => [f.id, f]));
  // Return in group's frameIds order (preserves per-group reorder)
  return group.frameIds.map(id => frameMap.get(id)).filter((f): f is Frame => !!f);
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
  return true; // handled
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
  // Update or create the group label inside vb-left (after the buttons).
  // vb-left has flex:1 matching vb-right, so the middle buttons stay centred.
  let labelEl = document.getElementById('groupActiveLabel');
  if (s.activeGroupId !== null) {
    const group = s.groups.find(g => g.id === s.activeGroupId);
    const name = group ? group.name : '';
    if (!labelEl) {
      labelEl = document.createElement('span');
      labelEl.id = 'groupActiveLabel';
      labelEl.className = 'group-active-label';
      const vbLeft = document.querySelector('.vb-left');
      if (vbLeft) vbLeft.appendChild(labelEl);
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
        <span class="group-name">${escHtml(g.name)}</span>
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
        <span class="group-name">ALL</span>
        <span class="group-count">${s.frames.length}</span>
      </div>
      ${groupsHTML}
      <button class="group-new-btn">+ New Group</button>
      <div class="group-subtitle">Sort frames by locations, scenes, or cutdowns</div>
    </div>`;
}

function wireSidebarEvents(sidebar: HTMLElement): void {
  // Close button
  sidebar.querySelector('.group-close-btn')?.addEventListener('click', closeGroupSidebar);

  // Select group
  sidebar.querySelectorAll('.group-item').forEach(el => {
    el.addEventListener('click', (e) => {
      // Don't trigger on edit button click
      if ((e.target as HTMLElement).closest('.group-edit-btn')) return;
      const gid = (el as HTMLElement).dataset.gid;
      if (gid === 'all') {
        useStore.setState({ activeGroupId: null });
      } else {
        useStore.setState({ activeGroupId: parseInt(gid!) });
      }
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

  // Build frame thumbnails — larger, with description on the right
  let framesHTML = '';
  for (const f of s.frames) {
    const checked = selectedIds.has(f.id);
    const thumbSrc = f.src || '';
    const label = f.label || `Frame ${f.id}`;
    const desc = f.textContent ? f.textContent.substring(0, 60) + (f.textContent.length > 60 ? '…' : '') : '';
    framesHTML += `
      <label class="group-frame-toggle" data-fid="${f.id}" style="
        display:flex;align-items:center;gap:12px;padding:8px 10px;
        border-radius:8px;cursor:pointer;
        background:${checked ? 'rgba(201,68,50,0.15)' : 'transparent'};
        border:1px solid ${checked ? '#c94432' : '#333'};
      ">
        <input type="checkbox" data-fid="${f.id}" ${checked ? 'checked' : ''} style="
          width:18px;height:18px;accent-color:#c94432;cursor:pointer;flex-shrink:0;
        ">
        ${thumbSrc
          ? `<img src="${thumbSrc}" style="width:96px;height:64px;object-fit:cover;border-radius:4px;flex-shrink:0;">`
          : `<div style="width:96px;height:64px;background:#333;border-radius:4px;flex-shrink:0;"></div>`}
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;">${escHtml(label)}</div>
          ${desc ? `<div style="font-size:11px;color:#888;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(desc)}</div>` : ''}
        </div>
      </label>`;
  }

  box.innerHTML = `
    <div style="margin-bottom:16px;">
      <div style="font-weight:700;font-size:15px;margin-bottom:12px;">
        ${existing ? 'Edit Group' : 'New Group'}
      </div>
      <input type="text" class="group-name-input" value="${existing ? escHtml(existing.name) : ''}"
        placeholder="Group name (e.g. Kitchen, Scene 2)"
        style="width:100%;padding:10px 12px;border-radius:8px;border:1px solid #555;
        background:#2a2a2a;color:#fff;font-size:14px;outline:none;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;">
    </div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
      ${framesHTML}
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      ${existing ? `<button class="group-delete-btn" style="
        padding:10px 18px;border-radius:8px;border:1px solid #c94432;
        background:transparent;color:#c94432;font-size:14px;font-weight:600;
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
        background:#c94432;color:#fff;font-size:14px;font-weight:600;cursor:pointer;
        font-family:-apple-system,BlinkMacSystemFont,sans-serif;
      ">Save</button>
    </div>`;

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  _overlayEl = overlay;

  // Focus name input
  const nameInput = box.querySelector('.group-name-input') as HTMLInputElement;
  setTimeout(() => nameInput.focus(), 100);

  // Toggle visual feedback on checkboxes
  box.querySelectorAll('input[type="checkbox"]').forEach(cb => {
    cb.addEventListener('change', () => {
      const label = (cb as HTMLElement).closest('.group-frame-toggle') as HTMLElement;
      const checked = (cb as HTMLInputElement).checked;
      label.style.background = checked ? 'rgba(201,68,50,0.15)' : 'transparent';
      label.style.borderColor = checked ? '#c94432' : '#333';
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
    }
  });

  // Save
  box.querySelector('.group-save-btn')?.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.style.borderColor = '#c94432';
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
        g.id === existing.id ? { ...g, name, frameIds: checkedIds } : g
      );
      useStore.setState({ groups: newGroups });
    } else {
      // Create new
      const newGroup: FrameGroup = {
        id: s.nextGroupId,
        name,
        frameIds: checkedIds,
      };
      useStore.setState({
        groups: [...s.groups, newGroup],
        nextGroupId: s.nextGroupId + 1,
      });
    }
    closeEditor();
    refreshSidebar();
    triggerRerender();
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

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

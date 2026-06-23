// Setups — colour-coded lighting/time-of-day labels for main frame cards.
// Each setup has a name (max 7 chars, UPPERCASE) and a colour from the 12-colour palette.
// Frames can belong to at most one setup. A colour tag shows on the canvas in all views.

import { state, useStore, SETUP_COLORS, bumpRenderTick } from '../store/state';
import type { Setup, StripType } from '../store/state';
import { getStripVersions, ensureStripVersions, stripTabPrefix, relabelStripVersions, reorderByStars } from './helpers';
import { showToast, showConfirm } from './modals';

// ─── Setup bar rendering ───────────────────────────────────────────────

/** Toggle setup mode on/off. */
export function toggleSetupMode(): void {
  const s = state();
  const bar = document.getElementById('setupBar');
  if (!bar) return;

  if (s.setupMode) {
    // Exit setup mode entirely (keep activeSetupId so we remember last-used)
    useStore.setState({ setupMode: false, setupEditing: false });
    bar.style.display = 'none';
    bar.innerHTML = '';
    document.body.classList.remove('setup-lock');
    document.getElementById('setupsBtn')?.classList.remove('active');
    const renderAll = (window as any).__fh_renderAll;
    if (renderAll) renderAll();
    return;
  }

  // Enter setup mode — lock all other UI
  useStore.setState({ setupMode: true, setupEditing: false });
  bar.style.display = '';
  document.body.classList.add('setup-lock');
  document.getElementById('setupsBtn')?.classList.add('active');

  if (s.setups.length === 0) {
    // First time — show creation form
    renderSetupCreateForm(bar);
  } else {
    // Open straight into edit mode with last-used (or first) setup
    const activeId = s.activeSetupId && s.setups.some((su) => su.id === s.activeSetupId)
      ? s.activeSetupId : s.setups[0].id;
    useStore.setState({ activeSetupId: activeId });
    renderSetupBarEdit(bar);
  }
}

/** Render the setup bar in EDIT state: ▼ [PILL] "TAP FRAMES..." [DONE] */
function renderSetupBarEdit(bar: HTMLElement): void {
  const s = state();
  const active = s.setups.find((su) => su.id === s.activeSetupId);
  if (!active) {
    renderSetupCreateForm(bar);
    return;
  }
  const col = SETUP_COLORS[active.colorIndex] || SETUP_COLORS[0];
  const textCol = needsDarkText(col.hex) ? '#000' : '#fff';

  useStore.setState({ setupEditing: true });

  bar.innerHTML = `
    <div class="setup-bar-inner">
      <button class="setup-dropdown-arrow" id="setupDropdownBtn" title="Choose setup">▶</button>
      <span class="setup-pill active-pill" style="background:${col.hex};color:${textCol}">${active.name}</span>
      <span class="setup-helper-text">TAP FRAMES TO ADD / REMOVE</span>
      <button class="setup-done-btn" id="setupDoneBtn">DONE</button>
    </div>
    <div class="setup-dropdown" id="setupDropdown" style="display:none"></div>
  `;

  // Wire dropdown (stays active — user can switch setups mid-edit)
  _wireDropdown(bar);

  // Wire DONE → exit setup mode entirely
  bar.querySelector('#setupDoneBtn')!.addEventListener('click', () => {
    toggleSetupMode();
  });

  // Re-render to show toggle buttons on canvases
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
}

/** Close dropdown + reset arrow. */
function _closeDropdown(): void {
  const dd = document.getElementById('setupDropdown');
  const btn = document.getElementById('setupDropdownBtn');
  if (dd) dd.style.display = 'none';
  if (btn) btn.textContent = '▶';
}

/** Wire the dropdown arrow + menu. Used in both view and edit states. */
function _wireDropdown(bar: HTMLElement): void {
  const btn = bar.querySelector('#setupDropdownBtn')!;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const dd = document.getElementById('setupDropdown')!;
    if (dd.style.display === 'none') {
      renderSetupDropdown(dd);
      dd.style.display = '';
      btn.textContent = '▼';
      // Close dropdown when clicking outside
      setTimeout(() => {
        const closer = (ev: MouseEvent) => {
          const target = ev.target as HTMLElement;
          if (!dd.contains(target) && target !== btn) {
            _closeDropdown();
            document.removeEventListener('click', closer, true);
          }
        };
        document.addEventListener('click', closer, true);
      }, 0);
    } else {
      _closeDropdown();
    }
  });
}

/** Render the dropdown menu: + NEW first, then existing setups as coloured pills with EDIT. */
function renderSetupDropdown(dd: HTMLElement): void {
  const s = state();
  let html = s.setups.length < 12
    ? '<button class="setup-dd-item setup-dd-new" data-setup-new="1">+NEW</button>'
    : '';
  for (const su of s.setups) {
    const col = SETUP_COLORS[su.colorIndex] || SETUP_COLORS[0];
    const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
    const isActive = su.id === s.activeSetupId;
    html += `<div class="setup-dd-row${isActive ? ' setup-dd-active' : ''}">
      <button class="setup-dd-item" data-setup-select="${su.id}" style="background:${col.hex};color:${textCol}">${su.name}</button>
      <button class="setup-dd-edit" data-setup-edit="${su.id}" title="Edit setup">EDIT</button>
    </div>`;
  }
  dd.innerHTML = html;

  // Wire + NEW
  dd.querySelector('[data-setup-new]')?.addEventListener('click', () => {
    _closeDropdown();
    const bar = document.getElementById('setupBar')!;
    renderSetupCreateForm(bar);
  });

  // Wire selection (click on the pill → switch to that setup)
  dd.querySelectorAll('[data-setup-select]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.setupSelect!;
      useStore.setState({ activeSetupId: id });
      _closeDropdown();
      // Switch setup and stay in edit mode
      renderSetupBarEdit(document.getElementById('setupBar')!);
      // Re-render all canvases so +/pill state reflects the new active setup
      const renderAll = (window as any).__fh_renderAll;
      if (renderAll) renderAll();
    })
  );

  // Wire EDIT buttons → open edit form for that setup
  dd.querySelectorAll('[data-setup-edit]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = (btn as HTMLElement).dataset.setupEdit!;
      _closeDropdown();
      renderSetupEditForm(document.getElementById('setupBar')!, id);
    })
  );
}

/** Render an edit form for a specific setup: rename, recolour, delete. */
function renderSetupEditForm(bar: HTMLElement, setupId: string): void {
  const s = state();
  const su = s.setups.find((x) => x.id === setupId);
  if (!su) return;

  // Pause editing while in the edit form
  useStore.setState({ setupEditing: false, activeSetupId: setupId });

  // Build colour circles — mark taken ones (except current setup's colour)
  const usedColors = new Set(s.setups.filter((x) => x.id !== setupId).map((x) => x.colorIndex));
  let colorsHTML = '';
  for (let i = 0; i < SETUP_COLORS.length; i++) {
    const col = SETUP_COLORS[i];
    const taken = usedColors.has(i);
    const selected = i === su.colorIndex;
    const light = taken && needsDarkText(col.hex);
    colorsHTML += `<button class="setup-color-circle${selected ? ' selected' : ''}${taken ? ' taken' : ''}${light ? ' light' : ''}" data-ci="${i}" style="background:${col.hex}"${taken ? ' disabled' : ''}></button>`;
  }

  bar.innerHTML = `
    <div class="setup-bar-inner setup-edit-form">
      <input class="setup-name-input" id="setupEditNameInput" type="text" maxlength="7" value="${su.name}" autocomplete="off" />
      <div class="setup-color-picker">${colorsHTML}</div>
      <button class="setup-create-btn" id="setupEditSaveBtn">SAVE</button>
      <button class="setup-delete-btn" id="setupEditDeleteBtn">DELETE</button>
    </div>
  `;

  let selectedCI = su.colorIndex;

  // Wire colour selection
  bar.querySelectorAll('.setup-color-circle:not(.taken)').forEach((circle) =>
    circle.addEventListener('click', () => {
      bar.querySelectorAll('.setup-color-circle').forEach((c) => c.classList.remove('selected'));
      circle.classList.add('selected');
      selectedCI = parseInt((circle as HTMLElement).dataset.ci!);
    })
  );

  // Wire SAVE
  bar.querySelector('#setupEditSaveBtn')!.addEventListener('click', () => {
    const input = document.getElementById('setupEditNameInput') as HTMLInputElement;
    const name = input.value.trim().toUpperCase();
    if (!name) { showToast('Enter a name'); return; }
    if (name.length > 7) { showToast('Max 7 characters'); return; }
    // Check duplicate (exclude self)
    const latest = state();
    if (latest.setups.some((x) => x.name === name && x.id !== setupId)) { showToast('Name already used'); return; }

    // Apply changes
    su.name = name;
    su.colorIndex = selectedCI;
    bumpRenderTick();
    renderSetupBarEdit(bar);
  });

  // Wire DELETE
  bar.querySelector('#setupEditDeleteBtn')!.addEventListener('click', () => {
    _deleteSetup(bar, setupId);
  });

  // Auto-focus
  (document.getElementById('setupEditNameInput') as HTMLInputElement)?.focus();
}

/** Render the setup creation form: name input + colour circles + CREATE. */
function renderSetupCreateForm(bar: HTMLElement): void {
  const s = state();
  // Find colours already taken
  const usedColors = new Set(s.setups.map((su) => su.colorIndex));

  let colorsHTML = '';
  for (let i = 0; i < SETUP_COLORS.length; i++) {
    const col = SETUP_COLORS[i];
    const taken = usedColors.has(i);
    const light = taken && needsDarkText(col.hex);
    colorsHTML += `<button class="setup-color-circle${i === 0 && !taken ? ' selected' : ''}${taken ? ' taken' : ''}${light ? ' light' : ''}" data-ci="${i}" style="background:${col.hex}"${taken ? ' disabled' : ''}></button>`;
  }

  // Pick first available colour
  let defaultCI = 0;
  for (let i = 0; i < SETUP_COLORS.length; i++) {
    if (!usedColors.has(i)) { defaultCI = i; break; }
  }

  bar.innerHTML = `
    <div class="setup-bar-inner setup-create-form">
      <input class="setup-name-input" id="setupNameInput" type="text" maxlength="7" placeholder="NAME" autocomplete="off" />
      <div class="setup-color-picker">${colorsHTML}</div>
      <button class="setup-create-btn" id="setupCreateBtn">CREATE</button>
      <button class="setup-cancel-btn" id="setupCancelBtn">CANCEL</button>
    </div>
  `;

  // Pre-select first available colour
  let selectedCI = defaultCI;
  bar.querySelectorAll('.setup-color-circle:not(.taken)').forEach((circle) => {
    if (parseInt((circle as HTMLElement).dataset.ci!) === defaultCI) {
      circle.classList.add('selected');
    }
  });

  // Wire colour selection
  bar.querySelectorAll('.setup-color-circle:not(.taken)').forEach((circle) =>
    circle.addEventListener('click', () => {
      bar.querySelectorAll('.setup-color-circle').forEach((c) => c.classList.remove('selected'));
      circle.classList.add('selected');
      selectedCI = parseInt((circle as HTMLElement).dataset.ci!);
    })
  );

  // Wire CREATE → goes straight into EDIT mode for the new setup
  bar.querySelector('#setupCreateBtn')!.addEventListener('click', () => {
    const input = document.getElementById('setupNameInput') as HTMLInputElement;
    const name = input.value.trim().toUpperCase();
    if (!name) { showToast('Enter a name'); return; }
    if (name.length > 7) { showToast('Max 7 characters'); return; }
    // Check duplicate name
    const latest = state();
    if (latest.setups.some((su) => su.name === name)) { showToast('Name already used'); return; }

    const id = 'setup_' + latest.nextSetupId;
    const newSetup: Setup = { id, name, colorIndex: selectedCI };
    useStore.setState((prev) => ({
      setups: [...prev.setups, newSetup],
      activeSetupId: id,
      nextSetupId: prev.nextSetupId + 1,
    }));

    // Go straight into edit/assign mode
    renderSetupBarEdit(bar);
  });

  // Wire CANCEL — back to edit state if setups exist, otherwise exit setup mode
  bar.querySelector('#setupCancelBtn')!.addEventListener('click', () => {
    const latest = state();
    if (latest.setups.length > 0) {
      useStore.setState({ activeSetupId: latest.activeSetupId || latest.setups[0].id });
      renderSetupBarEdit(bar);
    } else {
      toggleSetupMode(); // exit setup mode entirely
    }
  });

  // Auto-focus
  (document.getElementById('setupNameInput') as HTMLInputElement)?.focus();
}

// ─── Delete setup ─────────────────────────────────────────────────────

/** Delete a setup by ID after confirmation. Untags all frames. */
async function _deleteSetup(bar: HTMLElement, setupId: string): Promise<void> {
  const s = state();
  const target = s.setups.find((su) => su.id === setupId);
  if (!target) return;

  const ok = await showConfirm(
    `Delete setup "${target.name}"? All frames marked with this setup will be un-tagged.`
  );
  if (!ok) return;

  // Untag all frames that belong to this setup — clear copies first
  for (const f of s.frames) {
    if (f.setupId === setupId) {
      clearCopyTaggedVersions(f.id);
      f.setupId = null;
    }
  }

  // Remove setup from list
  const remaining = s.setups.filter((su) => su.id !== setupId);
  const newActiveId = remaining.length > 0 ? remaining[0].id : null;

  useStore.setState({
    setups: remaining,
    activeSetupId: newActiveId,
    setupEditing: false,
  });
  bumpRenderTick();

  if (remaining.length > 0) {
    renderSetupBarEdit(bar);
  } else {
    // No setups left — show create form
    renderSetupCreateForm(bar);
  }
}

// ─── Frame assignment ──────────────────────────────────────────────────

/** Handle a click on a main frame card's toggle button while in setup edit mode.
 *  Toggle: assign → unassign → assign to different setup. */
export function handleSetupFrameClick(fid: number): void {
  const s = state();
  if (!s.setupMode || !s.setupEditing || !s.activeSetupId) return;

  const f = s.frames.find((fr) => fr.id === fid);
  if (!f) return;

  if (f.setupId === s.activeSetupId) {
    // Unassign — clear any copy-tagged strip content first
    const oldSetupId = f.setupId;
    clearCopyTaggedVersions(f.id);
    f.setupId = null;
    // Re-propagate remaining origins in the old setup (cleans up copies this frame produced)
    if (oldSetupId) propagateAllSetupTags(oldSetupId);
  } else {
    // Reassigning from different setup — clear old copies before switching
    const oldSetupId = f.setupId;
    if (oldSetupId) clearCopyTaggedVersions(f.id);
    // Assign (or reassign from different setup)
    f.setupId = s.activeSetupId;
    // Re-propagate old setup (remove copies this frame produced)
    if (oldSetupId) propagateAllSetupTags(oldSetupId);
    // Propagate existing tags from new setup to include this frame
    if (s.activeSetupId) propagateAllSetupTags(s.activeSetupId);
  }

  // Bump render tick so Zustand subscribers notice the in-place mutation
  bumpRenderTick();

  // Re-render to update toggle buttons + tags
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
}

/** Remove whatever setup is assigned to this frame (regardless of active setup). */
export function handleSetupRemoveClick(fid: number): void {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  if (!f || !f.setupId) return;

  const oldSetupId = f.setupId;
  clearCopyTaggedVersions(f.id);
  f.setupId = null;
  // Re-propagate remaining origins so copies from this frame's origins get cleaned up
  propagateAllSetupTags(oldSetupId);

  bumpRenderTick();
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
}

// ─── Colour tag HTML ───────────────────────────────────────────────────

/** Return HTML for the setup colour tag on a canvas + add/remove controls when editing.
 *  - Always: shows colour pill tag in bottom-right if frame has a setup assigned
 *  - In edit mode: frame IN current setup → clickable pill (tap to remove)
 *  - In edit mode: frame NOT in current setup → centred "+" ADD TO SETUP overlay (tap to add/reassign) */
export function setupTagHTML(fid: number): string {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  let html = '';

  const isEditing = s.setupMode && s.setupEditing && s.activeSetupId;
  const isAssignedToActive = f?.setupId === s.activeSetupId;
  const hasSetup = f && f.setupId;

  if (isEditing) {
    if (isAssignedToActive && hasSetup) {
      // Assigned to current setup → "TAP BELOW TO REMOVE" label + clickable pill (tap to remove)
      const setup = s.setups.find((su) => su.id === f.setupId);
      if (setup) {
        const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
        const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
        html += `<div class="setup-remove-overlay" data-setup-fid="${fid}"><span class="setup-remove-label">TAP BELOW<br>TO REMOVE</span></div><button class="setup-tag setup-tag-btn" data-setup-fid="${fid}" style="background:${col.hex};color:${textCol}">${setup.name}</button>`;
      }
    } else {
      // Not in current setup → show "+" ADD TO SETUP overlay
      // If in a different setup, also show that setup's pill as a clickable remove button
      if (hasSetup) {
        const setup = s.setups.find((su) => su.id === f.setupId);
        if (setup) {
          const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
          const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
          html += `<div class="setup-remove-overlay" data-setup-remove-fid="${fid}"><span class="setup-remove-label">TAP BELOW<br>TO REMOVE</span></div><button class="setup-tag setup-tag-btn setup-tag-remove" data-setup-remove-fid="${fid}" style="background:${col.hex};color:${textCol}">${setup.name}</button>`;
        }
      }
      html += `<button class="setup-add-overlay" data-setup-fid="${fid}"><span class="setup-add-plus">+</span><span class="setup-add-label">ADD TO SETUP</span></button>`;
    }
  } else {
    // Normal mode (not editing): clickable pill → shows hint overlay + pulses SETUPS button
    if (hasSetup) {
      const setup = s.setups.find((su) => su.id === f!.setupId);
      if (setup) {
        const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
        const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
        html += `<button class="setup-tag setup-tag-hint" data-setup-hint="1" style="background:${col.hex};color:${textCol}">${setup.name}</button>`;
      }
    }
  }

  return html;
}

/** Wire click handlers on setup toggle buttons. Call after rendering. */
export function wireSetupClicks(container: HTMLElement | Document = document): void {
  container.querySelectorAll('[data-setup-fid]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const fid = parseInt((btn as HTMLElement).dataset.setupFid!, 10);
      handleSetupFrameClick(fid);
    })
  );
}

// ─── Cascade cleanup ──────────────────────────────────────────────────

/** Clear all 'copy'-tagged strip versions for a given frame across all strips.
 *  Called when a frame loses its SETUP (unassign or delete). Origins stay. */
function clearCopyTaggedVersions(fid: number): void {
  const strips: StripType[] = ['ver', 'floor', 'refs'];
  for (const strip of strips) {
    const vers = getStripVersions(fid, strip);
    if (!vers) continue;
    for (const v of vers) {
      if (v.setupTagged === 'copy') {
        v.bgImage = null;
        v.strokes = [];
        v.type = 'empty';
        v.setupTagged = undefined;
      }
    }
  }
}

/** Re-propagate all existing strip tags across every frame in a setup.
 *  Call after adding/removing a frame so copies stay in sync. */
function propagateAllSetupTags(setupId: string): void {
  const s = state();
  const strips: StripType[] = ['ver', 'floor', 'refs'];
  const anyFrame = s.frames.find((f) => f.setupId === setupId);
  if (!anyFrame) return;
  for (const strip of strips) {
    reapplyStripTags(anyFrame.id, strip);
  }
}

// ─── Strip tags (VERSN / FLOOR / REFS) ────────────────────────────────

/**
 * Returns HTML for the strip-tag pill in the bottom-right corner of a
 * VERSN/FLOOR/REFS canvas. Shows only when the parent MAIN frame has a
 * SETUP assigned. The pill is either empty (outline) or filled (tagged).
 */
export function stripTagHTML(fid: number, vi: number, strip: StripType): string {
  if (strip === 'main') return ''; // MAIN frames use setupTagHTML instead

  const s = state();
  const mainFrame = s.frames.find((f) => f.id === fid);
  if (!mainFrame || !mainFrame.setupId) return ''; // no SETUP on this MAIN frame

  const setup = s.setups.find((su) => su.id === mainFrame.setupId);
  if (!setup) return '';

  const ver = getStripVersions(fid, strip)[vi];
  const isTagged = ver?.setupTagged;
  const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
  const textCol = needsDarkText(col.hex) ? '#000' : '#fff';

  if (isTagged) {
    // Filled pill — shows SETUP name in colour
    return `<button class="strip-tag strip-tag-filled" data-striptag-fid="${fid}" data-striptag-vi="${vi}" data-striptag-strip="${strip}" style="background:${col.hex};color:${textCol}">${setup.name}</button>`;
  }
  // Empty pill — shows "TAG" text
  return `<button class="strip-tag strip-tag-empty" data-striptag-fid="${fid}" data-striptag-vi="${vi}" data-striptag-strip="${strip}">TAG</button>`;
}

/**
 * Wire click handlers on strip-tag pills. Call after rendering.
 */
export function wireStripTagClicks(container: HTMLElement | Document = document): void {
  container.querySelectorAll('[data-striptag-fid]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const el = btn as HTMLElement;
      const fid = parseInt(el.dataset.striptagFid!, 10);
      const vi = parseInt(el.dataset.striptagVi!, 10);
      const strip = el.dataset.striptagStrip! as StripType;
      handleStripTagClick(fid, vi, strip);
    })
  );
}

/** Handle a strip-tag pill click — show confirmation overlay or toggle directly. */
export function handleStripTagClick(fid: number, vi: number, strip: StripType): void {
  const s = state();
  const ver = getStripVersions(fid, strip)[vi];
  if (!ver) return;

  if (ver.setupTagged) {
    // UNTAG — remove this image from the tag system entirely.
    // Origin stays as user content on its frame; all copies are deleted everywhere.
    const targetImage = ver.bgImage;
    const mainFrame = s.frames.find((f) => f.id === fid);
    const setupId = mainFrame?.setupId;
    const setupFrames = setupId ? s.frames.filter((f) => f.setupId === setupId) : [mainFrame!];

    // 1) Find and untag the origin (could be on this frame or another)
    for (const sf of setupFrames) {
      const vers = getStripVersions(sf.id, strip);
      for (const v of vers) {
        if (v.setupTagged === 'origin' && v.bgImage === targetImage) {
          v.setupTagged = undefined; // becomes regular user content
        }
      }
    }

    // 2) Remove ALL copies of this image from ALL setup frames
    for (const sf of setupFrames) {
      const vers = getStripVersions(sf.id, strip);
      for (let i = vers.length - 1; i >= 0; i--) {
        if (vers[i].setupTagged === 'copy' && vers[i].bgImage === targetImage) {
          vers.splice(i, 1);
        }
      }
      if (vers.length === 0) {
        vers.push({ id: 1, label: '', type: 'empty' as const, strokes: [], bgImage: null });
      }
      reorderByStars(sf.id, strip);
      relabelStripVersions(sf.id, strip);
    }

    bumpRenderTick();
    const renderAll = (window as any).__fh_renderAll;
    if (renderAll) renderAll();
    return;
  }

  // Not tagged — show confirmation overlay (unless dismissed for this project)
  if (s.stripTagInfoDismissed) {
    applyStripTag(fid, vi, strip);
    return;
  }

  showStripTagOverlay(fid, vi, strip);
}

/** Show the confirmation overlay before tagging. */
function showStripTagOverlay(fid: number, vi: number, strip: StripType): void {
  const s = state();
  const mainFrame = s.frames.find((f) => f.id === fid);
  if (!mainFrame || !mainFrame.setupId) return;
  const setup = s.setups.find((su) => su.id === mainFrame.setupId);
  if (!setup) return;
  const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
  const textCol = needsDarkText(col.hex) ? '#000' : '#fff';

  // Get the strip's display name (e.g. "VERSN", "FLOOR", "REFS")
  const stripDef = s.stripDefs.find((d) => d.id === strip);
  const stripLabel = stripDef ? stripDef.buttonLabel : strip.toUpperCase();

  // Remove any existing overlay
  document.getElementById('stripTagOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'stripTagOverlay';
  overlay.className = 'strip-tag-overlay';
  overlay.innerHTML = `
    <div class="strip-tag-overlay-box">
      <p class="strip-tag-overlay-title">Share this image with all<br><span class="setup-tag" style="background:${col.hex};color:${textCol};position:static;display:inline-flex;vertical-align:middle;pointer-events:none;margin:6px 0;font-size:16px;padding:4px 14px;min-height:28px;">${setup.name}</span><br>SETUP marked frames?</p>
      <p class="strip-tag-overlay-desc">This image will appear in the ${stripLabel} strip of every main frame tagged ${setup.name}.</p>
      <label class="strip-tag-overlay-dismiss"><input type="checkbox" id="stripTagDismissCheck" /> Don't show this again</label>
      <div class="strip-tag-overlay-btns">
        <button class="strip-tag-overlay-ok" id="stripTagOk">OK</button>
        <button class="strip-tag-overlay-cancel" id="stripTagCancel">CANCEL</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#stripTagOk')!.addEventListener('click', () => {
    const dismiss = (document.getElementById('stripTagDismissCheck') as HTMLInputElement).checked;
    if (dismiss) {
      useStore.setState({ stripTagInfoDismissed: true });
    }
    overlay.remove();
    applyStripTag(fid, vi, strip);
  });

  overlay.querySelector('#stripTagCancel')!.addEventListener('click', () => {
    overlay.remove();
  });
}

/** Apply the strip tag and copy content to same-SETUP frames.
 *  Supports multiple origins per strip — each origin maps to the next
 *  slot on target frames (creating new versions if needed). */
function applyStripTag(fid: number, vi: number, strip: StripType): void {
  const s = state();
  const ver = getStripVersions(fid, strip)[vi];
  if (!ver) return;

  // Find the parent MAIN frame's setupId
  const mainFrame = s.frames.find((f) => f.id === fid);
  if (!mainFrame || !mainFrame.setupId) return;

  // Mark this version as the origin
  ver.setupTagged = 'origin';

  // Re-apply ALL origins for this frame+strip so slots are assigned in order
  reapplyStripTags(fid, strip);

  bumpRenderTick();
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
}

/**
 * Setup-wide tag propagation: collect origins from ALL frames in the setup,
 * then rebuild every frame's version list so that:
 *   - Tagged content (own origins + foreign copies) is at the FRONT
 *   - User's own untagged content follows, never overwritten
 *   - Order follows storyboard frame order
 * fid is only used to look up the setupId.
 */
function reapplyStripTags(fid: number, strip: StripType): void {
  const s = state();
  const mainFrame = s.frames.find((f) => f.id === fid);
  if (!mainFrame || !mainFrame.setupId) return;
  const setupId = mainFrame.setupId;

  // All frames in this setup, in storyboard order
  const setupFrames = s.frames.filter((f) => f.setupId === setupId);

  // Collect origins per frame: Map<frameId, originVersions[]>
  const originsByFrame = new Map<number, import('../store/state').Version[]>();
  for (const f of setupFrames) {
    const vers = getStripVersions(f.id, strip);
    const origins = vers.filter((v) => v.setupTagged === 'origin');
    if (origins.length > 0) originsByFrame.set(f.id, origins);
  }

  // For each frame, rebuild its version list
  for (const targetFrame of setupFrames) {
    const targetVers = ensureStripVersions(targetFrame.id, strip);

    // Own origins on this frame (keep the actual objects)
    const ownOrigins = targetVers.filter((v) => v.setupTagged === 'origin');
    // User's untagged content that actually has something — empty versions
    // are just placeholders and should be filled by copies, not preserved
    const userContent = targetVers.filter((v) => !v.setupTagged && v.type !== 'empty');

    // Build the tagged-front section in storyboard order:
    // for each frame that has origins, if it's THIS frame → keep own origins,
    // if it's another frame → create copies
    const taggedFront: import('../store/state').Version[] = [];
    for (const [sourceId, srcOrigins] of originsByFrame) {
      if (sourceId === targetFrame.id) {
        // Own origins stay as real origin objects
        for (const orig of ownOrigins) taggedFront.push(orig);
      } else {
        // Foreign origins → fresh copy versions
        for (const orig of srcOrigins) {
          taggedFront.push({
            id: 0,
            label: '',
            bgImage: orig.bgImage,
            strokes: orig.strokes.map((st) => ({ ...st })),
            type: (orig.bgImage ? 'upload' : orig.strokes.length > 0 ? 'drawing' : 'empty') as 'empty' | 'drawing' | 'upload',
            setupTagged: 'copy' as const,
          });
        }
      }
    }

    // Rebuild: tagged front, then user content
    targetVers.length = 0;
    for (const tv of taggedFront) targetVers.push(tv);
    for (const uv of userContent) targetVers.push(uv);

    // Ensure at least one version exists (don't leave a strip empty)
    if (targetVers.length === 0) {
      targetVers.push({ id: 1, label: '', type: 'empty', strokes: [], bgImage: null });
    }

    // Relabel v1, v2, v3... / f1, f2... after reordering
    relabelStripVersions(targetFrame.id, strip);
  }
}

// ─── Setup pill hint (tap pill in normal mode) ────────────────────────

/** Show a small grey overlay hint + pulse the SETUPS button. */
export function showSetupPillHint(): void {
  // Don't show if already visible
  if (document.getElementById('setupPillHint')) return;

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'setupPillHint';
  overlay.className = 'setup-pill-hint';
  overlay.innerHTML = `
    <div class="setup-pill-hint-box">
      <p>Tap <strong>SETUPS</strong> on top of the page<br>to edit main frame assignments</p>
    </div>
  `;
  document.body.appendChild(overlay);

  // Dismiss on tap anywhere
  const dismiss = () => {
    overlay.remove();
    document.removeEventListener('click', dismiss, true);
  };
  // Delay listener so the current click doesn't immediately dismiss
  setTimeout(() => document.addEventListener('click', dismiss, true), 50);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (overlay.parentNode) overlay.remove();
    document.removeEventListener('click', dismiss, true);
  }, 5000);
}

// ─── Helpers ───────────────────────────────────────────────────────────

/** Determine if a colour is light enough to need dark text. */
function needsDarkText(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55;
}

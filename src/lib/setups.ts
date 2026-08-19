// Setups — colour-coded lighting/time-of-day labels for main frame cards.
// Each setup has a name (max 7 chars, UPPERCASE) and a colour from the 12-colour palette.
// Frames can belong to at most one setup. A colour tag shows on the canvas in all views.

import { state, useStore, SETUP_COLORS, bumpRenderTick } from '../store/state';
import { uniqueId } from './ids';
import type { Setup, StripType } from '../store/state';
import { getStripVersions, ensureStripVersions, stripTabPrefix, relabelStripVersions, reorderByStars, getStripActiveTab, setStripActiveTab } from './helpers';
import { showToast, showConfirm } from './modals';
import { flushSyncNow } from './currentProject';

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
    document.body.classList.remove('setup-lock', 'setup-expanded');
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

/** Render the setup bar in EDIT state: inline pills + NEW + EDIT + instruction + separator + DONE */
function renderSetupBarEdit(bar: HTMLElement): void {
  const s = state();
  const active = s.setups.find((su) => su.id === s.activeSetupId);
  if (!active) {
    renderSetupCreateForm(bar);
    return;
  }

  document.body.classList.remove('setup-expanded');
  useStore.setState({ setupEditing: true });

  const isPhone = Math.min(window.innerWidth, window.innerHeight) <= 430;

  // Build pills HTML — active gets white ring, others dimmed
  let pillsHTML = '';
  for (const su of s.setups) {
    const col = SETUP_COLORS[su.colorIndex] || SETUP_COLORS[0];
    const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
    const isAct = su.id === s.activeSetupId;
    pillsHTML += `<button class="setup-pill${isAct ? ' active-pill' : ' dim'}" data-setup-pill="${su.id}" style="background:${col.hex};color:${textCol}">${su.name}</button>`;
  }

  // +NEW and EDIT buttons (max 12 setups for +NEW)
  const newBtnHTML = s.setups.length < 12
    ? '<button class="setup-new-btn" id="setupNewBtn">+NEW</button>'
    : '';
  const editBtnHTML = '<button class="setup-edit-btn" id="setupEditBtn">EDIT</button>';

  // Instruction text (hidden on iPhone)
  const instrHTML = isPhone ? '' : '<span class="setup-helper-text">CLICK FRAMES BELOW TO ADD / REMOVE</span>';
  const rightText = isPhone ? '' : '<span class="setup-helper-text">click when</span>';

  bar.innerHTML = `
    <div class="setup-bar-inner">
      <div class="setup-bar-pills">
        ${pillsHTML}
        ${newBtnHTML}
        ${editBtnHTML}
        ${instrHTML}
      </div>
      <div class="setup-bar-right">
        <span class="setup-bar-sep"></span>
        ${rightText}
        <button class="setup-done-btn" id="setupDoneBtn">DONE</button>
      </div>
    </div>
  `;

  // Wire pill clicks — tap to switch active setup
  bar.querySelectorAll('[data-setup-pill]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.setupPill!;
      useStore.setState({ activeSetupId: id });
      renderSetupBarEdit(bar);
      const renderAll = (window as any).__fh_renderAll;
      if (renderAll) renderAll();
    });
  });

  // Wire +NEW → show inline creation form as second row
  bar.querySelector('#setupNewBtn')?.addEventListener('click', () => {
    _showInlineCreateForm(bar);
  });

  // Wire EDIT → show inline edit form for active pill as second row
  bar.querySelector('#setupEditBtn')!.addEventListener('click', () => {
    _showInlineEditForm(bar);
  });

  // Wire DONE → exit setup mode entirely
  bar.querySelector('#setupDoneBtn')!.addEventListener('click', () => {
    toggleSetupMode();
  });

  // Re-render to show toggle buttons on canvases
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
}

/** Show inline creation form as a second row below the pills. */
function _showInlineCreateForm(bar: HTMLElement): void {
  // Remove existing inline row if any
  bar.querySelector('.setup-create-row')?.remove();

  const s = state();
  const usedColors = new Set(s.setups.map((su) => su.colorIndex));

  // Find first available colour
  let defaultCI = 0;
  for (let i = 0; i < SETUP_COLORS.length; i++) {
    if (!usedColors.has(i)) { defaultCI = i; break; }
  }

  let colorsHTML = '';
  for (let i = 0; i < SETUP_COLORS.length; i++) {
    const col = SETUP_COLORS[i];
    const taken = usedColors.has(i);
    const selected = !taken && i === defaultCI;
    const light = taken && needsDarkText(col.hex);
    colorsHTML += `<button class="setup-color-circle${selected ? ' selected' : ''}${taken ? ' taken' : ''}${light ? ' light' : ''}" data-ci="${i}" style="background:${col.hex}"${taken ? ' disabled' : ''}></button>`;
  }

  const row = document.createElement('div');
  row.className = 'setup-create-row';
  row.innerHTML = `
    <input class="setup-name-input" id="setupInlineNameInput" type="text" maxlength="7" placeholder="NAME" autocomplete="one-time-code" />
    <div class="setup-color-picker">${colorsHTML}</div>
    <button class="setup-create-btn" id="setupInlineCreateBtn">CREATE</button>
    <button class="setup-cancel-btn" id="setupInlineCancelBtn">CANCEL</button>
  `;
  bar.appendChild(row);
  document.body.classList.add('setup-expanded');

  let selectedCI = defaultCI;

  // Wire colour selection
  row.querySelectorAll('.setup-color-circle:not(.taken)').forEach((circle) =>
    circle.addEventListener('click', () => {
      row.querySelectorAll('.setup-color-circle').forEach((c) => c.classList.remove('selected'));
      circle.classList.add('selected');
      selectedCI = parseInt((circle as HTMLElement).dataset.ci!);
    })
  );

  // Wire CREATE
  row.querySelector('#setupInlineCreateBtn')!.addEventListener('click', () => {
    const input = document.getElementById('setupInlineNameInput') as HTMLInputElement;
    const name = input.value.trim().toUpperCase();
    if (!name) { showToast('Enter a name'); return; }
    if (name.length > 7) { showToast('Max 7 characters'); return; }
    const latest = state();
    if (latest.setups.some((su) => su.name === name)) { showToast('Name already used'); return; }

    const id = uniqueId('setup');            // never a per-device count (#322)
    const newSetup: Setup = { id, name, colorIndex: selectedCI };
    useStore.setState((prev) => ({
      setups: [...prev.setups, newSetup],
      activeSetupId: id,
      nextSetupId: prev.nextSetupId + 1,
    }));

    renderSetupBarEdit(bar);
    void flushSyncNow(); // STP-1: create setup → CREATE
  });

  // Wire CANCEL — remove the creation row
  row.querySelector('#setupInlineCancelBtn')!.addEventListener('click', () => {
    row.remove();
    document.body.classList.remove('setup-expanded');
  });

  // Auto-focus
  (document.getElementById('setupInlineNameInput') as HTMLInputElement)?.focus();
}

/** Show inline edit form for the active setup as a second row below the pills. */
function _showInlineEditForm(bar: HTMLElement): void {
  // Remove existing inline row if any
  bar.querySelector('.setup-create-row')?.remove();

  const s = state();
  const su = s.setups.find((x) => x.id === s.activeSetupId);
  if (!su) return;

  // Build colour circles — mark taken ones (except current setup's colour)
  const usedColors = new Set(s.setups.filter((x) => x.id !== su.id).map((x) => x.colorIndex));
  let colorsHTML = '';
  for (let i = 0; i < SETUP_COLORS.length; i++) {
    const col = SETUP_COLORS[i];
    const taken = usedColors.has(i);
    const selected = i === su.colorIndex;
    const light = taken && needsDarkText(col.hex);
    colorsHTML += `<button class="setup-color-circle${selected ? ' selected' : ''}${taken ? ' taken' : ''}${light ? ' light' : ''}" data-ci="${i}" style="background:${col.hex}"${taken ? ' disabled' : ''}></button>`;
  }

  const row = document.createElement('div');
  row.className = 'setup-create-row';
  row.innerHTML = `
    <input class="setup-name-input" id="setupInlineEditNameInput" type="text" maxlength="7" value="${su.name}" autocomplete="one-time-code" />
    <div class="setup-color-picker">${colorsHTML}</div>
    <button class="setup-create-btn" id="setupInlineEditSaveBtn">SAVE</button>
    <button class="setup-delete-btn" id="setupInlineEditDeleteBtn">DELETE</button>
    <button class="setup-cancel-btn" id="setupInlineEditCancelBtn">CANCEL</button>
  `;
  bar.appendChild(row);
  document.body.classList.add('setup-expanded');

  let selectedCI = su.colorIndex;

  // Wire colour selection
  row.querySelectorAll('.setup-color-circle:not(.taken)').forEach((circle) =>
    circle.addEventListener('click', () => {
      row.querySelectorAll('.setup-color-circle').forEach((c) => c.classList.remove('selected'));
      circle.classList.add('selected');
      selectedCI = parseInt((circle as HTMLElement).dataset.ci!);
    })
  );

  // Wire SAVE
  row.querySelector('#setupInlineEditSaveBtn')!.addEventListener('click', () => {
    const input = document.getElementById('setupInlineEditNameInput') as HTMLInputElement;
    const name = input.value.trim().toUpperCase();
    if (!name) { showToast('Enter a name'); return; }
    if (name.length > 7) { showToast('Max 7 characters'); return; }
    const latest = state();
    if (latest.setups.some((x) => x.name === name && x.id !== su.id)) { showToast('Name already used'); return; }

    su.name = name;
    su.colorIndex = selectedCI;
    bumpRenderTick();
    renderSetupBarEdit(bar);
    void flushSyncNow(); // STP-2: edit setup → SAVE
  });

  // Wire DELETE
  row.querySelector('#setupInlineEditDeleteBtn')!.addEventListener('click', () => {
    _deleteSetup(bar, su.id);
  });

  // Wire CANCEL — remove the edit row
  row.querySelector('#setupInlineEditCancelBtn')!.addEventListener('click', () => {
    row.remove();
    document.body.classList.remove('setup-expanded');
  });

  // Auto-focus
  (document.getElementById('setupInlineEditNameInput') as HTMLInputElement)?.focus();
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
      <input class="setup-name-input" id="setupEditNameInput" type="text" maxlength="7" value="${su.name}" autocomplete="one-time-code" />
      <div class="setup-color-picker">${colorsHTML}</div>
      <button class="setup-create-btn" id="setupEditSaveBtn">SAVE</button>
      <button class="setup-delete-btn" id="setupEditDeleteBtn">DELETE</button>
    </div>
  `;
  document.body.classList.add('setup-expanded');

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
    void flushSyncNow(); // STP-2: edit setup → SAVE
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
      <input class="setup-name-input" id="setupNameInput" type="text" maxlength="7" placeholder="NAME" autocomplete="one-time-code" />
      <div class="setup-color-picker">${colorsHTML}</div>
      <button class="setup-create-btn" id="setupCreateBtn">CREATE</button>
      <button class="setup-cancel-btn" id="setupCancelBtn">CANCEL</button>
    </div>
  `;
  document.body.classList.add('setup-expanded');

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

    const id = uniqueId('setup');            // never a per-device count (#322)
    const newSetup: Setup = { id, name, colorIndex: selectedCI };
    useStore.setState((prev) => ({
      setups: [...prev.setups, newSetup],
      activeSetupId: id,
      nextSetupId: prev.nextSetupId + 1,
    }));

    // Go straight into edit/assign mode
    renderSetupBarEdit(bar);
    void flushSyncNow(); // STP-1: create setup → CREATE
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
  void flushSyncNow(); // STP-3: delete setup → confirm

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
    // Unassign — clear this frame's own copies, leave other frames' copies alone
    clearCopyTaggedVersions(f.id);
    f.setupId = null;
  } else {
    // Reassigning from different setup — clear old copies before switching
    const oldSetupId = f.setupId;
    if (oldSetupId) clearCopyTaggedVersions(f.id);
    // Assign (or reassign from different setup)
    f.setupId = s.activeSetupId;
    // Propagate existing tags from new setup to include this frame
    if (s.activeSetupId) propagateAllSetupTags(s.activeSetupId);
  }

  // Bump render tick so Zustand subscribers notice the in-place mutation
  bumpRenderTick();

  // Re-render to update toggle buttons + tags
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
  void flushSyncNow(); // STP-4: assign frame to setup
}

/** Remove whatever setup is assigned to this frame (regardless of active setup). */
export function handleSetupRemoveClick(fid: number): void {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  if (!f || !f.setupId) return;

  clearCopyTaggedVersions(f.id);
  f.setupId = null;

  bumpRenderTick();
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
  void flushSyncNow(); // STP-5: remove setup from frame
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
 *  Called when a frame loses its SETUP (unassign or delete).
 *  Also clears 'origin' markers — they become regular user content.
 *  Without this, old origins would be propagated into the new setup. */
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
      } else if (v.setupTagged === 'origin') {
        // Origin becomes regular content — no longer participates in tag propagation
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
    // Show untag confirmation overlay (unless dismissed for this project)
    if (s.stripUntagInfoDismissed) {
      executeUntag(fid, strip, ver);
      return;
    }
    showStripUntagOverlay(fid, strip, ver);
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
      <p class="strip-tag-overlay-title">Share this image with all<br><span class="setup-tag" style="background:${col.hex};color:${textCol};position:static;display:inline-flex;vertical-align:middle;pointer-events:none;margin:6px 0;font-size:16px;padding:4px 14px;min-height:28px;">${setup.name}</span> SETUP<br>marked frames?</p>
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

/** Execute the actual untag — remove this image from the tag system entirely.
 *  Origin stays as user content on its frame; all copies are deleted everywhere. */
function executeUntag(fid: number, strip: StripType, ver: import('../store/state').Version): void {
  const s = state();
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
    // Clamp activeTab — splicing may have left it pointing past the array end
    const curTab = getStripActiveTab(sf.id, strip);
    if (curTab >= vers.length) {
      setStripActiveTab(sf.id, strip, Math.max(0, vers.length - 1));
    }
  }

  bumpRenderTick();
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
  // TAG-2: untag a version → 1s delay lets cascade removal complete
  setTimeout(() => void flushSyncNow(), 1000);
}

/** Show the confirmation overlay before untagging. */
function showStripUntagOverlay(fid: number, strip: StripType, ver: import('../store/state').Version): void {
  const s = state();
  const mainFrame = s.frames.find((f) => f.id === fid);
  if (!mainFrame || !mainFrame.setupId) return;
  const setup = s.setups.find((su) => su.id === mainFrame.setupId);
  if (!setup) return;
  const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
  const textCol = needsDarkText(col.hex) ? '#000' : '#fff';

  // Remove any existing overlay
  document.getElementById('stripTagOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'stripTagOverlay';
  overlay.className = 'strip-tag-overlay';
  overlay.innerHTML = `
    <div class="strip-tag-overlay-box">
      <p class="strip-tag-overlay-title">Untagging this image will remove it from all <span class="setup-tag" style="background:${col.hex};color:${textCol};position:static;display:inline-flex;vertical-align:middle;pointer-events:none;margin:4px 2px;font-size:16px;padding:4px 14px;min-height:28px;">${setup.name}</span> SETUP marked frames.</p>
      <p class="strip-tag-overlay-desc">The original image stays in its source frame.</p>
      <label class="strip-tag-overlay-dismiss"><input type="checkbox" id="stripUntagDismissCheck" /> Don't show this again</label>
      <div class="strip-tag-overlay-btns">
        <button class="strip-tag-overlay-ok" id="stripUntagOk">OK</button>
        <button class="strip-tag-overlay-cancel" id="stripUntagCancel">CANCEL</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#stripUntagOk')!.addEventListener('click', () => {
    const dismiss = (document.getElementById('stripUntagDismissCheck') as HTMLInputElement).checked;
    if (dismiss) {
      useStore.setState({ stripUntagInfoDismissed: true });
    }
    overlay.remove();
    executeUntag(fid, strip, ver);
  });

  overlay.querySelector('#stripUntagCancel')!.addEventListener('click', () => {
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
  // TAG-1: tag a version → 1s delay lets cascade propagation complete
  setTimeout(() => void flushSyncNow(), 1000);
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
    // User's untagged content that actually has something — truly empty
    // versions are just placeholders and should be filled by copies, not
    // preserved.  Guard: also keep versions whose type is 'empty' but that
    // have actual content (strokes or images), e.g. after freehand drawing.
    const userContent = targetVers.filter((v) => !v.setupTagged && (v.type !== 'empty' || (v.strokes && v.strokes.length > 0) || v.bgImage));

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

    // Orphaned copies — copies whose origin frame left the setup.
    // Keep them so the image survives; they'll be cleaned up when
    // this frame itself leaves the setup.
    const orphanedCopies = targetVers.filter(
      (v) =>
        v.setupTagged === 'copy' &&
        !taggedFront.some((tf) => tf.bgImage === v.bgImage)
    );

    // Rebuild: tagged front, then orphaned copies, then user content
    targetVers.length = 0;
    for (const tv of taggedFront) targetVers.push(tv);
    for (const oc of orphanedCopies) targetVers.push(oc);
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
      <p>To edit Main Frame's SETUP assignments,<br>click <strong>SETUPS</strong> in the upper left corner of the page.</p>
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

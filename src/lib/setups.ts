// Setups — colour-coded lighting/time-of-day labels for main frame cards.
// Each setup has a name (max 7 chars, UPPERCASE) and a colour from the 12-colour palette.
// Frames can belong to at most one setup. A colour tag shows on the canvas in all views.

import { state, useStore, SETUP_COLORS, bumpRenderTick } from '../store/state';
import type { Setup } from '../store/state';
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

  // Untag all frames that belong to this setup
  for (const f of s.frames) {
    if (f.setupId === setupId) f.setupId = null;
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
    // Unassign
    f.setupId = null;
  } else {
    // Assign (or reassign from different setup)
    f.setupId = s.activeSetupId;
  }

  // Bump render tick so Zustand subscribers notice the in-place mutation
  bumpRenderTick();

  // Re-render to update toggle buttons + tags
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
      // Assigned to current setup → clickable pill in bottom-right (tap to remove)
      const setup = s.setups.find((su) => su.id === f.setupId);
      if (setup) {
        const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
        const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
        html += `<button class="setup-tag setup-tag-btn" data-setup-fid="${fid}" style="background:${col.hex};color:${textCol}">${setup.name}</button>`;
      }
    } else {
      // Not in current setup → show "+" ADD TO SETUP overlay
      // If in a different setup, also show that setup's pill tag underneath
      if (hasSetup) {
        const setup = s.setups.find((su) => su.id === f.setupId);
        if (setup) {
          const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
          const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
          html += `<span class="setup-tag" style="background:${col.hex};color:${textCol}">${setup.name}</span>`;
        }
      }
      html += `<button class="setup-add-overlay" data-setup-fid="${fid}"><span class="setup-add-plus">+</span><span class="setup-add-label">ADD TO SETUP</span></button>`;
    }
  } else {
    // Normal mode (not editing): just show the colour tag if assigned
    if (hasSetup) {
      const setup = s.setups.find((su) => su.id === f!.setupId);
      if (setup) {
        const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
        const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
        html += `<span class="setup-tag" style="background:${col.hex};color:${textCol}">${setup.name}</span>`;
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

// ─── Helpers ───────────────────────────────────────────────────────────

/** Determine if a colour is light enough to need dark text. */
function needsDarkText(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55;
}

// Setups — colour-coded lighting/time-of-day labels for main frame cards.
// Each setup has a name (max 7 chars, UPPERCASE) and a colour from the 12-colour palette.
// Frames can belong to at most one setup. A colour tag shows on the canvas in all views.

import { state, useStore, SETUP_COLORS } from '../store/state';
import type { Setup } from '../store/state';
import { showToast } from './modals';

// ─── Setup bar rendering ───────────────────────────────────────────────

/** Toggle setup mode on/off. */
export function toggleSetupMode(): void {
  const s = state();
  const bar = document.getElementById('setupBar');
  if (!bar) return;

  if (s.setupMode) {
    // Exit setup mode
    useStore.setState({ setupMode: false, activeSetupId: null });
    bar.style.display = 'none';
    bar.innerHTML = '';
    document.getElementById('setupsBtn')?.classList.remove('active');
    // Re-render to remove toggle circles
    const renderAll = (window as any).__fh_renderAll;
    if (renderAll) renderAll();
    return;
  }

  // Enter setup mode
  useStore.setState({ setupMode: true });
  bar.style.display = '';
  document.getElementById('setupsBtn')?.classList.add('active');

  if (s.setups.length === 0) {
    // First time — show creation form
    renderSetupCreateForm(bar);
  } else {
    // Show bar with first setup selected
    useStore.setState({ activeSetupId: s.setups[0].id });
    renderSetupBar(bar);
  }
}

/** Render the setup bar with active pill + dropdown + helper text + DONE. */
export function renderSetupBar(bar: HTMLElement): void {
  const s = state();
  const active = s.setups.find((su) => su.id === s.activeSetupId);
  if (!active) {
    renderSetupCreateForm(bar);
    return;
  }
  const col = SETUP_COLORS[active.colorIndex] || SETUP_COLORS[0];
  const textCol = needsDarkText(col.hex) ? '#000' : '#fff';

  bar.innerHTML = `
    <div class="setup-bar-inner">
      <button class="setup-dropdown-arrow" id="setupDropdownBtn" title="Choose setup">▼</button>
      <span class="setup-pill active-pill" style="background:${col.hex};color:${textCol}">${active.name}</span>
      <span class="setup-helper-text">tap frames to assign</span>
      <span class="setup-bar-spacer"></span>
      <button class="setup-done-btn" id="setupDoneBtn">DONE</button>
    </div>
    <div class="setup-dropdown" id="setupDropdown" style="display:none"></div>
  `;

  // Wire DONE
  bar.querySelector('#setupDoneBtn')!.addEventListener('click', () => toggleSetupMode());

  // Wire dropdown
  bar.querySelector('#setupDropdownBtn')!.addEventListener('click', () => {
    const dd = document.getElementById('setupDropdown')!;
    if (dd.style.display === 'none') {
      renderSetupDropdown(dd);
      dd.style.display = '';
    } else {
      dd.style.display = 'none';
    }
  });

  // Re-render to show toggle circles + tags
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
}

/** Render the dropdown menu: + NEW first, then existing setups as coloured pills. */
function renderSetupDropdown(dd: HTMLElement): void {
  const s = state();
  let html = '<button class="setup-dd-item setup-dd-new" data-setup-new="1">+ NEW</button>';
  for (const su of s.setups) {
    const col = SETUP_COLORS[su.colorIndex] || SETUP_COLORS[0];
    const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
    const isActive = su.id === s.activeSetupId;
    html += `<button class="setup-dd-item${isActive ? ' setup-dd-active' : ''}" data-setup-select="${su.id}" style="background:${col.hex};color:${textCol}">${su.name}</button>`;
  }
  dd.innerHTML = html;

  // Wire + NEW
  dd.querySelector('[data-setup-new]')?.addEventListener('click', () => {
    dd.style.display = 'none';
    const bar = document.getElementById('setupBar')!;
    renderSetupCreateForm(bar);
  });

  // Wire selection
  dd.querySelectorAll('[data-setup-select]').forEach((btn) =>
    btn.addEventListener('click', () => {
      const id = (btn as HTMLElement).dataset.setupSelect!;
      useStore.setState({ activeSetupId: id });
      dd.style.display = 'none';
      renderSetupBar(document.getElementById('setupBar')!);
    })
  );
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
    colorsHTML += `<button class="setup-color-circle${i === 0 && !taken ? ' selected' : ''}${taken ? ' taken' : ''}" data-ci="${i}" style="background:${col.hex}" title="${col.name}"${taken ? ' disabled' : ''}></button>`;
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
      ${s.setups.length > 0 ? '<button class="setup-cancel-btn" id="setupCancelBtn">CANCEL</button>' : ''}
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

  // Wire CREATE
  bar.querySelector('#setupCreateBtn')!.addEventListener('click', () => {
    const input = document.getElementById('setupNameInput') as HTMLInputElement;
    const name = input.value.trim().toUpperCase();
    if (!name) { showToast('Enter a name'); return; }
    if (name.length > 7) { showToast('Max 7 characters'); return; }
    // Check duplicate name
    if (s.setups.some((su) => su.name === name)) { showToast('Name already used'); return; }

    const id = 'setup_' + state().nextSetupId;
    const newSetup: Setup = { id, name, colorIndex: selectedCI };
    useStore.setState((prev) => ({
      setups: [...prev.setups, newSetup],
      activeSetupId: id,
      nextSetupId: prev.nextSetupId + 1,
    }));

    renderSetupBar(bar);
  });

  // Wire CANCEL (back to bar with existing setups)
  bar.querySelector('#setupCancelBtn')?.addEventListener('click', () => {
    const latest = state();
    if (latest.setups.length > 0) {
      useStore.setState({ activeSetupId: latest.activeSetupId || latest.setups[0].id });
      renderSetupBar(bar);
    }
  });

  // Auto-focus
  (document.getElementById('setupNameInput') as HTMLInputElement)?.focus();
}

// ─── Frame assignment ──────────────────────────────────────────────────

/** Handle a click on a main frame card while in setup mode.
 *  Toggle: assign → unassign → assign to different setup. */
export function handleSetupFrameClick(fid: number): void {
  const s = state();
  if (!s.setupMode || !s.activeSetupId) return;

  const f = s.frames.find((fr) => fr.id === fid);
  if (!f) return;

  if (f.setupId === s.activeSetupId) {
    // Unassign
    f.setupId = null;
  } else {
    // Assign (or reassign from different setup)
    f.setupId = s.activeSetupId;
  }

  // Re-render the changed card
  const renderAll = (window as any).__fh_renderAll;
  if (renderAll) renderAll();
}

// ─── Colour tag HTML ───────────────────────────────────────────────────

/** Return HTML for the setup colour tag overlay on a canvas, or '' if none.
 *  When in setup mode, also renders a clickable toggle overlay. */
export function setupTagHTML(fid: number): string {
  const s = state();
  const f = s.frames.find((fr) => fr.id === fid);
  let tagHTML = '';

  if (f && f.setupId) {
    const setup = s.setups.find((su) => su.id === f.setupId);
    if (setup) {
      const col = SETUP_COLORS[setup.colorIndex] || SETUP_COLORS[0];
      const textCol = needsDarkText(col.hex) ? '#000' : '#fff';
      tagHTML = `<span class="setup-tag" style="background:${col.hex};color:${textCol}">${setup.name}</span>`;
    }
  }

  // In setup mode, add a transparent clickable overlay for toggling
  if (s.setupMode && s.activeSetupId) {
    const isAssigned = f?.setupId === s.activeSetupId;
    tagHTML += `<button class="setup-toggle-overlay" data-setup-fid="${fid}" title="${isAssigned ? 'Remove from setup' : 'Assign to setup'}"><span class="setup-toggle-icon">${isAssigned ? '✓' : '+'}</span></button>`;
  }

  return tagHTML;
}

/** Wire click handlers on setup toggle overlays. Call after rendering. */
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
  // Relative luminance approximation
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.55;
}

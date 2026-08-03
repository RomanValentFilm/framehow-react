// FITTING project chrome.
//
// Fitting projects use a single toolbar: everything that normally lives in the
// detail bar is moved onto the view bar, and the detail bar itself is hidden.
//
// Buttons are MOVED, never recreated — click handlers are bound once at startup
// (init.ts scans the DOM), and moving a node carries its listeners with it.
//
// IMPORTANT: landscape and 9:16 projects must be byte-identical to v4.9.042.
// Rather than trusting a snapshot taken at some earlier moment, the original
// layout is written out below as a fixed specification, and rebuilt from that.
// It is also re-checked on every render of a non-fitting project, so those
// project types can never be left with a rearranged toolbar.

import { state, useStore } from '../store/state';
import { relabelStripVersions } from './helpers';

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

/**
 * The toolbar exactly as ViewBar.tsx builds it (v4.9.042).
 * Container selector -> the children it must hold, in order.
 */
const CANONICAL: [string, string[]][] = [
  ['.view-bar .vb-left',   ['.view-btn[data-view="group"]', '#setupsBtn']],
  ['.view-bar .vb-middle', ['.view-btn[data-view="3x2"]', '.vb-sep-hair', '#sortByBtn']],
  ['.view-bar .vb-right',  ['#detailBtn']],
  ['#detailBar .db-middle', ['.strip-toggle[data-strip="main"]', '#stripBtn-ver', '#stripBtn-floor',
                             '#stripBtn-refs', '.vb-sep', '#needsStripBtn', '#notesStripBtn']],
  ['#detailBar .db-right',  ['#vbOffBtn', '.view-btn[data-view="overview"]', '.view-btn[data-view="grid4"]']],
];

/** Original button wording, restored alongside the original positions. */
const CANONICAL_TEXT: [string, string][] = [
  ['.view-btn[data-view="3x2"]', '3×2VIEW'],
  ['.strip-toggle[data-strip="main"]', 'FRAME'],
  ['.view-btn[data-view="grid4"]', 'M+3'],
];

/** Buttons a fitting project does not use. */
const HIDDEN_IN_FITTING = [
  '.view-btn[data-view="setups"]',
  '.view-btn[data-view="sortby"]',
  '.view-btn[data-view="detail"]',
  '.view-btn[data-view="needs"]',
  '.view-btn[data-view="overview"]',   // M+2 — fitting keeps only the gallery
  '.strip-toggle[data-strip="floor"]', // the middle LOOK strip is unused
];

/** Fitting wording. */
const FITTING_TEXT: [string, string][] = [
  ['.view-btn[data-view="3x2"]', 'CAST BOARD'],
  ['.strip-toggle[data-strip="main"]', 'TALENTS'],
  ['.view-btn[data-view="grid4"]', 'LOOKS GALLERY'],
];

let _applied = false;
let _detailBarWasOpen = false;

/** True when every container already holds exactly the children it should. */
function isCanonical(): boolean {
  for (const [parentSel, childSels] of CANONICAL) {
    const parent = q(parentSel);
    if (!parent) return true;  // toolbar not mounted — nothing to judge
    const want = childSels.map((s) => q(s)).filter(Boolean) as HTMLElement[];
    const have = Array.from(parent.children).filter((c) => want.includes(c as HTMLElement));
    if (have.length !== want.length) return false;
    for (let i = 0; i < want.length; i++) if (have[i] !== want[i]) return false;
  }
  for (const [sel, text] of CANONICAL_TEXT) {
    const el = q(sel);
    if (el && el.textContent !== text) return false;
  }
  return true;
}

/** Put the toolbar back exactly as ViewBar.tsx built it. */
function restoreCanonical(): void {
  for (const [parentSel, childSels] of CANONICAL) {
    const parent = q(parentSel);
    if (!parent) continue;
    for (const sel of childSels) {
      const el = q<HTMLElement>(sel);
      if (el) parent.appendChild(el);   // appending in order rebuilds the row
    }
  }
  for (const [sel, text] of CANONICAL_TEXT) {
    const el = q<HTMLElement>(sel);
    if (el && el.textContent !== text) el.textContent = text;
  }
  document.querySelectorAll('.fitting-hidden').forEach((el) => el.classList.remove('fitting-hidden'));
  document.querySelectorAll('.vb-sep-hair').forEach((el) => ((el as HTMLElement).style.display = ''));

  const detailBar = q<HTMLElement>('#detailBar');
  if (detailBar) detailBar.style.display = _detailBarWasOpen ? '' : 'none';
  const detailBtn = q<HTMLElement>('#detailBtn');
  if (detailBtn) detailBtn.classList.toggle('active', _detailBarWasOpen);
  document.body.classList.toggle('detail-open', _detailBarWasOpen);
  _detailBarWasOpen = false;
}

function applyFitting(): boolean {
  const vbLeft = q('.view-bar .vb-left');
  const vbMiddle = q('.view-bar .vb-middle');
  const vbRight = q('.view-bar .vb-right');
  if (!vbLeft || !vbMiddle || !vbRight) return false;   // not mounted yet

  // CAST BOARD moves to the far left, beside GROUP.
  const castBoard = q<HTMLElement>('.view-btn[data-view="3x2"]');
  if (castBoard) vbLeft.appendChild(castBoard);

  // Middle: TALENTS, LOOKS, REFS, separator, NOTES.
  vbMiddle.querySelectorAll('.vb-sep-hair').forEach((el) => ((el as HTMLElement).style.display = 'none'));
  for (const sel of ['.strip-toggle[data-strip="main"]', '.strip-toggle[data-strip="ver"]',
                     '.strip-toggle[data-strip="refs"]', '#detailBar .vb-sep',
                     '.view-btn[data-view="notes"]']) {
    const el = q<HTMLElement>(sel);
    if (el) vbMiddle.appendChild(el);
  }

  // Right: the gallery button, plus OFF (which shows itself when relevant).
  for (const sel of ['.view-btn[data-view="off"]', '.view-btn[data-view="grid4"]']) {
    const el = q<HTMLElement>(sel);
    if (el) vbRight.appendChild(el);
  }

  for (const [sel, text] of FITTING_TEXT) {
    const el = q<HTMLElement>(sel);
    if (el) el.textContent = text;
  }
  for (const sel of HIDDEN_IN_FITTING) {
    const el = q<HTMLElement>(sel);
    if (el) el.classList.add('fitting-hidden');
  }

  const detailBar = q<HTMLElement>('#detailBar');
  if (detailBar) {
    _detailBarWasOpen = detailBar.style.display !== 'none';
    detailBar.style.display = 'none';
  }
  document.body.classList.remove('detail-open');
  return true;
}

/**
 * Older fitting projects were created with the first naming pass
 * ("fit" / f1, f2). Bring them up to the current one ("look" / L1, L2) —
 * but ONLY where the names are still the untouched defaults, so anything the
 * user renamed themselves is left exactly as they set it.
 */
function migrateFittingNames(): void {
  const s = state();
  const ver = s.stripDefs.find((d) => d.id === 'ver');
  if (!ver) return;
  let changed = false;
  if (ver.defaultFrameLabel === 'fit') { ver.defaultFrameLabel = 'look'; changed = true; }
  if (ver.prefix === 'f') {
    ver.prefix = 'L';
    changed = true;
    // Existing tabs still read f1, f2 — renumber them under the new prefix.
    for (const f of s.frames) relabelStripVersions(f.id, 'ver');
  }
  if (changed) useStore.setState({ stripDefs: [...s.stripDefs] });
}

/**
 * Re-shape the toolbar for the project that is currently open.
 * Safe to call on every render.
 */
export function applyFittingChrome(): void {
  const isFitting = state().projectType === 'fitting';
  document.body.classList.toggle('fitting-mode', isFitting);

  if (isFitting) {
    migrateFittingNames();
    if (_applied) return;
    if (applyFitting()) _applied = true;
    return;
  }

  // Not a fitting project: guarantee the original layout, every render.
  if (_applied || !isCanonical()) {
    restoreCanonical();
    _applied = false;
  }
}

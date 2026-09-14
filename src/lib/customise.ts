// CUSTOMISE — the six column names of a project (#510).
//
// SHOT (button only), ANGLE / vers, SKETCH / sketch, REFS / refs, NEEDS /
// needs, NOTES / note. Roman, 12 September: "let's have all 6". Per project,
// saved with it, travelling by time; and remembered as the user's own default
// for the next NEW project. The body of the Save button lives here so the
// button and the browser tests press exactly the same thing.

import { state, useStore } from '../store/state';
import type { StripType } from '../store/state';
import { relabelStripVersions } from './helpers';
import { renderAll } from './render';
import { renameNeedsLabel } from './needs';
import { renameNotesLabel } from './notes';
import { flushSyncNow } from './currentProject';
import { rememberDefaultNames } from './userDefaults';

export interface CustomiseValues {
  /** Button names, as typed. Empty keeps what the project has. */
  main: string; ver: string; floor: string; refs: string; needs: string; notes: string;
  /** Card labels, as typed. Empty keeps what the project has. */
  verLabel: string; floorLabel: string; refsLabel: string; needsLabel: string; notesLabel: string;
}

const cleanButton = (raw: string, keep: string) =>
  raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').slice(0, 6) || keep;
const cleanLabel = (raw: string, keep: string) => raw.trim().slice(0, 6) || keep;

/** What the modal should show when it opens: the project's names now. */
export function currentCustomiseValues(): CustomiseValues {
  const s = state();
  const strip = (id: StripType) => s.stripDefs.find((d) => d.id === id);
  const col = (id: 'main' | 'needs' | 'notes') => s.columnNames.find((c) => c.id === id);
  return {
    main: col('main')?.buttonLabel ?? 'SHOT',
    ver: strip('ver')?.buttonLabel ?? '', floor: strip('floor')?.buttonLabel ?? '', refs: strip('refs')?.buttonLabel ?? '',
    needs: col('needs')?.buttonLabel ?? 'NEEDS', notes: col('notes')?.buttonLabel ?? 'NOTES',
    verLabel: strip('ver')?.defaultFrameLabel ?? '', floorLabel: strip('floor')?.defaultFrameLabel ?? '',
    refsLabel: strip('refs')?.defaultFrameLabel ?? '',
    needsLabel: col('needs')?.cardLabel ?? 'needs', notesLabel: col('notes')?.cardLabel ?? 'note',
  };
}

/** SAVE. Exactly what the button did for the three strips, plus the other three columns. */
export function applyCustomise(v: CustomiseValues): void {
  const s = state();
  const buttons: Record<string, string> = { ver: v.ver, floor: v.floor, refs: v.refs };
  const labels: Record<string, string> = { ver: v.verLabel, floor: v.floorLabel, refs: v.refsLabel };
  const newDefs = s.stripDefs.map((def) => ({
    ...def,
    buttonLabel: cleanButton(buttons[def.id] ?? '', def.buttonLabel),
    defaultFrameLabel: cleanLabel(labels[def.id] ?? '', def.defaultFrameLabel),
  }));
  const newColumns = s.columnNames.map((c) => {
    if (c.id === 'main') return { ...c, buttonLabel: cleanButton(v.main, c.buttonLabel) };
    if (c.id === 'needs') return { ...c, buttonLabel: cleanButton(v.needs, c.buttonLabel), cardLabel: cleanLabel(v.needsLabel, c.cardLabel) };
    return { ...c, buttonLabel: cleanButton(v.notes, c.buttonLabel), cardLabel: cleanLabel(v.notesLabel, c.cardLabel) };
  });
  useStore.setState({ stripDefs: newDefs, columnNames: newColumns });

  // Update prefix + relabel tabs, and clear per-frame overrides — as before.
  for (const def of newDefs) {
    for (const fr of s.frames) {
      if (fr.stripLabels && fr.stripLabels[def.id]) {
        delete fr.stripLabels[def.id];
      }
    }
    // A FITTING keeps CAPITAL prefixes (#505): "l1" reads as "11". Other
    // project types keep v, s, r as they always were.
    const first = def.defaultFrameLabel[0];
    const newPrefix = (first ? (s.projectType === 'fitting' ? first.toUpperCase() : first.toLowerCase()) : '') || def.prefix;
    if (def.prefix !== newPrefix) {
      def.prefix = newPrefix;
      const versMap = s.stripVersions[def.id] || {};
      for (const fid of Object.keys(versMap)) {
        relabelStripVersions(+fid, def.id);
      }
    }
  }

  // The card labels on every needs / note card, through the app's own rename.
  const needsNow = newColumns.find((c) => c.id === 'needs')!.cardLabel;
  const notesNow = newColumns.find((c) => c.id === 'notes')!.cardLabel;
  if (needsNow !== (s.columnNames.find((c) => c.id === 'needs')?.cardLabel ?? '')) renameNeedsLabel(needsNow);
  if (notesNow !== (s.columnNames.find((c) => c.id === 'notes')?.cardLabel ?? '')) renameNotesLabel(notesNow);

  // Remembered for the next NEW project — on this device and with the account.
  rememberDefaultNames({ stripDefs: newDefs, columnNames: newColumns });

  renderAll();
  void flushSyncNow(); // CUS-1: customise names → Save
}

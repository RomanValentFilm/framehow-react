// WHEN each frame and each version was changed on this device.
//
// The push stamps every row with `updated_at: now`, which is the moment of the
// PUSH. Two devices editing the same frame offline therefore arrive in the
// order they reconnected, and "newer wins" silently meant "last to reconnect
// wins" — the desktop overwriting an iPad change made half an hour later.
//
// So we keep the honest fact separately, exactly as project settings do: taken
// when the change is first SEEN LOCALLY, on the autosave that follows it. Never
// at push time, or everything made offline would look newest.
//
// Kept for ONE project, and carried in the local snapshot so a restart does not
// forget and start claiming everything changed just now.

import { useStore } from '../store/state';
import type { Frame, Version } from '../store/state';

/** What the row looked like last time we looked, and when we first saw it that
 *  way. */
const _seen = new Map<string, { fp: string; at: number }>();
let _projectId: string | null | undefined;

/** A frame's OWN content — not its versions, which are stamped separately. */
function frameFp(f: Frame, sortOrder: number, needs: string, notes: string): string {
  return [
    f.label, f.cropW, f.cropH, f.textContent,
    f.tableData ? JSON.stringify(f.tableData) : '',
    f.hidden ? 1 : 0, f.note ?? '', (f.scribbles?.length ?? 0),
    f.stripLabels ? JSON.stringify(f.stripLabels) : '',
    f.setupId ?? '', needs, notes,
    f.r2Key || (f.src ? f.src.substring(0, 40) : ''),
    f.strokes?.length ?? 0,
    sortOrder,
  ].join('|');
}

function versionFp(v: Version): string {
  return [
    v.label, v.type, v.hidden ? 1 : 0, Number(v.stars ?? 0), v.note ?? '',
    v.setupTagged ?? '',
    v.r2Key || (v.bgImage ? v.bgImage.substring(0, 40) : ''),
    v.strokes?.length ?? 0,
  ].join('|');
}

/**
 * Note anything that changed since the last look, with the time we noticed.
 * Called from the local autosave.
 */
/**
 * @param received  For work that has just arrived from the server: the time the
 *   OTHER device changed it, per `f/<id>` or `v/<id>`. Receiving is not
 *   changing (#265) — without this, a device that merely pulled stamped
 *   everything it received with the current time and then claimed to hold the
 *   newest edit of work it had only been handed.
 */
export function stampChangedContent(
  projectId?: string | null,
  received?: ReadonlyMap<string, number>,
): void {
  if (projectId !== undefined && projectId !== _projectId) {
    _seen.clear();
    _projectId = projectId;
  }

  const s = useStore.getState();
  const now = Date.now();
  // The first look at a project is not a change. Everything is recorded as
  // unknown-age, so merely opening a project cannot out-rank real work done
  // elsewhere.
  const seeding = _seen.size === 0;

  const note = (key: string, fp: string) => {
    const prev = _seen.get(key);
    const cameFromServer = received?.get(key);
    if (!prev) _seen.set(key, { fp, at: cameFromServer ?? (seeding ? 0 : now) });
    else if (prev.fp !== fp) _seen.set(key, { fp, at: cameFromServer ?? now });
  };

  s.frames.forEach((f, i) => {
    if (!f.serverFrameId) return;   // never synced — nothing to compare against
    const needs = s.frameNeeds[f.id] ? JSON.stringify(s.frameNeeds[f.id]) : '';
    const notes = s.frameNotes[f.id] ? JSON.stringify(s.frameNotes[f.id]) : '';
    note(`f/${f.serverFrameId}`, frameFp(f, i, needs, notes));

    for (const stripId of Object.keys(s.stripVersions)) {
      for (const v of s.stripVersions[stripId]?.[f.id] ?? []) {
        if (v.serverVersionId) note(`v/${v.serverVersionId}`, versionFp(v));
      }
    }
  });
}

/** When this device last changed that frame. Undefined = we do not know, and
 *  the server falls back to the push time, which is no worse than before. */
export function frameChangedAt(serverFrameId: string | undefined): number | undefined {
  if (!serverFrameId) return undefined;
  const hit = _seen.get(`f/${serverFrameId}`);
  return hit && hit.at > 0 ? hit.at : undefined;
}

export function versionChangedAt(serverVersionId: string | undefined): number | undefined {
  if (!serverVersionId) return undefined;
  const hit = _seen.get(`v/${serverVersionId}`);
  return hit && hit.at > 0 ? hit.at : undefined;
}

/** Carried in the local snapshot, so being offline over a restart still orders
 *  edits honestly. */
export function exportChangeStamps(): Record<string, { fp: string; at: number }> {
  return Object.fromEntries(_seen);
}

export function importChangeStamps(m: Record<string, { fp: string; at: number }> | undefined): void {
  if (!m) return;
  _seen.clear();
  for (const [k, v] of Object.entries(m)) _seen.set(k, v);
}

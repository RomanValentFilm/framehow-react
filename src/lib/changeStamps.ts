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
import type { Frame, Version, Stroke } from '../store/state';

/** What the row looked like last time we looked, and when we first saw it that
 *  way. */
const _seen = new Map<string, { fp: string; at: number }>();
let _projectId: string | null | undefined;

/**
 * A frame's OWN content — not its versions, which are stamped separately, and
 * NOT its position (#294).
 *
 * Position used to be in here, which made moving a frame count as changing it.
 * A device that only rearranged therefore sent every frame's whole row stamped
 * "now", and could carry its own older notes over someone else's newer ones.
 * The arrangement is one item of its own now; this is only what is IN the frame.
 */
/**
 * WHAT A PICTURE LOOKS LIKE, SHORTLY (#333).
 *
 * A picture already in the cloud is known by its storage key, and that is
 * exact. One that is not yet uploaded was summarised by the first 40 characters
 * of its data — which is about thirty bytes, and image formats spend their
 * first thirty bytes on a fixed header. Two photographs from the same camera,
 * or two drawings exported at the same size, therefore looked identical.
 *
 * What that cost: retake a shot on the same frame while offline, and the frame
 * could read as unchanged, never upload, and be replaced by the old picture on
 * the next pull.
 *
 * The length plus a piece from the middle and a piece from the end costs
 * nothing to compute and cannot be fooled by a shared header.
 */
export function pictureFp(r2Key: string | undefined, src: string | undefined | null): string {
  if (r2Key) return r2Key;
  if (!src) return '';
  return `${src.length}:${src.slice(40, 64)}:${src.slice(-24)}`;
}

/**
 * WHAT A DRAWING LOOKS LIKE, SHORTLY (#333).
 *
 * It was the NUMBER of strokes. Erase one and draw another and the number is
 * the same, so the drawing read as unchanged and was never sent.
 *
 * Counting the points as well as the strokes, and taking the tail of the last
 * one, catches that without walking every point of every stroke twice.
 */
export function strokesFp(strokes: Stroke[] | undefined | null): string {
  if (!strokes || strokes.length === 0) return '0';
  let points = 0;
  for (const st of strokes) points += st.points?.length ?? (st.text ? st.text.length : 0);
  const last = strokes[strokes.length - 1];
  const tail = last?.points?.length
    ? `${last.points[last.points.length - 1]?.x},${last.points[last.points.length - 1]?.y}`
    : (last?.text ?? '');
  return `${strokes.length}:${points}:${tail}`;
}

function frameFp(f: Frame, _sortOrder: number, needs: string, notes: string): string {
  return [
    f.label, f.cropW, f.cropH, f.textContent,
    f.tableData ? JSON.stringify(f.tableData) : '',
    f.hidden ? 1 : 0, f.note ?? '', (f.scribbles?.length ?? 0),
    f.stripLabels ? JSON.stringify(f.stripLabels) : '',
    f.setupId ?? '', needs, notes,
    pictureFp(f.r2Key, f.src),
    strokesFp(f.strokes),
  ].join('|');
}

function versionFp(v: Version): string {
  return [
    v.label, v.type, v.hidden ? 1 : 0, Number(v.stars ?? 0), v.note ?? '',
    v.setupTagged ?? '',
    pictureFp(v.r2Key, v.bgImage),
    strokesFp(v.strokes),
  ].join('|');
}

/**
 * THE FIRST LOOK, taken when a project LOADS (#289).
 *
 * Everything on the device is written down as it currently stands, aged zero —
 * unknown, so merely opening a project cannot out-rank work done elsewhere.
 *
 * It has to happen at LOAD. It used to happen on the first save afterwards, and
 * that save waits two seconds after your last action — so a frame re-ordered in
 * the first moments was swallowed into the first look and recorded as "it was
 * always in that place". It then went up with no time on it, the server kept
 * its own order, and the re-order was lost without a word. Exactly the fault
 * fixed for the NEEDS categories in #264, in the frames' memory instead.
 */
export function seedContentStamps(projectId: string | null): void {
  _projectId = projectId;
  _seen.clear();
  stampChangedContent(projectId);      // first sight of everything = age unknown
}

/**
 * Note anything that changed since the last look, with the time we noticed.
 * Called from the local autosave.
 *
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
    const needs = s.frameNeeds[f.id] ? JSON.stringify(s.frameNeeds[f.id]) : '';
    const notes = s.frameNotes[f.id] ? JSON.stringify(s.frameNotes[f.id]) : '';

    // A FRAME WITH NO SERVER ID STILL HAS A TIME (#395).
    //
    // This used to say `if (!f.serverFrameId) return;` — nothing that had never
    // been to the server was given a time at all. Which sounds harmless, and is
    // not: press NEW, type a name while the push is still in the air, and that
    // name is recorded nowhere. When the reply comes back the frame is given a
    // time for the first time — the moment it was NOTICED, not the moment you
    // typed it — and until then it goes up as zero, the oldest time there is,
    // and loses to the server's own copy. That is the name coming back.
    //
    // So it is filed under the LOCAL number in the meantime and moved across
    // when the id arrives, keeping the time. Roman's rule, plainly: everything
    // the app creates has a time. Not 1970 and not zero — the real moment.
    const key = f.serverFrameId ? `f/${f.serverFrameId}` : `l/${f.id}`;
    if (f.serverFrameId) {
      const waiting = _seen.get(`l/${f.id}`);
      if (waiting && !_seen.has(key)) _seen.set(key, waiting);
      if (waiting) _seen.delete(`l/${f.id}`);
    }
    note(key, frameFp(f, i, needs, notes));

    if (!f.serverFrameId) return;   // versions below are keyed by server id

    for (const stripId of Object.keys(s.stripVersions)) {
      for (const v of s.stripVersions[stripId]?.[f.id] ?? []) {
        if (v.serverVersionId) note(`v/${v.serverVersionId}`, versionFp(v));
      }
    }
  });
}

/** When this device last changed that frame. Undefined = we do not know, and
 *  the server falls back to the push time, which is no worse than before. */
/**
 * NEVER ANSWER "I DON'T KNOW" (#379).
 *
 * A frame this device has not changed used to report NOTHING, and nothing
 * cannot lose a comparison. So an untouched frame, sent up merely because the
 * device re-sends everything after a pull, could quietly overwrite a real edit
 * made on the other device — the server had no times to compare on either side
 * and fell back to whichever arrived last. Whoever reconnected last won, and
 * the other person's writing was gone without a word.
 *
 * Roman put it plainly: everything should carry a time, so there is always
 * something to compare. An untouched frame now says ZERO — the oldest time
 * there is — which loses to any real edit, everywhere, always. Nothing is added
 * to the database and nothing is asked of the other device.
 *
 * Note this is only about what we SEND. `frameChangedAt` is still the honest
 * answer to "when did I change this", and callers that need to know the
 * difference use it directly.
 */
export function frameChangedAtForSending(
  serverFrameId: string | undefined,
  localId?: number,
): number {
  const known = frameChangedAt(serverFrameId);
  if (known !== undefined) return known;
  // AND LOOK UNDER THE LOCAL NUMBER TOO (#397).
  //
  // #395 started recording a time for a frame that has no server id yet, filed
  // under `l/<localId>`. It did not teach the SENDER to look there, so a brand
  // new frame still went up as zero — `change times: 3d7c54@none` in Roman's
  // log, on the build that was supposed to have fixed it. Writing it down and
  // never reading it is worth nothing.
  if (localId !== undefined) {
    const hit = _seen.get(`l/${localId}`);
    if (hit && hit.at > 0) return hit.at;
  }
  return 0;
}

export function frameChangedAt(serverFrameId: string | undefined): number | undefined {
  if (!serverFrameId) return undefined;
  const hit = _seen.get(`f/${serverFrameId}`);
  return hit && hit.at > 0 ? hit.at : undefined;
}

/** The same for a version — see frameChangedAtForSending (#379). */
export function versionChangedAtForSending(serverVersionId: string | undefined): number {
  return versionChangedAt(serverVersionId) ?? 0;
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

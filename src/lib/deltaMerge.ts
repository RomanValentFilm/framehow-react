// Fold "what changed since I last heard" into "what I already have".
//
// The pull used to fetch the whole project every time — 500 rows read to answer
// a one-word edit (#280). Now it can ask for a delta. But the app applies a
// cloud project by REBUILDING the storyboard from it, and handing that code
// three frames would wipe the other forty-two.
//
// So the delta is folded into the copy this device already holds, and the
// rebuild runs on the result, exactly as before. That keeps ONE piece of code
// mapping cloud rows to frames — a second copy would drift from the first, and
// the drift would show up as lost work months later.
//
// Nothing here touches the store. It is lists in, list out, which is why it can
// be tested on the bench.

export interface Identified { id: string }

/** The shape both sides share. Only the fields the merge needs are named. */
export interface MergeableTree {
  project: unknown;
  strips: Identified[];
  frames: Array<Identified & { updated_at: number }>;
  versions: Array<Identified & { frame_id: string; updated_at: number }>;
  images: Array<Identified & { version_id: string }>;
  drawings: Array<Identified & { version_id: string }>;
  deletions?: Array<{ entity_type: string; entity_id: string; deleted_at: number }>;
  settings?: Array<{ kind: string; item_id: string }>;
  server_now?: number;
  full?: boolean;
}

function byId<T extends Identified>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.id, r]));
}

/**
 * @param held   the whole project as this device last understood it
 * @param delta  only what has reached the server since
 * @returns      a whole project again — held, with the delta written over it
 *
 * Rules, all of them boring on purpose:
 * - a row in the delta replaces the row with the same id
 * - a row in the delta with an id nobody has is added
 * - a row NOT mentioned by the delta is left exactly as it was: silence means
 *   "nothing happened to that", never "it is gone"
 * - a tombstone removes a frame or a version, and takes its children with it
 */
export function mergeDelta(held: MergeableTree, delta: MergeableTree): MergeableTree {
  if (delta.full !== false) return delta;          // a full answer replaces everything

  const frames = byId(held.frames);
  for (const f of delta.frames) frames.set(f.id, f);

  const versions = byId(held.versions);
  for (const v of delta.versions) versions.set(v.id, v);

  // Images and drawings are keyed by the version they belong to, not by their
  // own id — the app makes a new id each time it sends one, so matching on id
  // would leave two rows for the same picture and the older one could win.
  const imageByVersion = new Map(held.images.map((i) => [i.version_id, i]));
  for (const i of delta.images) imageByVersion.set(i.version_id, i);

  const drawingByVersion = new Map(held.drawings.map((d) => [d.version_id, d]));
  for (const d of delta.drawings) drawingByVersion.set(d.version_id, d);

  // Deletions last, so a row that arrives and is deleted in the same delta ends
  // up gone rather than present.
  const goneFrames = new Set<string>();
  const goneVersions = new Set<string>();
  for (const del of delta.deletions ?? []) {
    if (del.entity_type === 'frame') goneFrames.add(del.entity_id);
    if (del.entity_type === 'version') goneVersions.add(del.entity_id);
  }
  for (const id of goneFrames) frames.delete(id);
  for (const [id, v] of versions) {
    if (goneVersions.has(id) || goneFrames.has(v.frame_id)) versions.delete(id);
  }
  for (const [versionId] of imageByVersion) {
    if (!versions.has(versionId)) imageByVersion.delete(versionId);
  }
  for (const [versionId] of drawingByVersion) {
    if (!versions.has(versionId)) drawingByVersion.delete(versionId);
  }

  // Settings are merged by the settings code itself, which already knows how to
  // keep an unsent local change (#262). Anything the delta did not mention is
  // carried through untouched so that code sees the same list as before.
  const settings = new Map((held.settings ?? []).map((s) => [`${s.kind}/${s.item_id}`, s]));
  for (const s of delta.settings ?? []) settings.set(`${s.kind}/${s.item_id}`, s);

  const merged: MergeableTree = {
    ...held,
    project: delta.project ?? held.project,
    strips: delta.strips.length > 0 ? delta.strips : held.strips,
    frames: [...frames.values()],
    versions: [...versions.values()],
    images: [...imageByVersion.values()],
    drawings: [...drawingByVersion.values()],
    deletions: delta.deletions ?? [],
    settings: [...settings.values()],
    server_now: delta.server_now ?? held.server_now,
    full: true,                                    // the result IS the whole thing
  };

  // THE LAST LINE OF DEFENCE (#283).
  //
  // Every frame this device had must still be here, unless something explicitly
  // deleted it. A frame may only leave by a tombstone — never by a merge going
  // wrong, a field being misread, or an answer arriving half-built.
  //
  // If that is ever untrue, the merge is abandoned and the device keeps what it
  // had. Nothing is shown, nothing is lost, and the next pull asks for the whole
  // project. Being stale for a few seconds is recoverable. Frames vanishing off
  // a storyboard is not.
  const missing = held.frames
    .map((f) => f.id)
    .filter((id) => !frames.has(id) && !goneFrames.has(id));
  if (missing.length > 0) {
    lastRefusal = `a merge would have dropped ${missing.length} frame(s) that nothing deleted: ${missing.slice(0, 5).join(', ')}`;
    return held;
  }
  lastRefusal = null;
  return merged;
}

/** Why the last merge was refused, if it was. Read by the pull, which then asks
 *  for the whole project instead. */
let lastRefusal: string | null = null;
export function lastMergeRefusal(): string | null { return lastRefusal; }

/**
 * MAY THIS ANSWER BE PUT ON SCREEN? (#283)
 *
 * Asked of EVERY pull — delta or whole — immediately before the storyboard is
 * rebuilt from it. The rebuild takes the answer as the truth, so an answer that
 * has lost frames takes them off the screen and, on the next save, off the
 * device.
 *
 * A frame may disappear for exactly one reason: something deleted it, and said
 * so. Anything else — a half-built answer, a merge gone wrong, a project id
 * confused with another, a bug not yet written — is caught here.
 *
 * The caller does NOT throw the answer away. It puts the missing frames back
 * and keeps this device's copy of them, so the rest of the answer still
 * applies: new frames from the other device arrive, changes land, and nothing
 * that was here goes missing. Protecting the frames must not cost the user the
 * work that arrived alongside them.
 *
 * @param haveNow      server ids of the frames on screen right now
 * @param answer       the frames the answer contains
 * @param tombstoned   ids the answer says were deleted
 */
export function answerIsSafeToApply(
  haveNow: readonly string[],
  answer: readonly string[],
  tombstoned: readonly string[],
): { safe: true } | { safe: false; why: string; missing: string[] } {
  const arriving = new Set(answer);
  const deleted = new Set(tombstoned);
  const missing = haveNow.filter((id) => !arriving.has(id) && !deleted.has(id));
  if (missing.length === 0) return { safe: true };
  return {
    safe: false,
    missing,
    why: `${missing.length} frame(s) on this device are not in the answer and nothing deleted them`,
  };
}

// THE SKELETON IS GONE (#306).
//
// It built a stand-in copy of the project from what was on the device — names
// and places, no content — so that a delta pull could fold onto something after
// a restart, when the real copy is no longer in memory (#285).
//
// It cost two days. The fold keeps the base's rows for everything the delta does
// not mention, so whatever the skeleton left out became the truth:
//
//   #302  no server times → every push claimed to have seen nothing, and the
//         server raised a picker between one device and itself
//   #306  no version TYPE → the apply died on `type.startsWith`, every pull,
//         every reload, on both devices, silently
//
// The next missing field would have been the third. A delta is now folded only
// onto a copy that came from a real answer; after a restart the first pull asks
// for the whole project. One honest answer costs a few hundred rows once.


/** Which frames in a folded tree came from the device's own copy rather than
 *  from the answer — those must be kept exactly as they are. */
export function untouchedByDelta(
  folded: MergeableTree,
  delta: MergeableTree,
): Set<string> {
  const mentioned = new Set(delta.frames.map((f) => f.id));
  return new Set(folded.frames.map((f) => f.id).filter((id) => !mentioned.has(id)));
}

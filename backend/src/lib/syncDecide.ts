// WHO WINS. The one decision at the centre of syncing, on its own so it can be
// asked questions without two real devices and a deploy.
//
// It used to live inline inside the push handler, which meant the only way to
// find out what it does was to pick up the iPad. Four attempts at the same rule
// (#256, #257, #259, #261) went out untested because of that. Same code, moved.
//
// Three answers, and nothing else:
//   accept — write what arrived
//   stale  — the server's copy is newer; keep it and tell the pusher
//   ask    — both sides changed the same picture/strokes/text blind; picker

export type FrameOutcome = 'accept' | 'stale' | 'ask';

/** The frame as it arrived in the push. */
export interface IncomingFrame {
  /** What the pusher believed the server's `updated_at` was. Undefined = an
   *  older app that does not send it. */
  base_updated_at?: number;
  /** When the change was actually MADE on that device. Null/undefined = not
   *  known (older app, or a row written before this existed). */
  content_changed_at?: number | null;
  /** Set by the push itself, so it is the time of the CONNECTION, not the edit.
   *  Only used as a fallback when there is no content_changed_at. */
  updated_at: number;
}

/** The row the server already holds. */
export interface HeldFrame {
  updated_at: number;
  content_changed_at: number | null;
}

/**
 * @param held         the server's row, or undefined if it has never seen this frame
 * @param touchesContested  does this push change the frame's picture, strokes or
 *                          text? Passed in as a function because answering it
 *                          needs the main version, its image and its drawing —
 *                          none of which belong in this decision.
 */
export function decideFrame(
  incoming: IncomingFrame,
  held: HeldFrame | undefined,
  touchesContested: () => boolean,
): FrameOutcome {
  // Unknown to the server = a frame created on this device. Always taken.
  if (!held) return 'accept';

  // Did the frame move under this device since it last heard about it? That is
  // the only thing worth ASKING about, and only for the picture, the strokes
  // and the text.
  const moved = incoming.base_updated_at !== undefined && held.updated_at > incoming.base_updated_at;
  if (moved && touchesContested()) return 'ask';

  // NEWER WINS, checked ALWAYS — not only when the frame moved. It used to sit
  // inside the "moved" branch, so once a device had learned the server's
  // timestamp from a reply, its next push looked like it was building on top
  // and the comparison was skipped: an older edit then overwrote a newer one on
  // the second attempt.
  //
  // A copy that knows WHEN it changed beats one that does not, or an unstamped
  // copy would win just by reconnecting later.
  if (held.content_changed_at !== null && incoming.content_changed_at == null) return 'stale';

  const mineAt   = held.content_changed_at ?? held.updated_at;
  const theirsAt = incoming.content_changed_at ?? incoming.updated_at;
  if (mineAt > theirsAt) return 'stale';

  return 'accept';
}

export type VersionOutcome = 'accept' | 'stale';

/**
 * Same rule for a version in a strip, minus the picker: two devices making a
 * new LOOK both keep theirs, and the same existing LOOK edited twice settles by
 * time. Nothing in a strip ever raises a question.
 */
export function decideVersion(
  incoming: { content_changed_at?: number | null; updated_at: number },
  held: { content_changed_at: number | null; updated_at: number } | undefined,
): VersionOutcome {
  if (!held) return 'accept';                 // new to the server — take it
  if (held.content_changed_at !== null && incoming.content_changed_at == null) return 'stale';
  const mineAt   = held.content_changed_at ?? held.updated_at;
  const theirsAt = incoming.content_changed_at ?? incoming.updated_at;
  return mineAt > theirsAt ? 'stale' : 'accept';
}

/**
 * Would the server take this settings item, or leave its own copy alone?
 * Mirrors the ON CONFLICT ... WHERE excluded.changed_at > project_settings.changed_at
 * in the push handler, so the bench can see the answer for a renamed NEEDS
 * category without a database.
 */
export function decideSetting(
  incoming: { changed_at: number },
  held: { changed_at: number } | undefined,
): 'accept' | 'ignored' {
  if (!held) return 'accept';
  return incoming.changed_at > held.changed_at ? 'accept' : 'ignored';
}

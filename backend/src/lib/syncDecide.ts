// WHO WINS. The one decision at the centre of syncing, on its own so it can be
// asked questions without two real devices and a deploy.
//
// It used to live inline inside the push handler, which meant the only way to
// find out what it does was to pick up the iPad. Four attempts at the same rule
// (#256, #257, #259, #261) went out untested because of that. Same code, moved.
//
// TWO answers, and nothing else (#303):
//   accept — write what arrived
//   stale  — the server's copy is newer; keep it and tell the pusher
//
// There used to be a third, `ask`: two devices changing the same picture blind
// put a picker on screen and made the user choose. It is gone, by decision.
//
// A main frame now settles by time like everything else. The reason is not that
// the picker was wrong — it is that answering "did you see my copy before you
// changed yours?" costs a number per frame, carried through every push, every
// pull, every restart. That number was lost or invented on reload again and
// again, and each time the server answered honestly and asked a question nobody
// could make sense of: one device, no other device switched on, choose between
// two pictures. The machinery cost more than it protected.
//
// The shooting-order picker stays: an order is a long list nobody can eyeball,
// and two people rearranging one blind is a real decision, not a collision.

export type FrameOutcome = 'accept' | 'stale';

/** The frame as it arrived in the push. */
export interface IncomingFrame {
  /** What the pusher believed the server's `updated_at` was. Nothing reads it
   *  any more (#303) — kept only so an older app's push still parses. */
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
 * @param held  the server's row, or undefined if it has never seen this frame
 */
export function decideFrame(
  incoming: IncomingFrame,
  held: HeldFrame | undefined,
): FrameOutcome {
  // Unknown to the server = a frame created on this device. Always taken.
  if (!held) return 'accept';

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

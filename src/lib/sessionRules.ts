// WHAT A DEVICE DOES ACROSS A WHOLE SESSION — the plumbing, not the rules.
//
// Five days of device testing, and not one failure was a merge rule. Every one
// was here: what a device remembers when it starts, what it may send, when it
// may listen, and what makes it believe it is up to date.
//
//   #297  it could not read memory written by an older version of itself
//   #298  nothing asked the server when the connection came back
//   #299  it called itself up to date because it PUSHED
//   #300  a device that had forgotten everything sent a full replace
//
// Each cost an afternoon on two real devices, and each is one line of thought.
// They lived buried in a four-thousand-line file that no test can load, so they
// could only be found by living through them.
//
// So they live here instead: plain functions, no store, no browser, no imports.
// The session bench drives them against the real server, and a fault like the
// four above fails in one second instead of one day.

/**
 * Everything a device knows about its relationship with the server. This is
 * exactly what has to survive a restart — and every fault above was a piece of
 * it going missing, or meaning something it did not mean.
 */
export interface DeviceMemory {
  /** The project's id on the server. Its mere existence is proof the server has
   *  seen this project — the fact #300 turned on. */
  cloudId: string | null;
  /** Frames whose exact content the server has confirmed. */
  confirmedFrames: number;
  /** Frames the server has told us about. Hearing about a frame is not the same
   *  as agreeing with it, so these two are counted separately. */
  framesTheServerHas: number;
  /** The server's clock as of the last time this device TOOK something.
   *  Zero means "I have never taken anything", which is true of a device that
   *  has only ever pushed. */
  takenFromServerAt: number;
  /** Work made here that the server has not accepted yet. */
  unsentFrames: number;
  settingsUnsent: boolean;
}

export const emptyMemory = (cloudId: string | null = null): DeviceMemory => ({
  cloudId,
  confirmedFrames: 0,
  framesTheServerHas: 0,
  takenFromServerAt: 0,
  unsentFrames: 0,
  settingsUnsent: false,
});

/**
 * MAY THIS PUSH REPLACE THE WHOLE PROJECT? (#300)
 *
 * A full replace deletes the project's rows on the server and writes this
 * device's copy in their place. Right exactly once — a project made here that
 * the server has never seen. Every other time it can only destroy.
 *
 * The old test counted what the device remembered, which is a guess at the
 * question. An iPad that restarted with an empty memory answered "the server
 * has never seen this" about a project both devices had been working on all
 * afternoon — while holding that project's cloud id the whole time.
 */
export function pushIsPartial(m: DeviceMemory): boolean {
  if (m.cloudId) return true;                       // the server made this id
  return m.confirmedFrames > 0 || m.framesTheServerHas > 0;
}

/**
 * MAY THIS DEVICE LISTEN RIGHT NOW?
 *
 * Not while it is holding work the server has not got: applying the server's
 * copy over unsent work is how offline work disappears. The push comes first,
 * then the pull.
 */
export function pullIsHeldBack(m: DeviceMemory, force = false): boolean {
  if (force) return false;
  // FRAMES ONLY (#305).
  //
  // Settings used to hold a pull back too, and that made a circle no device
  // could leave: the pull waits for a push; the push declines because nothing
  // is dirty (settings are not part of the dirty flag); so the setting is never
  // sent and the pull never happens. A desktop that had just been reloaded sat
  // in it — one pull, then "pull held back" for ever, with no push in between.
  //
  // Nothing needed forcing. Settings are safe in a pull already: it merges them
  // one item at a time and deliberately keeps any local copy that is newer and
  // unsent (#262). So holding the pull hostage to them protected nothing. They
  // travel with the next push, which is what "nothing dirty, nothing to send"
  // means.
  return m.unsentFrames > 0;
}

/**
 * IS THERE ANYTHING NEW FOR ME? (#299)
 *
 * Against what this device last TOOK — never against what it last said.
 *
 * Pushing used to count. So a device could be held back from pulling (unsent
 * work), push, mark itself current, and never fetch what the server had been
 * holding before that push. From then on the newest thing on the server was its
 * own, and it never asked again. That is how two drawings sat on a server for
 * ten minutes while an iPad three feet away printed "nothing changed".
 *
 * Speaking is not listening.
 */
export function serverHasSomethingNew(m: DeviceMemory, serverUpdatedAt: number): boolean {
  return serverUpdatedAt > m.takenFromServerAt;
}

/**
 * MY UNSENT FRAME, OR THEIRS? (#307)
 *
 * Asked on the device, about a frame with work here that the server has not
 * taken, when the answer contains a copy of that same frame.
 *
 * It used to be asked of the USER: two thumbnails, choose. That picker lived in
 * the app on top of the one the server raised, and it outlived it — the server
 * stopped asking in #303 and this one carried on into #307.
 *
 * It is the same question the server answers in decideFrame, so it must give the
 * same answer, or the two devices settle differently and never converge. The
 * session bench checks the two rules against each other case by case.
 *
 * @param mine    when this device changed it; undefined = we do not know
 * @param theirs  when the other side changed it; undefined = the server has no
 *                copy, so there is nothing to lose to
 */
export function whoseFrameWins(mine: number | undefined,
                               theirs: number | undefined): 'mine' | 'theirs' {
  if (theirs === undefined) return 'mine';     // nothing on the other side
  if (mine === undefined) return 'theirs';     // a copy that knows when it
                                               // changed beats one that does not
  return mine >= theirs ? 'mine' : 'theirs';   // a tie keeps local, and the
                                               // server accepts it — same result
}

/**
 * After a push the server accepted. Note what does NOT move: `takenFromServerAt`.
 * The push told this device nothing about what the server was already holding.
 */
export function afterPush(m: DeviceMemory, accepted: number): DeviceMemory {
  return {
    ...m,
    confirmedFrames: m.confirmedFrames + accepted,
    framesTheServerHas: Math.max(m.framesTheServerHas, m.confirmedFrames + accepted),
    unsentFrames: 0,
    settingsUnsent: false,
  };
}

/** After a pull that was applied. This is the only thing that makes a device
 *  up to date. */
export function afterPull(
  m: DeviceMemory,
  { serverUpdatedAt, framesReceived }: { serverUpdatedAt: number; framesReceived: number },
): DeviceMemory {
  return {
    ...m,
    takenFromServerAt: serverUpdatedAt,
    framesTheServerHas: Math.max(m.framesTheServerHas, framesReceived),
  };
}

/**
 * THE RESTART.
 *
 * What a device carries back is whatever its last save wrote down. A save that
 * lost a piece is indistinguishable, at boot, from a device that never had it —
 * which is why an empty memory must never be read as "this project is new".
 *
 * Anything missing is restored as ZERO, never guessed at: zero confirmed frames
 * means "send everything again", which is wasteful and safe. Guessing the other
 * way means "assume the server agrees with me", which loses work.
 */
export function afterRestart(saved: Partial<DeviceMemory> | null | undefined,
                             cloudId: string | null): DeviceMemory {
  return {
    ...emptyMemory(cloudId),
    ...(saved ?? {}),
    cloudId,                       // the project being opened, not the saved one
  };
}

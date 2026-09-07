// THE PROJECT IS GONE — NOT AN OUTAGE (#465).
//
// Roman deleted a project last week. His Mac still had it open with unsent
// work, so every push was refused, and the app told him he was offline. He
// wasn't. It had been pushing at a project that does not exist since 11:25.
//
// Two faults in one line of behaviour:
//   1. it retried something that can never succeed — a 404 does not heal
//   2. it said "you seem to be working offline" when the wifi was fine
//
// THE RULE, IN ROMAN'S WORDS
//
//   It shows only on a device still holding that project, the first time the
//   server answers "not found" — to a push or to a pull. That is ONE moment,
//   whether it lands when you open the app or after two hours of working with
//   the wifi off. Offline is the same case, only later: the device can only
//   ever learn at the moment it reaches the server.
//
//   Then: stop retrying. Drop the offline notice. Leave the project on screen —
//   nothing is yanked away mid-work. And ask:
//
//     YOU DELETED THIS PROJECT ALREADY
//     It is no longer on the server, so the changes on this device cannot be
//     uploaded. If you deleted it by mistake, you may still be able to save it
//     as a new project.
//     [ SAVE AS NEW ]  [ DELETE ]
//
//   SAVE AS NEW uploads it as a new project and you carry on in the same
//   window. DELETE drops the copy on this device. No answer at all — the app is
//   closed, the dialog dismissed — throws NOTHING away and asks again next
//   time.
//
// WHY 'YOU DELETED' AND NOT 'IT WAS DELETED'. Roman: "it has to be YOU that
// deleted it (nothing is deleted by IT)". Only the owner of an account can
// delete their own project, so it is true however it happened — on this device
// or another.

/** What the app should do about a failed push or pull. */
export type SyncTrouble =
  | 'gone'        // the project is not on the server. Asking again cannot help.
  | 'offline'     // no answer at all, or a server that is having trouble.
  | 'conflict'    // the server is ahead; pull, then push again.
  | 'fine';       // nothing wrong.

/**
 * Read the server's answer.
 *
 * `status` is what the response carried: 0 or undefined when nothing came back
 * at all (which is the honest sign of being offline — the browser's own opinion
 * is often wrong), otherwise the HTTP code.
 *
 * ONLY 410 IS 'GONE', AND THIS IS THE WHOLE POINT.
 *
 * A 404 from the sync means one of three things — you deleted it, it belongs to
 * another account, or that id never existed — and the server used to answer all
 * three identically. Roman's condition is absolute: "IT SEEMS YOU DELETED THIS
 * PROJECT ALREADY" must NEVER show for a project that was not deleted. So the
 * server now answers 410 for exactly one case, a row carrying both this user's
 * id and a deleted_at, and a plain 404 stays an ordinary failure that is
 * retried and never accused of anything.
 */
export function whatWentWrong(status: number | undefined | null): SyncTrouble {
  if (status === undefined || status === null || status === 0) return 'offline';
  if (status === 410) return 'gone';
  if (status === 409) return 'conflict';
  if (status >= 200 && status < 300) return 'fine';
  return 'offline';
}

/** Only a deleted project is beyond asking again. */
export function worthTryingAgain(status: number | undefined | null): boolean {
  return whatWentWrong(status) !== 'gone';
}

/** Should the "you seem to be working offline" notice be shown for this? */
export function isReallyOffline(status: number | undefined | null): boolean {
  return whatWentWrong(status) === 'offline';
}

// ---------------------------------------------------------------------------
// ASKED ONCE PER PROJECT, BUT NEVER FORGOTTEN
//
// The question must not stack up — a push every five seconds must not put forty
// dialogs on the screen. But it must also not be answered by silence: closing
// the app is not "delete my work". So the asking is remembered for as long as
// the app is open, and forgotten when it closes, which is what makes it ask
// again next time.
// ---------------------------------------------------------------------------

export interface GoneRegister {
  /** May we put the question on screen for this project right now? */
  shouldAsk(projectId: string): boolean;
  /** The dialog is up. */
  asking(projectId: string): void;
  /** The dialog was dismissed with no answer — ask again next time it fails. */
  unanswered(projectId: string): void;
  /** Answered. Nothing more to ask about this one. */
  answered(projectId: string): void;
  /**
   * Something got through for this project after all — so it is not deleted any
   * more, and the whole question is off (#468).
   *
   * A project can be deleted, RECOVERED from the project list, and deleted
   * again. Without this, the second deletion would never be mentioned: the
   * first answer would still be remembered, and the app would sit there saying
   * nothing while the work piled up.
   */
  cameBack(projectId: string): void;
}

export function makeGoneRegister(): GoneRegister {
  const onScreen = new Set<string>();
  const settled = new Set<string>();
  return {
    shouldAsk: (id) => !onScreen.has(id) && !settled.has(id),
    asking: (id) => { onScreen.add(id); },
    // Dismissed without choosing. It comes off the screen but is NOT settled,
    // so the next failed push asks again. Nothing was thrown away.
    unanswered: (id) => { onScreen.delete(id); },
    answered: (id) => { onScreen.delete(id); settled.add(id); },
    cameBack: (id) => { onScreen.delete(id); settled.delete(id); },
  };
}

// HOW MUCH ONE ACCOUNT CAN HOLD (23 November, list item 15 — numbers and words
// agreed with Roman).
//
//   50 projects per account   (the live ones; the recover list does not count)
//   300 shots per project
//   versions — looks, angles, sketches, refs — are not counted: a fitting has as
//   many looks per talent as it needs, and the storage limit covers them
//
// THE ONE RULE: a limit only ever stops MAKING SOMETHING NEW. It never refuses
// a save. Work that exists is never held back because of a count ("never lose
// work"). So:
//   · the box comes at the tap that would go over — New project, New, +SH/+TL,
//     pictures that would become new shots — and nothing is made;
//   · a project made with no connection cannot be counted, and is let through;
//     when it reaches the server as the 51st the server takes it. The server
//     has a ceiling of its own, far above (100), against abuse only;
//   · a storyboard PDF is not counted on the way in (its shots are known only
//     after it is read): it comes in whole, and no shot can be added after.

import { state } from '../store/state';
import { trace } from './syncTrace';
import { api } from './api';
import { getToken, isLoggedIn } from './session';

export const MAX_PROJECTS = 50;
export const MAX_SHOTS = 300;

/** Would `adding` more shots go over? Says so in a box, and answers true. */
export function shotLimitReached(adding = 1): boolean {
  const have = state().frames.length;
  if (have + adding <= MAX_SHOTS) return false;
  trace(`limit: ${have} shot(s) in the project, ${adding} more asked for — ${MAX_SHOTS} is the most; nothing is made`);
  void import('./modals').then((m) => m.showImportantNote('SHOT LIMIT REACHED',
    `A project can hold ${MAX_SHOTS} shots. Create a new project for more.`));
  return true;
}

/** Has the account its 50 projects? Asked of the server, two seconds at most;
 *  no line, nobody signed in or no answer: not known, so not stopped. */
export async function projectLimitReached(): Promise<boolean> {
  if (!isLoggedIn() || navigator.onLine === false) return false;
  let live = -1;
  try {
    const res = await Promise.race([
      api.get<{ projects: Array<{ deleted_at: number | null }> }>('/projects', getToken()),
      new Promise<null>((r) => window.setTimeout(() => r(null), 2000)),
    ]);
    if (res) live = res.projects.filter((p) => !p.deleted_at).length;
  } catch { /* not known */ }
  if (live < MAX_PROJECTS) return false;
  trace(`limit: the account has ${live} project(s) — ${MAX_PROJECTS} is the most; no new one is started`);
  const { showImportantNote } = await import('./modals');
  await showImportantNote('PROJECT LIMIT REACHED',
    `An account can hold ${MAX_PROJECTS} projects. Delete the old projects you no longer need to make a new one.`);
  return true;
}

// FULL REPLACE, or just the changes?
//
// A full replace deletes the server's copy of the project and writes this
// device's copy in its place. That is exactly right ONCE: a project made on this
// device, with all its frames, that the server has never seen. Any other time it
// can only destroy — anything the other device has and this one does not goes
// with it.
//
// The test used to be "do I remember any frame the server has confirmed". That
// is not the same question, and the difference cost a project: after a pull that
// keeps every local frame, the app deliberately forgets what the server holds
// for each kept frame, so it remembered nothing — and read that as "the server
// has never seen this project" and sent a full replace over the top of it.
//
// Kept in its own file so it can be tested on the bench.

import { pushIsPartial, type DeviceMemory } from './sessionRules';

export interface WhatWeKnow {
  /** Does the app hold a cloud id for this project? This is the fact that
   *  settles it. An id exists only because the server created the project, so
   *  the server HAS seen it — whatever this device does or does not remember
   *  about individual frames. Counting frames was a guess about the same
   *  question; this is the answer (#300). */
  hasCloudId: boolean;
  /** Frames whose exact content the server has confirmed. Emptied per frame
   *  when a pull keeps the local copy, because that copy still has to be sent. */
  confirmedFrames: number;
  /** Frames the server has told us about, with the time it holds for them.
   *  Filled by every pull and every push reply, and NOT emptied by keeping a
   *  local copy — hearing about a frame is not the same as agreeing with it. */
  framesTheServerHas: number;
}

/** Has the server ever held any part of this project? */
export function serverHasSeenProject(k: WhatWeKnow): boolean {
  // ONE copy of this decision, in sessionRules, where the session bench drives
  // it against the real server. A second copy here would drift from it, and the
  // drift would show up as a wiped project months later.
  return pushIsPartial({
    cloudId: k.hasCloudId ? 'yes' : null,
    confirmedFrames: k.confirmedFrames,
    framesTheServerHas: k.framesTheServerHas,
  } as DeviceMemory);
}

/** true = send only what changed. false = full replace. */
export function shouldSendOnlyChanges(k: WhatWeKnow): boolean {
  return serverHasSeenProject(k);
}

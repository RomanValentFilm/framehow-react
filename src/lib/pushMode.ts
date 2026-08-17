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

export interface WhatWeKnow {
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
  return k.confirmedFrames > 0 || k.framesTheServerHas > 0;
}

/** true = send only what changed. false = full replace. */
export function shouldSendOnlyChanges(k: WhatWeKnow): boolean {
  return serverHasSeenProject(k);
}

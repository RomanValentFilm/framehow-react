// THE BENCH. Two pretend devices, one pretend server, no network, no iPad.
//
// Run:  npm run bench        (from backend/)
//
// Every case below is a sequence of real pushes played against the real
// decision code in src/lib/syncDecide.ts. If a rule is wrong, it says so here
// in a second — instead of after a build, a deploy, and twenty minutes on two
// devices, which is how #256, #257, #259 and #261 all went out broken.
//
// Times are written as minutes-past-ten for readability: t(0) = 10:00.

import { decideFrame, decideVersion, decideSetting } from '../src/lib/syncDecide.ts';

const BASE = Date.UTC(2026, 7, 17, 10, 0, 0);
const t = (min: number) => BASE + min * 60_000;
const hhmm = (ms: number | null) =>
  ms === null ? '  --  ' : new Date(ms).toISOString().slice(11, 16);

// ---------------------------------------------------------------------------
// The pretend server: holds one frame, one version, one settings item, and
// applies the same consequences the push handler applies.
// ---------------------------------------------------------------------------

interface Row { updated_at: number; content_changed_at: number | null; body: string }

class Server {
  frame: Row | undefined;
  version: Row | undefined;
  setting: { changed_at: number; body: string } | undefined;
  /** What each device was last told the frame's updated_at was. */
  told = new Map<string, number>();

  /** A device pushes its copy of the frame. `pushedAt` is the connection time,
   *  which is what the app puts in updated_at. */
  pushFrame(device: string, o: {
    body: string; changedAt: number | null; pushedAt: number; contested?: boolean;
  }): 'accept' | 'stale' | 'ask' {
    const incoming = {
      base_updated_at: this.told.get(device),
      content_changed_at: o.changedAt,
      updated_at: o.pushedAt,
    };
    const held = this.frame
      ? { updated_at: this.frame.updated_at, content_changed_at: this.frame.content_changed_at }
      : undefined;
    const outcome = decideFrame(incoming, held, () => o.contested === true);
    if (outcome === 'accept') {
      this.frame = { updated_at: o.pushedAt, content_changed_at: o.changedAt, body: o.body };
    }
    // Every push gets the tree back, so the pusher learns the server's stamp —
    // this is the step that made #261's bug appear only on the SECOND push.
    this.told.set(device, this.frame!.updated_at);
    return outcome;
  }

  pushVersion(o: { body: string; changedAt: number | null; pushedAt: number }): 'accept' | 'stale' {
    const held = this.version
      ? { updated_at: this.version.updated_at, content_changed_at: this.version.content_changed_at }
      : undefined;
    const outcome = decideVersion({ content_changed_at: o.changedAt, updated_at: o.pushedAt }, held);
    if (outcome === 'accept') {
      this.version = { updated_at: o.pushedAt, content_changed_at: o.changedAt, body: o.body };
    }
    return outcome;
  }

  pushSetting(o: { body: string; changedAt: number }): 'accept' | 'ignored' {
    const outcome = decideSetting({ changed_at: o.changedAt }, this.setting);
    if (outcome === 'accept') this.setting = { changed_at: o.changedAt, body: o.body };
    return outcome;
  }

  /** A device pulls: it now knows the server's stamp. */
  pull(device: string): void {
    if (this.frame) this.told.set(device, this.frame.updated_at);
  }
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

interface Case {
  what: string;
  run: (s: Server) => string;   // returns what ended up on the server
  want: string;
}

const cases: Case[] = [

  // --- a frame the server has never seen -----------------------------------
  {
    what: 'brand new frame, server never saw it',
    want: 'iPad',
    run: (s) => {
      s.pushFrame('iPad', { body: 'iPad', changedAt: t(0), pushedAt: t(0) });
      return s.frame!.body;
    },
  },

  // --- THE CASE THAT KEEPS FAILING ----------------------------------------
  // Later edit pushes FIRST. If "newer wins" really means newer, the later
  // edit must survive the older one arriving afterwards.
  {
    what: 'iPad edits 10:20, desktop edits 10:10, iPad pushes FIRST',
    want: 'iPad',
    run: (s) => {
      s.frame = { updated_at: t(0), content_changed_at: t(0), body: 'both started here' };
      s.told.set('iPad', t(0)); s.told.set('desktop', t(0));
      s.pushFrame('iPad', { body: 'iPad', changedAt: t(20), pushedAt: t(30) });
      s.pushFrame('desktop', { body: 'desktop', changedAt: t(10), pushedAt: t(31) });
      return s.frame!.body;
    },
  },
  {
    what: 'desktop edits 10:20, iPad edits 10:10, iPad pushes FIRST',
    want: 'desktop',
    run: (s) => {
      s.frame = { updated_at: t(0), content_changed_at: t(0), body: 'both started here' };
      s.told.set('iPad', t(0)); s.told.set('desktop', t(0));
      s.pushFrame('iPad', { body: 'iPad', changedAt: t(10), pushedAt: t(30) });
      s.pushFrame('desktop', { body: 'desktop', changedAt: t(20), pushedAt: t(31) });
      return s.frame!.body;
    },
  },

  // --- the #261 regression -------------------------------------------------
  // The loser retries. Its second push knows the server's stamp, so it looks
  // like it is building on top. It must still lose: its edit is older.
  {
    what: 'loser retries after learning the server stamp (the #261 bug)',
    want: 'iPad',
    run: (s) => {
      s.frame = { updated_at: t(0), content_changed_at: t(0), body: 'both started here' };
      s.told.set('iPad', t(0)); s.told.set('desktop', t(0));
      s.pushFrame('iPad', { body: 'iPad', changedAt: t(20), pushedAt: t(30) });
      s.pushFrame('desktop', { body: 'desktop', changedAt: t(10), pushedAt: t(31) });
      s.pushFrame('desktop', { body: 'desktop', changedAt: t(10), pushedAt: t(32) });  // retry
      s.pushFrame('desktop', { body: 'desktop', changedAt: t(10), pushedAt: t(33) });  // and again
      return s.frame!.body;
    },
  },

  // --- one side does not know when it changed -----------------------------
  {
    what: 'server copy is stamped, incoming is not (old app / old row)',
    want: 'iPad',
    run: (s) => {
      s.frame = { updated_at: t(5), content_changed_at: t(20), body: 'iPad' };
      s.pushFrame('desktop', { body: 'desktop', changedAt: null, pushedAt: t(40) });
      return s.frame!.body;
    },
  },
  {
    what: 'incoming is stamped, server copy is not',
    want: 'desktop',
    run: (s) => {
      s.frame = { updated_at: t(5), content_changed_at: null, body: 'iPad' };
      s.pushFrame('desktop', { body: 'desktop', changedAt: t(10), pushedAt: t(40) });
      return s.frame!.body;
    },
  },
  {
    what: 'neither is stamped — falls back to push time (accepted by decision)',
    want: 'desktop',
    run: (s) => {
      s.frame = { updated_at: t(5), content_changed_at: null, body: 'iPad' };
      s.pushFrame('desktop', { body: 'desktop', changedAt: null, pushedAt: t(6) });
      return s.frame!.body;
    },
  },

  // --- the picker -----------------------------------------------------------
  {
    what: 'both changed the PICTURE blind → asks',
    want: 'ASK',
    run: (s) => {
      s.frame = { updated_at: t(0), content_changed_at: t(0), body: 'start' };
      s.told.set('desktop', t(0));
      s.pushFrame('iPad', { body: 'iPad', changedAt: t(10), pushedAt: t(20), contested: true });
      const r = s.pushFrame('desktop', { body: 'desktop', changedAt: t(15), pushedAt: t(21), contested: true });
      return r === 'ask' ? 'ASK' : s.frame!.body;
    },
  },
  {
    what: 'both changed NEEDS/NOTES blind → never asks, newer wins',
    want: 'desktop',
    run: (s) => {
      s.frame = { updated_at: t(0), content_changed_at: t(0), body: 'start' };
      s.told.set('desktop', t(0));
      s.pushFrame('iPad', { body: 'iPad', changedAt: t(10), pushedAt: t(20) });
      const r = s.pushFrame('desktop', { body: 'desktop', changedAt: t(15), pushedAt: t(21) });
      return r === 'ask' ? 'ASK' : s.frame!.body;
    },
  },
  {
    what: 'built on top of what it already saw → no question, just wins',
    want: 'desktop',
    run: (s) => {
      s.frame = { updated_at: t(0), content_changed_at: t(0), body: 'iPad' };
      s.told.set('desktop', t(0));
      s.pull('desktop');                    // desktop has seen the iPad's copy
      s.pushFrame('desktop', { body: 'desktop', changedAt: t(10), pushedAt: t(20), contested: true });
      return s.frame!.body;
    },
  },

  // --- versions in a strip -------------------------------------------------
  {
    what: 'version new to the server → added',
    want: 'iPad LOOK',
    run: (s) => {
      s.pushVersion({ body: 'iPad LOOK', changedAt: t(0), pushedAt: t(0) });
      return s.version!.body;
    },
  },
  {
    what: 'same version drawn on both, older pushes last',
    want: 'iPad',
    run: (s) => {
      s.version = { updated_at: t(0), content_changed_at: t(20), body: 'iPad' };
      s.pushVersion({ body: 'desktop', changedAt: t(10), pushedAt: t(40) });
      return s.version!.body;
    },
  },

  // --- settings items (a NEEDS category rename) ---------------------------
  {
    what: 'category renamed on one device → server takes it',
    want: 'COSTUME',
    run: (s) => {
      s.setting = { changed_at: t(0), body: 'Costume' };
      s.pushSetting({ body: 'COSTUME', changedAt: t(10) });
      return s.setting!.body;
    },
  },
  {
    what: 'category rename that carries NO time (changed_at 0) → server refuses it',
    want: 'Costume',
    run: (s) => {
      s.setting = { changed_at: t(0), body: 'Costume' };
      s.pushSetting({ body: 'COSTUME', changedAt: 0 });
      return s.setting!.body;
    },
  },
  {
    what: 'older category rename cannot undo a newer one it never saw',
    want: 'NEWER',
    run: (s) => {
      s.setting = { changed_at: t(20), body: 'NEWER' };
      s.pushSetting({ body: 'older', changedAt: t(10) });
      return s.setting!.body;
    },
  },
];

// ---------------------------------------------------------------------------
// Run them
// ---------------------------------------------------------------------------

let failed = 0;
const width = Math.max(...cases.map((c) => c.what.length));
console.log('');
for (const c of cases) {
  let got: string;
  try { got = c.run(new Server()); }
  catch (e) { got = `threw: ${(e as Error).message}`; }
  const ok = got === c.want;
  if (!ok) failed++;
  console.log(
    `${ok ? '  ok  ' : ' WRONG'}  ${c.what.padEnd(width)}  ->  ${got.padEnd(12)}` +
    (ok ? '' : `  (should be ${c.want})`),
  );
}
console.log(`\n${cases.length - failed} of ${cases.length} correct` + (failed ? `, ${failed} WRONG\n` : '\n'));
process.exit(failed ? 1 : 0);

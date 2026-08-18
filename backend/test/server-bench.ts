// THE SERVER ON A BENCH — the real routes, the real schema, no deploy.
//
// Run:  npm run bench:server
//
// A push here goes through the actual sign-in check, the actual parser, the
// actual decisions and the actual SQL, against a real SQLite database built
// from the project's own migrations. Then it reads the rows back and says what
// really happened.
//
// This is the thing that was missing all week. Every fault that cost a day —
// fields silently dropped by the parser, versions deleted by a push that never
// mentioned them, the refusal at 100 values — is a case in here now, and each
// one takes a second instead of a build, a deploy and two devices.

import app from '../src/index.ts';
import { FakeD1 } from './fake-d1.ts';
import { hashToken, newId } from '../src/lib/crypto.ts';
// The app's fold, tested here against the real server: a device that only ever
// asks for changes must end up holding exactly what a device that asked for
// everything holds. If these two can drift, frames disappear off a screen.
import { mergeDelta } from '../../src/lib/deltaMerge.ts';

// ---------------------------------------------------------------------------
// a signed-in user with one project
// ---------------------------------------------------------------------------

const TOKEN = 'bench-token';
const USER = 'user-1';
const PROJECT = 'project-1';
const STRIP = 'strip-1';
const DEVICE = 'device-A';

async function freshServer(): Promise<FakeD1> {
  const db = new FakeD1('migrations');
  const now = Date.now();
  db.db.prepare(
    `INSERT INTO users (id, name, email, password_hash, created_at, updated_at, email_verified)
     VALUES (?, 'Bench', 'bench@example.com', 'x', ?, ?, 1)`,
  ).run(USER, now, now);
  db.db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(newId(), USER, await hashToken(TOKEN), now, now + 86_400_000);
  db.db.prepare(
    `INSERT INTO projects (id, user_id, name, created_at, updated_at)
     VALUES (?, ?, 'Bench project', ?, ?)`,
  ).run(PROJECT, USER, now, now);
  db.db.prepare(
    `INSERT INTO strips (id, project_id, label, sort_order, updated_at)
     VALUES (?, ?, 'main', 0, ?)`,
  ).run(STRIP, PROJECT, now);
  return db;
}

const env = (db: FakeD1) => ({
  DB: db as never,
  APP_NAME: 'Framehow',
  APP_URL: 'https://framehow.app',
  SESSION_TTL_DAYS: '30',
  PASSWORD_RESET_TTL_HOURS: '1',
  EMAIL_VERIFY_TTL_HOURS: '48',
  ADMIN_EMAIL: 'bench@example.com',
});

async function call(db: FakeD1, method: string, path: string, body?: unknown) {
  const res = await app.fetch(
    new Request(`https://bench.local${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env(db) as never,
  );
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, body: json as never, text };
}

// ---------------------------------------------------------------------------
// building a push
// ---------------------------------------------------------------------------

interface FrameSpec { id: string; label?: string; text?: string; notes?: string; picture?: string; changedAt?: number | null; versions?: number; base?: number }

/**
 * A push shaped the way the app really sends one.
 *
 * Two fields decide which path the server takes, and leaving them out sends the
 * bench down a road no device uses:
 *   partial: true          — only the frames named here; anything else is left
 *                            alone. partial=false REPLACES the project.
 *   base_updated_at        — what this device believed the server held. Without
 *                            it the server cannot do per-frame decisions at all
 *                            and falls back to whole-project last-write-wins.
 */
function push(frames: FrameSpec[], opts: { device?: string; at?: number; partial?: boolean } = {}) {
  const at = opts.at ?? Date.now();
  const versions: unknown[] = [];
  for (const f of frames) {
    const count = f.versions ?? 1;                    // 1 = just the main version
    for (let i = 0; i < count; i++) {
      versions.push({
        id: `${f.id}-v${i}`, frame_id: f.id,
        label: i === 0 ? null : `LOOK ${i}`,
        type: i === 0 ? 'main' : 'ver',
        hidden: false, starred: 0, note: null,
        updated_at: at, content_changed_at: f.changedAt ?? null,
      });
    }
  }
  return {
    partial: opts.partial ?? true,
    project: {
      name: 'Bench project', updated_at: at,
      device_id: opts.device ?? DEVICE, device_name: opts.device ?? DEVICE,
    },
    strips: [{ id: STRIP, label: 'main', sort_order: 0, updated_at: at }],
    frames: frames.map((f, i) => ({
      id: f.id, strip_id: STRIP, label: f.label ?? String(i + 1), sort_order: i,
      crop_w: null, crop_h: null,
      text_content: f.text ?? null, table_data: f.notes ?? null, version_label: null,
      strip_labels: null, hidden: false, note: null, scribbles: null,
      updated_at: at, content_changed_at: f.changedAt ?? null,
      base_updated_at: f.base ?? 0,
    })),
    versions,
    images: frames.filter((f) => f.picture).map((f) => ({
      id: `${f.id}-img`, version_id: `${f.id}-v0`, r2_key: f.picture!,
      width: 1920, height: 1080, size_bytes: 1000, content_type: 'image/jpeg', updated_at: at,
    })),
    drawings: [], deletions: [],
  };
}

const framesNamed = (n: number, prefix = 'f'): FrameSpec[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, label: String(i + 1) }));

/**
 * A pretend device that remembers what the server told it, the way the real app
 * does. This matters: a push whose base_updated_at is 0 is saying "I have never
 * heard of your copy", and the server rightly treats every frame as changed
 * blind and raises the picker. Only a device that has been told the server's
 * times can be judged on newer-wins.
 */
class Device {
  name: string;
  private db: FakeD1;
  private serverTimes = new Map<string, number>();
  /** The server's clock as of this device's last answer — never its own. */
  heardAt = 0;
  constructor(db: FakeD1, name: string) { this.db = db; this.name = name; }

  async send(frames: FrameSpec[], at?: number) {
    const withBase = frames.map((f) => ({ ...f, base: f.base ?? this.serverTimes.get(f.id) ?? 0 }));
    const r = await call(this.db, 'POST', `/projects/${PROJECT}/sync`, push(withBase, { device: this.name, at }));
    this.learn(r.body);
    return r;
  }

  /** Everything, as a device does when it first opens a project. */
  async pull() {
    const r = await call(this.db, 'GET', `/projects/${PROJECT}/sync`);
    this.learn(r.body);
    this.heardAt = (r.body as { server_now?: number }).server_now ?? this.heardAt;
    return r;
  }

  /** Only what has arrived since this device last heard (#280). */
  async pullChanges() {
    const r = await call(this.db, 'GET', `/projects/${PROJECT}/sync?since=${this.heardAt}`);
    this.learn(r.body);
    this.heardAt = (r.body as { server_now?: number }).server_now ?? this.heardAt;
    return r;
  }

  private learn(body: unknown) {
    const frames = (body as { frames?: Array<{ id: string; updated_at: number }> })?.frames;
    for (const f of frames ?? []) this.serverTimes.set(f.id, f.updated_at);
  }
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

const results: Array<{ what: string; got: string; want: string }> = [];
const check = (what: string, got: unknown, want: unknown) =>
  results.push({ what, got: String(got), want: String(want) });

async function run() {
  // --- a plain push lands ---------------------------------------------------
  {
    const db = await freshServer();
    const r = await call(db, 'POST', `/projects/${PROJECT}/sync`, push(framesNamed(3)));
    check('a push of 3 frames is accepted', r.status, 200);
    check('...and 3 frames are in the database', db.rows('SELECT id FROM frames').length, 3);
    check('...with their versions', db.rows('SELECT id FROM versions').length, 3);
  }

  // --- THE 500 THAT BLOCKED THE DESKTOP ALL EVENING (#276) ------------------
  // 105 frames, each with two versions: 210 names in one question, and D1 stops
  // at 100. Before the fix this came back as a bare 500, for ever.
  {
    const db = await freshServer();
    const desktop = new Device(db, 'desktop');
    await desktop.send(framesNamed(105).map((f) => ({ ...f, versions: 2 })));
    const again = await desktop.send(framesNamed(105).map((f) => ({ ...f, versions: 2, text: 'edited' })));
    check('a second push of 105 frames does not fail', again.status, 200);
    check('...and the edit reached every frame',
      db.rows<{ n: number }>("SELECT COUNT(*) AS n FROM frames WHERE text_content = 'edited'")[0].n, 105);
  }

  // --- newer wins, on the real path ----------------------------------------
  {
    const db = await freshServer();
    const t = Date.now();
    const iPad = new Device(db, 'iPad');
    const desktop = new Device(db, 'desktop');
    // Both start from the same copy, then each edits it.
    await iPad.send([{ id: 'f1' }]);
    await desktop.pull();
    await iPad.send([{ id: 'f1', text: 'from the iPad', changedAt: t + 60_000 }]);
    const older = await desktop.send([{ id: 'f1', text: 'from the desktop', changedAt: t }]);
    const answer = older.body as { stale_frames?: string[]; rejected_frames?: Array<{ id: string }> };
    check('text edited on both, blind: the older one is simply refused',
      answer.stale_frames?.[0], 'f1');
    check('...and nobody is asked a question (#282)', answer.rejected_frames?.length ?? 0, 0);
    check('...and the newer text is what the database holds',
      db.one<{ text_content: string }>("SELECT text_content FROM frames WHERE id = 'f1'")?.text_content,
      'from the iPad');
  }

  // --- #282: writing settles by time, pictures do not -----------------------
  {
    const db = await freshServer();
    const t = Date.now();
    const iPad = new Device(db, 'iPad');
    const desktop = new Device(db, 'desktop');
    await iPad.send([{ id: 'f1' }]);
    await desktop.pull();

    // the NOTES card, edited on both without either seeing the other
    await iPad.send([{ id: 'f1', notes: 'iPad note', changedAt: t + 60_000 }]);
    const r = await desktop.send([{ id: 'f1', notes: 'desktop note', changedAt: t }]);
    check('notes edited on both, blind: no picker',
      (r.body as { rejected_frames?: unknown[] }).rejected_frames?.length ?? 0, 0);
    check('...the later note is what survives',
      db.one<{ table_data: string }>("SELECT table_data FROM frames WHERE id = 'f1'")?.table_data,
      'iPad note');
  }
  {
    const db = await freshServer();
    const iPad = new Device(db, 'iPad');
    const desktop = new Device(db, 'desktop');
    await iPad.send([{ id: 'f2', picture: 'r2/original.jpg' }]);
    await desktop.pull();

    // a new photo on the main frame, on both, blind — this must still ask
    await iPad.send([{ id: 'f2', picture: 'r2/from-the-ipad.jpg' }]);
    const r = await desktop.send([{ id: 'f2', picture: 'r2/from-the-desktop.jpg' }]);
    check('a picture changed on both, blind: the picker still appears',
      (r.body as { rejected_frames?: Array<{ id: string }> }).rejected_frames?.[0]?.id, 'f2');
    check('...and the losing side is kept, not thrown away',
      db.rows('SELECT id FROM frame_conflicts').length, 1);
  }

  // --- a push must not delete what it does not mention (#253) ---------------
  {
    const db = await freshServer();
    const a = new Device(db, 'A');
    await a.send([{ id: 'f1', versions: 3 }]);
    check('three versions to start with', db.rows('SELECT id FROM versions').length, 3);
    // The other device knows only the main version and pushes the frame again.
    const b = new Device(db, 'B');
    await b.pull();
    await b.send([{ id: 'f1', versions: 1, text: 'touched' }]);
    check('a push that mentions one version does not erase the others',
      db.rows('SELECT id FROM versions').length, 3);
  }

  // --- settings arrive at all (the categories bug, from the server's side) --
  {
    const db = await freshServer();
    const body = push(framesNamed(1)) as Record<string, unknown>;
    body.settings = [
      { kind: 'needCategory', item_id: 'tab_shoot', value: '{"idx":0,"data":{"name":"SHOOT"}}', changed_at: 1000, deleted_at: null },
    ];
    await call(db, 'POST', `/projects/${PROJECT}/sync`, body);
    check('a settings item is written', db.rows('SELECT item_id FROM project_settings').length, 1);

    const newer = push(framesNamed(1)) as Record<string, unknown>;
    newer.settings = [
      { kind: 'needCategory', item_id: 'tab_shoot', value: '{"idx":0,"data":{"name":"RENAMED"}}', changed_at: 2000, deleted_at: null },
    ];
    await call(db, 'POST', `/projects/${PROJECT}/sync`, newer);
    check('a newer rename replaces it',
      db.one<{ value: string }>("SELECT value FROM project_settings WHERE item_id = 'tab_shoot'")?.value?.includes('RENAMED'),
      true);

    const older = push(framesNamed(1)) as Record<string, unknown>;
    older.settings = [
      { kind: 'needCategory', item_id: 'tab_shoot', value: '{"idx":0,"data":{"name":"STALE"}}', changed_at: 500, deleted_at: null },
    ];
    await call(db, 'POST', `/projects/${PROJECT}/sync`, older);
    check('an older rename cannot undo it',
      db.one<{ value: string }>("SELECT value FROM project_settings WHERE item_id = 'tab_shoot'")?.value?.includes('RENAMED'),
      true);
  }

  // --- needs, notes and setup reach the frame row (#237) --------------------
  {
    const db = await freshServer();
    const body = push([{ id: 'f1' }]) as { frames: Array<Record<string, unknown>> };
    body.frames[0].needs = '{"toggles":{"a":true}}';
    body.frames[0].notes = '{"text":"call the stunt team"}';
    body.frames[0].setup_id = 'setup-3';
    await call(db, 'POST', `/projects/${PROJECT}/sync`, body as never);
    const row = db.one<{ needs: string; notes: string; setup_id: string }>(
      "SELECT needs, notes, setup_id FROM frames WHERE id = 'f1'");
    check('needs reach the frame row', row?.needs?.includes('toggles'), true);
    check('notes reach the frame row', row?.notes?.includes('stunt'), true);
    check('the setup reaches the frame row', row?.setup_id, 'setup-3');
  }

  // --- what a pull costs today ---------------------------------------------
  {
    const db = await freshServer();
    await call(db, 'POST', `/projects/${PROJECT}/sync`, push(framesNamed(45).map((f) => ({ ...f, versions: 3 }))));
    const r = await call(db, 'GET', `/projects/${PROJECT}/sync`);
    const tree = r.body as { frames: unknown[]; versions: unknown[] };
    check('a pull returns every frame in the project', tree.frames.length, 45);
    check('...and every version', tree.versions.length, 135);
  }

  // --- #280: a pull brings only what changed --------------------------------
  {
    const db = await freshServer();
    const iPad = new Device(db, 'iPad');
    const desktop = new Device(db, 'desktop');

    await iPad.send(framesNamed(45).map((f) => ({ ...f, versions: 3 })));
    const first = await desktop.pull();
    check('opening a project brings the whole thing',
      (first.body as { frames: unknown[] }).frames.length, 45);
    check('...and says so', (first.body as { full: boolean }).full, true);

    const quiet = await desktop.pullChanges();
    check('nothing has happened since — nothing comes back',
      (quiet.body as { frames: unknown[] }).frames.length, 0);
    check('...and it is marked as a delta', (quiet.body as { full: boolean }).full, false);

    await new Promise((r) => setTimeout(r, 5));       // let the clock move
    await iPad.send([{ id: 'f7', text: 'one word changed' }]);

    const delta = await desktop.pullChanges();
    const got = delta.body as { frames: Array<{ id: string; text_content: string }>; versions: unknown[] };
    check('one frame changed — one frame comes back', got.frames.length, 1);
    check('...the right one', got.frames[0]?.id, 'f7');
    check('...with the change in it', got.frames[0]?.text_content, 'one word changed');
    check('...instead of 45', got.frames.length < 45, true);
  }

  // --- #280: the traps ------------------------------------------------------
  {
    const db = await freshServer();
    const iPad = new Device(db, 'iPad');
    const desktop = new Device(db, 'desktop');
    await iPad.send(framesNamed(3));
    await desktop.pull();

    // a deletion has to travel, or the other device keeps showing the frame
    await new Promise((r) => setTimeout(r, 5));
    const body = push([{ id: 'f0' }], { device: 'iPad' }) as Record<string, unknown>;
    body.frames = [];
    body.versions = [];
    body.deletions = [{ id: 'del-1', entity_type: 'frame', entity_id: 'f1', deleted_at: Date.now(), device_id: 'iPad' }];
    await call(db, 'POST', `/projects/${PROJECT}/sync`, body);

    const delta = await desktop.pullChanges();
    const got = delta.body as { deletions: Array<{ entity_id: string }> };
    check('a deletion reaches the other device', got.deletions?.[0]?.entity_id, 'f1');

    // a device that has been away longer than the tombstone window gets it all
    const ancient = await call(db, 'GET', `/projects/${PROJECT}/sync?since=1`);
    check('a device away for months is given everything', (ancient.body as { full: boolean }).full, true);
    check('...rather than a delta it cannot trust',
      (ancient.body as { frames: unknown[] }).frames.length > 0, true);

    // the boundary: a change made in the very millisecond of the last answer
    {
      // The iPad sends a change stamped at exactly the moment the desktop last
      // heard from the server — the one instant a "later than" filter loses.
      const at = desktop.heardAt;
      await iPad.send([{ id: 'f2', text: 'made on the boundary' }], at);
      const r = await call(db, 'GET', `/projects/${PROJECT}/sync?since=${at}`);
      const frames = (r.body as { frames: Array<{ id: string; text_content: string }> }).frames;
      check('a change on the exact boundary is not skipped',
        frames.some((f) => f.text_content === 'made on the boundary'), true);
    }

    // settings travel in a delta too
    const withSetting = push([], { device: 'iPad' }) as Record<string, unknown>;
    withSetting.settings = [{ kind: 'needCategory', item_id: 'tab_1', value: '{"idx":0,"data":{"name":"GEAR"}}', changed_at: Date.now(), deleted_at: null }];
    const before = desktop.heardAt;
    await new Promise((r) => setTimeout(r, 5));
    await call(db, 'POST', `/projects/${PROJECT}/sync`, withSetting);
    const s2 = await call(db, 'GET', `/projects/${PROJECT}/sync?since=${before}`);
    check('a renamed category arrives in a delta',
      (s2.body as { settings: Array<{ item_id: string }> }).settings.some((x) => x.item_id === 'tab_1'), true);
  }

  // --- #280: asking only for changes must end up in the same place ----------
  {
    const db = await freshServer();
    const iPad = new Device(db, 'iPad');
    const watcher = new Device(db, 'watcher');

    await iPad.send(framesNamed(20).map((f) => ({ ...f, versions: 2, picture: 'r2/first.jpg' })));

    // the watcher opens the project once, in full, and then only ever asks for
    // changes — folding each answer into what it holds
    let held = (await watcher.pull()).body as never;

    const foldNext = async () => {
      const r = await watcher.pullChanges();
      held = mergeDelta(held, r.body as never) as never;
    };

    const step = async (fn: () => Promise<unknown>) => {
      await new Promise((r) => setTimeout(r, 5));
      await fn();
      await foldNext();
    };

    await step(() => iPad.send([{ id: 'f3', text: 'a word' }]));
    await step(() => iPad.send([{ id: 'f4', notes: 'a note', versions: 2 }]));
    await step(() => iPad.send([{ id: 'brand-new', label: '21' }]));
    await step(() => iPad.send([{ id: 'f5', picture: 'r2/replaced.jpg' }]));
    await step(async () => {
      const body = push([], { device: 'iPad' }) as Record<string, unknown>;
      body.deletions = [{ id: 'del-x', entity_type: 'frame', entity_id: 'f9', deleted_at: Date.now(), device_id: 'iPad' }];
      await call(db, 'POST', `/projects/${PROJECT}/sync`, body);
    });
    await step(async () => {
      const body = push([], { device: 'iPad' }) as Record<string, unknown>;
      body.settings = [{ kind: 'needCategory', item_id: 'tab_9', value: '{"idx":0,"data":{"name":"NEW"}}', changed_at: Date.now(), deleted_at: null }];
      await call(db, 'POST', `/projects/${PROJECT}/sync`, body);
    });

    // ...and a device that asked for everything, right now
    const whole = (await call(db, 'GET', `/projects/${PROJECT}/sync`)).body as {
      frames: Array<{ id: string; text_content: string | null; table_data: string | null }>;
      versions: Array<{ id: string }>;
      images: Array<{ version_id: string; r2_key: string }>;
      settings: Array<{ item_id: string }>;
    };
    const folded = held as unknown as typeof whole;

    const sorted = (xs: string[]) => xs.slice().sort().join(',');
    check('folding deltas gives the same frames as asking for everything',
      sorted(folded.frames.map((f) => f.id)), sorted(whole.frames.map((f) => f.id)));
    check('...the same versions',
      sorted(folded.versions.map((v) => v.id)), sorted(whole.versions.map((v) => v.id)));
    check('...the same pictures',
      sorted(folded.images.map((i) => `${i.version_id}=${i.r2_key}`)),
      sorted(whole.images.map((i) => `${i.version_id}=${i.r2_key}`)));
    check('...the same settings',
      sorted(folded.settings.map((x) => x.item_id)), sorted(whole.settings.map((x) => x.item_id)));
    check('...the same words in the frames',
      sorted(folded.frames.map((f) => `${f.id}:${f.text_content ?? ''}/${f.table_data ?? ''}`)),
      sorted(whole.frames.map((f) => `${f.id}:${f.text_content ?? ''}/${f.table_data ?? ''}`)));
    check('...and the deleted frame is gone from both',
      folded.frames.some((f) => f.id === 'f9'), false);
  }

  // --- delete frame 16, then make a new frame 16 -----------------------------
  // The number is a label. What the server matches on is the frame's own id,
  // which is never reused. So this is a deletion and a birth, not a puzzle.
  {
    const db = await freshServer();
    const iPad = new Device(db, 'iPad');
    const desktop = new Device(db, 'desktop');
    await iPad.send(framesNamed(20));
    await desktop.pull();

    await new Promise((r) => setTimeout(r, 5));
    // the user deletes the frame labelled 16 and draws a new one in its place
    const body = push([{ id: 'replacement', label: '16', text: 'the new sixteen' }], { device: 'iPad' }) as Record<string, unknown>;
    body.deletions = [{ id: 'del-16', entity_type: 'frame', entity_id: 'f15', deleted_at: Date.now(), device_id: 'iPad' }];
    await call(db, 'POST', `/projects/${PROJECT}/sync`, body);

    check('the old frame is gone from the database',
      db.one("SELECT id FROM frames WHERE id = 'f15'") ? 'still there' : 'gone', 'gone');
    check('...its versions went with it',
      db.rows("SELECT id FROM versions WHERE frame_id = 'f15'").length, 0);
    check('the new frame is there, under its own id',
      db.one<{ label: string }>("SELECT label FROM frames WHERE id = 'replacement'")?.label, '16');
    check('...and the project still has 20 frames', db.rows('SELECT id FROM frames').length, 20);

    // and the other device is told both halves of the story
    const delta = await desktop.pullChanges();
    const got = delta.body as {
      frames: Array<{ id: string }>;
      deletions: Array<{ entity_id: string }>;
    };
    check('the other device is told the old one died',
      got.deletions?.some((d) => d.entity_id === 'f15'), true);
    check('...and that a new one was born',
      got.frames.some((f) => f.id === 'replacement'), true);
    check('...and it never confuses the two',
      got.frames.some((f) => f.id === 'f15'), false);
  }

  // --- report ---------------------------------------------------------------
  const width = Math.max(...results.map((r) => r.what.length));
  let failed = 0;
  console.log('');
  for (const r of results) {
    const ok = r.got === r.want;
    if (!ok) failed++;
    console.log(`${ok ? '  ok  ' : ' WRONG'}  ${r.what.padEnd(width)}  ->  ${r.got.padEnd(16)}` +
                (ok ? '' : `  (should be ${r.want})`));
  }
  console.log(`\n${results.length - failed} of ${results.length} correct` + (failed ? `, ${failed} WRONG\n` : '\n'));
  process.exit(failed ? 1 : 0);
}

run().catch((e) => { console.error(e); process.exit(1); });

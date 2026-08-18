// TWO DEVICES, A WHOLE SESSION — the bench that was missing.
//
// Run:  npm run bench:session   (from backend/)
//
// The server bench proves the RULES: newer wins, coexist, the picker, deletion.
// Those have been right for days. What kept failing on real devices was
// everything around them — what a device remembers when it starts, what it is
// allowed to send, when it is allowed to listen, and what makes it believe it
// is up to date.
//
// So this drives the real server, the real database and the real device rules
// through the sequences that actually cost us days:
//
//   1. an iPad held back from pulling, that pushes, and must still get the work
//      that was on the server before its push          (#299)
//   2. an iPad that restarts having forgotten everything, and must not wipe the
//      desktop's project                               (#300)
//   3. a device that goes offline, works, comes back   (#298)
//   4. both devices offline, both rearranging          (the story flow rule)
//
// A device here is its MEMORY plus the server — and the memory is saved and
// restored between turns exactly as the app does it, because losing a piece of
// it in that round trip is the fault, twice over now.

import app from '../src/index.ts';
import { FakeD1 } from './fake-d1.ts';
import { hashToken, newId } from '../src/lib/crypto.ts';
import {
  type DeviceMemory, emptyMemory, afterRestart, afterPush, afterPull,
  pushIsPartial, pullIsHeldBack, serverHasSomethingNew,
} from '../../src/lib/sessionRules.ts';

const TOKEN = 'bench-token';
const USER = 'user-1';
const PROJECT = 'project-1';
const STRIP = 'strip-1';

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
  APP_NAME: 'Framehow', APP_URL: 'https://framehow.app',
  SESSION_TTL_DAYS: '30', PASSWORD_RESET_TTL_HOURS: '1',
  EMAIL_VERIFY_TTL_HOURS: '48', ADMIN_EMAIL: 'bench@example.com',
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
// A device: what it holds on screen, what it remembers, and nothing else.
// ---------------------------------------------------------------------------

interface Held { id: string; text: string; changedAt: number | null }

class Device {
  name: string;
  memory: DeviceMemory;
  /** What is on this device's screen. */
  frames = new Map<string, Held>();
  /** What its last local save wrote down. A restart gets THIS, not the live
   *  memory — which is the whole point: a save that loses a piece is a fault. */
  saved: Partial<DeviceMemory> | null = null;
  private db: FakeD1;
  private serverTimes = new Map<string, number>();

  constructor(db: FakeD1, name: string, cloudId: string | null = PROJECT) {
    this.db = db; this.name = name;
    this.memory = emptyMemory(cloudId);
  }

  /** The user changes a frame here. */
  write(id: string, text: string, at: number): void {
    this.frames.set(id, { id, text, changedAt: at });
    this.memory = { ...this.memory, unsentFrames: this.memory.unsentFrames + 1 };
  }

  /** The local save, then the app is closed and opened again. */
  restart(): void {
    this.saved = { ...this.memory };
    this.memory = afterRestart(this.saved, PROJECT);
  }

  /** A restart after a save that lost the memory — Safari killed the app, an
   *  older build wrote the snapshot, the storage was full. The frames are still
   *  on the device; what it knew about the SERVER is gone. */
  restartHavingForgotten(): void {
    this.saved = null;
    this.memory = afterRestart(null, PROJECT);
  }

  async push(at: number) {
    const partial = pushIsPartial(this.memory);
    const frames = [...this.frames.values()];
    const r = await call(this.db, 'POST', `/projects/${PROJECT}/sync`, {
      partial,
      project: {
        name: 'Bench project', updated_at: at,
        device_id: this.name, device_name: this.name,
      },
      strips: [{ id: STRIP, label: 'main', sort_order: 0, updated_at: at }],
      frames: frames.map((f) => ({
        id: f.id, strip_id: STRIP, sort_order: 0, label: f.id,
        crop_w: null, crop_h: null, table_data: null, version_label: null,
        strip_labels: null, hidden: false, note: null, scribbles: null,
        text_content: f.text, updated_at: at,
        content_changed_at: f.changedAt,
        base_updated_at: this.serverTimes.get(f.id) ?? 0,
      })),
      versions: frames.map((f) => ({
        id: `${f.id}-v0`, frame_id: f.id, type: 'main', label: null,
        hidden: false, starred: 0, note: null,
        updated_at: at, content_changed_at: f.changedAt,
      })),
      images: [], drawings: [], deletions: [], settings: [],
    });
    if (process.env.BENCH_DEBUG) console.log('PUSH', this.name, r.status, r.text.slice(0, 300));
    this.learn(r.body);
    this.memory = afterPush(this.memory, frames.length);
    return { partial, ...r };
  }

  /** "Is there anything for me?" — and if so, take it. Returns whether it
   *  actually listened, which is the thing #299 got wrong. */
  async pullIfThereIsSomething(): Promise<{ asked: boolean; took: boolean }> {
    if (pullIsHeldBack(this.memory)) return { asked: false, took: false };
    const status = await call(this.db, 'GET', `/projects/${PROJECT}/status`);
    const serverUpdatedAt = (status.body as { updated_at: number }).updated_at;
    if (!serverHasSomethingNew(this.memory, serverUpdatedAt)) return { asked: true, took: false };
    await this.take();
    return { asked: true, took: true };
  }

  /** Take everything the server has, as the app does when it applies a pull. */
  async take() {
    const r = await call(this.db, 'GET', `/projects/${PROJECT}/sync`);
    const body = r.body as {
      project: { updated_at: number };
      frames: Array<{ id: string; text_content: string | null; updated_at: number }>;
    };
    for (const f of body.frames) {
      this.frames.set(f.id, { id: f.id, text: f.text_content ?? '', changedAt: null });
      this.serverTimes.set(f.id, f.updated_at);
    }
    this.memory = afterPull(this.memory, {
      serverUpdatedAt: body.project.updated_at,
      framesReceived: body.frames.length,
    });
    return r;
  }

  private learn(body: unknown) {
    const frames = (body as { frames?: Array<{ id: string; updated_at: number }> })?.frames;
    for (const f of frames ?? []) this.serverTimes.set(f.id, f.updated_at);
  }

  sees(id: string): string { return this.frames.get(id)?.text ?? '(nothing)'; }
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------

const results: Array<{ what: string; got: string; want: string }> = [];
const check = (what: string, got: unknown, want: unknown) =>
  results.push({ what, got: String(got), want: String(want) });

const rowsIn = (db: FakeD1) =>
  db.rows('SELECT id FROM frames').length;

async function run() {
  // =========================================================================
  // 1. THE IPAD THAT NEVER HEARD (#299)
  //
  // The exact afternoon: the iPad has an unsent setting, so its pulls are held
  // back. The desktop draws on two frames and pushes. The iPad then pushes its
  // own work — and must STILL end up with the desktop's drawings.
  // =========================================================================
  {
    const db = await freshServer();
    const desktop = new Device(db, 'Desktop');
    const pad = new Device(db, 'Tablet');

    // both open the project with the same three frames
    desktop.write('f1', 'one', 1000);
    desktop.write('f2', 'two', 1000);
    desktop.write('f3', 'three', 1000);
    await desktop.push(1000);
    await pad.take();
    check('both devices start with the same three frames', pad.sees('f2'), 'two');

    // the iPad is holding something unsent, so it may not listen
    pad.memory = { ...pad.memory, settingsUnsent: true };
    check('a device with unsent work does not pull', pullIsHeldBack(pad.memory), true);

    // meanwhile the desktop draws on two frames
    desktop.write('f1', 'DRAWING on 10', 2000);
    desktop.write('f3', 'DRAWING on 12', 2000);
    await desktop.push(2000);
    check('the drawings are on the server', rowsIn(db), 3);

    // the iPad now pushes its own work — this is the moment that used to make it
    // believe it was up to date
    const takenBeforeItsPush = pad.memory.takenFromServerAt;
    await pad.push(3000);
    check('pushing does not move what the iPad has TAKEN',
      pad.memory.takenFromServerAt, takenBeforeItsPush);

    const listened = await pad.pullIfThereIsSomething();
    check('so it still asks the server', listened.asked, true);
    check('...and takes what was there', listened.took, true);
    check('the iPad now sees the first drawing', pad.sees('f1'), 'DRAWING on 10');
    check('...and the second', pad.sees('f3'), 'DRAWING on 12');

    // and once it HAS taken, it stops asking for the same thing
    const again = await pad.pullIfThereIsSomething();
    check('a device that is genuinely current does not pull again', again.took, false);
  }

  // =========================================================================
  // 2. THE DEVICE THAT FORGOT EVERYTHING (#300)
  //
  // The iPad restarts with a save that lost its memory of the server. The
  // frames are still on it. By the old rule that reads as "a project the server
  // has never seen" — and a full replace deletes the desktop's work.
  // =========================================================================
  {
    const db = await freshServer();
    const desktop = new Device(db, 'Desktop');
    const pad = new Device(db, 'Tablet');

    desktop.write('f1', 'one', 1000);
    desktop.write('f2', 'two', 1000);
    await desktop.push(1000);
    await pad.take();

    // the desktop adds a frame the iPad has never seen
    desktop.write('f3', 'made on the desktop', 2000);
    await desktop.push(2000);
    check('the server holds three frames', rowsIn(db), 3);

    // the iPad restarts, and its save carried nothing
    pad.restartHavingForgotten();
    check('it remembers no frames as confirmed', pad.memory.confirmedFrames, 0);
    check('...and none as known to the server', pad.memory.framesTheServerHas, 0);
    check('...but it still holds the cloud id', Boolean(pad.memory.cloudId), true);
    check('so its push sends CHANGES ONLY, not a replacement',
      pushIsPartial(pad.memory), true);

    await pad.push(3000);
    check('the desktop-only frame is still on the server', rowsIn(db), 3);
    const still = await call(db, 'GET', `/projects/${PROJECT}/sync`);
    const names = (still.body as { frames: Array<{ id: string; text_content: string }> })
      .frames.map((f) => f.id).sort().join(',');
    check('...by name', names, 'f1,f2,f3');

    // and the one case a full replace is still right
    const brandNew = new Device(db, 'Desktop', null);
    check('a project the server has never seen is still replaced whole',
      pushIsPartial(brandNew.memory), false);
  }

  // =========================================================================
  // 3. A RESTART THAT KEPT ITS MEMORY
  //
  // The ordinary case, which must stay cheap: nothing is re-sent, nothing is
  // claimed, and the device knows it is current.
  // =========================================================================
  {
    const db = await freshServer();
    const desktop = new Device(db, 'Desktop');
    desktop.write('f1', 'one', 1000);
    await desktop.push(1000);
    await desktop.take();
    const takenBefore = desktop.memory.takenFromServerAt;

    desktop.restart();
    check('a restart keeps what the device had taken',
      desktop.memory.takenFromServerAt, takenBefore);
    check('...and it does not think it is holding unsent work',
      pullIsHeldBack(desktop.memory), false);
    const asked = await desktop.pullIfThereIsSomething();
    check('...so it asks, and there is nothing new', asked.took, false);
  }

  // =========================================================================
  // 4. OFFLINE, WORK, COME BACK (#298)
  //
  // While the desktop is away the iPad writes. When the desktop returns it must
  // send what it made AND take what arrived — in that order, or its own work is
  // overwritten by the copy it never sent.
  // =========================================================================
  {
    const db = await freshServer();
    const desktop = new Device(db, 'Desktop');
    const pad = new Device(db, 'Tablet');
    desktop.write('f1', 'one', 1000);
    desktop.write('f2', 'two', 1000);
    await desktop.push(1000);
    await pad.take();

    // desktop goes offline and writes on f1; the iPad writes on f2 and pushes
    desktop.write('f1', 'written offline on the desktop', 2000);
    pad.write('f2', 'written on the iPad', 2500);
    await pad.push(2500);

    // the desktop comes back: it may not listen first — it is holding work
    check('a device holding offline work does not listen first',
      pullIsHeldBack(desktop.memory), true);
    await desktop.push(3000);
    await desktop.pullIfThereIsSomething();
    check('the desktop keeps its own offline writing',
      desktop.sees('f1'), 'written offline on the desktop');
    check('...and receives the iPad\'s', desktop.sees('f2'), 'written on the iPad');

    await pad.pullIfThereIsSomething();
    check('and the iPad receives the desktop\'s', pad.sees('f1'), 'written offline on the desktop');
  }

  // =========================================================================
  // 5. NEITHER DEVICE MAY BE MADE STALE BY ITS OWN VOICE
  //
  // The general shape of #299, stated once: for any sequence, a device that has
  // pushed but never taken must never believe it is current.
  // =========================================================================
  {
    const m = emptyMemory(PROJECT);
    const pushed = afterPush(m, 45);
    check('pushing 45 frames does not make a device current',
      serverHasSomethingNew(pushed, 1), true);
    const took = afterPull(pushed, { serverUpdatedAt: 5000, framesReceived: 45 });
    check('taking does', serverHasSomethingNew(took, 5000), false);
    check('...and anything after that is new again',
      serverHasSomethingNew(took, 5001), true);
  }

  // ---------------------------------------------------------------------------
  const width = Math.max(...results.map((r) => r.what.length));
  let failed = 0;
  console.log('');
  for (const r of results) {
    const ok = r.got === r.want;
    if (!ok) failed++;
    console.log(`${ok ? '  ok  ' : ' WRONG'}  ${r.what.padEnd(width)}  ->  ${r.got.padEnd(24)}` +
                (ok ? '' : `  (should be ${r.want})`));
  }
  console.log(`\n${results.length - failed} of ${results.length} correct` +
              (failed ? `, ${failed} WRONG\n` : '\n'));
  process.exit(failed ? 1 : 0);
}

void run();

// A FETCH FOR THE OLD PROJECT MUST NOT LAND IN THE ONE BEING OPENED
// (Roman's phone, 12 November: "i tapped the screen while loading W7... and i
// think it mixed up the two projects!!!").
//
// Opening a project from the list puts the new project's shots on the screen
// first, then loads its pictures — twenty seconds for a big one — and only then
// calls it the open project. A fetch in that time was still for the OLD
// project: its answer was laid over the NEW project's shots, the new shots were
// "kept as local work" inside the old one, and both went on mixed (30 shots:
// 26 of WF 7 and 4 of "9x16 proj"; WF 7 turned upright). He had shot photos in
// the old project seconds before, so there was something to fetch.
//
// THE RULES IT HOLDS TO
//   · while a project is being opened, nothing is fetched for the old one —
//     not when asked by hand, not by the heartbeat
//   · after the opening: exactly the opened project's shots, its name, its pictures
//   · the old project, on the server and on another device, is untouched by it
//
//     npm run t -- e2e/68-fetch-while-opening.spec.ts

import { test, expect } from '@playwright/test';
import * as zlib from 'zlib';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 420_000 });

/** A flat grey PNG of any size — a few hundred bytes however wide. */
function flatPng(width: number, height: number): string {
  const crcTable = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c; }
  const crc = (buf: Buffer): number => { let c = -1; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;   // 8-bit RGB
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]).toString('base64');
}

const png = (n: number): string => `data:image/png;base64,${flatPng(8 + n, 4)}`;

/** Open a project the way a person does from the list, over whatever is on the
 *  screen: if the app asks about unsaved work, the answer is yes. Returns when
 *  the project is the open one. */
async function openOver(d: Device, id: string, timeoutMs = 120_000): Promise<void> {
  say(`${d.name}: opening ${id.slice(0, 6)} over what is on the screen`);
  void d.page.evaluate((pid) => { void (window as never as { __fh_test: { openProject(i: string): Promise<void> } }).__fh_test.openProject(pid as string).catch(() => undefined); }, id);
  const until = Date.now() + timeoutMs;
  for (;;) {
    const yes = d.page.locator('#confirmModal:not(.hidden) #confirmYes');
    if (await yes.count()) await yes.click().catch(() => undefined);
    if ((await d.read()).projectId === id) return;
    if (Date.now() > until) throw new Error(`${d.name}: THE PROJECT NEVER BECAME THE OPEN ONE\n${(await d.log()).slice(0, 40).map((l) => '  ' + l).join('\n')}`);
    await d.page.waitForTimeout(400);
  }
}

test('a fetch while a project is being opened: the two projects are not mixed', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  say('BIG: three shots with a picture each. SMALL: two shots. The desktop ends in SMALL.');
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.putPicture(0, png(1)); await desktop.putPicture(1, png(2)); await desktop.putPicture(2, png(3));
  await desktop.renameFrame(0, 'BIG ONE');
  await desktop.settle();
  const smallId = await desktop.newProject('SMALL', 2);
  await desktop.renameFrame(0, 'SMALL ONE');
  await desktop.settle();
  await desktop.reload();                       // (forgets the pictures it has in hand, so BIG's must be fetched)
  await desktop.settle();
  await tablet.openProject(smallId!);
  await tablet.settle();

  say('BIG\'s pictures are slow: the opening takes about eight seconds');
  await desktop.page.route('**/images/**', async (route) => {
    await new Promise((r) => setTimeout(r, 8_000));
    await route.continue();
  });
  void desktop.page.evaluate((pid) => { void (window as never as { __fh_test: { openProject(id: string): Promise<void> } }).__fh_test.openProject(pid as string); }, bigId!);
  await desktop.page.waitForTimeout(1_500);

  say('meanwhile the tablet changes SMALL — so there IS something to fetch for the old project');
  await tablet.renameFrame(1, 'FROM THE TABLET');
  await tablet.settle();

  say('…and the desktop is asked to fetch, in the middle of the opening (as the heartbeat did)');
  await desktop.startPullWithoutWaiting();
  await desktop.page.waitForTimeout(1_000);
  await desktop.startPullWithoutWaiting();

  say('the opening finishes');
  await expect.poll(async () => (await desktop.read()).projectName, { timeout: 60_000 }).toBe('BIG');
  await desktop.page.unroute('**/images/**');
  await desktop.settle();

  const now = await desktop.read();
  say(`   the desktop holds: ${now.frames.map((f) => f.label).join(', ')}`);
  expect(now.projectId, 'the open project is BIG').toBe(bigId);
  expect(now.frames.length, 'EXACTLY BIG\'S THREE SHOTS — nothing of SMALL among them').toBe(3);
  expect(now.frames.map((f) => f.label), 'BIG\'s own shot is there').toContain('BIG ONE');
  expect(now.frames.map((f) => f.label).join('|'), 'no shot of SMALL in BIG').not.toMatch(/SMALL ONE|FROM THE TABLET/);
  const log = (await desktop.log()).join('\n');
  expect(log, 'the fetch was turned away while the project was being opened').toMatch(/not fetching: a project is being opened|answer came back while another project was being opened/);

  say('SMALL is untouched by it: the tablet still holds its two shots, with its own change');
  const small = await tablet.read();
  expect(small.frames.length, 'SMALL has its two shots').toBe(2);
  expect(small.frames.map((f) => f.label)).toContain('FROM THE TABLET');

  say('and BIG is the same on the server: the tablet opens it and both agree');
  await tablet.openProject(bigId!);
  await tablet.settle();
  await Device.waitUntilWholeAgrees(desktop, tablet, 'BIG after the opening');
  expect((await tablet.read()).frames.length, 'BIG has three shots on the tablet too').toBe(3);

  say('SMALL once more, on the desktop: its two shots, the tablet\'s change arrived');
  await desktop.openProject(smallId!);
  await desktop.settle();
  const back = await desktop.read();
  expect(back.frames.length, 'SMALL has two shots on the desktop').toBe(2);
  expect(back.frames.map((f) => f.label)).toContain('FROM THE TABLET');

  await desktop.close();
  await tablet.close();
});

// THE SAVE OF THE PROJECT BEING LEFT MUST NOT CLAIM THE ONE BEING OPENED
// (Roman's phone, 12 November 16:45). An unnamed project with two photos was
// going up as "Untitled 12 Nov 16:44" when WF 7 was opened over it. When the
// creation finished it marked ITS project as the open one — with WF 7's shots
// on the screen — and the next fetch mixed them: "KEEPING 26 frame(s)", then
// "256 picture(s) nothing names any more removed", all cards blank.
//
// THE RULES IT HOLDS TO
//   · opening waits for the save that is still going up
//   · after the opening the open project IS the opened one, and stays it
//   · the project that was left is on the server, whole
test('the save of the project being left finishes first, and never claims the one being opened', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  say('BIG: three shots with a picture each');
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.putPicture(0, png(1)); await desktop.putPicture(1, png(2)); await desktop.putPicture(2, png(3));
  await desktop.settle();

  say('a new project, NOT saved, with a picture — and every upload is slow');
  await desktop.page.route('**/upload', async (route) => {
    await new Promise((r) => setTimeout(r, 9_000));
    await route.continue();
  });
  await desktop.page.evaluate(async () => {
    const t = (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void>; waveSaveReminderAway(): void } }).__fh_test;
    await t.newUnsavedProject(2);
  });
  await desktop.putPicture(0, png(7));
  await desktop.renameFrame(0, 'LEFT BEHIND');
  await desktop.page.evaluate(() => (window as never as { __fh_test: { waveSaveReminderAway(): void } }).__fh_test.waveSaveReminderAway());

  say('it starts going up as "Untitled …" (the app does that by itself)');
  await expect.poll(async () => (await desktop.log()).some((l) => l.includes('retry: creating')), { timeout: 90_000 }).toBe(true);

  say('BIG is opened while that save is still going up');
  await openOver(desktop, bigId!);
  await desktop.page.unroute('**/upload');
  await desktop.settle();
  await desktop.page.waitForTimeout(12_000);      // the old save has long finished by now
  await desktop.settle();

  const now = await desktop.read();
  say(`   open: ${now.projectName} (${now.projectId?.slice(0, 6)}), shots: ${now.frames.map((f) => f.label).join(', ')}`);
  expect(now.projectId, 'THE OPEN PROJECT IS BIG — the old save did not claim it').toBe(bigId);
  expect(now.projectName).toBe('BIG');
  expect(now.frames.length, 'BIG\'s three shots, nothing else').toBe(3);
  expect(now.frames.map((f) => f.label).join('|'), 'no shot of the project that was left').not.toContain('LEFT BEHIND');
  const log = (await desktop.log()).join('\n');
  expect(log, 'the opening waited for the save, or the save stood back').toMatch(/opening waits: the save of the project being left|another project was opened/);
  expect(log, 'nothing was "kept" from another project').not.toContain('KEEPING');
  expect(log, 'no pictures were thrown off the device').not.toContain('nothing names any more removed');

  say('the project that was left is on the server');
  expect((await Device.projectNames(token)).some((n) => n.startsWith('Untitled')), 'the Untitled project exists').toBe(true);

  await desktop.close();
});

// A SAVE THAT TAKES LONGER THAN THE OPENING WILL WAIT (Roman, 12 Nov: "it can
// take longer than 20 seconds to save a project, no?"). The wait is politeness;
// the safety is that the project being left is filed on the device first, and
// that its save, when it comes back to another project on the screen, stops.
//
// THE RULES IT HOLDS TO
//   · the opened project is and stays the open one, with only its own shots
//   · the save of the project that was left stops — nothing of the open
//     project is sent under the other one's name
//   · the work that was left is not lost: it is filed on the device and
//     reaches the server by itself, into its own project
test('a save that outlasts the wait: the project left is filed, its save stops, its work still arrives', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  say('BIG: three shots with a picture each');
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.putPicture(0, png(1)); await desktop.putPicture(1, png(2)); await desktop.putPicture(2, png(3));
  await desktop.settle();

  say('a new project, NOT saved, with a picture — and its upload takes thirty-five seconds');
  let slow = true;
  await desktop.page.route('**/upload', async (route) => {
    if (slow) await new Promise((r) => setTimeout(r, 35_000));
    await route.continue();
  });
  await desktop.page.evaluate(async () => {
    await (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void> } }).__fh_test.newUnsavedProject(2);
  });
  await desktop.putPicture(0, png(9));
  await desktop.renameFrame(0, 'LEFT BEHIND');
  await desktop.page.evaluate(() => (window as never as { __fh_test: { waveSaveReminderAway(): void } }).__fh_test.waveSaveReminderAway());
  await expect.poll(async () => (await desktop.log()).some((l) => l.includes('retry: creating')), { timeout: 90_000 }).toBe(true);

  say('BIG is opened over it; the opening waits its twenty seconds, files the project, and goes on');
  await openOver(desktop, bigId!);
  slow = false;                                  // (uploads from here on are ordinary)
  let log = (await desktop.log()).join('\n');
  expect(log, 'the project being left was filed on the device before BIG came on').toContain('is filed on this device first');

  say('the old save comes back to another project on the screen — and stops');
  await expect.poll(async () => (await desktop.log()).some((l) => /stopped .*another project is on the screen|came back after another project was opened|stopped half way/.test(l)),
    { timeout: 60_000 }).toBe(true);
  await desktop.settle();
  let now = await desktop.read();
  expect(now.projectId, 'THE OPEN PROJECT IS BIG').toBe(bigId);
  expect(now.frames.length, 'BIG\'s three shots, nothing else').toBe(3);
  expect(now.frames.map((f) => f.label).join('|')).not.toContain('LEFT BEHIND');
  log = (await desktop.log()).join('\n');
  expect(log, 'nothing was "kept" from another project').not.toContain('KEEPING');

  say('a change in BIG — a save that reaches the server is the moment unsent work of other projects goes up');
  await desktop.renameFrame(1, 'BIG TWO');
  await desktop.settle();

  say('the work that was left arrives on the server by itself, in its own project');
  let untitledId: string | null = null;
  await expect.poll(async () => {
    const res = await fetch('http://127.0.0.1:8787/projects', { headers: { Authorization: `Bearer ${token}` } });
    const list = ((await res.json()) as { projects: Array<{ id: string; name: string }> }).projects;
    const u = list.find((p) => p.name.startsWith('Untitled'));
    if (!u) return 'no Untitled project';
    untitledId = u.id;
    const tree = (await (await fetch(`http://127.0.0.1:8787/projects/${u.id}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { frames?: Array<{ label?: string }> };
    return (tree.frames ?? []).map((f) => f.label).join('|');
  }, { timeout: 150_000, intervals: [3_000] }).toContain('LEFT BEHIND');

  say('and through all of it BIG stayed BIG — here and on the tablet');
  await desktop.settle();
  now = await desktop.read();
  expect(now.projectId).toBe(bigId);
  expect(now.frames.length, 'BIG still has exactly three shots').toBe(3);
  await tablet.openProject(bigId!);
  await tablet.settle();
  await Device.waitUntilWholeAgrees(desktop, tablet, 'BIG at the end');
  expect((await tablet.read()).frames.map((f) => f.label), 'the tablet has BIG\'s own change').toContain('BIG TWO');
  await tablet.openProject(untitledId!);
  await tablet.settle();
  const left = await tablet.read();
  expect(left.frames.length, 'the project that was left has its two shots').toBe(2);
  expect(left.frames.map((f) => f.label)).toContain('LEFT BEHIND');

  await desktop.close();
  await tablet.close();
});

// THE APP IS CLOSED WHILE A PROJECT IS STILL LOADING (Roman, 12 Nov: "a project
// loads too long and someone loses his nerves and swipes up the app … once the
// user decides to load a new project, independently of how long this loading
// takes or is killed in the middle, nothing should change the old on-screen
// project. That's the safety net.")
//
// THE RULES IT HOLDS TO
//   · the app opened again comes up in the project that was on the screen
//     BEFORE — its shots, its names, its picture — even one never saved
//   · nothing of the half-loaded project is in it
//   · the half-loaded project is untouched on the server and opens whole after
test('the app is closed while a project is loading: it comes back in the old project, whole', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  say('BIG: three shots with a picture each, on the server');
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.putPicture(0, png(1)); await desktop.putPicture(1, png(2)); await desktop.putPicture(2, png(3));
  await desktop.renameFrame(0, 'BIG ONE');
  await desktop.settle();

  say('on the screen: a new project, never saved, two shots, a picture');
  await desktop.page.evaluate(async () => {
    await (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void> } }).__fh_test.newUnsavedProject(2);
  });
  await desktop.putPicture(0, png(5));
  await desktop.renameFrame(0, 'MINE, UNSAVED');
  await desktop.settle();
  const before = await desktop.read();
  expect(before.projectId, 'it has never been to the server').toBeNull();

  say('BIG is opened — its pictures are slow — and the app is closed in the middle');
  await desktop.page.route('**/images/**', async (route) => {
    await new Promise((r) => setTimeout(r, 20_000));
    await route.continue().catch(() => undefined);
  });
  void desktop.page.evaluate((pid) => { void (window as never as { __fh_test: { openProject(i: string): Promise<void> } }).__fh_test.openProject(pid as string).catch(() => undefined); }, bigId!);
  for (let i = 0; i < 20; i++) {                 // (the question about unsaved work is answered yes)
    const yes = desktop.page.locator('#confirmModal:not(.hidden) #confirmYes');
    if (await yes.count()) { await yes.click().catch(() => undefined); break; }
    await desktop.page.waitForTimeout(250);
  }
  await desktop.page.waitForTimeout(4_000);      // BIG's shots are on the screen, its pictures still coming
  await desktop.page.unroute('**/images/**');
  await desktop.reload();                        // the app closed and opened again
  await desktop.settle();

  const after = await desktop.read();
  say(`   it came back with: ${after.frames.map((f) => f.label).join(', ')} (project ${after.projectId ?? 'not on the server'})`);
  expect(after.frames.map((f) => f.label), 'THE PROJECT THAT WAS ON THE SCREEN BEFORE IS BACK').toContain('MINE, UNSAVED');
  expect(after.frames.length, 'its two shots, nothing of BIG').toBe(2);
  expect(after.frames.map((f) => f.label).join('|'), 'no shot of the half-loaded project').not.toContain('BIG ONE');
  const shape = await desktop.page.evaluate(() =>
    (window as never as { __fh_test: { deviceSaveShape(): Promise<{ live: number }> } }).__fh_test.deviceSaveShape());
  expect(shape.live, 'its picture is there').toBeGreaterThanOrEqual(1);

  say('BIG opens whole afterwards; the unsaved project becomes "Untitled" on the server');
  await openOver(desktop, bigId!);
  await desktop.settle();
  const big = await desktop.read();
  expect(big.frames.length, 'BIG has its three shots').toBe(3);
  expect(big.frames.map((f) => f.label)).toContain('BIG ONE');
  // THE UNSAVED PROJECT IS NOT LOST: left for BIG, it becomes a full "Untitled"
  // project on the server with its shots (the rule of 12 Nov — before it, it
  // had to be found as a copy on the device).
  await expect.poll(() => untitledWith(token, 'MINE, UNSAVED'), { timeout: 120_000, intervals: [3_000] }).toMatch(/^Untitled \d/);

  await desktop.close();
});

// AN UNSAVED PROJECT THAT IS LEFT BECOMES A FULL PROJECT, "Untitled" AND ITS DATE
// (Roman, 12 Nov: "an unsaved project should not become the short one. It
// should become the full long one, untitled project with a date. And the short
// ones are only copies of projects that have not been uploaded to the server.")
//
// THE RULES IT HOLDS TO
//   · left for another project: it is on the server soon after, as
//     "Untitled <date> <time>", with its shots — nobody pressed SAVE
//   · the project that was opened is untouched by it
async function untitledWith(token: string, label: string): Promise<string> {
  const res = await fetch('http://127.0.0.1:8787/projects', { headers: { Authorization: `Bearer ${token}` } });
  const list = ((await res.json()) as { projects: Array<{ id: string; name: string }> }).projects;
  for (const p of list.filter((x) => /^Untitled \d/.test(x.name))) {
    const tree = (await (await fetch(`http://127.0.0.1:8787/projects/${p.id}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { frames?: Array<{ label?: string }> };
    if ((tree.frames ?? []).some((f) => f.label === label)) return p.name;
  }
  return `no Untitled project holds "${label}" (projects: ${list.map((p) => p.name).join(', ')})`;
}

test('an unsaved project that is left becomes a full "Untitled" project on the server', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const bigId = await desktop.newProject('BIG', 3);
  await desktop.settle();

  say('a new project, a little work, never saved — and BIG is opened straight away');
  await desktop.page.evaluate(async () => {
    await (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void> } }).__fh_test.newUnsavedProject(2);
  });
  await desktop.putPicture(0, png(4));
  await desktop.renameFrame(0, 'A QUICK TRY');
  await desktop.page.waitForTimeout(800);
  await openOver(desktop, bigId!);

  say('it is on the server by itself, as "Untitled …", with its shots');
  await expect.poll(() => untitledWith(token, 'A QUICK TRY'), { timeout: 120_000, intervals: [3_000] }).toMatch(/^Untitled \d/);
  await desktop.settle();
  const now = await desktop.read();
  expect(now.projectId, 'BIG is still the open project').toBe(bigId);
  expect(now.frames.length, 'BIG has its three shots, nothing else').toBe(3);

  // ONE "Untitled" PROJECT, NOT TWO (Roman's phone, 19:21): while BIG was being
  // opened, BIG's own shots were filed as the unsaved project's work, and a
  // second "Untitled" was made for them.
  await desktop.page.waitForTimeout(10_000);
  await desktop.settle();
  const untitled = (await Device.projectNames(token)).filter((n) => /^Untitled \d/.test(n));
  say(`   Untitled projects on the server: ${untitled.join(', ')}`);
  expect(untitled.length, 'EXACTLY ONE "Untitled" PROJECT — the one that was left').toBe(1);
  const log = (await desktop.log()).join('\n');
  expect(log, 'no shots of BIG were sent into another project').not.toContain('belong to ANOTHER project');
  await desktop.close();
});

// TWO UNSAVED PROJECTS, AND THE APP IS CLOSED (Roman, 12 Nov: "you have an old
// unsaved project where you tried a couple of photos, and then you decide to
// create a new project. And then you kill the app. Both are not saved.")
//
// THE RULES IT HOLDS TO
//   · the app opened again comes up in the NEW one, with what was done in it
//   · the OLD one is not lost: it becomes a full "Untitled" project with its shots
//   · neither holds anything of the other
test('two unsaved projects and the app is closed: the new one comes back, the old one becomes "Untitled"', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  say('the old try: two shots, a picture, never saved');
  await desktop.page.evaluate(async () => {
    await (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void> } }).__fh_test.newUnsavedProject(2);
  });
  await desktop.putPicture(0, png(6));
  await desktop.renameFrame(0, 'OLD TRY');
  await desktop.settle();

  say('a new project is begun over it: one shot, a picture, never saved either');
  await desktop.page.evaluate(async () => {
    await (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void> } }).__fh_test.newUnsavedProject(1);
  });
  await desktop.putPicture(0, png(8));
  await desktop.renameFrame(0, 'NEW ONE');
  await desktop.settle();

  say('the app is closed and opened again');
  await desktop.reload();
  await desktop.settle();
  const back = await desktop.read();
  say(`   it came back with: ${back.frames.map((f) => f.label).join(', ')}`);
  expect(back.frames.map((f) => f.label), 'THE NEW PROJECT IS BACK').toContain('NEW ONE');
  expect(back.frames.map((f) => f.label).join('|'), 'nothing of the old try in it').not.toContain('OLD TRY');
  expect(back.frames.length).toBe(1);

  say('the old try is not lost: it is a full "Untitled" project, with its shots');
  await expect.poll(() => untitledWith(token, 'OLD TRY'), { timeout: 180_000, intervals: [3_000] }).toMatch(/^Untitled \d/);
  const after = await desktop.read();
  expect(after.frames.map((f) => f.label).join('|'), 'and still nothing of it in the open project').not.toContain('OLD TRY');
  expect(after.frames.map((f) => f.label)).toContain('NEW ONE');
  await desktop.close();
});

// THE OLD PROJECT LEAVES THE SCREEN THE MOMENT THE NEW ONE IS CHOSEN — AND COMES
// BACK IF THE OPENING FAILS (Roman, 12 Nov: "why don't you wipe off the screen
// the old project in the same moment when the user decides to open the new
// one? There can't be two projects on the screen at the same time.")
//
// THE RULES IT HOLDS TO
//   · while the new project is loading, NO project is open and no shot of the
//     old one is on the screen
//   · the opening fails (the server does not answer): the old project is back,
//     whole, and is the open one — and it still saves
test('opening: the old project leaves the screen at once; if the opening fails it comes back whole', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const bigId = await desktop.newProject('BIG', 3);
  await desktop.putPicture(0, png(1)); await desktop.putPicture(1, png(2));
  await desktop.settle();
  const homeId = await desktop.newProject('HOME', 2);
  await desktop.putPicture(0, png(3));
  await desktop.renameFrame(0, 'HOME ONE');
  await desktop.settle();
  await desktop.reload();
  await desktop.settle();

  say('BIG is opened, its pictures are slow: in the middle, nothing of HOME is on the screen and no project is open');
  await desktop.page.route('**/images/**', async (route) => {
    await new Promise((r) => setTimeout(r, 6_000));
    await route.continue().catch(() => undefined);
  });
  void desktop.page.evaluate((pid) => { void (window as never as { __fh_test: { openProject(i: string): Promise<void> } }).__fh_test.openProject(pid as string).catch(() => undefined); }, bigId!);
  await desktop.page.waitForTimeout(2_500);
  const mid = await desktop.read();
  say(`   in the middle: open project ${mid.projectId ?? 'none'}, shots: ${mid.frames.map((f) => f.label).join(', ') || 'none'}`);
  expect(mid.projectId, 'NO PROJECT IS OPEN WHILE THE NEW ONE LOADS — not the old one').not.toBe(homeId);
  expect(mid.frames.map((f) => f.label).join('|'), 'no shot of the old project on the screen').not.toContain('HOME ONE');
  await expect.poll(async () => (await desktop.read()).projectId, { timeout: 60_000 }).toBe(bigId);
  await desktop.page.unroute('**/images/**');
  await desktop.settle();
  expect((await desktop.read()).frames.length, 'BIG arrived with its three shots').toBe(3);

  say('back to HOME (it opens whole), then BIG again — but this time the server does not answer');
  await desktop.openProject(homeId!);
  await desktop.settle();
  expect((await desktop.read()).frames.map((f) => f.label)).toContain('HOME ONE');
  await desktop.page.route(`**/projects/${bigId}/sync*`, (route) => route.abort());
  await desktop.openProject(bigId!);            // returns when the opening has given up
  await desktop.page.unroute(`**/projects/${bigId}/sync*`);
  await desktop.page.waitForTimeout(1_000);
  const back = await desktop.read();
  say(`   after the failed opening: open project ${back.projectId?.slice(0, 6) ?? 'none'}, shots: ${back.frames.map((f) => f.label).join(', ')}`);
  expect(back.projectId, 'THE OLD PROJECT IS THE OPEN ONE AGAIN').toBe(homeId);
  expect(back.frames.length, 'with its two shots').toBe(2);
  expect(back.frames.map((f) => f.label)).toContain('HOME ONE');
  const shape = await desktop.page.evaluate(() =>
    (window as never as { __fh_test: { deviceSaveShape(): Promise<{ live: number }> } }).__fh_test.deviceSaveShape());
  expect(shape.live, 'and its picture').toBeGreaterThanOrEqual(1);

  say('and it still works: a change in HOME reaches the tablet');
  await desktop.renameFrame(1, 'HOME TWO');
  await desktop.settle();
  await tablet.openProject(homeId!);
  await tablet.settle();
  await Device.waitUntilWholeAgrees(desktop, tablet, 'HOME after the failed opening');
  expect((await tablet.read()).frames.map((f) => f.label)).toContain('HOME TWO');

  await desktop.close();
  await tablet.close();
});

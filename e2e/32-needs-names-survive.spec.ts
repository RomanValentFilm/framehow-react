// RENAMED NEEDS NAMES SURVIVE THE OTHER DEVICE MOVING ABOUT (22 Sept).
//
// Roman, 21 September, twice in one day: the actors in NEEDS renamed, the
// LOCATION renamed, the category itself renamed — all back to ACTOR 1,
// LOCATION 1, TALENTS. "They survived multiple reloads today", but re-opening
// the project after having another one open lost them. The desktop's log
// showed it sending its own stale copies of tab_talents and tab_shoot as
// changes, and the server took them.
//
// Roman's recipe, as a test. Device A renames all four kinds of name and
// pushes. Device B, still holding the old names, opens another project and
// comes back; then B starts again from its own cache; then B goes to the
// other project and back once more. After every step both devices must show
// A's names — and nothing may be pushed back over them.
//
//     npm run t -- -g "needs names"
//
// About two minutes.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const TAB = 1;                 // TALENTS is the second category
const TABLE = 'tbl_talent';
const ACTOR = 'ti_actor1';
const LOC_TABLE = 'tbl_location';
const LOC = 'ti_loc1';

/** What the four names read as on a device, in one line. */
async function names(d: Device): Promise<string> {
  const raw = JSON.parse(await d.whole()) as { categories: string[] };
  // The defaults write "ACTOR 1" with a narrow space; the test reads plain ones.
  const w = { categories: raw.categories.map((c) => c.replace(/[ -  ]/g, ' ')) };
  // "CAST: PEOPLE[MARIA,ACTOR 2,ACTOR 3] ..." → the bits we renamed
  const talents = w.categories[TAB] ?? '';
  const shoot = w.categories[0] ?? '';
  const tab = talents.split(':')[0];
  const table = (talents.match(/:\s*([^[]+)\[/) ?? [])[1]?.trim();
  const actor = (talents.match(/\[([^,\]]+)/) ?? [])[1];
  const loc = (shoot.match(/ LOCATION\[([^,\]]+)/) ?? [])[1];
  return `tab=${tab} table=${table} actor=${actor} location=${loc}`;
}

/** The settings decisions in a device's log, newest last — for reading. */
async function sayDecisions(d: Device, when: string): Promise<void> {
  const lines = (await d.log()).filter((l) => /settings memory|setting need|setting strip|KEPT MINE|PUT BACK|settings changed/.test(l));
  say(`   ${d.name} ${when}: ${lines.length} settings line(s)`);
  for (const l of lines.reverse().slice(-25)) say(`     ${l}`);
}

async function expectNames(d: Device, want: string, why: string): Promise<void> {
  await expect.poll(() => names(d), { timeout: 20_000, message: `${d.name}: ${why}` }).toBe(want);
}

test('needs names: renamed tab, table, item and location survive the other device switching projects and restarting', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token, false);

  say('desktop: two projects — NAMES (the one we rename in) and OTHER');
  const otherId = await desktop.newProject('OTHER', 2);
  await desktop.settle();
  const namesId = await desktop.newProject('NAMES', 3);
  await desktop.settle();

  const ipad = await Device.open(browser, 'ipad', token, true);
  await ipad.openProject(namesId!);
  await ipad.settle();
  const before = 'tab=TALENTS table=TALENT actor=ACTOR 1 location=LOCATION 1';
  expect(await names(ipad), 'the defaults to begin with').toBe(before);

  // ── ROUND 1: A renames, pushes; B goes to OTHER and comes back ──────────
  say('desktop: renames the category, the column, an actor and a location');
  await desktop.renameCategory(TAB, 'CAST');
  await desktop.renameNeedTable(TABLE, 'PEOPLE');
  await desktop.renameNeedItem(TABLE, ACTOR, 'MARIA');
  await desktop.renameNeedItem(LOC_TABLE, LOC, 'STUDIO 7');
  await desktop.push();
  await desktop.settle();
  const round1 = 'tab=CAST table=PEOPLE actor=MARIA location=STUDIO 7';
  expect(await names(desktop), 'desktop shows its own renames').toBe(round1);

  say('ipad: opens OTHER, then NAMES again');
  await ipad.openProject(otherId!);
  await ipad.settle();
  await ipad.openProject(namesId!);
  await ipad.settle();
  await sayDecisions(ipad, 'after OTHER and back');
  await expectNames(ipad, round1, 'after OTHER and back, the renames must be here');
  await desktop.settle();
  await expectNames(desktop, round1, 'the desktop must still hold its renames');

  // ── ROUND 2: A renames again while B is away from the server ────────────
  // The simulator's browser cannot reload a page with the network cut (the
  // page itself comes from the dev server), so "starts from its cache" is a
  // plain restart: the app restores its local save first — round 1 names —
  // and only then hears the server.
  say('ipad: goes offline; desktop renames all four again and pushes');
  await ipad.offline(true);
  await desktop.renameCategory(TAB, 'PLAYERS');
  await desktop.renameNeedTable(TABLE, 'FACES');
  await desktop.renameNeedItem(TABLE, ACTOR, 'JONAS');
  await desktop.renameNeedItem(LOC_TABLE, LOC, 'HARBOUR');
  await desktop.push();
  await desktop.settle();
  const round2 = 'tab=PLAYERS table=FACES actor=JONAS location=HARBOUR';

  say('ipad: comes back online and starts again from its own cache');
  await ipad.offline(false);
  const markBoot = await ipad.mark();
  await ipad.reload();
  await ipad.settle();
  await sayDecisions(ipad, 'at boot');
  void markBoot;
  await expectNames(ipad, round2, 'back online, the second renames must arrive');
  await desktop.settle();
  await expectNames(desktop, round2, 'the desktop must still hold them');

  // ── ROUND 3: B to OTHER and back once more, then A restarts ─────────────
  say('ipad: OTHER and back once more; desktop restarts');
  await ipad.openProject(otherId!);
  await ipad.settle();
  await ipad.openProject(namesId!);
  await ipad.settle();
  await expectNames(ipad, round2, 'after OTHER and back, round 2 must be here');
  await desktop.reload();
  await desktop.settle();
  await expectNames(desktop, round2, 'after a restart the desktop must still show round 2');
  await ipad.settle();
  await expectNames(ipad, round2, 'and the ipad too');

  // ── ROUND 4: B starts a NEW project (unsaved, then saved), then re-opens NAMES ──
  // Roman's iPad, 21 Sept: recovered a project, deleted it, re-opened the
  // project → defaults. Between the two, the screen held something the server
  // had never seen, whose settings the device had dated as changed just now.
  say('ipad: builds a new project without saving, then opens NAMES');
  await ipad.buildProjectWithoutSaving('SCRATCH', 2);
  await ipad.page.waitForTimeout(1_500);
  {
    // "You have unsaved work…" — Yes, discard it, if the app asks.
    const opening = ipad.openProject(namesId!);
    await ipad.page.getByRole('button', { name: /^(Yes|OK|Continue)$/i }).first().click({ timeout: 8_000 }).catch(() => undefined);
    await opening;
  }
  await ipad.settle();
  await sayDecisions(ipad, 'after a scratch project and back');
  await expectNames(ipad, round2, 'after an unsaved new project and back, round 2 must be here');
  await desktop.settle();
  await expectNames(desktop, round2, 'the desktop must still hold round 2');

  say('ipad: makes and saves a new project, then opens NAMES');
  await ipad.newProject('FRESH', 2);
  await ipad.settle();
  await ipad.openProject(namesId!);
  await ipad.settle();
  await sayDecisions(ipad, 'after a fresh saved project and back');
  await expectNames(ipad, round2, 'after a fresh project and back, round 2 must be here');
  await desktop.settle();
  await expectNames(desktop, round2, 'the desktop must still hold round 2 (nothing pushed over it)');

  // ── ROUND 5: Roman's iPad, 21 Sept, exactly — open a project, DELETE IT
  // while it is open, then open NAMES. Between the two the screen is empty:
  // no project, default names, and a memory that dates them as changed now.
  say('ipad: opens FRESH, deletes it while open, waits, then opens NAMES');
  const freshId = (await (await fetch('http://127.0.0.1:8787/projects', { headers: { Authorization: `Bearer ${token}` } })).json() as
    { projects: Array<{ id: string; name: string }> }).projects.find((p) => p.name === 'FRESH')!.id;
  await ipad.openProject(freshId);
  await ipad.settle();
  await ipad.deleteThisProject();
  await ipad.page.waitForTimeout(4_000);      // the local save runs and stamps what is on screen
  await ipad.openProject(namesId!);
  await ipad.settle();
  await sayDecisions(ipad, 'after deleting the open project and opening NAMES');
  await expectNames(ipad, round2, 'after deleting an open project and opening NAMES, round 2 must be here');
  await desktop.settle();
  await expectNames(desktop, round2, 'the desktop must still hold round 2 (nothing pushed over it)');

  // Nothing went back over them: the server holds A's names.
  const tree = await (await fetch(`http://127.0.0.1:8787/projects/${namesId}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json() as
    { settings: Array<{ kind: string; item_id: string; value: string | null }> };
  const talents = tree.settings.find((s) => s.kind === 'needCategory' && s.item_id === 'tab_talents');
  expect(talents?.value ?? '', 'the server holds the renamed category').toContain('PLAYERS');
  expect(talents?.value ?? '').toContain('JONAS');

  await desktop.close();
  await ipad.close();
});

// A PROJECT DELETED FOR GOOD LEAVES EVERY SCREEN (18 November).
//
// Roman deleted WF 7 with Delete now. A browser still had it open — and kept
// it: reload brought it back from that browser's own copy, the server answered
// "not found", and the app said nothing at all. Deleted for good left no row
// behind, so the server could not say "you deleted it".
//
// His rule: "if a user deletes a project for good, the server knows, and if
// it's open on any device the OPEN PROJECT list appears the moment the app
// checks with the server … and we remove the deleted project from screen".
//   · no box, no SAVE AS NEW — nothing is asked
//   · the device's own copy goes too: a reload does not bring it back
//   · unsent work on that device goes with it (his own delete; agreed)
//   · a project still in the recover list keeps its question, as before
//
//     npm run t -- -g "deleted for good"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

const openId = async (d: Device): Promise<string | null> => (await d.read()).projectId ?? null;

test('deleted for good: the project leaves the other device\'s screen, the list comes up, a reload does not bring it back', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token);

  const keepId = await desktop.newProject('KEEP', 1);
  await desktop.settle();
  const goingId = await desktop.newProject('GOING', 2);
  await desktop.settle();
  await tablet.openProject(goingId!);
  await tablet.settle();
  expect(await openId(tablet)).toBe(goingId);

  say('tablet: renames shot 1 with the SAVE cut — unsent work on a project about to go');
  await tablet.page.route('**/127.0.0.1:8787/projects/*/sync*', (r) =>
    (r.request().method() === 'POST' ? r.abort('connectionfailed') : r.continue()));
  await tablet.renameFrame(0, 'NEVER SENT');
  await tablet.page.waitForTimeout(1500);

  say('desktop: opens KEEP, then DELETE NOW on GOING');
  await desktop.openProject(keepId!);
  await desktop.settle();
  await desktop.deleteProjectNow(goingId!);

  say('tablet: the next word with the server closes GOING and shows the Open project list');
  await tablet.page.unroute('**/127.0.0.1:8787/projects/*/sync*');
  const before = await tablet.mark();
  await expect.poll(async () => { await tablet.nudge(); return await openId(tablet); },
    { timeout: 60_000, message: 'the tablet lets go of the deleted project' }).toBeNull();
  await tablet.waitForLogAfter(before, 'deleted for good', 10_000);
  await expect(tablet.page.locator('#projectListModal'), 'the Open project list is up').toBeVisible({ timeout: 15_000 });
  await expect(tablet.page.locator('[data-gone]'), 'nothing is asked').toHaveCount(0);
  await expect(tablet.page.locator('#projectListContent'), 'KEEP is offered').toContainText('KEEP', { timeout: 15_000 });
  await expect(tablet.page.locator('#projectListContent')).not.toContainText('GOING');
  await expect(tablet.page.locator('#projectListNew'), 'New project is there').toBeVisible();

  say('tablet: reload — GOING does not come back from the device');
  await tablet.reload();
  await tablet.page.waitForTimeout(3000);
  expect(await openId(tablet), 'no deleted project after the reload').not.toBe(goingId);
  expect((await tablet.log()).some((l) => l.includes('"GOING"') && l.includes('restored')), 'nothing of GOING is restored').toBe(false);

  await desktop.close(); await tablet.close();
});

test('deleted for good: a project still in the recover list keeps its question — until it is deleted for good', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token);

  const keepId = await desktop.newProject('KEEP', 1);
  await desktop.settle();
  const softId = await desktop.newProject('SOFT', 2);
  await desktop.settle();
  await tablet.openProject(softId!);
  await tablet.settle();

  say('desktop: plain Delete on SOFT (it goes to the recover list)');
  await desktop.deleteThisProject();
  await desktop.page.waitForTimeout(1000);
  void keepId;

  say('tablet: is asked, as before — SAVE AS NEW / DELETE — and the project stays on screen');
  await expect.poll(async () => { await tablet.nudge(); return await tablet.page.locator('[data-gone="new"]').count(); },
    { timeout: 60_000, message: 'the question about the deleted project' }).toBe(1);
  expect(await openId(tablet), 'SOFT is still on screen behind the question').toBe(softId);

  // ...AND THEN IT IS DELETED FOR GOOD WHILE THE QUESTION STANDS THERE (Roman's
  // phone, 18 Nov 17:42: it went on asking). The question goes, the project
  // leaves, the list comes up.
  say('desktop: DELETE NOW on SOFT from the recover list — the tablet\'s question goes, the project leaves');
  await desktop.deleteProjectNow(softId!);
  await expect.poll(async () => { await tablet.nudge(); return await openId(tablet); },
    { timeout: 60_000, message: 'the tablet lets go of the project deleted for good' }).toBeNull();
  await expect(tablet.page.locator('[data-gone]'), 'the question is off the screen').toHaveCount(0);
  await expect(tablet.page.locator('#projectListModal'), 'the Open project list is up').toBeVisible({ timeout: 15_000 });

  await desktop.close(); await tablet.close();
});

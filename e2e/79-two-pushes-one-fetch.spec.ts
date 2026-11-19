// TWO PUSHES BEFORE ONE FETCH ARE STILL ONE'S OWN WORK (19 November, job 4 item 10).
//
// Roman's iPad, 11:21:44–48, after a camera series: push 1 sent two shots, push
// 2 a second later sent one of them again (its real photo had arrived), and the
// fetch that followed brought back both. The app only remembered what the LAST
// push had sent, so the shot only push 1 carried looked like another device's
// work: "pull: remote is newer (Tablet)" — its own name — and the whole
// storyboard was rebuilt and redrawn over the work in hand.
//
// Here: one device, two saves of two different shots with no fetch in between,
// then the fetch. It must know both for its own: no "remote is newer", no
// drawing of the whole project.
//
//     npm run t -- -g "two pushes before one fetch"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

test('two pushes before one fetch: both are known for the device\'s own work — no rebuild, no drawing', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  await desktop.newProject('TWO PUSHES', 4);
  await desktop.settle();
  // Let the opening's own first fetch pass (test 73 covers that one).
  for (let i = 0; i < 6; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(1000); }

  const redraws = () => desktop.page.evaluate(() => (window as never as { __fh_redraws?: number }).__fh_redraws ?? 0);
  const count = async (needle: string) => (await desktop.log()).filter((l) => l.includes(needle)).length;

  say('desktop: no fetch for a moment (the heartbeat is held) — shot 1 is saved, then shot 2 is saved');
  await desktop.page.route('**/127.0.0.1:8787/projects/*/heartbeat', (r) => r.abort('connectionfailed'));
  const newsBefore = await count('pull: remote is newer');
  const ownBefore = await count('its own push');
  await desktop.writeUnder(0, 'first save: shot one');
  await desktop.push();
  await desktop.writeUnder(1, 'second save: shot two');
  await desktop.push();
  await desktop.settle();
  const drawnBefore = await redraws();

  say('desktop: the fetch comes — it brings back both saves');
  await desktop.page.unroute('**/127.0.0.1:8787/projects/*/heartbeat');
  for (let i = 0; i < 40; i++) {
    await desktop.nudge();
    if (await count('its own push') > ownBefore || await count('pull: remote is newer') > newsBefore) break;
    await desktop.page.waitForTimeout(500);
  }
  await desktop.page.waitForTimeout(1500);
  expect(await count('pull: remote is newer'), 'ITS OWN TWO SAVES WERE TAKEN FOR NEWS ("pull: remote is newer")').toBe(newsBefore);
  expect(await count('its own push'), 'the fetch knew both saves for its own').toBeGreaterThan(ownBefore);
  expect((await redraws()) - drawnBefore, 'no drawing of the whole project for one\'s own saves coming back').toBe(0);

  await desktop.close();
});

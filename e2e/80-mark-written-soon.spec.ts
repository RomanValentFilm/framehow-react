// THE MARK OF WHAT WAS TAKEN IS WRITTEN SOON (19 November, job 4 item 9).
//
// Roman's iPhone, 15:21–15:22: three starts in a row restored "holds everything
// the server had up to 15:03:30", fetched the same 49 rows each time and rebuilt
// the storyboard from them. The mark went into the ordinary save on the device,
// which waits for two seconds without ANY change and starts waiting again at
// every touch — keep working, or put the app away a few seconds after a fetch,
// and it was never written.
//
// Here: the tablet writes; the desktop fetches it while a hand keeps moving on
// it; within a second and a half the desktop says the mark is written; a start
// right after does not fetch that news a second time.
//
//     npm run t -- -g "mark of what was taken"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

test('the mark of what was taken is written soon after a fetch, hands or no hands — the next start does not fetch the same news again', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);
  const pid = await tablet.newProject('THE MARK', 4);
  await tablet.settle();
  await desktop.openProject(pid!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  for (let i = 0; i < 6; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(700); }

  const count = async (needle: string) => (await desktop.log()).filter((l) => l.includes(needle)).length;
  const newsBefore = await count('pull: remote is newer');
  const writtenBefore = await count('what the server has is written to the device now');

  say('tablet: writes under shot 2 · desktop: a hand keeps moving, the fetch lands');
  await tablet.writeUnder(1, 'written on the tablet');
  await tablet.push();
  for (let i = 0; i < 60 && await count('pull: remote is newer') === newsBefore; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(300); }
  expect(await count('pull: remote is newer'), 'the desktop took the tablet\'s news').toBe(newsBefore + 1);

  say('desktop: the hand goes on moving — the mark is written all the same, within a second and a half');
  const until = Date.now() + 1500;
  while (Date.now() < until) { await desktop.page.mouse.move(20 + Math.random() * 200, 20 + Math.random() * 200); await desktop.page.waitForTimeout(120); }
  expect(await count('what the server has is written to the device now'), 'said so in the log').toBeGreaterThan(writtenBefore);

  say('desktop: a start right after — what it holds is known, nothing is fetched twice');
  await desktop.reload();
  for (let i = 0; i < 8; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(700); }
  const log = await desktop.log();                       // newest first
  const sinceStart = log.slice(0, log.findIndex((l) => l.includes('THE PAGE STARTED ANEW')) >>> 0);
  expect(sinceStart.filter((l) => l.includes('pull: remote is newer')).length, 'THE SAME NEWS WAS FETCHED AGAIN AT THE START').toBe(0);
  expect((await desktop.read()).frames[1].text, 'and the tablet\'s words are there').toBe('written on the tablet');

  await desktop.close(); await tablet.close();
});

// …AND SO IS A PUSH (same day, Roman's iPhone 15:25): a photo, its push OK, the app
// closed a few seconds later with hands on it — the start found the photo but no
// word that it had been sent, pushed the shot again and uploaded its picture a
// second time. What the server has is written to the device right after the push.
test('the mark of what was taken: a push is noted on the device at once — a start right after does not send the shot again', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  await desktop.newProject('THE MARK 2', 3);
  await desktop.settle();
  const count = async (needle: string) => (await desktop.log()).filter((l) => l.includes(needle)).length;
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAr7QkJ4AAAAASUVORK5CYII=';

  say('desktop: a picture on shot 1, pushed — and a hand keeps moving');
  const writtenBefore = await count('what the server has is written to the device now');
  await desktop.uploadPicture(0, 'main', png);
  await desktop.push();
  const until = Date.now() + 1600;
  while (Date.now() < until) { await desktop.page.mouse.move(20 + Math.random() * 200, 20 + Math.random() * 200); await desktop.page.waitForTimeout(120); }
  expect(await count('what the server has is written to the device now'), 'the device noted the push').toBeGreaterThan(writtenBefore);

  say('desktop: a start right after — the shot is known to be up, nothing is sent again');
  await desktop.reload();
  for (let i = 0; i < 8; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(700); }
  const log = await desktop.log();
  const sinceStart = log.slice(0, log.findIndex((l) => l.includes('THE PAGE STARTED ANEW')) >>> 0);
  expect(sinceStart.filter((l) => l.includes('local frames not yet on the server: 1')).length, 'THE START THOUGHT THE SHOT WAS NEVER SENT').toBe(0);
  expect(sinceStart.filter((l) => l.includes('sending frames:')).length, 'and sent nothing again').toBe(0);

  await desktop.close();
});

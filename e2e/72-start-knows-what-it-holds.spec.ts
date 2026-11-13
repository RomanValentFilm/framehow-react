// THE APP REMEMBERS ACROSS A RESTART WHAT IT HAS TAKEN FROM THE SERVER (13 November).
//
// Roman's iPad: at every start the app fetched the whole project back — its own
// saves — and rebuilt the screen three times, 650 ms each: two seconds in which
// the app did not answer. After a restart it had forgotten that it already
// held everything, and every project on the server was "newer".
//
// THE RULES IT HOLDS TO
//   · the app starts again in a project nobody else has touched: it knows what
//     it holds, and the project is NOT fetched and rebuilt
//   · the other device changes something while this one is closed: the start
//     fetches it, and the change is on the screen
//
//     npm run t -- e2e/72-start-knows-what-it-holds.spec.ts

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const RED = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z4AdMOEQH7QSAEPIAQ+kQYbwAAAAAElFTkSuQmCC';

test('a start knows what it holds: nothing new is not fetched again, something new is', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);
  const id = await desktop.newProject('SAME AGAIN', 4);
  await desktop.putPicture(0, RED);
  await desktop.putPicture(2, RED);
  await desktop.renameFrame(1, 'MINE');
  await desktop.settle();
  await desktop.push();
  await desktop.settle();
  // its own save comes back as "nothing new" — that is when the mark moves —
  // and the device's save is written again with the mark in it
  // (asked until it has happened, as the heartbeat does every five seconds while
  // somebody is at the device — a fetch asked for too soon after the last is let go)
  // …UNTIL THE LAST WORD IS THE SERVER'S: a fetch that rebuilds the project is
  // followed by one more save of the device's own (run 740), and that one has
  // to come back too. The device is level with the server when the newest of
  // "push OK" and "leaving the screen alone" is the second.
  const levelWithTheServer = async (): Promise<boolean> => {
    const newest = (await desktop.log()).find((l) => /push OK|leaving the screen alone/.test(l)) ?? '';
    return newest.includes('leaving the screen alone');
  };
  await expect.poll(async () => {
    if (await levelWithTheServer()) { await desktop.page.waitForTimeout(2_500); return levelWithTheServer(); }
    await desktop.startPullWithoutWaiting();
    await desktop.page.waitForTimeout(1_500);
    return false;
  }, { timeout: 60_000, intervals: [500], message: 'the device took its own last save back from the server' }).toBe(true);
  await desktop.page.waitForTimeout(4_000);      // (the save on the device, two seconds after)

  say('the app is closed and opened again — nobody else touched the project');
  await desktop.reload();
  await desktop.settle();
  await desktop.startPullWithoutWaiting();       // (as the first heartbeat would)
  await desktop.settle();
  let log = (await desktop.log()).join('\n');
  expect(log, 'THE START KNOWS WHAT IT HOLDS').toContain('holds everything the server had up to');
  expect(log, 'AND THE PROJECT IS NOT FETCHED AND REBUILT AGAIN').not.toContain('pull: remote is newer');
  let now = await desktop.read();
  expect(now.projectId).toBe(id);
  expect(now.frames.map((f) => f.label)).toContain('MINE');

  say('the tablet renames a shot; the desktop starts again — this time the screen has to change');
  await tablet.openProject(id!);
  await tablet.settle();
  await tablet.renameFrame(3, 'FROM THE TABLET');
  await tablet.settle();
  await tablet.push();
  await tablet.settle();
  await desktop.reload();
  await desktop.settle();
  await desktop.startPullWithoutWaiting();
  await expect.poll(async () => (await desktop.read()).frames.map((f) => f.label).join('|'), { timeout: 60_000 }).toContain('FROM THE TABLET');
  const onScreen = await desktop.page.evaluate(() => document.body.innerText);
  expect(onScreen, 'THE NEW NAME IS DRAWN, not only held').toContain('FROM THE TABLET');
  log = (await desktop.log()).join('\n');
  expect(log, 'this time the start DID fetch — the server had something newer').toContain('pull: remote is newer');

  await desktop.close();
  await tablet.close();
});

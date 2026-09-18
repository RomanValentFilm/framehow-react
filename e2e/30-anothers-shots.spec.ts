// A SHOT STAYS IN THE PROJECT IT WAS BORN IN (#523).
//
// Roman, 18 September, the doubled "uboot". His iPad still held the shots of
// the project "uboot" when it saved what was on screen as a NEW project — also
// called "uboot". The server filed shots by their name alone, so the push of
// the new project MOVED the old one's shots across; the desktop, on the old
// one, pushed them back; the iPad moved them again, every ten seconds, for
// ever. The desktop showed shots twice, the iPad "rescued" 34 shots on every
// pull, and neither project was whole.
//
// The rule now: a shot found under another LIVE project is not touched by a
// push — not written, not deleted — and the pusher is told, so it drops the
// shot from the wrong project. Nothing is lost: the shot is exactly where it
// was, untouched.
//
// The simulator uses the app's own SAVE AS NEW path to get into the state —
// the same steps the deleted-project dialog takes.
//
//     npm run t -- -g "another project's shots"
//
// About two minutes.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

test("another project's shots: saved as new on top of them, the old project stays whole and nothing loops",
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);

    const jobA = await desktop.newProject('UBOOT', 6);
    await desktop.settle();
    await desktop.renameFrame(0, 'TOWER');
    await desktop.renameFrame(5, 'PERISCOPE');
    await desktop.push();
    await desktop.settle();
    await ipad.openProject(jobA!);
    await ipad.settle();
    const wanted = await Device.waitUntilTheyAgree(desktop, ipad);

    // ── THE IPAD SAVES WHAT IT HOLDS AS A NEW PROJECT ─────────────────────
    say('ipad: the same six shots, saved as a NEW project — the doubled uboot');
    const markPad = await ipad.mark();
    await ipad.saveAsNewProject('UBOOT');
    await ipad.settle();
    const jobB = (await ipad.read()).projectId;
    expect(jobB, 'the new project must exist').toBeTruthy();
    expect(jobB, 'and be a project of its own').not.toBe(jobA);

    // The server must have said so, and the iPad must have let them go.
    await ipad.waitForLogAfter(markPad, 'belong to ANOTHER project', 30_000);
    expect((await ipad.read()).frames.filter((f) => f.serverFrameId).length,
      "the old project's shots must have left the new one on the iPad").toBe(0);

    // ── THE OLD PROJECT IS UNTOUCHED ──────────────────────────────────────
    say('desktop: still on the old uboot — it must be exactly what it was');
    await desktop.nudge();
    await desktop.push();
    await desktop.settle();
    const deskNow = (await desktop.read()).frames.map((f) => f.label);
    expect(deskNow, 'the old project lost or doubled shots')
      .toEqual(['TOWER', '2', '3', '4', '5', 'PERISCOPE']);
    await desktop.expectNeverInLog('shots this device has not got yet');

    // ── NO LOOP ───────────────────────────────────────────────────────────
    // The fault's own signature: the iPad "rescued" the same shots on every
    // pull and sent them again ten seconds later. Left alone for a while, it
    // must not say so even once more.
    const markLoop = await ipad.mark();
    await ipad.nudge();
    await ipad.page.waitForTimeout(25_000);
    const after = await ipad.log();
    const rescuedBefore = markLoop.filter((l) => l.includes('rescued (answer left them out)')).length;
    const rescuedAfter = after.filter((l) => l.includes('rescued (answer left them out)')).length;
    expect(rescuedAfter - rescuedBefore, 'the iPad keeps rescuing shots that are not its own — the loop').toBe(0);

    // ── AND THE OLD PROJECT OPENS WHOLE ON THE IPAD AGAIN ─────────────────
    await ipad.openProject(jobA!);
    await ipad.settle();
    expect(await Device.waitUntilTheyAgree(desktop, ipad),
      'the old project must be whole on both devices').toBe(wanted);

    await desktop.close();
    await ipad.close();
  });

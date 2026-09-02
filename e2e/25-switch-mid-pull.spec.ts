// OPENING A PROJECT WHILE A FETCH IS IN THE AIR (#425).
//
// A pull works out which project it is for at the top, then waits on the
// network. Somebody can open another project during that wait — an ordinary
// thing to do, because a pull runs every few seconds. Nothing stopped the old
// answer from arriving afterwards and rebuilding the storyboard from the WRONG
// project, then marking the new project as saved under the old one's id.
//
// Same shape as the fault that put one project's frames into another (#417).
//
//     npm run t -- e2e/25-switch-mid-pull.spec.ts

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('an answer for the project you just left is not applied to the one you opened',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);

    say('desktop: two projects — BIG with five frames, SMALL with two');
    const big = await desktop.newProject('BIG', 5);
    await desktop.settle();
    const small = await desktop.newProject('SMALL', 2);
    await desktop.settle();

    // Something for BIG's fetch to actually bring back.
    say('tablet: adding a frame to BIG so its answer differs from what we hold');
    const tablet = await Device.open(browser, 'tablet', token);
    await tablet.openProject(big!);
    await tablet.settle();
    await tablet.newFrameAfter(0);
    await tablet.settle();
    await tablet.close();

    say('desktop: back into BIG');
    await desktop.openProject(big!);
    await desktop.settle();

    // THE RACE, made to happen rather than hoped for. BIG's answer is held
    // open for two seconds, so the switch to SMALL definitely lands first.
    say("desktop: holding BIG's answer open, then opening SMALL under it");
    await desktop.holdAnswerFor(big!, 2000);
    await desktop.startPullWithoutWaiting();
    await desktop.page.waitForTimeout(300);       // the request is out
    await desktop.holdNothing();                  // SMALL must load normally
    await desktop.openProject(small!);
    await desktop.page.waitForTimeout(2500);      // BIG's answer lands now
    await desktop.settle();

    const held = (await desktop.read()).frames.length;
    expect(held, 'SMALL SHOULD STILL HOLD ITS OWN TWO FRAMES — '
      + `it has ${held}, so BIG's answer was applied on top of it`).toBe(2);

    say('desktop: and BIG is untouched when we go back');
    await desktop.openProject(big!);
    await desktop.settle();
    expect((await desktop.read()).frames.length,
      'BIG still holds its six frames').toBe(6);

    await desktop.close();
  });

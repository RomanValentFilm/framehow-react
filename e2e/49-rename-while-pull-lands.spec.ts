// A TALENT RENAMED ON THE MAIN CARD WHILE A SYNC ANSWER LANDS (29 October,
// Roman: "when I change the name of a talent in FITTINGS I have to press it
// twice").
//
// #396 again, in the two spots it never reached: the name box on the MAIN
// VIEW card. The card object was found, then the box waited for the typing;
// meanwhile a pull replaced every card object, and the new name was written
// onto the discarded one — nothing on screen, nothing sent. In a fitting a
// pull follows every push, so the box was open during one most of the time.
//
// Here the box is opened, the other device renames something so a pull lands
// on top, and only then is the name typed and OK pressed. Once.
//
//     npm run t -- -g "pull lands"
//
// Up to five minutes (the devices take thirty-second turns).

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 400_000 });

// BOTH KINDS (Roman, 29 Oct: "when a main frame name/label changes it has to
// stick"). The main-view card is the same code in every project; a fitting
// only showed it first because there is more sync traffic there.
for (const kind of ['fitting', 'landscape'] as const) test(`${kind}: a name changed on the main card sticks when a pull lands while the box is open`, async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const id = await desktop.newProjectOfKind('RENAME TWICE', kind, 2);
  await tablet.openProject(id!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();
  await desktop.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));

  say(`desktop: opening the name box on the first ${kind === 'fitting' ? 'talent' : 'shot'}, and leaving it open`);
  await desktop.page.click('#mainScroll .frame-card [data-editlabel]');
  await desktop.page.waitForSelector('#labelModal:not(.hidden)');

  say('tablet: renaming the second one, so a pull lands on the desktop');
  await tablet.renameFrame(1, 'MEANWHILE');
  // One device awake at a time, as a person does (#496): the tablet to send,
  // the desktop to ask. A device nobody is looking at stays quiet.
  const deadline = Date.now() + 150_000;
  for (;;) {
    await Device.nudgeOneAtATime(tablet, desktop);
    const labels = (await desktop.read()).frames.map((f) => f.label);
    if (labels[1] === 'MEANWHILE') break;
    if (Date.now() > deadline) throw new Error(`the tablet's rename never reached the desktop: ${labels.join(', ')}`);
    await desktop.page.waitForTimeout(500);
  }
  await desktop.nudge();
  say('   the pull landed with the box still open');

  say('desktop: typing the new name and pressing OK — once');
  await desktop.page.fill('#labelModalInput', 'ANNA');
  await desktop.page.click('#labelOk');
  await desktop.page.waitForTimeout(800);

  const after = (await desktop.read()).frames.map((f) => f.label);
  say(`   the desktop's names: ${after.join(', ')}`);
  expect(after[0], 'THE NAME WENT ONTO A DISCARDED CARD OBJECT (#396 on the '
    + 'main view): the pull replaced the cards while the box was open, and the '
    + 'new name was written onto the old one. Roman had to rename twice.')
    .toBe('ANNA');

  say('tablet: waiting for ANNA');
  const until = Date.now() + 150_000;
  for (;;) {
    await Device.nudgeOneAtATime(desktop, tablet);
    const labels = (await tablet.read()).frames.map((f) => f.label);
    if (labels[0] === 'ANNA') break;
    if (Date.now() > until) throw new Error(`ANNA never reached the tablet: ${labels.join(', ')}`);
    await tablet.page.waitForTimeout(500);
  }

  await desktop.close();
  await tablet.close();
});

// A SCRIBBLE STROKE MUST NOT BE LOST TO A PUSH ALREADY IN THE AIR (#361).
//
// Roman: "when I'm in scribble mode and paint really quick… sometimes a stroke I
// draw disappears immediately after I make it. Is it because I draw too fast?"
//
// Yes, and here is why it needs speed. Every scribble stroke sends immediately,
// and a pull follows every push. A stroke made while a push is already on its way
// is not in that push. The pull comes back with the server's copy — which is
// newer, because our own push just wrote it — and the new stroke has no time of
// its own to argue with, because the scribble layer records THAT a frame changed
// but never WHEN. Drawing on a version records both. So the server's copy wins
// and the stroke is painted over.
//
// This draws several strokes in a row with no pause, which is the only way to get
// a stroke into that window.
//
//     npm run t -- -g "scribble"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('scribbling fast does not lose a stroke', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Fast pencil', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // The pencil only exists over the 3x2 page.
  await desktop.setView('grid3x2');
  await desktop.setScribbleMode(true);

  // One first, slowly, to prove the pencil works at all before anything is
  // claimed about losing strokes.
  const first = await desktop.scribble(0);
  expect(first, 'the pencil did not draw at all — nothing can be said about '
    + 'losing strokes until it does').toBeGreaterThan(0);
  await desktop.settle();
  await desktop.page.waitForTimeout(2000);

  // NOW AT THE SPEED OF A PERSON PAINTING QUICKLY.
  //
  // The first version of this test drew them with no pause at all, and passed —
  // because eight strokes in two milliseconds all land before a single push has
  // even started, so nothing is ever in the air. A hand is slower than that and
  // that is precisely what makes it dangerous: a few hundred milliseconds is
  // long enough for the push of one stroke to be on its way when the next is
  // made.
  // AND THE OTHER DEVICE IS ALIVE THROUGHOUT.
  //
  // The second version of this test had the tablet sitting idle, and passed —
  // because with nobody else working every pull comes back empty and leaves the
  // screen alone (#349). Nothing ever rebuilds, and it is the rebuild that
  // paints over things. On a real shoot both devices are in use.
  const tabletWorking = (async () => {
    for (let i = 0; i < 12; i++) {
      await tablet.writeUnder(1, `tablet keeps working ${i}`);
      await tablet.page.waitForTimeout(250);
    }
  })();

  say('desktop: a dozen strokes at the speed of a hand painting quickly');
  const HOW_MANY = 12;
  for (let i = 0; i < HOW_MANY; i++) {
    await desktop.scribble(0);
    await desktop.page.waitForTimeout(250);
  }
  await tabletWorking;

  const log = await desktop.log();
  const pushes = log.filter((l) => l.includes('push start')).length;
  const rebuilds = log.filter((l) => l.includes('arrangement arrived')).length;
  expect(pushes, 'no push ever started, so no stroke could have been made while '
    + 'one was in the air — this test proves nothing as written').toBeGreaterThan(2);
  expect(rebuilds, 'nothing was ever rebuilt from the server during the drawing, '
    + 'so the dangerous moment never happened — this test proves nothing as '
    + 'written').toBeGreaterThan(1);

  const madeAltogether = first + HOW_MANY;
  expect(await desktop.scribbleCount(0), 'the strokes did not even reach the '
    + 'frame — this is not about syncing').toBe(madeAltogether);

  // Let everything settle: pushes finish, pulls arrive, the dust lands.
  await desktop.settle();
  for (let i = 0; i < 20; i++) { await desktop.nudge(); await desktop.page.waitForTimeout(500); }

  expect(await desktop.scribbleCount(0), `STROKES WERE LOST. ${madeAltogether} `
    + `were drawn and the frame no longer holds them all. A stroke made while a `
    + `push was in the air was painted over by the pull that followed it.`)
    .toBe(madeAltogether);

  // And they must reach the other device too.
  say('tablet: waiting for all of them to arrive');
  const deadline = Date.now() + 60_000;
  for (;;) {
    await tablet.nudge();
    const n = await tablet.scribbleCount(0);
    if (n === madeAltogether) break;
    if (Date.now() > deadline) {
      throw new Error(`the tablet has ${n} scribble stroke(s) of ${madeAltogether}`);
    }
    await tablet.page.waitForTimeout(1000);
  }

  await desktop.close();
  await tablet.close();
});

// ---------------------------------------------------------------------------
// A QUICK LITTLE MARK IS STILL A MARK (#361)
// ---------------------------------------------------------------------------
//
// Roman's own guess, and a better one than mine: "could it have something to do
// with what we introduced for drawing a dot?"
//
// When the pen comes up, the app decides whether that was a TAP or a LINE. A tap
// becomes a dot. The test it uses is: under 400 milliseconds, and never more than
// thirty pixels FROM WHERE IT STARTED — not the length of the line drawn, but how
// far it ever got from the beginning.
//
// So a quick small mark — a tick, a tiny circle, a short dash, anything that
// comes back near where it began — is called a tap. The line is thrown away and
// a dot is put at the start point. That is a stroke disappearing the instant it
// is made, and only when you are quick.
test('a quick little tick stays a tick, and does not become a dot', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('Quick marks', 3);
  await desktop.settle();
  await desktop.setView('grid3x2');
  await desktop.setScribbleMode(true);

  say('desktop: one quick tick with a finger');
  await desktop.scribbleQuickTick(0);

  expect(await desktop.scribbleCount(0), 'nothing was drawn at all').toBeGreaterThan(0);
  const span = await desktop.lastScribbleSpan(0);
  expect(span, 'THE TICK BECAME A DOT. The mark was thrown away and a single '
    + 'point put where it started, because it was quick and never got far from '
    + 'its beginning. On screen that is a stroke vanishing the moment it is made.')
    .toBeGreaterThan(0);

  await desktop.close();
});

// ---------------------------------------------------------------------------
// THE PAGE MUST NOT BE PULLED OUT FROM UNDER THE PEN (#362)
// ---------------------------------------------------------------------------
//
// The other candidate, still worth settling. Every time the 3x2 page is drawn,
// the app throws the whole scribble layer away and makes a new one. And unlike
// drawing on a version, the scribble layer never says that a stroke is in
// progress — nothing in the app knows the pen is down.
//
// So this puts the pen down, lets the other device's work arrive and rebuild the
// page, and only then lifts it.
// Held back three times while the fix was wrong. Roman's rule is the right one
// and it is now in: while a hand is on the page, the app does not FETCH — the
// earlier attempts all held back the REDRAW, which tears the screen. Holding the
// fetch costs nothing; the work is still on the server and lands a moment later.
test('a stroke survives the page being redrawn under it', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Pen down', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  await desktop.setView('grid3x2');
  await desktop.setScribbleMode(true);
  const before = await desktop.scribbleCount(0);

  say('desktop: pen down, and left down');
  await desktop.scribbleStart(0);

  // The other device works, so a pull with real content arrives and the page is
  // rebuilt — with the pen still down.
  const mark = await desktop.mark();
  await tablet.writeUnder(1, 'the tablet writes mid-stroke');
  await tablet.settle();
  await desktop.waitForLogAfter(mark, 'arrangement arrived', 40_000);

  say('desktop: pen up, on whatever layer is there now');
  const after = await desktop.scribbleEnd(0);

  expect(after, 'THE STROKE WAS LOST WITH THE PAGE. The pen was down when a sync '
    + 'redrew the 3x2 page; the app threw the scribble layer away and made a new '
    + 'one, and the half-made stroke went with it.').toBe(before + 1);

  await desktop.close();
  await tablet.close();
});

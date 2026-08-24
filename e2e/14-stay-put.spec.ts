// THE PAGE STAYS WHERE YOU PUT IT (#363).
//
// Roman: "when taking a photo in 3x2 the fullscreen returns to that frame and
// pushes/scrolls the frame to the middle… also in the strip views. Also when I
// draw to the pictures, then they jump/scroll to the middle of the screen."
//
// Two separate causes, and neither is the photo or the drawing:
//
//   - the arrows and the cross-swipe scroll the card to the centre after every
//     render, on purpose, added deliberately at some point
//   - and after a sync, the app puts you back by CENTRING the frame you were
//     nearest. It measures where that frame actually was on your screen before
//     the rebuild, and then throws the measurement away and centres it. A photo
//     causes a push and a pull, so the page moves a moment after the picture
//     lands — which looks exactly like the photo did it.
//
//     npm run t -- -g "stays where"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

// NOT RUNNING. WebKit will not let a test build a touch out of nothing — "Illegal
// constructor" — and the cross-swipe listens for touches only. Left here because
// the rule is right and worth having the day we can drive a real finger. Roman
// reports the arrows in 3x2 behave, so this is not currently biting.
test.fixme('a swipe on the picture does not move the page', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  // Enough frames that there is somewhere to scroll to.
  await desktop.newProject('Stay put', 12);
  await desktop.settle();

  // Down the page a little, as a person reading their storyboard would be.
  await desktop.scrollTo(600);
  const before = await desktop.scrollPosition();
  expect(before, 'the page would not scroll at all, so this test cannot see '
    + 'whether anything moves it').toBeGreaterThan(100);

  say('desktop: swiping across a card to show its version');
  await desktop.swipeCard(4);
  await desktop.page.waitForTimeout(1200);

  const after = await desktop.scrollPosition();
  expect(Math.abs(after - before), `THE PAGE MOVED. It was at ${before} and is `
    + `now at ${after}. A swipe on the picture is not a request to go anywhere.`)
    .toBeLessThan(20);

  await desktop.close();
});

// ROMAN'S ACTUAL CASE: in 3x2, scrolled down the page, and the change is HIS —
// a photo or a drawing on a card. The first version of this test used the
// columns view and had the OTHER device make the change, and it passed. Which
// proved nothing about what he was describing.
test('a photo in 3x2 does not move the page', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('Stay put in 3x2', 12);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  await desktop.setView('grid3x2');
  await desktop.page.waitForTimeout(500);

  // Deliberately NOT centred on anything: partway down, where a person's page
  // usually is.
  await desktop.scrollTo(730);
  const before = await desktop.scrollPosition();
  say(`  the thing that scrolls here is: ${await desktop.scrollerName()}`);
  expect(before, 'the page would not scroll at all, so this test cannot see '
    + 'whether anything moves it').toBeGreaterThan(100);

  say('desktop: a picture lands on a card, which pushes and then pulls');
  await desktop.putPicture(5, RED_SQUARE);

  // MEASURED TWICE, on purpose. The first two attempts at this blamed the sync,
  // fixed the sync, and the page still moved by exactly the same 119 pixels —
  // because it had already moved when the card was redrawn, before any sync
  // started. So: once straight after the redraw, once after the sync.
  await desktop.page.waitForTimeout(400);
  const afterRedraw = await desktop.scrollPosition();
  say(`  page was at ${before}, after the redraw it is at ${afterRedraw}`);

  await desktop.settle();

  // The push, and the pull that follows it. That is the moment the page moves.
  const mark = await desktop.mark();
  await desktop.waitForLogAfter(mark, 'push OK', 40_000).catch(() => {});
  await desktop.page.waitForTimeout(2500);

  const after = await desktop.scrollPosition();
  const whoMoved = (await desktop.log()).filter((l) => l.includes('scroll:'));
  expect(Math.abs(after - before), `THE PAGE MOVED AFTER THE PHOTO. It was at `
    + `${before}, at ${afterRedraw} once the card had been redrawn, and is now `
    + `at ${after}.\n  If it had already moved by the redraw, the sync is `
    + `innocent and the redraw is the culprit.\n  Who moved it:\n`
    + (whoMoved.length ? whoMoved.map((l) => '    ' + l).join('\n')
      : '    nobody said they did — so it was not one of the anchoring calls'))
    .toBeLessThan(40);

  await desktop.close();
  await tablet.close();
});

const RED_SQUARE = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

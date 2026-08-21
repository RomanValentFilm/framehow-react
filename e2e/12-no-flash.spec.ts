// THE PICTURES MUST NOT BLINK (#360).
//
// Roman: "what's annoying is a short flashing of the app… I assume the short
// flashing of all content is that the app reloads all content after each sync?"
//
// He assumed the sync. It was not the sync. Every picture was decoded from
// scratch each time a card was drawn: the canvas was wiped straight away and
// painted only once the picture had finished decoding. A sync redraws every card
// at once, so all of them went blank together for a moment.
//
// This watches one card closely while the other device's work arrives, and fails
// if it is ever caught showing nothing.
//
//     npm run t -- -g "blink"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

// A real 64x64 picture in Framehow red. Made properly rather than typed from
// memory: the first version of this test had a base64 string I wrote by hand,
// which was not a valid picture at all, so nothing ever appeared and the test
// blamed the app for it twice.
const RED_SQUARE = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

test('a card never blinks blank while a sync goes through', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  const madeId = await desktop.newProject('No flashing', 3);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  await desktop.setView('grid3x2');
  await desktop.putPicture(0, RED_SQUARE);
  await desktop.settle();

  // Give the picture its one honest chance to decode. After this it must never
  // be decoded from scratch again on this device.
  await desktop.page.waitForTimeout(1500);
  expect(await desktop.cardIsBlank(0), 'the picture never appeared at all — this '
    + 'test cannot say anything about flashing until it does').toBe(false);

  // Now make the other device work, so real pulls keep arriving and the desktop
  // keeps redrawing. This is the moment Roman is describing.
  say('tablet: working, while the desktop is watched for blank moments');
  const watching = (async () => {
    const until = Date.now() + 12_000;
    let blanks = 0;
    while (Date.now() < until) {
      if (await desktop.cardIsBlank(0)) blanks++;
      await desktop.page.waitForTimeout(40);
    }
    return blanks;
  })();

  for (let i = 0; i < 6; i++) {
    await tablet.writeUnder(1, `the tablet at step ${i}`);
    await tablet.settle();
    await tablet.page.waitForTimeout(800);
    await desktop.nudge();
  }

  const blanks = await watching;
  expect(blanks, `THE CARD WENT BLANK ${blanks} time(s) while syncs were going `
    + `through. That is the flashing: the picture is thrown away and decoded `
    + `again on every redraw.`).toBe(0);

  await desktop.close();
  await tablet.close();
});

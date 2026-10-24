// MAX SCREEN (23 October, Roman).
//
// A half-transparent double-arrow on every picture; tap → the picture fills the
// screen (long side at the edge), with a close button top right; arrows / a
// swipe go through the versions of that look; a preview only.
//
//     npm run t -- -g "max screen"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

const RED_SQUARE = 'data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

test.describe.configure({ timeout: 180_000 });

test('max screen: button only on pictures, fits the screen, steps through the versions, closes', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProject('MAX SCREEN', 2);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click();
    await d.page.waitForTimeout(300);
  }
  await d.showStrip('ver');

  say('no pictures yet: no corner button anywhere');
  expect(await d.page.locator('.max-btn').count(), 'no button without a picture').toBe(0);

  say('a picture on the main card of shot 1, drawings on two VERSN versions of shot 1');
  await d.putPicture(0, RED_SQUARE);
  expect(await d.draw(0, 'ver', 0)).toBe(1);
  await d.pressNewVersion(0, 'ver');
  expect(await d.draw(0, 'ver', 1)).toBe(1);
  await d.page.waitForTimeout(500);
  const buttons = await d.page.locator('.max-btn').count();
  say(`   corner buttons now: ${buttons}`);
  expect(buttons, 'a button on each card that has something to show').toBeGreaterThanOrEqual(2);

  say('tap the button on shot 1 VERSN');
  await d.page.locator('.frame-card[data-vfid] .max-btn').first().click({ force: true });
  const view = d.page.locator('#maxView');
  await expect(view, 'the viewer is up').toBeVisible();
  const vp = d.page.viewportSize()!;
  const box = (await d.page.locator('#maxView canvas').boundingBox())!;
  say(`   picture ${Math.round(box.width)} × ${Math.round(box.height)} on a ${vp.width} × ${vp.height} screen`);
  const longSideFits = Math.abs(box.width - vp.width) <= 2 || Math.abs(box.height - vp.height) <= 2;
  expect(longSideFits, 'the long side touches the screen edge').toBe(true);
  expect(box.width <= vp.width + 2 && box.height <= vp.height + 2, 'and nothing sticks out').toBe(true);

  say('the label says which of the versions it is; the arrow keys step through them');
  const label = d.page.locator('#maxView .max-label');
  const first = await label.textContent();
  say(`   showing: ${first}`);
  expect(first, 'two versions to step through').toMatch(/[12] \/ 2/);
  // It opens on the version the card shows — the newest, so step LEFT (run 404
  // pressed → on the last one and nothing could change).
  const atLast = /2 \/ 2/.test(first || '');
  await d.page.keyboard.press(atLast ? 'ArrowLeft' : 'ArrowRight');
  await d.page.waitForTimeout(200);
  const second = await label.textContent();
  say(`   after ${atLast ? '←' : '→'}: ${second}`);
  expect(second, 'the other version').not.toBe(first);

  say('close with the double-arrow top right — and nothing in the project changed');
  const before = await d.read();
  await d.page.locator('#maxView .max-close').click();
  await expect(view).toBeHidden();
  expect((await d.read()).unsent, 'a preview sends nothing').toEqual(before.unsent);

  await d.close();
});

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
  // A card still in draw mode hides its button on purpose — take a visible one.
  await d.page.locator('.frame-card[data-vfid] .max-btn:visible').first().click();
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
  expect(first, 'the version\'s own label, nothing else (Roman, 24 Oct)').toMatch(/^v[12]$/);
  // It opens on the version the card shows — the newest, so step LEFT (run 404
  // pressed → on the last one and nothing could change).
  const atLast = first === 'v2';
  // The side arrow, as a user presses it (26 Oct) — not the key.
  await d.page.locator(atLast ? '#maxView .max-prev' : '#maxView .max-next').click();
  await d.page.waitForTimeout(200);
  const second = await label.textContent();
  say(`   after ${atLast ? '←' : '→'}: ${second}`);
  expect(second, 'the other version').not.toBe(first);

  say('desktop: DOWNLOAD and COPY top left; download gives a real JPEG named after the project and the shot (26 Oct)');
  await expect(d.page.locator('#maxView .max-share'), 'two buttons on a desktop').toHaveCount(2);
  const [dl] = await Promise.all([d.page.waitForEvent('download'), d.page.locator('#maxView .max-share[title="Download"]').click()]);
  const path = await dl.path();
  const bytes = path ? (await import('fs')).readFileSync(path) : Buffer.alloc(0);
  say(`   downloaded "${dl.suggestedFilename()}", ${Math.round(bytes.length / 1024)} KB`);
  expect(dl.suggestedFilename(), 'named after the project and the shot').toMatch(/^MAX SCREEN – shot 1 – v[12]\.jpg$/);
  expect(bytes[0] === 0xff && bytes[1] === 0xd8, 'a JPEG').toBe(true);
  expect(bytes.length, 'with the picture in it').toBeGreaterThan(3000);

  say('close with the double-arrow top right — nothing in the project changed, but the card now shows the one we left on (Roman, 24 Oct)');
  const before = await d.read();
  await d.page.locator('#maxView .max-close').click();
  await expect(view).toBeHidden();
  expect((await d.read()).unsent, 'a preview sends nothing').toEqual(before.unsent);
  await d.page.waitForTimeout(300);
  await d.page.locator('.frame-card[data-vfid] .max-btn:visible').first().click();
  await expect(view).toBeVisible();
  const again = await label.textContent();
  say(`   opened again on: ${again}`);
  expect(again, 'the card followed the viewer').toBe(second);
  await d.page.locator('#maxView .max-close').click();
  await expect(view).toBeHidden();

  await d.close();
});

test('max screen: a main card showing a version opens on that version, not on main (iPhone, 24 Oct)', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProject('MAX MAIN', 2);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click();
    await d.page.waitForTimeout(300);
  }
  say('a picture on main of shot 1, a drawing on its VERSN v1; then MAIN alone, like the phone');
  await d.putPicture(0, RED_SQUARE);
  await d.showStrip('ver');
  expect(await d.draw(0, 'ver', 0)).toBe(1);
  await d.showStrip('main');
  // The version column is still open; press its button again to close it, so
  // SHOT stands alone — the phone's view. (Run 410: two columns, no arrows.)
  await d.page.locator('.strip-toggle[data-strip="ver"]').click();
  await d.page.waitForTimeout(600);
  expect(await d.page.locator('#mainScroll .frame-card[data-mfid]').count(), 'main column there').toBeGreaterThan(0);
  expect(await d.page.locator('.frame-card[data-vfid]:visible').count(), 'version column gone').toBe(0);

  say('the main card\'s › arrow: the card now shows v1 in main\'s place');
  const card = d.page.locator('#mainScroll .frame-card[data-mfid]').first();
  await card.locator('.nav-arrow-right').click();
  await d.page.waitForTimeout(400);

  say('press max screen on it');
  await card.locator('.max-btn:visible').click();
  const view = d.page.locator('#maxView');
  await expect(view).toBeVisible();
  const label = d.page.locator('#maxView .max-label');
  const first = await label.textContent();
  say(`   showing: ${first}`);
  expect(first, 'the picture that was pressed — v1, not main').toBe('v1');

  say('← to main, close: the card is back on main (its arrow is › only)');
  await d.page.keyboard.press('ArrowLeft');
  await d.page.waitForTimeout(200);
  await d.page.locator('#maxView .max-close').click();
  await expect(view).toBeHidden();
  await d.page.waitForTimeout(300);
  expect(await card.locator('.nav-arrow-left').count(), 'no ‹ arrow: the card shows main again').toBe(0);
  await d.close();
});

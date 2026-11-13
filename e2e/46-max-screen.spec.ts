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

// STORY GRID, STEP 1 (Roman, 12 November): "when we are in the max screen, we
// can swipe left, right … if we would add arrows up and down, we could easily
// swap to the next main shot below. … You land on the shot, next shot. Not any
// version. And in a group, you land in a next shot in a group."
//
// THE RULES IT HOLDS TO
//   · down = the next shot, up = the one before; the viewer stays open
//   · you land on the shot's own (main) picture, even if you left the last one on a version
//   · a shot with nothing to show is passed over
//   · the up arrow is not there on the first shot, the down arrow not on the last
//   · left and right still step through the versions of the shot you are on
test('max screen: up and down go to the shot before and after, landing on the shot itself', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProject('UP AND DOWN', 4);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click();
    await d.page.waitForTimeout(300);
  }
  await d.showStrip('ver');

  say('pictures on shots 1, 2 and 4 — shot 3 stays empty; shot 1 also gets a drawn version');
  await d.putPicture(0, RED_SQUARE);
  await d.putPicture(1, RED_SQUARE);
  await d.putPicture(3, RED_SQUARE);
  expect(await d.draw(0, 'ver', 0)).toBe(1);
  await d.page.waitForTimeout(600);
  const labels = (await d.read()).frames.map((f) => f.label);
  say(`   the shots: ${labels.join(', ')}`);

  say('open the viewer on shot 1 (its main card)');
  await d.page.locator('#mainScroll .frame-card[data-mfid] .max-btn:visible').first().click();
  const view = d.page.locator('#maxView');
  await expect(view, 'the viewer is up').toBeVisible();
  const label = d.page.locator('#maxView .max-label');
  await expect(label, 'it shows shot 1').toHaveText(labels[0]);
  await expect(d.page.locator('#maxView .max-up'), 'no way up from the first shot').toBeHidden();
  await expect(d.page.locator('#maxView .max-down'), 'a way down').toBeVisible();

  say('the right and left KEYS step through the versions of shot 1, as ever');
  await d.page.keyboard.press('ArrowRight');
  await expect(label, 'the right key: a version of shot 1').toHaveText(/^v\d+$/);
  await d.page.keyboard.press('ArrowLeft');
  await expect(label, 'the left key: back on shot 1 itself').toHaveText(labels[0]);

  say('right: a version of shot 1. Then down — shot 2, its own picture, not a version');
  await d.page.locator('#maxView .max-next').click();
  await expect(label, 'a version of shot 1').toHaveText(/^v\d+$/);
  await d.page.keyboard.press('ArrowDown');
  await expect(label, 'DOWN LANDS ON SHOT 2 ITSELF').toHaveText(labels[1]);
  await expect(view, 'the viewer stayed open').toBeVisible();
  await expect(d.page.locator('#maxView .max-up'), 'a way up now').toBeVisible();

  say('down again, by its arrow: shot 3 has nothing to show and is passed over');
  // (the simulator keeps the log open along the bottom edge, over this arrow —
  // a person has no log there; the press goes to the button itself)
  await d.page.locator('#maxView .max-down').dispatchEvent('click');
  await expect(label, 'shot 4').toHaveText(labels[3]);
  await expect(d.page.locator('#maxView .max-down'), 'no way down from the last shot').toBeHidden();

  say('up: back on shot 2');
  await d.page.keyboard.press('ArrowUp');
  await expect(label, 'shot 2 again').toHaveText(labels[1]);

  say('close: the app is as it was, nothing changed in the project');
  await d.page.locator('#maxView .max-close').click();
  await expect(view).toHaveCount(0);
  expect((await d.read()).frames.map((f) => f.label), 'the shots are the same').toEqual(labels);
  const log = (await d.log()).join('\n');
  expect(log, 'the log says where it went').toMatch(/max screen: down to shot 2/);
  await d.close();
});

// IN THE 3×2 VIEW TOO (13 Nov, Roman's iPad: "not working, no arrows there" —
// and after closing, a card with two and three rows of buttons).
test('max screen in 3×2: up and down work, and closing leaves every card as one card', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProject('UP AND DOWN 3X2', 3);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click();
    await d.page.waitForTimeout(300);
  }
  await d.putPicture(0, RED_SQUARE);
  await d.putPicture(1, RED_SQUARE);
  await d.showStrip('ver');
  expect(await d.draw(0, 'ver', 0)).toBe(1);
  await d.setView('grid3x2');
  await d.page.waitForTimeout(600);
  const labels = (await d.read()).frames.map((f) => f.label);
  const cardsInside = () => d.page.evaluate(() =>
    Array.from(document.querySelectorAll('#overviewScroll .grid3x2-card-wrap')).map((w) => w.querySelectorAll('.frame-card').length));
  expect(await cardsInside(), 'one card in each place, before').toEqual([1, 1, 1]);

  say('3×2: open shot 1, down to shot 2, back up, right to a version, close');
  await d.page.locator('#overviewScroll .grid3x2-card-wrap .max-btn:visible').first().click();
  const label = d.page.locator('#maxView .max-label');
  await expect(label).toHaveText(labels[0]);
  await expect(d.page.locator('#maxView .max-down'), 'A WAY DOWN IN 3×2').toBeVisible();
  await d.page.keyboard.press('ArrowDown');
  await expect(label, 'down: shot 2').toHaveText(labels[1]);
  await d.page.keyboard.press('ArrowUp');
  await expect(label, 'up: shot 1 again').toHaveText(labels[0]);
  await d.page.keyboard.press('ArrowRight');
  await expect(label, 'a version of shot 1').toHaveText(/^v\d+$/);
  await d.page.locator('#maxView .max-close').click();
  await expect(d.page.locator('#maxView')).toHaveCount(0);
  await d.page.waitForTimeout(400);
  expect(await cardsInside(), 'ONE CARD IN EACH PLACE AFTER CLOSING — not a card inside a card').toEqual([1, 1, 1]);
  await d.close();
});


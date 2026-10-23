// THE ARROWS LEAVE THE PAGE WHERE IT IS (23 October, Roman, fitting).
//
// "When I click on the arrows to move through the versions, the page jumps a
// bit down by each click… the pictures/page is slowly moving." Every tap "put
// the card back where it was" — measured from the top of the screen, placed
// from under the bars — so each tap moved the page by the bars' height.
// Roman: "it should just not go back but stay where it is."
//
// Taps the real arrow button on a card in the middle of the page, five times,
// and asks where that card sits on the screen after each tap.
//
//     npm run t -- -g "arrows leave"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

test('fitting: the version arrows leave the page where it is', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProjectOfKind('ARROWS STAY', 'fitting', 8);
  await desktop.settle();
  say('four looks on shot 4, so there is somewhere to go with the arrows');
  for (let i = 0; i < 3; i++) await desktop.pressNewVersion(3, 'ver');
  await desktop.page.waitForTimeout(400);
  say(`   the view: ${await desktop.page.evaluate(() =>
    (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode())}`);

  // The card of shot 4 with arrows on it, wherever this view puts it (run 391:
  // the newest look is the one showing, so only the LEFT arrow is there — the
  // test waited for a right one that never came).
  // A fresh account opens on the "Open project" list; a person closes it (run 393:
  // it lay over the card and took the tap).
  if (await desktop.page.locator('#projectListModal').isVisible()) {
    await desktop.page.locator('#projectListClose').click();
    await desktop.page.waitForTimeout(300);
  }
  const card = desktop.page.locator('.frame-card:has(.nav-arrow)').nth(0);
  await card.scrollIntoViewIfNeeded({ timeout: 10_000 });
  // The card a third of the way down the screen, as a person reading would have
  // it — clear of the bars at the top and of the sync log at the bottom (run 393:
  // it sat at -21 px, under the bars).
  {
    const box = (await card.boundingBox())!;
    await desktop.scrollTo((await desktop.scrollPosition()) + Math.round(box.y - 250));
    await desktop.page.waitForTimeout(400);
  }
  const topOf = async () => Math.round((await card.boundingBox())!.y);
  const start = await topOf();
  say(`   the card sits at ${start} px from the top of the screen`);

  for (let tap = 1; tap <= 5; tap++) {
    // Whichever way there is still somewhere to go: left first, then back right.
    const left = card.locator('.nav-arrow-left'), right = card.locator('.nav-arrow-right');
    const goLeft = (await left.count()) > 0 && (tap <= 3 || (await right.count()) === 0);
    say(`   tap ${tap}: ${goLeft ? '‹' : '›'}`);
    await (goLeft ? left : right).click({ timeout: 5_000 });
    await desktop.page.waitForTimeout(350);
    const now = await topOf();
    say(`   tap ${tap}: the card sits at ${now} px`);
    expect(Math.abs(now - start), `THE PAGE MOVED by ${now - start} px on tap ${tap} (Roman, 23 Oct)`).toBeLessThanOrEqual(2);
  }

  await desktop.close();
});

// THE STAR IN THE 3x2 VIEW (12 October, Roman).
//
// Three versions on a shot, looking at v3 in the 3x2 view, star it: it moves
// to the front as designed — but the card kept showing POSITION 3, which was
// now the old v2's picture. The strip views were fine: they read the strip's
// own pointer, which the star moves. The 3x2 card reads the cross-swipe
// pointer, which the star never moved. Now one function moves both — for the
// star, the ◀ ▶ arrows and HIDE.
//
//     npm run t -- -g "star in 3x2"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

test('star in 3x2: the card keeps showing the version you starred, and the arrows and HIDE follow too', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  await desktop.newProject('STAR IN 3x2', 1);
  await desktop.settle();

  say('three versions on shot 1, made on the strip card');
  await desktop.pressNewVersion(0, 'ver');
  await desktop.pressNewVersion(0, 'ver');
  expect(await desktop.versionLabels(0, 'ver')).toEqual(['v1', 'v2', 'v3']);

  say('3x2 view; a stroke on the THIRD so it can be told apart — the card then shows v3');
  await desktop.setView('grid3x2');
  await desktop.page.waitForTimeout(400);
  expect(await desktop.draw(0, 'ver', 2), 'one stroke on v3').toBe(1);
  expect(await desktop.cardShowing(0), 'after drawing, the 3x2 card shows v3').toBe('ver 3');

  say('star v3 on the 3x2 card — it moves to the front, and the card must go with it');
  await desktop.pressStar(0, 'ver', 2);
  await desktop.page.waitForTimeout(400);
  expect(await desktop.strokes(0, 'ver', 0), 'the drawn version is now FIRST').toBe(1);
  expect(await desktop.cardShowing(0),
    'THE CARD STAYED ON POSITION 3 — which is now somebody else\'s picture (Roman, 12 Oct)').toBe('ver 1');
  const activeTab = await desktop.page.locator('.grid3x2-card-wrap .vtab.active').first().innerText();
  expect(activeTab.trim(), 'and the lit tab on the card is v1').toBe('v1');

  say('▶ moves it one place right — the card follows');
  await desktop.moveVersion(0, 'ver', 0, 'right');
  await desktop.page.waitForTimeout(300);
  expect(await desktop.strokes(0, 'ver', 1), 'the drawn version is second now').toBe(1);
  expect(await desktop.cardShowing(0), 'the card follows the arrow').toBe('ver 2');

  say('HIDE on the 3x2 card — the card lands on the first visible version');
  await desktop.page.evaluate(async () => {
    const btn = document.querySelector('.grid3x2-card-wrap .act-btn[data-action="clear"]') as HTMLElement | null;
    if (!btn) throw new Error('no HIDE button on the 3x2 card');
    btn.click();
    await new Promise((r) => setTimeout(r, 200));
    const hide = document.querySelector('#choiceContent [data-choice="hide"]') as HTMLElement | null;
    const ok = document.getElementById('choiceOk3');
    if (!hide || !ok) throw new Error('the hide/delete choice did not open');
    hide.click();
    ok.click();
    await new Promise((r) => setTimeout(r, 200));
  });
  await desktop.page.waitForTimeout(400);
  const labels = await desktop.versionLabels(0, 'ver');
  say(`   versions now: ${labels.join(' · ')}`);
  expect(labels, 'the drawn one is hidden, at the back').toEqual(['v1', 'v2', 'h1']);
  expect(await desktop.cardShowing(0), 'the card points at the first visible version').toBe('ver 1');

  await desktop.close();
});

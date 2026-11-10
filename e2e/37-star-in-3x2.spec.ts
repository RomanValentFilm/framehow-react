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

  // STARS DECIDE THE GROUP, THE ARROWS THE ORDER INSIDE IT (Roman, 10 Nov):
  // the starred one cannot be moved behind an unstarred one; an unstarred one
  // moves among the unstarred, and the card follows the arrow.
  say('▶ on the starred version is refused — it stays first');
  const refused = await desktop.moveVersion(0, 'ver', 0, 'right').then(() => false, () => true);
  expect(refused, 'a starred version cannot be moved behind an unstarred one').toBe(true);
  expect(await desktop.strokes(0, 'ver', 0), 'the drawn, starred version is still first').toBe(1);

  say('▶ moves an unstarred one a place right — the card follows');
  await desktop.moveVersion(0, 'ver', 1, 'right');
  await desktop.page.waitForTimeout(300);
  expect(await desktop.cardShowing(0), 'the card follows the arrow').toBe('ver 3');
  expect(await desktop.strokes(0, 'ver', 0), 'the starred one has not moved').toBe(1);

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
  expect(labels, 'the one on show is hidden, at the back').toEqual(['v1', 'v2', 'h1']);
  expect(await desktop.strokes(0, 'ver', 0), 'the starred one is still first').toBe(1);
  expect(await desktop.cardShowing(0), 'the card points at the first visible version').toBe('ver 1');

  await desktop.close();
});

// THREE STARS IN EVERY PROJECT (Roman, 10 November). The rating fitting had is
// everywhere: a row in a horizontal project (first star on the left), a column
// in an upright one. Most stars first; pressing the level a version is on
// clears it.
//
//     npm run t -- -g "three stars"
test('three stars in a horizontal project: a row of three, the level pressed is the rating, most stars first', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  await desktop.newProject('THREE STARS', 1);
  await desktop.settle();
  await desktop.pressNewVersion(0, 'ver');
  await desktop.pressNewVersion(0, 'ver');
  expect(await desktop.draw(0, 'ver', 1), 'one stroke on v2').toBe(1);
  await desktop.draw(0, 'ver', 2);
  await desktop.draw(0, 'ver', 2);
  expect(await desktop.draw(0, 'ver', 2), 'three strokes on v3 — it is the one on show').toBe(3);

  const pressLevel = (vi: number, level: number) => desktop.page.evaluate(([v, l]) => {
    const el = document.querySelector(`.star-btn[data-starvi="${v}"][data-starstrip="ver"] [data-starlevel="${l}"]`) as HTMLElement | null;
    if (!el) throw new Error(`no star level ${l} on version ${v + 1}`);
    el.click();
  }, [vi, level]);
  const ratings = async () => (JSON.parse(await desktop.whole()) as { shots: Array<{ versions: Record<string, Array<{ stars: number; strokes: number }>> }> })
    .shots[0].versions.ver.map((v) => `${v.stars}★/${v.strokes}`);

  say('the star icon is a ROW of three, the first on the left');
  const shape = await desktop.page.evaluate(() => {
    const b = document.querySelector('.star-btn[data-starstrip="ver"]') as HTMLElement;
    const lv = Array.from(b.querySelectorAll('[data-starlevel]')) as HTMLElement[];
    return { row: b.classList.contains('star-row'), levels: lv.map((e) => e.dataset.starlevel), xs: lv.map((e) => Math.round(e.getBoundingClientRect().left)) };
  });
  expect(shape.row, 'a row in a horizontal project').toBe(true);
  expect(shape.levels).toEqual(['1', '2', '3']);
  expect(shape.xs[0] < shape.xs[1] && shape.xs[1] < shape.xs[2], 'left to right').toBe(true);

  say('v3 (three strokes) gets 3 stars — it goes first, and the card follows it');
  await pressLevel(2, 3);
  await desktop.page.waitForTimeout(300);
  expect(await ratings()).toEqual(['3★/3', '0★/0', '0★/1']);

  say('◀ moves the one with one stroke in front of the other unrated one (same group) — then it gets 2 stars');
  await desktop.moveVersion(0, 'ver', 2, 'left');
  await desktop.page.waitForTimeout(300);
  expect(await ratings()).toEqual(['3★/3', '0★/1', '0★/0']);
  await pressLevel(1, 2);
  await desktop.page.waitForTimeout(300);
  expect(await ratings()).toEqual(['3★/3', '2★/1', '0★/0']);

  say('pressing the level it is on clears it — it stays in front of the other unrated one');
  await pressLevel(1, 2);
  await desktop.page.waitForTimeout(300);
  expect(await ratings()).toEqual(['3★/3', '0★/1', '0★/0']);

  say('the arrows stay inside a star group: the 3★ cannot go behind an unrated one');
  const refused = await desktop.moveVersion(0, 'ver', 0, 'right').then(() => false, () => true);
  expect(refused).toBe(true);
  await desktop.settle();
  await desktop.close();
});

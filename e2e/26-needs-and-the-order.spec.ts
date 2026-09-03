// THE SHOOTING ORDER AND THE NEEDS — TODAY'S RULES, END TO END (#435).
//
// Everything above this file tests the decision on the bench, in a second. This
// one drives the real app: real needs cards, the real bracket, the real SORT
// NOW, the real arrows and DONE — and then goes round the loop again and again,
// because almost every fault we found today only appeared on the SECOND or
// THIRD visit to an order.
//
// THE RULES IT HOLDS TO
//   · a shot whose BOX changed joins that box in storyboard order, and is
//     marked green — card and icon — until DONE
//   · nothing else moves, ever
//   · a shot dragged out of its box goes RED, and only that shot
//   · put it back and the red goes, with nothing remembered
//   · the leftovers are a box like any other
//   · leaving and coming back announces nothing new
//   · SORT NOW writes a sheet that is up to date, so it never marks afterwards
//
//     npm run t -- e2e/26-needs-and-the-order.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

const DAY1 = 'ti_day1';
const DAY2 = 'ti_day2';
const DAY3 = 'ti_day3';

/** Tag one shot's SHOOT DAY through the real needs card. */
async function setDay(page: Page, frameIndex: number, day: string | null): Promise<void> {
  await page.evaluate(async ([i, want]) => {
    const t = (window as never as { __fh_test: { openNeedsCard(i: number): void } }).__fh_test;
    const shut = () => document.querySelector('.g3-needs-overlay')?.remove();
    shut();
    await new Promise((r) => setTimeout(r, 120));
    t.openNeedsCard(i as number);
    await new Promise((r) => setTimeout(r, 350));
    const fid = (document.querySelector('[data-needs-toggle]') as HTMLElement | null)?.dataset.needsFid;
    for (const d of ['ti_day1', 'ti_day2', 'ti_day3']) {
      const el = document.querySelector(`[data-needs-toggle="${d}"][data-needs-fid="${fid}"]`) as HTMLElement | null;
      if (!el) continue;
      const on = el.className.includes('needs-dot-on');
      if ((d === want) !== on) { el.click(); await new Promise((r) => setTimeout(r, 100)); }
    }
    shut();
  }, [frameIndex, day] as [number, string | null]);
  await page.waitForTimeout(400);
}

/** Build the sheet through the real bracket: one box per day, then SORT NOW. */
async function sortByDays(page: Page, days: string[]): Promise<void> {
  await page.evaluate(async (wanted) => {
    const click = (sel: string) => (document.querySelector(sel) as HTMLElement | null)?.click();
    const edit = Array.from(document.querySelectorAll('button'))
      .find((b) => /EDIT ORDER/.test(b.textContent || ''));
    edit?.click();
    await new Promise((r) => setTimeout(r, 500));
    for (const item of wanted as string[]) {
      const boxes = Array.from(document.querySelectorAll('[data-bact="expand"]'));
      (boxes[boxes.length - 1] as HTMLElement | undefined)?.click();
      await new Promise((r) => setTimeout(r, 350));
      click(`[data-bact="pick"][data-bid="${item}"]`);
      await new Promise((r) => setTimeout(r, 450));
    }
    const sortNow = Array.from(document.querySelectorAll('button,span'))
      .find((b) => /SORT NOW/.test(b.textContent || '')) as HTMLElement | undefined;
    sortNow?.click();
    await new Promise((r) => setTimeout(r, 600));
    const yes = Array.from(document.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).offsetParent !== null && /^(Yes|OK)$/i.test((b.textContent || '').trim()));
    (yes as HTMLElement | undefined)?.click();
    await new Promise((r) => setTimeout(r, 400));
  }, days);
  await page.waitForTimeout(600);
}

/**
 * Nudge a shot with the REAL arrows (#435).
 *
 * The moveInOrder door writes straight into the store and never redraws the
 * order, so nothing is re-marked and the icons stay as they were — the test saw
 * no red and blamed the app. A door has to be the app's own path: this taps the
 * card, presses the arrow the right number of times, and presses DONE, exactly
 * as a person does.
 */
async function nudge(page: Page, label: string, steps: number): Promise<void> {
  const before = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sort-card')).map((c) =>
      ((c.querySelector('.sort-card-num')?.textContent || '')
        + (c.querySelector('.sort-card-extra')?.textContent || '')).trim()));
  await page.evaluate(async ([want, n]) => {
    const name = (c: Element) =>
      ((c.querySelector('.sort-card-num')?.textContent || '')
        + (c.querySelector('.sort-card-extra')?.textContent || '')).trim();
    const card = Array.from(document.querySelectorAll('.sort-card')).find((c) => name(c) === want);
    if (!card) throw new Error(`no card ${want}`);
    // A CARD IS WOKEN BY ITS OWN BUTTON, NOT BY CLICKING THE CARD.
    //
    // This clicked the card, which does nothing at all — so the arrows never
    // appeared, the shot never moved, and tests 2 and 3 blamed the app for not
    // marking it. They were red for two days without ever touching the app.
    // Run 125 of the newer test caught it, because that helper says whether it
    // actually moved anything.
    const fid = (card as HTMLElement).dataset.sortFid!;
    (card.querySelector(`[data-sort-activate="${fid}"]`) as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 350));
    const dir = (n as number) < 0 ? 'up' : 'down';
    for (let i = 0; i < Math.abs(n as number); i++) {
      const arrow = document.querySelector(
        `.sort-card-active [data-sort-move="${dir}"]`) as HTMLElement | null;
      if (!arrow) break;
      arrow.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    // DONE is also what puts a card back to sleep — the same button.
    (document.querySelector('.sort-card-active [data-sort-deactivate]') as HTMLElement | null)?.click();
  }, [label, steps] as [string, number]);
  await page.waitForTimeout(500);
  const after = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.sort-card')).map((c) =>
      ((c.querySelector('.sort-card-num')?.textContent || '')
        + (c.querySelector('.sort-card-extra')?.textContent || '')).trim()));
  if (before.indexOf(label) === after.indexOf(label)) {
    throw new Error(`THE TEST COULD NOT MOVE ${label}: still at place ${after.indexOf(label) + 1}.`
      + ` The test's arrows are failing, not the app's marking.`
      + `\n  before: ${before.join(' ')}\n  after:  ${after.join(' ')}`);
  }
}

/** What the order view is showing right now. */
async function look(page: Page): Promise<{ order: string[]; green: string[]; red: string[]; greenIcons: string[] }> {
  return page.evaluate(() => {
    const txt = (e: Element | null) => (e?.textContent || '').trim();
    return {
      order: Array.from(document.querySelectorAll('.sort-card'))
        .map((c) => txt(c.querySelector('.sort-card-num')) + txt(c.querySelector('.sort-card-extra'))),
      green: Array.from(document.querySelectorAll('.sort-card-resorted'))
        .map((c) => txt(c.querySelector('.sort-card-num')) + txt(c.querySelector('.sort-card-extra'))),
      red: Array.from(document.querySelectorAll('.sort-bracket-pill-moved')).map((p) => txt(p)),
      greenIcons: Array.from(document.querySelectorAll('.sort-bracket-pill-new')).map((p) => txt(p)),
    };
  });
}

const reopen = async (d: Device): Promise<void> => {
  await d.closeOrder();
  await d.settle();
  await d.openOrder(0);
  await d.settle();
};

test('the needs move a shot, mark it, and never announce it twice', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  say('eight shots: 1,2 on day 1 · 3,4 on day 2 · 5-8 with no needs at all');
  await desktop.newProject('NEEDS AND ORDER', 8);
  await desktop.settle();
  await setDay(desktop.page, 0, DAY1);
  await setDay(desktop.page, 1, DAY1);
  await setDay(desktop.page, 2, DAY2);
  await setDay(desktop.page, 3, DAY2);

  say('sort it: day 1, then day 2, then whatever is left');
  await desktop.newSortOrder('SHOOT');
  await desktop.settle();
  await desktop.openOrder(0);
  await desktop.settle();
  await sortByDays(desktop.page, [DAY1, DAY2]);

  // A SHEET WRITTEN BY SORT NOW IS UP TO DATE, so coming back says nothing.
  await reopen(desktop);
  expect((await look(desktop.page)).green,
    'A FRESH SORT MARKED SHOTS. The sheet was saved out of date.').toEqual([]);

  say('change ONE shot to day 1 — it should join the day 1 shots, alone');
  await desktop.closeOrder();
  await desktop.settle();
  await setDay(desktop.page, 4, DAY1);          // shot 5, previously a leftover
  await desktop.openOrder(0);
  await desktop.settle();

  let seen = await look(desktop.page);
  expect(seen.green, 'EXACTLY ONE SHOT SHOULD BE GREEN').toEqual(['5']);
  expect(seen.greenIcons, 'and its icon too').toEqual(['5']);
  expect(seen.order.indexOf('5'), 'it joins the day 1 shots, at its number')
    .toBe(2);

  say('leave and come back twice — nothing new may be announced');
  await reopen(desktop);
  expect((await look(desktop.page)).green, 'still the same one, not re-decided').toEqual(['5']);
  await reopen(desktop);
  expect((await look(desktop.page)).green, 'and still, on the third visit').toEqual(['5']);

  say('DONE clears it, and it stays cleared through a reload');
  await desktop.page.evaluate(() => {
    (document.querySelector('.sort-card-resorted [data-sort-deactivate]') as HTMLElement | null)?.click();
  });
  await desktop.settle();
  expect((await look(desktop.page)).green, 'DONE did not clear the green').toEqual([]);
  await desktop.page.reload();
  await desktop.settle();
  await desktop.openOrder(0);
  await desktop.settle();
  expect((await look(desktop.page)).green, 'the green came back after a reload').toEqual([]);

  await desktop.close();
});

test('a shot dragged out of its box goes red, alone, and grey again when put back',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);

    await desktop.newProject('RED AND BACK', 8);
    await desktop.settle();
    await setDay(desktop.page, 0, DAY1);
    await setDay(desktop.page, 1, DAY1);
    await setDay(desktop.page, 2, DAY2);
    await setDay(desktop.page, 3, DAY2);
    await desktop.newSortOrder('SHOOT');
    await desktop.settle();
    await desktop.openOrder(0);
    await desktop.settle();
    await sortByDays(desktop.page, [DAY1, DAY2]);

    expect((await look(desktop.page)).red, 'a freshly sorted order has nothing red').toEqual([]);

    say('drag a leftover shot up among the day 2 shots — the leftovers are a box too');
    await nudge(desktop.page, '7', -3);          // shot 7 up, in among 3 and 4
    await desktop.settle();
    let seen = await look(desktop.page);
    expect(seen.red, 'EXACTLY ONE SHOT SHOULD BE RED — the one that was moved')
      .toEqual(['7']);
    expect(seen.green, 'and moving a shot by hand is not a needs change').toEqual([]);

    say('put it back where it was');
    await nudge(desktop.page, '7', 3);
    await desktop.settle();
    expect((await look(desktop.page)).red, 'the red should clear itself, with nothing remembered')
      .toEqual([]);

    say('now drag a day 1 shot down among the day 2 shots');
    await nudge(desktop.page, '1', 3);
    await desktop.settle();
    expect((await look(desktop.page)).red, 'again exactly one').toEqual(['1']);

    await desktop.close();
  });

test('going round the loop many times settles, and never invents work',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);

    await desktop.newProject('ROUND AND ROUND', 8);
    await desktop.settle();
    for (let i = 0; i < 4; i++) await setDay(desktop.page, i, i < 2 ? DAY1 : DAY2);
    await desktop.newSortOrder('SHOOT');
    await desktop.settle();
    await desktop.openOrder(0);
    await desktop.settle();
    await sortByDays(desktop.page, [DAY1, DAY2]);

    // Change a shot, look, DONE it, come back. Four times over, with a third
    // day appearing halfway through — every fault today showed up on a LATER
    // visit, never the first.
    const plan: Array<[number, string]> = [[4, DAY1], [5, DAY2], [6, DAY3], [2, DAY1]];
    for (const [idx, day] of plan) {
      await desktop.closeOrder();
      await desktop.settle();
      await setDay(desktop.page, idx, day);
      await desktop.openOrder(0);
      await desktop.settle();

      const seen = await look(desktop.page);
      expect(seen.green.length,
        `ONE CHANGE SHOULD MARK ONE SHOT — it marked ${seen.green.length}: ${seen.green.join(', ')}`)
        .toBe(1);
      expect(seen.order.length, 'and the order never grows or shrinks').toBe(8);
      expect(new Set(seen.order).size, 'and never holds a shot twice').toBe(8);

      await desktop.page.evaluate(() => {
        (document.querySelector('.sort-card-resorted [data-sort-deactivate]') as HTMLElement | null)?.click();
      });
      await desktop.settle();
      expect((await look(desktop.page)).green, 'DONE clears it').toEqual([]);

      // …and simply visiting must add nothing.
      await reopen(desktop);
      expect((await look(desktop.page)).green, 'a visit with no change marks nothing').toEqual([]);
    }

    say('finally: re-sort from the boxes, which must leave nothing marked');
    await sortByDays(desktop.page, []);          // EDIT ORDER → SORT NOW, no new picks
    await reopen(desktop);
    const end = await look(desktop.page);
    expect(end.green, 'A RE-SORT MARKED SHOTS. The sheet was saved out of date.').toEqual([]);
    expect(end.order.length, 'and every shot is still there').toBe(8);

    await desktop.close();
  });

// NEEDS AND NOTES, CHANGED FROM THE FRAME-SET CARD ITSELF (Roman, 11 November).
//
// In SORT BY every card shows the shot's note and its four needs blocks. Since
// today a tap on one of them opens the shot's NOTES / NEEDS box right there —
// the same boxes 3x2 opens. This file drives that through the real app.
//
// THE RULES IT HOLDS TO
//   · a tap on a needs block opens NEEDS on THAT block's tab
//   · on closing, the shooting order is asked again AT ONCE: the shot joins its
//     new box, it is green, and nothing else moved
//   · the card shows the new need, and the page shows the shot that was edited
//   · a tap on the note opens NOTES; the card shows the new note; a note never
//     moves anything
//   · a card that is being moved (arrows + DONE) opens nothing
//   · with EDIT ORDER pressed the cards cannot be touched at all
//   · all of it is still there after a reload
//
//     npm run t -- e2e/64-needs-from-the-order.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

const DAY1 = 'ti_day1';
const DAY2 = 'ti_day2';

/** Tag one shot's SHOOT DAY through the real needs card (as test 26 does). */
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

/** What the order view is showing right now. */
async function look(page: Page): Promise<{ order: string[]; green: string[] }> {
  return page.evaluate(() => {
    const txt = (e: Element | null) => (e?.textContent || '').trim();
    const name = (c: Element) => txt(c.querySelector('.sort-card-num')) + txt(c.querySelector('.sort-card-extra'));
    return {
      order: Array.from(document.querySelectorAll('.sort-card')).map(name),
      green: Array.from(document.querySelectorAll('.sort-card-resorted')).map(name),
    };
  });
}

/** Click a box on the card of the shot with this number: 'notes', or a needs tab id. */
async function tapBox(page: Page, label: string, which: string): Promise<void> {
  const found = await page.evaluate(([want, box]) => {
    const txt = (e: Element | null) => (e?.textContent || '').trim();
    const card = Array.from(document.querySelectorAll('.sort-card')).find((c) =>
      txt(c.querySelector('.sort-card-num')) + txt(c.querySelector('.sort-card-extra')) === want);
    if (!card) return 'no card';
    const sel = box === 'notes' ? '[data-sort-open-notes]' : `[data-sort-open-needs][data-sort-needs-tab="${box}"]`;
    const el = card.querySelector(sel) as HTMLElement | null;
    if (!el) return 'no box';
    el.click();
    return 'ok';
  }, [label, which] as [string, string]);
  expect(found, `the ${which} box on the card of shot ${label}`).toBe('ok');
  await page.waitForTimeout(500);
}

/** Close an open NEEDS / NOTES box the way a person does: a tap beside it. */
async function tapBeside(page: Page): Promise<void> {
  await page.mouse.click(4, 4);
  await page.waitForTimeout(700);
  // The "modified to match NEEDS" note, when it comes, is read and sent away.
  await page.evaluate(() => {
    const note = document.querySelector('.sort-resort-note-modal');
    (note?.querySelector('button') as HTMLElement | null)?.click();
  });
  await page.waitForTimeout(300);
}

/** The text of one box on a card. */
async function boxText(page: Page, label: string, which: string): Promise<string> {
  return page.evaluate(([want, box]) => {
    const txt = (e: Element | null) => (e?.textContent || '').trim();
    const card = Array.from(document.querySelectorAll('.sort-card')).find((c) =>
      txt(c.querySelector('.sort-card-num')) + txt(c.querySelector('.sort-card-extra')) === want);
    const sel = box === 'notes' ? '[data-sort-open-notes]' : `[data-sort-open-needs][data-sort-needs-tab="${box}"]`;
    // Plain spaces only: the names carry a non-breaking space ("DAY\u00a01"),
    // which reads the same and compares differently (run 681).
    return txt(card?.querySelector(sel) ?? null).replace(/\s+/g, ' ');
  }, [label, which] as [string, string]);
}

test('needs and notes changed from the frame-set card: the order follows at once', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const page = desktop.page;

  say('eight shots: 1,2 on day 1 · 3,4 on day 2 · 5-8 with no needs at all');
  await desktop.newProject('NEEDS FROM THE CARD', 8);
  await desktop.settle();
  await setDay(page, 0, DAY1);
  await setDay(page, 1, DAY1);
  await setDay(page, 2, DAY2);
  await setDay(page, 3, DAY2);

  say('a shooting order: day 1, then day 2, then whatever is left');
  await desktop.newSortOrder('SHOOT');
  await desktop.settle();
  await desktop.openOrder(0);
  await desktop.settle();
  await sortByDays(page, [DAY1, DAY2]);
  const before = await look(page);
  expect(before.order, 'the order as sorted').toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  expect(before.green, 'a fresh sort marks nothing').toEqual([]);

  say('every card has its note box and its four needs boxes, empty ones too');
  const boxes = await page.evaluate(() => Array.from(document.querySelectorAll('.sort-card')).map((c) => ({
    notes: c.querySelectorAll('[data-sort-open-notes]').length,
    left: Array.from(c.querySelectorAll('.sort-needs-col:nth-child(1) [data-sort-needs-tab]')).map((b) => (b as HTMLElement).dataset.sortNeedsTab),
    right: Array.from(c.querySelectorAll('.sort-needs-col:nth-child(2) [data-sort-needs-tab]')).map((b) => (b as HTMLElement).dataset.sortNeedsTab),
  })));
  for (const b of boxes) {
    expect(b.notes, 'one note box on every card').toBe(1);
    expect(b.left, 'left: TALENTS over ART').toEqual(['tab_talents', 'tab_art']);
    expect(b.right, 'right: SHOOT over GEAR').toEqual(['tab_shoot', 'tab_gear']);
  }

  say('tap the SHOOT box of shot 5 — NEEDS opens on the SHOOT tab');
  await tapBox(page, '5', 'tab_shoot');
  expect(await page.locator('.g3-needs-overlay').count(), 'the NEEDS box is open').toBe(1);
  expect(await page.locator(`.g3-needs-modal [data-needs-toggle="${DAY1}"]`).count(),
    'it is on the SHOOT tab — the shoot days are there to press').toBeGreaterThan(0);

  say('give it DAY 1 and close — the order follows AT ONCE');
  await page.locator(`.g3-needs-modal [data-needs-toggle="${DAY1}"]`).first().click();
  await page.waitForTimeout(200);
  await tapBeside(page);
  expect(await page.locator('.g3-needs-overlay').count(), 'the box is closed').toBe(0);
  let seen = await look(page);
  expect(seen.order, 'SHOT 5 DID NOT JOIN THE DAY 1 SHOTS on closing the box')
    .toEqual(['1', '2', '5', '3', '4', '6', '7', '8']);
  expect(seen.green, 'exactly that shot is green').toEqual(['5']);
  expect(await boxText(page, '5', 'tab_shoot'), 'its card shows the new need').toContain('DAY 1');
  const inView = await page.evaluate(() => {
    const txt = (e: Element | null) => (e?.textContent || '').trim();
    const card = Array.from(document.querySelectorAll('.sort-card')).find((c) => txt(c.querySelector('.sort-card-num')) === '5');
    const r = card!.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  expect(inView, 'THE PAGE DOES NOT SHOW THE SHOT THAT WAS EDITED').toBe(true);

  say('DONE on the green card, then a need on ANOTHER tab from the same box');
  await page.evaluate(() => {
    (document.querySelector('.sort-card-resorted [data-sort-deactivate]') as HTMLElement | null)?.click();
  });
  await desktop.settle();
  await tapBox(page, '7', 'tab_talents');
  expect(await page.locator('.g3-needs-overlay').count(), 'the NEEDS box is open again').toBe(1);
  // Change tab INSIDE the box, to SHOOT, and tag day 2 there.
  await page.locator('.g3-needs-modal [data-needs-tab="tab_shoot"]').first().click();
  await page.waitForTimeout(250);
  await page.locator(`.g3-needs-modal [data-needs-toggle="${DAY2}"]`).first().click();
  await page.waitForTimeout(200);
  await tapBeside(page);
  seen = await look(page);
  expect(seen.order, 'a need set on another tab inside the box counts the same')
    .toEqual(['1', '2', '5', '3', '4', '7', '6', '8']);
  expect(seen.green, 'and marks that shot').toEqual(['7']);
  await page.evaluate(() => {
    (document.querySelector('.sort-card-resorted [data-sort-deactivate]') as HTMLElement | null)?.click();
  });
  await desktop.settle();

  say('tap the note box of shot 3, write a note with a break made on purpose');
  const orderBeforeNote = (await look(page)).order;
  await tapBox(page, '3', 'notes');
  expect(await page.locator('.g3-notes-overlay').count(), 'the NOTES box is open').toBe(1);
  await page.evaluate(() => {
    const ta = document.querySelector('.g3-notes-modal .notes-textarea') as HTMLTextAreaElement;
    ta.value = 'Lamp stays on\nKeep the door open';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await tapBeside(page);
  expect(await page.locator('.g3-notes-overlay').count(), 'the NOTES box is closed').toBe(0);
  const noteHtml = await page.evaluate(() => {
    const txt = (e: Element | null) => (e?.textContent || '').trim();
    const card = Array.from(document.querySelectorAll('.sort-card')).find((c) => txt(c.querySelector('.sort-card-num')) === '3');
    return (card?.querySelector('[data-sort-open-notes]') as HTMLElement | null)?.innerHTML ?? '';
  });
  expect(noteHtml, 'the card shows the note, with the break that was typed')
    .toBe('Lamp stays on<br>Keep the door open');
  seen = await look(page);
  expect(seen.order, 'A NOTE MOVED SHOTS').toEqual(orderBeforeNote);
  expect(seen.green, 'and marked nothing').toEqual([]);

  say('a card that is being moved opens nothing');
  await page.evaluate(() => {
    const txt = (e: Element | null) => (e?.textContent || '').trim();
    const card = Array.from(document.querySelectorAll('.sort-card')).find((c) => txt(c.querySelector('.sort-card-num')) === '6');
    (card?.querySelector('[data-sort-activate]') as HTMLElement | null)?.click();
  });
  await page.waitForTimeout(400);
  await tapBox(page, '6', 'tab_shoot');
  await tapBox(page, '6', 'notes');
  expect(await page.locator('.g3-needs-overlay, .g3-notes-overlay').count(),
    'A CARD IN MOVE MODE OPENED A BOX').toBe(0);
  await page.evaluate(() => {
    (document.querySelector('.sort-card-active [data-sort-deactivate]') as HTMLElement | null)?.click();
  });
  await desktop.settle();

  say('all of it is still there after a reload');
  await page.reload();
  await desktop.settle();
  await desktop.openOrder(0);
  await desktop.settle();
  seen = await look(page);
  expect(seen.order, 'the order after a reload').toEqual(['1', '2', '5', '3', '4', '7', '6', '8']);
  expect(await boxText(page, '5', 'tab_shoot'), 'shot 5 kept its day').toContain('DAY 1');
  expect(await boxText(page, '7', 'tab_shoot'), 'shot 7 kept its day').toContain('DAY 2');
  expect(await boxText(page, '3', 'notes'), 'shot 3 kept its note').toContain('Lamp stays on');

  say('with EDIT ORDER pressed the cards cannot be touched');
  const locked = await page.evaluate(async () => {
    const edit = Array.from(document.querySelectorAll('button')).find((b) => /EDIT ORDER/.test(b.textContent || ''));
    edit?.click();
    await new Promise((r) => setTimeout(r, 500));
    const dim = document.querySelector('.sort-cards-dimmed');
    return dim ? getComputedStyle(dim).pointerEvents : 'not dimmed';
  });
  expect(locked, 'the cards are dimmed and take no taps').toBe('none');

  await desktop.close();
});

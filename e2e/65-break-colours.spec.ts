// A BREAK HAS A COLOUR, AND THE COLOUR TRAVELS (Roman, 11 November).
//
// A break in a shooting order, and a break in a story flow, can each be given
// one of eleven colours, or the grey every break starts with. This drives it
// through the real buttons on one device and reads it off the other.
//
// THE RULES IT HOLDS TO
//   · a break starts grey
//   · the colour button is there once the break is being edited (its arrows
//     pressed), left of the arrows; it opens the palette, a colour closes it
//   · the palette is the eleven colours and, last, the grey
//   · the name is white on a dark colour and dark on a light one
//   · the colour arrives on the other device — for the break of a shooting
//     order and for the break of a story flow, each its own
//   · back to grey travels too
//
//     npm run t -- e2e/65-break-colours.spec.ts

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

const TERRACOTTA = '#C87963';   // dark: white name
const CREAM = '#F8E8C7';        // light: dark name
const BLUE = '#B9CBE0';

/** The one break card on screen: its colours, and what is on it. */
async function breakCard(page: Page): Promise<{ bg: string; ink: string; button: number; swatches: string[] }> {
  return page.evaluate(() => {
    const card = document.querySelector('.sort-break-card') as HTMLElement | null;
    if (!card) return { bg: 'no break card', ink: '', button: 0, swatches: [] };
    return {
      bg: getComputedStyle(card).backgroundColor,
      ink: getComputedStyle(card.querySelector('.sort-break-text') as HTMLElement).color,
      button: card.querySelectorAll('[data-break-color-open]').length,
      swatches: Array.from(card.querySelectorAll('[data-break-color-set]')).map((s) => (s as HTMLElement).dataset.color ?? '?'),
    };
  });
}

const press = async (page: Page, selector: string): Promise<void> => {
  const hit = await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    el?.click();
    return !!el;
  }, selector);
  expect(hit, `a button to press: ${selector}`).toBe(true);
  await page.waitForTimeout(350);
};

/** Edit the break, open the palette, take a colour ('' is the grey), DONE. */
async function colourTheBreak(page: Page, hex: string): Promise<void> {
  if (!(await page.locator('.sort-break-active').count())) await press(page, '[data-break-activate]');
  await press(page, '[data-break-color-open]');
  await press(page, `[data-break-color-set][data-color="${hex}"]`);
}

test('a break is given a colour, and the colour arrives on the other device', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  say('four shots, a shooting order with a break, and a story-flow break');
  const madeId = await desktop.newProject('BREAK COLOURS', 4);
  await desktop.settle();
  await desktop.newSortOrder('SHOOT');
  await desktop.settle();
  await desktop.addBreak(0, 2, 'LUNCH');
  await desktop.page.evaluate(() =>
    (window as never as { __fh_test: { addStoryBreak(p: number, t: string, g: number | null): string } })
      .__fh_test.addStoryBreak(1, 'ACT TWO', null));
  await desktop.settle();
  await tablet.openProject(madeId!);
  let whole = await Device.waitUntilWholeAgrees(desktop, tablet, 'before any colour');
  expect(whole, 'no break has a colour yet').not.toContain('"color"');

  say('the shooting order: the break starts grey, with no colour button until it is edited');
  await desktop.openOrder(0);
  await desktop.settle();
  let card = await breakCard(desktop.page);
  expect(card.bg, 'a break starts grey').toBe('rgb(128, 128, 128)');
  expect(card.button, 'no colour button while the break is not being edited').toBe(0);

  say('press its arrows: the colour button is there; it opens the palette');
  await press(desktop.page, '[data-break-activate]');
  card = await breakCard(desktop.page);
  expect(card.button, 'the colour button, once the break is being edited').toBe(1);
  expect(card.swatches, 'the palette is closed until the button is pressed').toEqual([]);
  await press(desktop.page, '[data-break-color-open]');
  card = await breakCard(desktop.page);
  expect(card.swatches.length, 'eleven colours and the grey').toBe(12);
  expect(card.swatches[11], 'the grey is the last one').toBe('');
  expect(card.swatches.includes('#F4C884'), 'the colour that was taken out is not there').toBe(false);

  say('a dark colour: white name. A light colour: dark name.');
  await press(desktop.page, `[data-break-color-set][data-color="${TERRACOTTA}"]`);
  card = await breakCard(desktop.page);
  expect(card.bg, 'the break has the colour').toBe('rgb(200, 121, 99)');
  expect(card.ink, 'white on a dark colour').toBe('rgb(255, 255, 255)');
  expect(card.swatches, 'choosing a colour closes the palette').toEqual([]);
  await colourTheBreak(desktop.page, CREAM);
  card = await breakCard(desktop.page);
  expect(card.bg, 'the light colour').toBe('rgb(248, 232, 199)');
  expect(card.ink, 'dark on a light colour').toBe('rgb(28, 28, 28)');
  await colourTheBreak(desktop.page, TERRACOTTA);
  await press(desktop.page, '[data-break-deactivate]');
  await desktop.closeOrder();
  await desktop.settle();

  say('the story flow: its break gets a colour of its own');
  await desktop.pickStoryFlow(null);
  await desktop.settle();
  expect((await breakCard(desktop.page)).bg, 'the story-flow break is still grey — each break has its own')
    .toBe('rgb(128, 128, 128)');
  await colourTheBreak(desktop.page, BLUE);
  expect((await breakCard(desktop.page)).bg, 'the story-flow break has its colour').toBe('rgb(185, 203, 224)');
  await press(desktop.page, '[data-break-deactivate]');
  await desktop.closeOrder();
  await desktop.settle();

  say('both colours arrive on the tablet');
  whole = await Device.waitUntilWholeAgrees(desktop, tablet, 'after the colours');
  expect(whole, 'THE SHOOTING ORDER BREAK DID NOT KEEP ITS COLOUR').toContain(`"color": "${TERRACOTTA}"`);
  expect(whole, 'THE STORY FLOW BREAK DID NOT KEEP ITS COLOUR').toContain(`"color": "${BLUE}"`);
  await tablet.openOrder(0);
  await tablet.settle();
  expect((await breakCard(tablet.page)).bg, 'the tablet draws the break in its colour').toBe('rgb(200, 121, 99)');

  say('the tablet puts it back to grey — and that travels too');
  await colourTheBreak(tablet.page, '');
  expect((await breakCard(tablet.page)).bg, 'grey again').toBe('rgb(128, 128, 128)');
  await press(tablet.page, '[data-break-deactivate]');
  await tablet.closeOrder();
  await tablet.settle();
  whole = await Device.waitUntilWholeAgrees(desktop, tablet, 'after back to grey');
  expect(whole, 'the shooting order break is grey on both').not.toContain(TERRACOTTA);
  expect(whole, 'and the story-flow break kept its own colour').toContain(`"color": "${BLUE}"`);

  await desktop.close();
  await tablet.close();
});

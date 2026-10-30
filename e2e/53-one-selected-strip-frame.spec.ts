// "MAIN FRAME + ONE SELECTED STRIP FRAME" (30 Oct, Roman). The export layout
// that was called "Double Strip", in the PDF and the Keynote boxes:
//   1. Main Frame + (v1) 1st Version Frame        — the default
//   2. Main Frame + last captured Version Frame   — the last in the row with a picture
//   3. Main Frame + 1st Starred Frame
//   4. Main Frame + 1st Tagged Frame
// ("Main Frame + Active Frame" is gone.)
//
//     npm run t -- -g "one selected strip frame"
//
// About 30 seconds.

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

/** A small PNG of one colour, made in the page — each colour its own picture. */
async function png(page: Page, colour: string): Promise<string> {
  return page.evaluate((c) => {
    const cv = document.createElement('canvas'); cv.width = 160; cv.height = 90;
    const g = cv.getContext('2d')!; g.fillStyle = c; g.fillRect(0, 0, 160, 90);
    return cv.toDataURL('image/png').split(',')[1];
  }, colour);
}

type Pick = { v1: string; last: string; starred: string; tagged: string };
const pick = (d: Device) => d.page.evaluate(() =>
  (window as never as { __fh_test: { doublePick(i: number, s: string): Pick } }).__fh_test.doublePick(0, 'ver'));

test('one selected strip frame: the four choices, v1 first and the default, in the PDF and Keynote boxes', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProjectOfKind('ONE SELECTED STRIP FRAME', 'landscape', 2);
  await d.settle();
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));

  // The boxes: the new title, the four choices in order, v1 ticked.
  for (const pre of ['export', 'pptx']) {
    const values = await d.page.locator(`input[name="${pre}DoubleMode"]`).evaluateAll((els) =>
      els.map((e) => `${(e as HTMLInputElement).value}${(e as HTMLInputElement).checked ? '*' : ''}`));
    say(`   ${pre} box: ${values.join(', ')}`);
    expect(values, `${pre}: the four choices in Roman's order, v1 the default`).toEqual(['v1*', 'last', 'starred', 'tagged']);
  }
  const titles = await d.page.locator('.exp-opt-text strong').allTextContents();
  expect(titles.filter((t) => t === 'Main Frame + One Selected Strip Frame').length, 'the title, in both boxes').toBe(2);
  expect(titles.includes('Double Strip'), 'the old name "Double Strip" is gone').toBe(false);

  // Three pictures on shot 1's version strip: v1, v2, v3.
  await d.uploadPictures(0, 'ver', [await png(d.page, '#c00'), await png(d.page, '#0a0'), await png(d.page, '#00c')]);
  await d.settle();
  const labels = await d.versionLabels(0, 'ver');
  say(`   shot 1 versions: ${labels.join(', ')}`);
  let p = await pick(d);
  say(`   picks: ${JSON.stringify(p)}`);
  expect(p.v1, 'v1 = the first in the row').toBe(labels[0]);
  expect(p.last, 'last captured = the last in the row with a picture').toBe(labels[labels.length - 1]);
  expect(p.starred, 'nothing starred yet').toBe('none');
  expect(p.tagged, 'nothing tagged yet').toBe('none');

  // Star v2: "1st Starred" follows it; v1 and last do not move.
  await d.page.evaluate(() => (window as never as { __fh_test: { setVersionStar(i: number, s: string, vi: number, on: boolean): void } }).__fh_test.setVersionStar(0, 'ver', 1, true));
  p = await pick(d);
  say(`   after starring ${labels[1]}: ${JSON.stringify(p)}`);
  expect(p.starred, '1st Starred = the starred one').toBe(labels[1]);
  expect(p.v1, 'v1 stays v1 whatever is starred').toBe(labels[0]);
  expect(p.last, 'last stays the last').toBe(labels[labels.length - 1]);
  await d.close();
});

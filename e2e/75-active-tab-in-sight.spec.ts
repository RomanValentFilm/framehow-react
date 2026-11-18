// THE TAB OF THE VERSION ON SHOW IS IN SIGHT (18 November, Roman).
//
// "In the single strip views, the moment you land on a version, let's say 7, the
// tabs in the frame card above do not show you that version. They are on V1 …
// if you're on version 38, the tab above the frame card should show v38."
//
// The row of tabs scrolls sideways. A card drawn before it is on the page has no
// width, so the "bring the active tab into view" step measured nothing and the
// row stayed at its beginning after every whole-page redraw.
//
// This plays it: one shot with 30 versions (the last one on show), the view is
// changed away and back — a whole-page redraw — and the active tab must lie
// inside its row.
//
//     npm run t -- -g "tab of the version on show"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

const PICTURE = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

async function activeTabInSight(d: Device): Promise<{ label: string; inSight: boolean; rowScrolls: boolean; left: number }> {
  return d.page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.frame-card[data-vfid] .version-tabs'))
      .filter((r) => r.offsetParent && r.clientWidth > 0);
    const row = rows[0];
    const tab = row?.querySelector<HTMLElement>('.vtab.active');
    if (!row || !tab) return { label: '(no row or no active tab)', inSight: false, rowScrolls: false, left: -1 };
    const rr = row.getBoundingClientRect(), tr = tab.getBoundingClientRect();
    return { label: (tab.textContent ?? '').trim(), inSight: tr.left >= rr.left - 1 && tr.right <= rr.right + 1,
      rowScrolls: row.scrollWidth > row.clientWidth + 1, left: Math.round(row.scrollLeft) };
  });
}

test('the tab of the version on show is in sight after a whole-page redraw', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'tablet', token);
  await d.newProject('TABS IN SIGHT', 2);
  await d.settle();

  say('one shot, 30 versions — the last one is on show');
  await d.uploadPictures(0, 'ver', Array.from({ length: 30 }, () => PICTURE));
  await d.settle();
  await d.setView('ver');
  await d.page.waitForTimeout(800);
  let t = await activeTabInSight(d);
  say(`   in the ver view: active tab "${t.label}", row scrolled to ${t.left}, in sight: ${t.inSight}`);
  expect(t.rowScrolls, 'the row is longer than the card — or this test proves nothing').toBe(true);
  expect(t.inSight, `the active tab (${t.label}) lies inside its row`).toBe(true);

  say('away to the main view and back — the whole page is drawn again');
  await d.setView('main');
  await d.page.waitForTimeout(500);
  await d.setView('ver');
  await d.page.waitForTimeout(900);
  t = await activeTabInSight(d);
  say(`   after the redraw: active tab "${t.label}", row scrolled to ${t.left}, in sight: ${t.inSight}`);
  expect(t.inSight, `THE ROW OF TABS WENT BACK TO ITS BEGINNING — the active tab (${t.label}) is out of sight`).toBe(true);

  // NOT PLAYED HERE: the main card showing a version (the cross-swipe), where the row of
  // tabs did not follow either (18 Nov, fixed in v5.0.308). Three tries at playing it
  // failed on the simulator, never on the app: made-up touches are refused by this
  // browser, a tablet's "main" view has two strips (no cross-swipe there), and on the
  // upright phone the test's own steps did not reach the version view. It is confirmed
  // on Roman's iPhone (v5.0.309, his log 14:25:55: "the main card shows ver 14 · CAM
  // from the main card showing a version") — and owed a proper play here.

  await d.close();
});

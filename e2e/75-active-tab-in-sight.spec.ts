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
  const d = await Device.open(browser, 'phone', token, false, { phone: { width: 390, height: 844 } });   // (an upright phone: ONE strip at a time, so the main card can show a version)
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

  // THE MAIN CARD SHOWING A VERSION (18 Nov, Roman: "in the single strip view of shot or of
  // talent … it doesn't scroll the tab bar"). In the main view the main card is made to
  // show the shot's versions, with the row of tabs above it — the same state a
  // cross-swipe, or a camera shot from the main card, leaves it in.
  say('the main view: the main card is made to show the version — its tab must be in sight');
  await d.setView('main');
  await d.page.waitForTimeout(500);
  // (the card's own › arrow is pressed — it does what the cross-swipe does; the swipe
  // itself cannot be played here: this browser refuses made-up touches, run 786/787)
  const pressed = await d.page.evaluate(async () => {
    const fid = (document.querySelector('#mainScroll .frame-card[data-mfid]') as HTMLElement | null)?.dataset.mfid;
    let n = 0;
    for (let i = 0; i < 40; i++) {
      const arrow = document.querySelector<HTMLElement>(`#mainScroll .frame-card[data-mfid="${fid}"] .nav-arrow-right`);
      if (!arrow) break;
      arrow.click(); n++;
      await new Promise((r) => setTimeout(r, 40));
      const tab = document.querySelector<HTMLElement>(`#mainScroll .frame-card[data-mfid="${fid}"] .version-tabs .vtab.active`);
      if ((tab?.textContent ?? '').trim() === 'v30') break;
    }
    return n;
  });
  say(`   › pressed ${pressed} time(s) on the main card`);
  await d.page.waitForTimeout(900);
  const m = await d.page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('#mainScroll .frame-card[data-mfid] .version-tabs'))
      .filter((r) => r.offsetParent && r.clientWidth > 0);
    const row = rows[0];
    const tab = row?.querySelector<HTMLElement>('.vtab.active');
    if (!row || !tab) return { label: '(the main card shows no tabs)', inSight: false, rowScrolls: false, left: -1 };
    const rr = row.getBoundingClientRect(), tr = tab.getBoundingClientRect();
    return { label: (tab.textContent ?? '').trim(), inSight: tr.left >= rr.left - 1 && tr.right <= rr.right + 1,
      rowScrolls: row.scrollWidth > row.clientWidth + 1, left: Math.round(row.scrollLeft) };
  });
  say(`   on the main card: active tab "${m.label}", row scrolled to ${m.left}, in sight: ${m.inSight}`);
  expect(m.rowScrolls, 'the main card shows the row of tabs and it is longer than the card').toBe(true);
  expect(m.inSight, `THE MAIN CARD'S TABS DID NOT FOLLOW — the active tab (${m.label}) is out of sight`).toBe(true);

  await d.close();
});

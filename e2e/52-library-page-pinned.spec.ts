// THE PAGE IS PINNED BEHIND THE LIBRARY (v5.0.130, 29 Oct). Instead of blocking
// fingers, the page behind the library is held with position:fixed. What that
// could have broken, checked here (Roman: "you test it"):
//   1. iPad: turning with the library open — closing it, the same shot is on screen
//   2. MAX view opened from the library — opens, closes, back in the library,
//      the page behind not moved
//   3. desktop: the page does not shift sideways, and is back where it was on closing
//
//     npm run t -- -g "page pinned"
//
// About 1 minute.

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

const RED = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';

/** Which shot's card is in the middle of the screen. */
async function middleShot(page: Page): Promise<string> {
  // The shot card whose middle is nearest the screen's middle (run 550: the
  // point in the very middle was a gap between cards, so it found none).
  return page.evaluate(() => {
    let best = 'none', dist = Infinity;
    for (const c of document.querySelectorAll<HTMLElement>('#mainScroll .frame-card[data-mfid], #overviewScroll .grid3x2-card-wrap[data-g3fid]')) {
      const r = c.getBoundingClientRect();
      if (!r.height || !c.offsetParent) continue;
      const d = Math.abs(r.top + r.height / 2 - window.innerHeight / 2);
      if (d < dist) { dist = d; best = c.dataset.mfid || c.dataset.g3fid || '?'; }
    }
    return best;
  });
}
const shown = (page: Page, fid: string) => page.evaluate((id) => {
  const c = [...document.querySelectorAll<HTMLElement>(`#mainScroll .frame-card[data-mfid="${id}"], #overviewScroll .grid3x2-card-wrap[data-g3fid="${id}"]`)].find((e) => e.offsetParent);
  if (!c) return false;
  const r = c.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight && r.height > 0;
}, fid);
const closeLibrary = async (d: Device) => {
  await d.page.locator('#pictsBtn').click({ timeout: 5_000 });
  await expect(d.page.locator('#pictsLibrary')).toHaveCount(0);
  await d.page.waitForTimeout(1500);   // the turn rule's own placing, up to 1.2 s
};

for (const [from, to] of [[[1180, 820], [820, 1180]], [[820, 1180], [1180, 820]]] as const)
test(`page pinned behind the library — iPad turned ${from[0] > from[1] ? 'landscape → portrait' : 'portrait → landscape'} with it open: closing it, the same shot is on screen`, async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'tablet', token, true);
  await d.page.setViewportSize({ width: from[0], height: from[1] });
  await d.newProjectOfKind('PINNED IPAD', 'landscape', 15);
  await d.settle();
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));
  await d.showStrip('ver');
  await d.page.evaluate(() => window.scrollTo(0, 900)); await d.page.waitForTimeout(800);
  const mid = await middleShot(d.page);
  expect(mid, 'the test found no shot on screen before opening the library').not.toBe('none');
  say(`iPad ${from[0]}×${from[1]}, view ${await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode())}, page at ${await d.page.evaluate(() => Math.round(window.scrollY))}, shot in the middle: ${mid}`);
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await d.page.waitForSelector('#pictsLibrary');
  await d.page.setViewportSize({ width: to[0], height: to[1] });
  await d.page.waitForTimeout(1500);
  say(`   turned to ${to[0]}×${to[1]} with the library open`);
  await closeLibrary(d);
  for (const l of (await d.log()).slice(0, 10).reverse()) say(`   app: ${l.trim()}`);
  const now = await middleShot(d.page);
  say(`   library closed: page at ${await d.page.evaluate(() => Math.round(window.scrollY))}, shot in the middle: ${now}; shot ${mid} on screen: ${await shown(d.page, mid)}`);
  expect(await shown(d.page, mid), `SHOT ${mid} IS NOT ON SCREEN after turning with the library open and closing it`).toBe(true);
  const bodyPos = await d.page.evaluate(() => document.body.style.position || 'normal');
  expect(bodyPos, 'the page is still pinned after the library closed').toBe('normal');
  await d.close();
});

test('page pinned behind the library — MAX view from the library opens, closes, back in the library, the page behind not moved', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'tablet', token, true);
  await d.newProjectOfKind('PINNED MAX', 'landscape', 15);
  await d.settle();
  await d.uploadPicture(0, 'main', RED);
  await d.settle();
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));
  await d.page.evaluate(() => window.scrollTo(0, 600)); await d.page.waitForTimeout(800);
  const y0 = await d.page.evaluate(() => Math.round(window.scrollY));
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await expect.poll(() => d.page.locator('#pictsLibrary .picts-tile').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
  await d.page.locator('#pictsLibrary .picts-tile').last().click();
  await expect(d.page.locator('#maxView'), 'MAX view opens from the library').toBeVisible();
  // a swipe inside MAX view (a finger, not a mouse)
  const box = (await d.page.locator('#maxView').boundingBox())!;
  await d.page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await d.page.locator('#maxView .max-close').click();
  await expect(d.page.locator('#maxView')).toBeHidden();
  await expect(d.page.locator('#pictsLibrary'), 'back in the library after MAX view').toBeVisible();
  await closeLibrary(d);
  const y1 = await d.page.evaluate(() => Math.round(window.scrollY));
  say(`   page at ${y0} before the library, ${y1} after library + MAX view`);
  expect(Math.abs(y1 - y0), 'THE PAGE BEHIND MOVED (library + MAX view)').toBeLessThanOrEqual(2);
  await d.close();
});

test('page pinned behind the library — desktop: no sideways shift, back where it was on closing', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProjectOfKind('PINNED DESKTOP', 'landscape', 15);
  await d.settle();
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));
  await d.page.evaluate(() => window.scrollTo(0, 700)); await d.page.waitForTimeout(800);
  const before = await d.page.evaluate(() => ({ y: Math.round(window.scrollY), w: document.documentElement.clientWidth,
    vb: Math.round((document.querySelector('.view-bar') as HTMLElement).getBoundingClientRect().left) }));
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await d.page.waitForSelector('#pictsLibrary'); await d.page.waitForTimeout(500);
  const open = await d.page.evaluate(() => ({ w: document.documentElement.clientWidth,
    vb: Math.round((document.querySelector('.view-bar') as HTMLElement).getBoundingClientRect().left) }));
  say(`   page width ${before.w} → ${open.w} px with the library open; view bar left ${before.vb} → ${open.vb}`);
  expect(Math.abs(open.vb - before.vb), 'THE PAGE SHIFTED SIDEWAYS when the library opened').toBeLessThanOrEqual(1);
  await closeLibrary(d);
  const y1 = await d.page.evaluate(() => Math.round(window.scrollY));
  say(`   page at ${before.y} before, ${y1} after closing`);
  expect(Math.abs(y1 - before.y), 'THE PAGE IS NOT BACK WHERE IT WAS after closing the library').toBeLessThanOrEqual(2);
  await d.close();
});

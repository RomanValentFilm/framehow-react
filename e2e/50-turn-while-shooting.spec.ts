// TURN THE DEVICE WHILE THE CAMERA IS OPEN (29 October, Roman):
// "if I shoot to shot 7, then however I turn the device in between, I want to
// end up seeing shot 7 when the picture is taken — mid screen. Not above, not
// below. Period."
//
// The camera is opened on shot 7 in portrait, the device is turned to
// landscape, the photo is handed over — and shot 7's card must sit in the
// middle of the screen. Then the same the other way round.
//
//     npm run t -- -g "turn while shooting"

import { test, expect, type Page } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 240_000 });

async function photo(page: Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
    const g = c.getContext('2d')!; g.fillStyle = '#d52632'; g.fillRect(0, 0, 1600, 1200);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return Buffer.from(b64, 'base64');
}

/** Where the card's top is on the screen, in px. */
async function topOf(page: Page, sel: string): Promise<{ top: number; h: number; vh: number }> {
  return page.evaluate((q) => {
    const el = document.querySelector(q) as HTMLElement | null;
    const r = el ? el.getBoundingClientRect() : { top: 9999, height: 0 };
    return { top: Math.round(r.top), h: Math.round(r.height), vh: window.innerHeight };
  }, sel);
}
/** Where the app must put it back: the height it had at CAM, kept on the screen. */
function wantTop(atCam: number, now: { h: number; vh: number }): number {
  return Math.max(0, Math.min(atCam, now.vh - Math.min(now.h, now.vh)));
}

/** How far the card's middle is from the middle of the screen, in px. */
async function offCentre(page: Page, fid: string): Promise<number> {
  return page.evaluate((id) => {
    const el = document.querySelector(`#versionsScroll .frame-card[data-vfid="${id}"]`) as HTMLElement | null;
    if (!el) return 9999;
    const r = el.getBoundingClientRect();
    return Math.round(r.top + r.height / 2 - window.innerHeight / 2);
  }, fid);
}

for (const [from, to] of [[[820, 1180], [1180, 820]], [[1180, 820], [820, 1180]]] as const) {
  test(`turn while shooting: ${from[0] < from[1] ? 'portrait → landscape' : 'landscape → portrait'}, the card goes back where it was`, async ({ browser }) => {
    const { token } = await freshAccount();
    const d = await Device.open(browser, 'desktop', token);
    await d.page.setViewportSize({ width: from[0], height: from[1] });
    await d.newProjectOfKind('TURN WHILE SHOOTING', 'landscape', 15);
    await d.settle();
    await d.showStrip('ver');
    if (await d.page.locator('#projectListModal').isVisible()) {
      await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
    }
    await d.page.evaluate(() => (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice('phone', false));

    // Shot 7 is known by its id from here on. Two shots are then added ABOVE it,
    // so its place in the list changes — the page must still end on THIS shot.
    const fid = (await d.page.locator('#versionsScroll .frame-card[data-vfid]').nth(6).getAttribute('data-vfid'))!;
    await d.newFrameAfter(1); await d.newFrameAfter(2); await d.page.waitForTimeout(500);
    const card = d.page.locator(`#versionsScroll .frame-card[data-vfid="${fid}"]`);
    const nowNo = await d.page.locator('#versionsScroll .frame-card[data-vfid]').evaluateAll((els, id) => els.findIndex((e) => (e as HTMLElement).dataset.vfid === id) + 1, fid);
    say(`   two shots added above — that shot is now number ${nowNo}`);
    // the list is redrawn after adding shots: wait until the card is in place (run 533)
    await card.waitFor({ state: 'visible' }); await d.page.waitForTimeout(300);
    await card.scrollIntoViewIfNeeded();
    const viewBefore = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
    say(`that shot (card ${fid}): CAM pressed at ${from[0]}×${from[1]} in the ${viewBefore} view`);
    const pic = await photo(d.page);
    const selA = `#versionsScroll .frame-card[data-vfid="${fid}"]`;
    const atCam = (await topOf(d.page, selA)).top;
    say(`   the card's top at CAM: ${atCam} px`);
    const [chooser] = await Promise.all([
      d.page.waitForEvent('filechooser', { timeout: 10_000 }),
      card.locator('[data-action="camera"]').click(),
    ]);
    say(`   turning the device to ${to[0]}×${to[1]} with the camera open`);
    await d.page.setViewportSize({ width: to[0], height: to[1] });
    await d.page.waitForTimeout(700);
    await chooser.setFiles({ name: 'turned.jpg', mimeType: 'image/jpeg', buffer: pic });
    await d.page.waitForTimeout(2200);

    // the photo went into THIS shot's version strip
    const log = (await d.log()).join('\n');
    expect(log, 'the photo did not land in the shot the camera was opened for')
      .toContain(`camera: landed on the card (shot ${nowNo}, ver`);
    const viewAfter = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
    expect(viewAfter, 'THE VIEW CHANGED while shooting (Roman: "come back to the same view")').toBe(viewBefore);
    const now = await topOf(d.page, selA);
    say(`   the card's top now: ${now.top} px (must be ${wantTop(atCam, now)})`);
    expect(Math.abs(now.top - wantTop(atCam, now)), 'THE CARD IS NOT BACK WHERE IT WAS WHEN CAM WAS PRESSED (Roman: "do not move the screen")')
      .toBeLessThanOrEqual(4);
    await d.close();
  });
}

// STARTED IN 3x2 (29 Oct, Roman). While the camera is open the page in the
// background ignores every turn.
//  · back: landscape → CAM → portrait → back to landscape → photo. Lands in
//    landscape: 3x2, the card showing the new photo, exactly where it was.
//  · portrait: landscape → CAM → portrait → photo. 3x2 does not exist in iPad
//    portrait, so the view becomes the ordinary portrait view (MAIN + VERSIONS)
//    on that shot. Turning back to landscape keeps that view — 3x2 only when
//    the user presses it.
const vm = (d: Device) => d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
const showingOf = (d: Device, i: number) => d.page.evaluate((n) => (window as never as { __fh_test: { cardShowing(i: number): string } }).__fh_test.cardShowing(n), i);
for (const how of ['back', 'portrait'] as const) test(`turn while shooting in 3x2: ${how === 'back' ? 'turned and back before the photo — 3x2, the card where it was' : 'photo taken in portrait — portrait view, and it stays when turned back'}`, async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.page.setViewportSize({ width: 1180, height: 820 });
  await d.newProjectOfKind('TURN IN 3x2', 'landscape', 15);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
  }
  await d.setView('grid3x2'); await d.page.waitForTimeout(600);
  await d.page.evaluate(() => (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice('phone', false));
  const wraps = d.page.locator('#overviewScroll .grid3x2-card-wrap[data-g3fid]');
  const fid = (await wraps.nth(9).getAttribute('data-g3fid'))!;
  const wrap = d.page.locator(`#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`);
  await wrap.scrollIntoViewIfNeeded();
  const pic = await photo(d.page);
  { // shot 10 gets its main picture first (no turn), so the next photo is a version
    const [ch] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), wrap.locator('[data-mact="camera"]').first().click()]);
    await ch.setFiles({ name: 'first.jpg', mimeType: 'image/jpeg', buffer: pic });
    await d.page.waitForTimeout(1500);
  }
  const selB = `#overviewScroll .grid3x2-card-wrap[data-g3fid="${fid}"]`;
  const atCam = (await topOf(d.page, selB)).top;
  say(`shot 10 in 3x2 (card ${fid}): CAM pressed in landscape, card top ${atCam} px`);
  const [chooser] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), wrap.locator('[data-mact="camera"]').first().click()]);
  say('   turning to portrait with the camera open');
  await d.page.setViewportSize({ width: 820, height: 1180 });
  await d.page.waitForTimeout(700);
  if (how === 'back') {
    say('   and back to landscape, camera still open');
    await d.page.setViewportSize({ width: 1180, height: 820 });
    await d.page.waitForTimeout(700);
  }
  await chooser.setFiles({ name: 'turned.jpg', mimeType: 'image/jpeg', buffer: pic });
  await d.page.waitForTimeout(2200);
  const landed = (await d.log()).find((l) => l.includes('camera: landed on the card (shot 10, ver')) ?? '';
  say(`   ${landed.trim()}`);
  expect(landed, 'the second photo did not land as a version of shot 10').not.toBe('');
  const m = landed.match(/\(shot 10, (\w+) (\d+)\)/);
  const expected = m ? `${m[1]} ${m[2]}` : 'main';
  for (const l of (await d.log()).slice(0, 25).reverse()) say(`   app: ${l.trim()}`);   // newest last
  if (how === 'back') {
    const view = await vm(d);
    say(`   the view: ${view}`);
    expect(view, 'NOT IN 3x2 after landscape → CAM → portrait → landscape → photo').toBe('grid3x2');
    const showing = await showingOf(d, 9);
    expect(showing, 'THE CARD DOES NOT SHOW THE PHOTO JUST TAKEN').toBe(expected);
    const now = await topOf(d.page, selB);
    say(`   the card shows ${showing}; its top now ${now.top} px (at CAM ${atCam})`);
    expect(Math.abs(now.top - atCam), 'THE CARD IS NOT WHERE IT WAS AT CAM (the page should have ignored the turn)').toBeLessThanOrEqual(4);
  } else {
    const view = await vm(d);
    say(`   the view in portrait: ${view}`);
    expect(view, 'iPad portrait after a 3x2 photo should be the ordinary portrait view').toBe('both');
    await d.page.waitForTimeout(1300);   // the turn rule places the shot (its own steps, up to 1.2 s)
    const card = await topOf(d.page, `#mainScroll .frame-card[data-mfid="${fid}"]`);
    say(`   shot 10 in portrait: top ${card.top} px of ${card.vh}`);
    expect(card.top >= 0 && card.top < card.vh, 'SHOT 10 IS NOT ON SCREEN in the portrait view').toBe(true);
    say('   turning back to landscape');
    await d.page.setViewportSize({ width: 1180, height: 820 });
    await d.page.waitForTimeout(1800);
    const back = await vm(d);
    say(`   the view after turning back: ${back}`);
    expect(back, 'THE APP WENT BACK TO 3x2 BY ITSELF (Roman: "only when the user presses 3x2")').toBe('both');
  }
  await d.close();
});

// iPHONE (29 Oct, Roman: "I think it's an iPhone problem only"). The phone's
// own turn rules are the harshest: portrait forces the single SHOT strip and
// resets what every card shows. The camera is opened in portrait on the SHOT
// card of a shot that already has its main picture, the phone is turned to
// landscape, the photo is taken: same view, same card, showing the new photo,
// in the middle.
test('turn while shooting on an iPhone: portrait → landscape, same view, same card, the new photo, where it was', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.page.setViewportSize({ width: 390, height: 844 });
  await d.newProjectOfKind('IPHONE TURN', 'landscape', 15);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
  }
  await d.page.evaluate(() => (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice('phone', false));
  const viewBefore = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
  const fid = (await d.page.locator('#mainScroll .frame-card[data-mfid]').nth(6).getAttribute('data-mfid'))!;
  const card = d.page.locator(`#mainScroll .frame-card[data-mfid="${fid}"]`);
  await card.scrollIntoViewIfNeeded();
  const pic = await photo(d.page);
  { // shot 7 gets its main picture first (no turn), so the next photo is a version
    const [ch] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), card.locator('[data-mact="camera"]').first().click()]);
    await ch.setFiles({ name: 'first.jpg', mimeType: 'image/jpeg', buffer: pic });
    await d.page.waitForTimeout(1500);
  }
  const selC = `#mainScroll .frame-card[data-mfid="${fid}"]`;
  const atCam = (await topOf(d.page, selC)).top;
  say(`iPhone portrait, ${viewBefore} view: CAM on shot 7, card top ${atCam} px`);
  const [chooser] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), card.locator('[data-mact="camera"]').first().click()]);
  say('   turning the iPhone to landscape with the camera open');
  await d.page.setViewportSize({ width: 844, height: 390 });
  await d.page.waitForTimeout(700);
  await chooser.setFiles({ name: 'turned.jpg', mimeType: 'image/jpeg', buffer: pic });
  await d.page.waitForTimeout(1500);
  const viewAfter = await d.page.evaluate(() => (window as never as { __fh_test: { viewMode(): string } }).__fh_test.viewMode());
  say(`   the view: ${viewBefore} → ${viewAfter}`);
  expect(viewAfter, 'THE VIEW CHANGED while shooting on the iPhone').toBe(viewBefore);
  const landed = (await d.log()).find((l) => l.includes('camera: landed on the card (shot 7, ver')) ?? '';
  expect(landed, 'the second photo did not land as a version of shot 7').not.toBe('');
  const m = landed.match(/\(shot 7, (\w+) (\d+)\)/);
  const showing = await d.page.evaluate(() => (window as never as { __fh_test: { cardShowing(i: number): string } }).__fh_test.cardShowing(6));
  say(`   ${landed.trim()} — the card shows: ${showing}`);
  expect(showing, 'THE CARD JUMPED BACK TO THE MAIN PICTURE (iPhone)').toBe(m ? `${m[1]} ${m[2]}` : 'main');
  const now = await topOf(d.page, selC);
  for (const l of (await d.log()).slice(0, 25).reverse()) say(`   app: ${l.trim()}`);   // newest last
  say(`   the card's top now: ${now.top} px (must be ${wantTop(atCam, now)})`);
  expect(Math.abs(now.top - wantTop(atCam, now)), 'the card is not back where it was at CAM (iPhone)').toBeLessThanOrEqual(4);
  await d.close();
});

// NO TURN: nothing moves at all (Roman: "do not move the screen").
test('shooting without a turn: the card stays exactly where it was', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.page.setViewportSize({ width: 1180, height: 820 });
  await d.newProjectOfKind('NO TURN', 'landscape', 15);
  await d.settle();
  await d.showStrip('ver');
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
  }
  await d.page.evaluate(() => (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice('phone', false));
  const fid = (await d.page.locator('#versionsScroll .frame-card[data-vfid]').nth(8).getAttribute('data-vfid'))!;
  const sel = `#versionsScroll .frame-card[data-vfid="${fid}"]`;
  await d.page.locator(sel).scrollIntoViewIfNeeded();
  const atCam = (await topOf(d.page, sel)).top;
  const pic = await photo(d.page);
  const [chooser] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), d.page.locator(sel).locator('[data-action="camera"]').click()]);
  await chooser.setFiles({ name: 'still.jpg', mimeType: 'image/jpeg', buffer: pic });
  await d.page.waitForTimeout(1500);
  const now = await topOf(d.page, sel);
  say(`   card top at CAM ${atCam} px, after the photo ${now.top} px`);
  expect(Math.abs(now.top - atCam), 'THE SCREEN MOVED although the device was not turned').toBeLessThanOrEqual(2);
  await d.close();
});

// STARTED IN PORTRAIT AFTER AN ORDINARY TURN FROM 3x2 (29 Oct, Roman's iPad:
// "I'm in single or double view in portrait, press CAM, turn to landscape, take
// the shot — it lands in 3x2. It should land where I started"). The earlier
// ordinary turn 3x2 → portrait leaves a note "came from 3x2"; the camera turn
// must not act on it.
for (const view of ['both', 'main'] as const) test(`turn while shooting: iPad portrait ${view === 'both' ? 'double' : 'single'} view (after a turn from 3x2) → landscape, lands in the same view, not 3x2`, async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.page.setViewportSize({ width: 1180, height: 820 });
  await d.newProjectOfKind('PORTRAIT START', 'landscape', 15);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
  }
  await d.setView('grid3x2'); await d.page.waitForTimeout(600);
  say('3x2 in landscape; an ordinary turn to portrait (no camera)');
  await d.page.setViewportSize({ width: 820, height: 1180 });
  await d.page.waitForTimeout(1500);
  say(`   the view after the ordinary turn: ${await vm(d)}`);
  if (view === 'main') { await d.setView('main'); await d.page.waitForTimeout(600); }
  const before = await vm(d);
  say(`   CAM pressed in the ${before} view, portrait`);
  await d.page.evaluate(() => (window as never as { __fh_test: { setCamChoice(m: string, l: boolean): void } }).__fh_test.setCamChoice('phone', false));
  const fid = (await d.page.locator('#mainScroll .frame-card[data-mfid]').nth(4).getAttribute('data-mfid'))!;
  const card = d.page.locator(`#mainScroll .frame-card[data-mfid="${fid}"]`);
  await card.scrollIntoViewIfNeeded();
  const before0 = (await topOf(d.page, `#mainScroll .frame-card[data-mfid="${fid}"]`)).top;
  const pic = await photo(d.page);
  const [chooser] = await Promise.all([d.page.waitForEvent('filechooser', { timeout: 10_000 }), card.locator('[data-mact="camera"]').first().click()]);
  // The card's place AS CAM IS PRESSED (run 540: the click itself scrolled the
  // page 102 px to reach the CAM button at the card's foot — measured before the
  // click, the test wanted a place the card had already left).
  const atCam = (await topOf(d.page, `#mainScroll .frame-card[data-mfid="${fid}"]`)).top;
  say(`   card top before the click ${before0} px, as CAM opened ${atCam} px`);
  say('   turning to landscape with the camera open, then the photo');
  await d.page.setViewportSize({ width: 1180, height: 820 });
  await d.page.waitForTimeout(700);
  await chooser.setFiles({ name: 'turned.jpg', mimeType: 'image/jpeg', buffer: pic });
  await d.page.waitForTimeout(2200);
  for (const l of (await d.log()).slice(0, 15).reverse()) say(`   app: ${l.trim()}`);
  const after = await vm(d);
  say(`   the view: ${before} → ${after}`);
  expect(after, 'THE PHOTO LANDED IN ANOTHER VIEW (Roman: "it lands in 3x2 — it should land where I started")').toBe(before);
  const now = await topOf(d.page, `#mainScroll .frame-card[data-mfid="${fid}"]`);
  say(`   the card's top: at CAM ${atCam} px, now ${now.top} px (must be ${wantTop(atCam, now)})`);
  expect(Math.abs(now.top - wantTop(atCam, now)), 'the card is not back where it was at CAM').toBeLessThanOrEqual(4);
  await d.close();
});

// LIBRARY OPEN, THEN A VIEW BUTTON (29 Oct, Roman's iPhone): "iPhone portrait —
// LIBRARY — landscape — any other button does not work: 3x2, SETUPS, GROUP,
// SORT BY, it simply stays in the library." On the iPhone those four buttons
// only exist in landscape, so the turn is part of it. Both ways are checked:
// opened in portrait and turned, and opened in landscape.
//
//     npm run t -- -g "library open"
//
// About 2 minutes (16 cases).

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

// run 543: all green with the page at the top. On the iPhone the toolbar scrolls
// with the page, so the same again with the page scrolled down first.
for (const scrolled of [false, true])
for (const start of ['portrait', 'landscape'] as const)
for (const btn of ['3x2', 'setups', 'group', 'sortby'] as const)
test(`library open on an iPhone (${start === 'portrait' ? 'opened in portrait, turned' : 'opened in landscape'}${scrolled ? ', page scrolled down' : ''}), then ${btn.toUpperCase()}: the library closes and the button works`, async ({ browser }) => {
  const { token } = await freshAccount();
  // A real touch iPhone from the start (run 544 was a desktop with a mouse:
  // the iPhone's own bar code never ran — Roman: only the bar with LIBRARY fails).
  const d = await Device.open(browser, 'phone', token, false, { phone: start === 'portrait' ? { width: 390, height: 844 } : { width: 844, height: 390 } });
  await d.newProjectOfKind('LIBRARY THEN BUTTON', 'landscape', scrolled ? 15 : 6);
  await d.settle();
  if (await d.page.locator('#projectListModal').isVisible()) {
    await d.page.locator('#projectListClose').click(); await d.page.waitForTimeout(300);
  }
  if (scrolled) {
    await d.page.evaluate(() => window.scrollTo(0, 1500)); await d.page.waitForTimeout(800);
    say(`page scrolled to ${await d.page.evaluate(() => Math.round(window.scrollY))}`);
  }
  await d.page.locator('#pictsBtn').tap({ timeout: 15_000 });
  await d.page.waitForSelector('#pictsLibrary');
  say(`library opened in ${start}`);
  if (start === 'portrait') {
    await d.page.setViewportSize({ width: 844, height: 390 });
    await d.page.waitForTimeout(1200);
    say('   turned to landscape');
  }
  const b = d.page.locator(`.view-bar .view-btn[data-view="${btn}"]`);
  // What is really under the middle of the button — the button, or something over it?
  const where = await b.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) as HTMLElement | null;
    const lib = document.getElementById('pictsLibrary')?.getBoundingClientRect();
    const name = (e: HTMLElement | null) => e ? `${e.tagName.toLowerCase()}${e.id ? '#' + e.id : ''}${typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : ''}` : 'nothing';
    const vb = document.querySelector('.view-bar') as HTMLElement | null;
    const vbr = vb?.getBoundingClientRect();
    const tb = document.getElementById('mainToolbar')?.getBoundingClientRect();
    const db = document.getElementById('detailBar')?.getBoundingClientRect();
    return `bars: toolbar ${tb ? Math.round(tb.top) + '–' + Math.round(tb.bottom) : '-'}, view bar ${vbr ? Math.round(vbr.top) + '–' + Math.round(vbr.bottom) : '-'}${vb?.classList.contains('vb-stuck') ? ' (stuck)' : ''}, detail bar ${db ? Math.round(db.top) + '–' + Math.round(db.bottom) : '-'}; button at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}×${Math.round(r.height)}, display ${getComputedStyle(el).display}; on top there: ${top === el || el.contains(top) ? 'the button' : name(top)}; library ${lib ? `${Math.round(lib.top)}–${Math.round(lib.bottom)}` : 'gone'}; page at ${Math.round(window.scrollY)}`;
  });
  say(`   ${btn}: ${where}`);
  // The view bar must not sit at the screen's top edge, where iOS takes the taps
  // (Roman's log 20:52:47: view bar 0–35, page at 146 — three taps lost).
  const vbTop = await d.page.evaluate(() => Math.round((document.querySelector('.view-bar') as HTMLElement).getBoundingClientRect().top));
  expect(vbTop, 'THE VIEW BAR IS AT THE TOP EDGE with the library open (iOS takes taps there)').toBeGreaterThanOrEqual(40);
  let clickErr = '';
  await b.tap({ timeout: 5_000 }).catch((e) => { clickErr = String(e).split('\n').slice(0, 3).join(' | '); });
  if (clickErr) say(`   the click failed: ${clickErr}`);
  await d.page.waitForTimeout(800);
  for (const l of (await d.log()).slice(0, 8).reverse()) say(`   app: ${l.trim()}`);
  const open = await d.page.locator('#pictsLibrary').count();
  if (scrolled && !open) say(`   page after closing: ${await d.page.evaluate(() => Math.round(window.scrollY))}`);
  say(`   library after the press: ${open ? 'STILL OPEN' : 'closed'}`);
  expect(clickErr, `THE ${btn.toUpperCase()} BUTTON COULD NOT BE PRESSED with the library open`).toBe('');
  expect(open, `THE LIBRARY STAYED OPEN after ${btn.toUpperCase()} (Roman: "it simply stays in library")`).toBe(0);
  await d.close();
});

// THE PICTS LIBRARY (26 October, Roman).
//
// Step 1 — the server's list: every picture the account ever uploaded, with the
// moment it arrived and the cards that use it today. Read-only.
//
//     npm run t -- -g "picts library"

import { test, expect } from '@playwright/test';
import { API, Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 180_000 });

const RED = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

type Pic = { key: string; uploaded_at: number; size: number; uses: { project: string; shot: string | null; version: string | null }[] };

test('picts library: the server lists every picture of the account, oldest first, with where it is used', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProjectOfKind('LIBRARY ONE', 'landscape', 2);
  await d.settle();

  say('a picture on shot 1, then one on shot 2');
  await d.uploadPicture(0, 'main', RED);
  await d.settle();
  await d.page.waitForTimeout(1200);
  await d.uploadPicture(1, 'main', RED);
  await d.settle();
  await d.page.waitForTimeout(1500);

  const res = await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${token}` } });
  expect(res.ok, 'the list answers').toBe(true);
  const { pictures } = await res.json() as { pictures: Pic[] };
  for (const p of pictures) say(`   ${new Date(p.uploaded_at).toISOString()} · ${p.size} bytes · ${p.uses.map((u) => `${u.project} / shot ${u.shot} / ${u.version}`).join(', ') || 'not on a card'}`);
  expect(pictures.length, 'both pictures').toBeGreaterThanOrEqual(2);
  expect(pictures.every((p) => p.key.includes('/users/') || p.key.startsWith('users/')), 'only this account\'s files').toBe(true);
  expect([...pictures].sort((a, b) => a.uploaded_at - b.uploaded_at).map((p) => p.key), 'oldest first').toEqual(pictures.map((p) => p.key));
  expect(pictures.filter((p) => p.uses.some((u) => u.project === 'LIBRARY ONE')).length, 'and where they are used').toBeGreaterThanOrEqual(2);

  say('step 2: PICTS opens the library — both pictures, under a date line; a tap opens the max screen, which returns here');
  // The project list may still lie over the bars after making the project
  // (runs 481/482: the PICTS tap waited three minutes behind it).
  await d.page.evaluate(() => document.getElementById('projectListModal')?.classList.add('hidden'));
  await d.page.waitForTimeout(300);
  await d.page.locator('#pictsBtn').click({ timeout: 15_000 });
  await expect(d.page.locator('#pictsLibrary'), 'the library').toBeVisible();
  await expect(d.page.locator('#pictsBtn'), 'the button is lit').toHaveClass(/active/);
  await expect.poll(() => d.page.locator('#pictsLibrary .picts-tile').count(), { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const dates = await d.page.locator('#pictsLibrary .picts-date').allTextContents();
  say(`   date lines: ${dates.join(' | ')}`);
  expect(dates.length, 'one line for today').toBe(1);
  await d.page.locator('#pictsLibrary .picts-tile').last().click();
  await expect(d.page.locator('#maxView'), 'the max screen').toBeVisible();
  say(`   max screen says: ${await d.page.locator('#maxView .max-label').textContent()}`);
  await d.page.locator('#maxView .max-close').click();
  await expect(d.page.locator('#maxView')).toBeHidden();
  await expect(d.page.locator('#pictsLibrary'), 'back in the library').toBeVisible();
  say('   another view button takes over: the library closes, the button goes back to normal');
  await d.page.locator('.strip-toggle[data-strip="ver"]').click();
  await expect(d.page.locator('#pictsLibrary')).toHaveCount(0);
  await expect(d.page.locator('#pictsBtn')).not.toHaveClass(/active/);

  say('another account sees none of them');
  const other = await freshAccount();
  const res2 = await fetch(`${API}/user/pictures`, { headers: { Authorization: `Bearer ${other.token}` } });
  const { pictures: theirs } = await res2.json() as { pictures: Pic[] };
  expect(theirs.length, 'a fresh account has an empty library').toBe(0);
  await d.close();
});

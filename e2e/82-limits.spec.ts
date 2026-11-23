// HOW MUCH ONE ACCOUNT CAN HOLD (23 November, list item 15 — numbers and words
// agreed with Roman): 50 projects per account, 300 shots per project.
//
// The one rule: a limit only stops MAKING SOMETHING NEW — at the tap that would
// go over, with a box that says why. It never refuses a save.
//   · shot 300 can be made; the 301st is not, and the box says so
//   · with 50 projects on the account, New project makes nothing and says so
//   · the server itself takes a project up to its own ceiling of 100 (a project
//     made with no connection must never be left stuck on a device), and
//     refuses only past that
//
//     npm run t -- -g "limits"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const API = 'http://127.0.0.1:8787';
const makeOnServer = async (token: string, name: string): Promise<number> =>
  (await fetch(`${API}/projects`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).status;

test('limits: the 301st shot is not made and the box says why — shot 300 is, and everything saves as ever', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  await d.newProject('MANY SHOTS', 299);
  await d.settle();
  for (const sel of ['#projectListClose', '#accountCancel']) {
    const b = d.page.locator(sel);
    if (await b.isVisible().catch(() => false)) await b.click();
  }
  expect((await d.read()).frames.length).toBe(299);
  const pressNew = () => d.page.evaluate(() => {
    const cards = document.querySelectorAll('#mainScroll .frame-card [data-mact="new"]');
    (cards[cards.length - 1] as HTMLElement).click();
  });

  say('299 shots: New makes the 300th');
  await pressNew();
  await expect.poll(async () => (await d.read()).frames.length, { timeout: 15_000 }).toBe(300);
  await expect(d.page.locator('#importantNote'), 'no box at 300').toHaveCount(0);

  say('300 shots: New makes nothing, and the box says why');
  await pressNew();
  const note = d.page.locator('#importantNote');
  await expect(note, 'THE BOX NEVER CAME').toBeVisible({ timeout: 10_000 });
  await expect(note).toContainText('SHOT LIMIT REACHED');
  await expect(note).toContainText('A project can hold 300 shots. Create a new project for more.');
  await note.getByRole('button').click();
  expect((await d.read()).frames.length, 'still 300').toBe(300);

  say('the project of 300 shots saves as ever: a word written under shot 300 reaches the server');
  const before = await d.mark();
  await d.writeUnder(299, 'the last one');
  await d.push();
  await d.waitForLogAfter(before, 'push OK', 60_000);
  await d.close();
});

test('limits: with 50 projects on the account New project makes nothing and says why; the server takes up to 100 and refuses only past that', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);

  say('49 projects are on the account: New project works');
  for (let i = 1; i <= 49; i++) expect(await makeOnServer(token, `P ${i}`)).toBe(201);
  await d.page.evaluate(() => { void (window as never as { __fh_test: { openProjectList(): Promise<void> } }).__fh_test.openProjectList(); });
  await expect(d.page.locator('#projectListNew')).toBeVisible({ timeout: 15_000 });
  const note = d.page.locator('#importantNote');

  say('the 50th is made on the server: now New project makes nothing, and the box says why');
  expect(await makeOnServer(token, 'P 50')).toBe(201);
  await d.page.locator('#projectListNew').click();
  await expect(note, 'THE BOX NEVER CAME').toBeVisible({ timeout: 15_000 });
  await expect(note).toContainText('PROJECT LIMIT REACHED');
  await expect(note).toContainText('An account can hold 50 projects. Delete the old projects you no longer need to make a new one.');
  await note.getByRole('button').click();

  say('the server itself: the 51st to the 100th are taken (a project made offline is never left stuck), the 101st is refused');
  for (let i = 51; i <= 100; i++) expect(await makeOnServer(token, `P ${i}`), `project ${i}`).toBe(201);
  expect(await makeOnServer(token, 'P 101'), 'the 101st').toBe(403);
  await d.close();
});

// LEAVING A PROJECT THAT HAS NO NAME: ASKED ONCE FOR ONE (13 November).
//
// Roman: "people are used to being asked if they should save their work." The
// box that SAVE uses, with its own words, at the moment the person really
// leaves — another project picked from the list — and only for a project with
// work in it and no name of its own.
//
// THE RULES IT HOLDS TO
//   · unnamed work, another project picked → "Name this project"  NOT NOW / SAVE
//   · NOT NOW: the picked project opens; the work becomes "Untitled …" on the server
//   · SAVE with a name: the picked project opens; the work is on the server under that name
//   · a project that has a name is never asked
//
//     npm run t -- e2e/71-name-before-leaving.spec.ts

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 420_000 });
const API = 'http://127.0.0.1:8787';

async function projectHolding(token: string, label: string): Promise<string> {
  const res = await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } });
  const list = ((await res.json()) as { projects: Array<{ id: string; name: string }> }).projects;
  for (const p of list) {
    const tree = (await (await fetch(`${API}/projects/${p.id}/sync`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { frames?: Array<{ label?: string }> };
    if ((tree.frames ?? []).some((f) => f.label === label)) return p.name;
  }
  return `no project holds "${label}" (projects: ${list.map((p) => p.name).join(', ')})`;
}

async function unnamedWork(d: Device, label: string): Promise<void> {
  await d.page.evaluate(async () => {
    await (window as never as { __fh_test: { newUnsavedProject(n: number): Promise<void> } }).__fh_test.newUnsavedProject(2);
  });
  await d.renameFrame(0, label);
  await d.page.waitForTimeout(500);
}
async function pickFromTheList(d: Device, name: string): Promise<void> {
  await d.page.evaluate(() => { void (window as never as { __fh_test: { openProjectList(): Promise<void> } }).__fh_test.openProjectList(); });
  const row = d.page.locator('#projectListContent .project-list-row', { hasText: name }).first();
  await row.waitFor({ state: 'visible', timeout: 15_000 });
  await row.click();
}

test('leaving an unnamed project: asked once for a name — NOT NOW, SAVE, and never for a named one', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);
  const homeId = await d.newProject('HOME', 2);
  await d.settle();
  const box = d.page.locator('#projectNameModal');

  say('unnamed work, HOME is picked from the list: the box asks');
  await unnamedWork(d, 'NO NAME YET');
  await pickFromTheList(d, 'HOME');
  await expect(box, 'THE NAME BOX IS UP').toBeVisible({ timeout: 10_000 });
  await expect(box.locator('h2')).toHaveText('Name this project');
  await expect(d.page.locator('#projectNameContinue')).toHaveText('SAVE');
  await expect(d.page.locator('#projectNameCancel')).toHaveText('NOT NOW');

  say('NOT NOW: HOME opens, the work becomes "Untitled …" on the server');
  await d.page.locator('#projectNameCancel').click();
  await expect.poll(async () => (await d.read()).projectId, { timeout: 60_000 }).toBe(homeId);
  await expect.poll(() => projectHolding(token, 'NO NAME YET'), { timeout: 120_000, intervals: [3_000] }).toMatch(/^Untitled \d/);

  say('unnamed work again, HOME picked: this time a name and SAVE');
  await unnamedWork(d, 'WILL BE NAMED');
  await pickFromTheList(d, 'HOME');
  await expect(box).toBeVisible({ timeout: 10_000 });
  await d.page.locator('#projectNameInput').fill('MY FILM');
  await d.page.locator('#projectNameContinue').click();
  await expect.poll(async () => (await d.read()).projectId, { timeout: 60_000 }).toBe(homeId);
  await expect.poll(() => projectHolding(token, 'WILL BE NAMED'), { timeout: 120_000, intervals: [3_000] }).toBe('MY FILM');

  say('a project with a name is never asked: HOME is left for MY FILM');
  await d.settle();
  await pickFromTheList(d, 'MY FILM');
  await expect.poll(async () => (await d.read()).projectName, { timeout: 60_000 }).toBe('MY FILM');
  await expect(box, 'no name box for a named project').toBeHidden();

  say('work that is ALREADY up there as "Untitled …", named when leaving: the same project is renamed — one, not two');
  await d.openProject(homeId!);
  await d.settle();
  await unnamedWork(d, 'UP AS UNTITLED');
  await d.page.evaluate(() => (window as never as { __fh_test: { waveSaveReminderAway(): void } }).__fh_test.waveSaveReminderAway());
  await expect.poll(() => projectHolding(token, 'UP AS UNTITLED'), { timeout: 120_000, intervals: [2_000] }).toMatch(/^Untitled \d/);
  await d.settle();
  const countBefore = ((await (await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { projects: unknown[] }).projects.length;
  await pickFromTheList(d, 'HOME');
  await expect(box).toBeVisible({ timeout: 10_000 });
  await d.page.locator('#projectNameInput').fill('NAMED LATER');
  await d.page.locator('#projectNameContinue').click();
  await expect.poll(async () => (await d.read()).projectId, { timeout: 60_000 }).toBe(homeId);
  await expect.poll(() => projectHolding(token, 'UP AS UNTITLED'), { timeout: 60_000, intervals: [2_000] }).toBe('NAMED LATER');
  const after = ((await (await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${token}` } })).json()) as { projects: Array<{ name: string }> }).projects;
  expect(after.length, 'THE SAME PROJECT, RENAMED — no second one').toBe(countBefore);
  expect(after.filter((p) => p.name === 'NAMED LATER').length).toBe(1);

  say('and SAVE on a new project still asks in its own words');
  const log = (await d.log()).join('\n');
  expect(log).toContain('leaving an unnamed project: NOT NOW');
  expect(log).toContain('leaving an unnamed project: named "MY FILM"');
  await d.close();
});

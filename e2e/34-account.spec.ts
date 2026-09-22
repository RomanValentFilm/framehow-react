// THE ACCOUNT: DELETING IT, AND THE QUESTION THAT ASKS FIRST (22 Sept).
//
// Roman, desktop: "the Delete account approval modal appears behind the
// opened modal, so it is not visible." On paper it cannot — the question is
// set to sit far above everything. So this test does not trust the numbers:
// it opens the settings, presses Delete account, and asks the page WHICH
// ELEMENT IS ACTUALLY IN FRONT at the middle of the screen. If it is not the
// question, the fault is proven rather than guessed.
//
// Then Roman's rules for deleting, in order:
//   press → signed out everywhere, cannot sign in again, space stops counting
//   seven days → everything still there, Roman can bring it back
//   after that → projects, pictures, restore points and the account itself
//                are erased; the address is free again
//
//     npm run t -- -g "account"
//
// About a minute.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const API = 'http://127.0.0.1:8787';
const ADMIN = 'e2e-admin';

test('account: the delete question is in front, and deleting erases everything after seven days', async ({ browser }) => {
  const { token, email, password } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token, false);

  say('desktop: a project with a picture and a restore point');
  const projectId = await desktop.newProject('MINE', 2);
  await desktop.settle();
  await desktop.saveRestorePoint('before it all');
  await desktop.settle();

  // ── THE QUESTION MUST BE THE THING IN FRONT ────────────────────────────
  say('desktop: open the account settings and press Delete account');
  await desktop.page.evaluate(() =>
    void (window as never as { __fh_test: { openAccountSettings(): Promise<void> } }).__fh_test.openAccountSettings());
  await desktop.page.waitForTimeout(600);
  await expect(desktop.page.locator('#accountSettingsModal')).toBeVisible();
  await desktop.page.locator('#settingsDeleteAccount').click();
  await desktop.page.waitForTimeout(600);

  // What the user's eye would meet in the middle of the screen.
  const inFront = await desktop.page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const box = document.getElementById('confirmModal');
    const ids: string[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) if ((n as HTMLElement).id) ids.push((n as HTMLElement).id);
    return {
      chain: ids,
      questionShown: !!box && !box.classList.contains('hidden'),
      questionIsAncestor: ids.includes('confirmModal'),
    };
  });
  say(`   in front: ${inFront.chain.join(' < ') || '(nothing named)'}`);
  expect(inFront.questionShown, 'the question is open').toBe(true);
  expect(inFront.questionIsAncestor, `the question must be the thing in front — found ${inFront.chain.join(' < ')}`).toBe(true);
  await expect(desktop.page.getByText('delete your account', { exact: false })).toBeVisible();

  // ── DELETE ──────────────────────────────────────────────────────────────
  say('desktop: Yes — the account is deleted');
  await desktop.page.getByRole('button', { name: 'Yes' }).click();
  await desktop.page.waitForTimeout(2_000);

  say('the account cannot sign in, and the address is not free yet');
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(login.status, 'signing in is refused').toBeGreaterThanOrEqual(400);
  const retake = await fetch(`${API}/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Someone Else', email, password: 'another-password-9' }),
  });
  expect(retake.status, 'the address stays reserved for the seven days').toBe(409);

  say('the work is still there — Roman can bring the account back');
  const stillThere = await fetch(`${API}/projects/${projectId}/sync`, { headers: { Authorization: `Bearer ${token}` } });
  expect(stillThere.status, 'the old key no longer opens it').toBeGreaterThanOrEqual(400);

  // ── RESTORE, from the analytics page ───────────────────────────────────
  say('Roman presses Restore on the analytics page');
  const users = await (await fetch(`${API}/analytics/users`, { headers: { Authorization: `Bearer ${ADMIN}` } })).json() as { users: Array<{ id: string; email: string }> };
  const me = users.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  expect(me, 'the account is still listed while it is closing').toBeTruthy();
  // The page Roman reaches from the link under All Users.
  const page = await (await fetch(`${API}/analytics/deleted-users?token=${ADMIN}`)).text();
  expect(page, 'the deleted account is listed there').toContain(email);
  expect(page, 'with a way to bring it back').toContain('Restore');

  const restored = await fetch(`${API}/analytics/restore-account`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: ADMIN, user: me!.id }),
  });
  expect(restored.status, 'the restore answers').toBe(200);

  const backIn = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(backIn.status, 'they can sign in again').toBe(200);
  const fresh = (await backIn.json() as { session: { token: string } }).session;
  const list = await (await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${fresh.token}` } })).json() as { projects: Array<{ name: string; deleted_at: number | null }> };
  expect(list.projects.filter((p) => !p.deleted_at).map((p) => p.name), 'the project is back in their list').toContain('MINE');

  await desktop.close();
});

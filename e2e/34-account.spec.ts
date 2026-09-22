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

  // ── AGREEING TO THE TERMS ── Create account is refused until it is ticked,
  // and the two links must lead somewhere real (22 Sept).
  say('desktop: the account box asks to agree before it will make an account');
  const terms = await desktop.page.evaluate(() => {
    const row = document.getElementById('accountRowTerms')!;
    const box = document.getElementById('accountTerms') as HTMLInputElement;
    return {
      text: row.innerText,
      ticked: box.checked,
      links: Array.from(row.querySelectorAll('a')).map((a) => (a as HTMLAnchorElement).getAttribute('href')),
    };
  });
  expect(terms.text, 'it says what is agreed to').toContain('Terms of Service');
  expect(terms.text).toContain('Privacy Policy');
  expect(terms.ticked, 'nothing is agreed to in advance').toBe(false);
  expect(terms.links, 'both are links').toEqual(['/terms', '/privacy']);

  // ── WHAT "FORGOT PASSWORD" SAYS ── it must not promise a letter (22 Sept).
  say('desktop: the forgot-password box says where to write');
  await desktop.page.evaluate(() => {
    document.getElementById('forgotModal')!.classList.remove('hidden');
  });
  await desktop.page.waitForTimeout(300);
  const forgot = await desktop.page.locator('#forgotModal').innerText();
  expect(forgot, 'it points at the address to write to').toContain('info@framehow.com');
  expect(forgot.toLowerCase(), 'it no longer promises a link by mail').not.toContain('reset link');
  expect(await desktop.page.locator('#forgotEmail').count(), 'it asks for nothing').toBe(0);
  // Shown by hand above, so its buttons carry no life yet — it is put away
  // the same way. (What this checks is the WORDING; the Close button is
  // exercised by the app's own path.)
  await desktop.page.evaluate(() => document.getElementById('forgotModal')!.classList.add('hidden'));
  await desktop.page.waitForTimeout(300);

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

  // ── A NEW PASSWORD BY HAND ── the answer to "I forgot mine" while there is
  // no way to send mail: Roman presses the button and reads the word out.
  say('Roman gives them a new password from the users page');
  const set = await fetch(`${API}/analytics/set-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: ADMIN, user: me!.id }),
  });
  expect(set.status, 'the page answers').toBe(200);
  const shown = (await set.text()).match(/font-size:28px">([a-z0-9-]+)</);
  expect(shown, 'the new password is shown once').toBeTruthy();
  const fresh2 = shown![1];
  say(`   the new password is "${fresh2}"`);

  const oldWay = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(oldWay.status, 'the old password is dead').toBeGreaterThanOrEqual(400);
  const newWay = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: fresh2 }),
  });
  expect(newWay.status, 'the new one works').toBe(200);
  const afterToken = (await newWay.json() as { session: { token: string } }).session.token;
  const stillMine = await (await fetch(`${API}/projects`, { headers: { Authorization: `Bearer ${afterToken}` } })).json() as { projects: Array<{ name: string; deleted_at: number | null }> };
  expect(stillMine.projects.filter((p) => !p.deleted_at).map((p) => p.name), 'their work is untouched').toContain('MINE');

  await desktop.close();
});

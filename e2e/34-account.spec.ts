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

/**
 * THE PROJECT LIST OPENS ITSELF AT START (runs 348–355).
 *
 * An account with nothing in it gets the list over the whole screen — right
 * for a person, and it stays until they close it. Every box these tests press
 * sits behind it until then, so both tests close it the same way: with its own
 * Close button.
 */
async function closeProjectList(d: Device): Promise<void> {
  if (await d.page.locator('#projectListModal:not(.hidden)').count()) {
    say(`${d.name}: closing the project list, as a person does`);
    await d.page.locator('#projectListClose').click();
    await d.page.waitForTimeout(400);
  }
  await expect(d.page.locator('#projectListModal')).toBeHidden();
}

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
  await closeProjectList(desktop);

  say('desktop: the account box asks to agree before it will make an account');
  // OPENED THE WAY THE MENU OPENS IT (run 353). This used to read the markup
  // with the box shut, which says nothing about what a person can reach — and
  // the eye below could not be pressed at all.
  await desktop.page.evaluate(() =>
    void (window as never as { __fh_test: { openAccountBox(): void } }).__fh_test.openAccountBox());
  await desktop.page.waitForTimeout(500);
  await expect(desktop.page.locator('#accountModal')).toBeVisible();
  const terms = await desktop.page.evaluate(() => {
    const row = document.getElementById('accountRowTerms')!;
    const box = document.getElementById('accountTerms') as HTMLInputElement;
    return {
      text: row.innerText,
      ticked: box.checked,
      links: Array.from(row.querySelectorAll('a')).map((a) => (a as HTMLAnchorElement).getAttribute('href')),
    };
  });
  // READ AS IT LOOKS (run 354/355). The line was styled as a field label and
  // came out in capitals; it reads as a sentence now, and the test says so.
  expect(terms.text, 'it says what is agreed to').toContain('Terms of Service');
  expect(terms.text).toContain('Privacy Policy');
  expect(terms.text, 'as a sentence, not shouted').not.toContain('TERMS OF SERVICE');
  expect(terms.ticked, 'nothing is agreed to in advance').toBe(false);

  // ONE COPY OF EACH, at the real address (9 Oct): the pages live with the
  // website now, not inside the app, so dev and live read the same words.
  expect(terms.links, 'both are links').toEqual(['https://framehow.com/terms', 'https://framehow.com/privacy']);

  // THE EYE ON THIS BOX TOO (9 Oct, Roman) — one helper serves this field and
  // the new-password field, so pressing it here proves both are wired.
  await desktop.page.locator('#accountPassword').fill('something-secret-8');
  expect(await desktop.page.locator('#accountPassword').getAttribute('type')).toBe('password');
  await desktop.page.locator('#accountPasswordEye').click();
  expect(await desktop.page.locator('#accountPassword').getAttribute('type'),
    'the eye shows what was typed').toBe('text');
  await desktop.page.locator('#accountPasswordEye').click();
  expect(await desktop.page.locator('#accountPassword').getAttribute('type'),
    'and hides it again').toBe('password');

  await desktop.page.locator('#accountCancel').click();
  await desktop.page.waitForTimeout(400);
  await expect(desktop.page.locator('#accountModal')).toBeHidden();

  // ── THE FORGOT BOX IS CHECKED IN ITS OWN TEST BELOW ─────────────────────
  // Asking for a new password drops every session the account has, so it
  // cannot share a test with the delete-and-restore walk below.

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

// ---------------------------------------------------------------------------
// FORGOT PASSWORD, THE WHOLE WAY ROUND (9 Oct).
//
// Roman took the Workers Paid plan and onboarded framehow.com for Cloudflare
// Email Sending, so the box asks for an address again and a person fixes their
// own password — no more passing one on by hand.
//
// The simulator's own worker has no sending binding: it writes the mail to the
// log and hands the link's token back in its answer (only when it knows it is
// the test worker). So this walks exactly the path a person walks, without
// reading a mailbox.
//
// Its own test because asking for a new password drops every session.
//
//     npm run t -- -g "forgot"
//
// About half a minute.
// ---------------------------------------------------------------------------
test('forgot password: the box asks, the answer never says who is a member, and the link sets a new one', async ({ browser }) => {
  const { token, email, password } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token, false);

  // THE PROJECT LIST IS IN FRONT AT START (runs 348 and 349). An account with
  // nothing in it gets the list opened over the whole screen — right for a
  // person, and it stays open until they close it, so it sat in front of every
  // box this test wants to press. A project, then its own Close button.
  await desktop.newProject('MINE', 2);
  await desktop.settle();
  await closeProjectList(desktop);

  say('desktop: the box asks for the address, opened the way the app opens it');
  await desktop.page.evaluate(() =>
    void (window as never as { __fh_test: { openForgotBox(): void } }).__fh_test.openForgotBox());
  await desktop.page.waitForTimeout(400);
  await expect(desktop.page.locator('#forgotModal')).toBeVisible();
  const box = await desktop.page.locator('#forgotModal').innerText();
  expect(box, 'it says what it will do').toContain("we'll send you a link");
  expect(await desktop.page.locator('#forgotEmail').count(), 'it asks for the address').toBe(1);

  // A STRANGER'S ADDRESS MUST LOOK EXACTLY THE SAME, or anyone can sit here
  // and find out who is a member.
  say('an address with no account: the same answer');
  await desktop.page.locator('#forgotEmail').fill('nobody-at-all@example.com');
  await desktop.page.locator('#forgotSend').click();
  await expect(desktop.page.locator('#forgotTitle')).toHaveText('Check your mail.');
  await desktop.page.locator('#forgotCancel').click();
  await desktop.page.waitForTimeout(300);

  say('the real address: the same answer again');
  await desktop.page.evaluate(() =>
    void (window as never as { __fh_test: { openForgotBox(): void } }).__fh_test.openForgotBox());
  await desktop.page.waitForTimeout(400);
  await desktop.page.locator('#forgotEmail').fill(email);
  await desktop.page.locator('#forgotSend').click();
  // The one sentence takes the heading's place, and nothing else is left on
  // screen to read (9 Oct, Roman).
  await expect(desktop.page.locator('#forgotTitle'), "Roman's one sentence, 9 Oct")
    .toHaveText('Check your mail.');
  await expect(desktop.page.locator('#forgotIntro')).toBeHidden();
  await expect(desktop.page.locator('#forgotRow')).toBeHidden();
  await desktop.page.locator('#forgotCancel').click();
  await desktop.close();

  say('the token the link carries');
  const asked = await (await fetch(`${API}/auth/forgot-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, app: 'http://127.0.0.1:5173/app' }),
  })).json() as { ok: true; dev_token?: string };
  expect(asked.dev_token, 'the simulator can follow the link').toBeTruthy();

  say('the person opens the link: the app comes up asking for a new password');
  const clicked = await Device.open(browser, 'the link', token, false,
    { openWith: `&reset=${asked.dev_token}` });
  await expect(clicked.page.locator('#resetModal')).toBeVisible();
  // THE EYE (9 Oct): hidden to start, readable when pressed, hidden again.
  expect(await clicked.page.locator('#resetPassword').getAttribute('type')).toBe('password');
  await clicked.page.locator('#resetPasswordEye').click();
  expect(await clicked.page.locator('#resetPassword').getAttribute('type'),
    'the eye shows what was typed').toBe('text');
  await clicked.page.locator('#resetPasswordEye').click();
  expect(await clicked.page.locator('#resetPassword').getAttribute('type')).toBe('password');
  await clicked.page.locator('#resetPassword').fill('a-brand-new-password-7');
  await clicked.page.locator('#resetSubmit').click();
  await clicked.page.waitForTimeout(1_500);

  // AND THEY ARE SIGNED IN, not sent back to the sign-in box for a password
  // they chose one second earlier (9 Oct, Roman).
  await expect(clicked.page.locator('#resetModal')).toBeHidden();
  const stillIn = await clicked.page.evaluate(() => localStorage.getItem('fh_session_token'));
  expect(stillIn, 'the device holds a sign-in').toBeTruthy();
  const whoami = await fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${stillIn}` } });
  expect(whoami.status, 'and the server knows that sign-in').toBe(200);

  const byNew = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'a-brand-new-password-7' }),
  });
  expect(byNew.status, 'the password chosen through the link works').toBe(200);
  const byOld = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  expect(byOld.status, 'and the old one is dead').toBeGreaterThanOrEqual(400);

  await clicked.close();

  say('and the link cannot be used twice');
  const again = await fetch(`${API}/auth/reset-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: asked.dev_token, password: 'something-else-9' }),
  });
  expect(again.status, 'a used link is refused').toBeGreaterThanOrEqual(400);
});

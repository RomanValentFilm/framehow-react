// RATE LIMITS (audit 9 Nov, B3d — "no rate limiting anywhere").
//
// The doors and their numbers, agreed with Roman: sign-in 10 wrong passwords
// per email per 15 min · sign-up 5 per address per hour · forgot mail 3 per
// email per hour · upload 60 per account per minute (a burst guard) · the
// /track beacon 600 per address per hour.
//
// On the test worker the limits count only requests carrying the header
// X-FH-Rate-Test: 1, so this test proves the doors while every other test
// signs in and up as often as it likes.
//
//     npm run t -- -g "rate limits"
//
// Under a minute.

import { test, expect } from '@playwright/test';
import { freshAccount, say } from './harness';

test.describe.configure({ timeout: 120_000 });

const API = 'http://127.0.0.1:8787';
const H = { 'Content-Type': 'application/json', 'X-FH-Rate-Test': '1' };

test('rate limits: the sign-in wall after 10 wrong passwords, the right one clears it; sign-up and forgot mail have theirs', async () => {
  const { email, password } = await freshAccount();

  say('sign-in: 10 wrong passwords are refused as wrong, the 11th as too many');
  for (let i = 1; i <= 10; i++) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: `wrong-${i}` }) });
    expect(r.status, `wrong password ${i} is simply wrong`).toBe(401);
  }
  const wall = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password: 'wrong-11' }) });
  expect(wall.status, 'the 11th is the wall').toBe(429);
  expect(((await wall.json()) as { error: { code: string } }).error.code).toBe('rate_limited');
  say('   …and the right password is held back too, until the window passes');
  const rightNow = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email, password }) });
  expect(rightNow.status, 'behind the wall even the right password waits').toBe(429);

  say('another account is untouched by that wall, and its right password clears its own count');
  const other = await freshAccount();
  for (let i = 1; i <= 9; i++) {
    await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: other.email, password: `wrong-${i}` }) });
  }
  const ok = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: other.email, password: other.password }) });
  expect(ok.status, 'the right password works at try 10').toBe(200);
  for (let i = 1; i <= 10; i++) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: H, body: JSON.stringify({ email: other.email, password: `again-${i}` }) });
    expect(r.status, `after a good sign-in the count starts over (wrong ${i})`).toBe(401);
  }

  say('forgot-password mail: 3 per email per hour, the 4th refused');
  for (let i = 1; i <= 3; i++) {
    const r = await fetch(`${API}/auth/forgot-password`, { method: 'POST', headers: H, body: JSON.stringify({ email: other.email }) });
    expect(r.status, `forgot mail ${i} answers`).toBeLessThan(400);
  }
  const fourth = await fetch(`${API}/auth/forgot-password`, { method: 'POST', headers: H, body: JSON.stringify({ email: other.email }) });
  expect(fourth.status, 'the 4th is too many').toBe(429);

  say('sign-up: 5 per address per hour, the 6th refused');
  const stamp = Date.now();
  for (let i = 1; i <= 5; i++) {
    const r = await fetch(`${API}/auth/signup`, {
      method: 'POST', headers: H,
      body: JSON.stringify({ name: `Crowd ${i}`, email: `crowd-${stamp}-${i}@example.com`, password: 'a-long-password-9', terms_agreed_at: Date.now() }),
    });
    expect(r.status, `sign-up ${i} goes through`).toBeLessThan(400);
  }
  const sixth = await fetch(`${API}/auth/signup`, {
    method: 'POST', headers: H,
    body: JSON.stringify({ name: 'Crowd 6', email: `crowd-${stamp}-6@example.com`, password: 'a-long-password-9', terms_agreed_at: Date.now() }),
  });
  expect(sixth.status, 'the 6th is too many').toBe(429);

  say('without the test header nothing is counted — the bench stays fast');
  const free = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  expect(free.status, 'the first account signs in without the header').toBe(200);
});

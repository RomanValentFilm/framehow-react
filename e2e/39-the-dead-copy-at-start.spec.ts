// THE DEAD COPY AT START (12 October, Roman's iPad).
//
// His iPad still held an unsent copy of "Juraj" — a project deleted on the
// server in September. Every start tried to send that copy FIRST, the server
// said "Project not found", the copy was kept, and the start ended on an EMPTY
// screen instead of the project that was open. Every start, the same.
//
// Now: a copy whose project the server no longer has is PARKED — kept on the
// device, shown in the project list as a device copy (save as new, or Delete
// now), never sent on its own again — and the start always ends on the project
// that was open.
//
//     npm run t -- -g "dead copy"
//
// About two minutes.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

test('the dead copy at start: parked, listed, never retried — and the start is never empty', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const ipad = await Device.open(browser, 'ipad', token, true);

  say('desktop: JURAJ, three shots, on the server; the iPad has its own project open');
  const juraj = await desktop.newProject('JURAJ', 3);
  await desktop.settle();
  expect(juraj).toBeTruthy();
  await ipad.newProject('IPAD OWN', 1);
  await ipad.settle();

  say('desktop goes offline, writes on JURAJ, then starts BEACH CLUB — JURAJ is filed as an unsent copy');
  await desktop.offline(true);
  await desktop.page.waitForTimeout(4000);
  await desktop.writeUnder(0, 'written on JURAJ with no signal');
  await desktop.page.waitForTimeout(3000);                 // the local save has its two seconds
  await desktop.buildProjectWithoutSaving('BEACH CLUB', 4);
  await desktop.writeUnder(1, 'beach club, shot 2');
  await desktop.page.waitForTimeout(3000);                 // ...and so does BEACH CLUB's
  const copies = await desktop.deviceCopies();
  say(`   device copies: ${copies.map((c) => `${c.name}${c.parked ? ' (parked)' : ''}`).join(' · ') || '(none)'}`);
  expect(copies.map((c) => c.name), 'JURAJ waits as an unsent copy').toContain('JURAJ');

  say('meanwhile the iPad deletes JURAJ for good — the server will not have it any more');
  await ipad.deleteProjectNow(juraj!);
  await ipad.settle();
  expect((await Device.projectsWithState(token)).map((p) => p.name), 'gone from the server').not.toContain('JURAJ');

  say('desktop comes back and RESTARTS at once — the start meets the dead copy');
  await desktop.offline(false);
  await desktop.reload();
  await desktop.waitForLog('unsent copy of "JURAJ"', 30_000);
  await desktop.waitForLog('PARKED', 30_000);
  await desktop.settle();

  const after = await desktop.read();
  say(`   on screen after the start: "${after.projectName}" with ${after.frames.length} shot(s)`);
  expect(after.frames.length, 'THE START ENDED EMPTY (Roman, 12 Oct) — BEACH CLUB must be back').toBe(4);
  expect(after.projectName, 'and it is BEACH CLUB').toBe('BEACH CLUB');
  expect(after.frames[1].text, 'with what was written in it').toBe('beach club, shot 2');

  const parked = await desktop.deviceCopies();
  say(`   device copies now: ${parked.map((c) => `${c.name}${c.parked ? ' (parked)' : ''}`).join(' · ') || '(none)'}`);
  const jurajCopy = parked.find((c) => c.name === 'JURAJ');
  expect(jurajCopy, 'the JURAJ copy is still on the device — nothing is lost').toBeTruthy();
  expect(jurajCopy!.parked, 'and it is parked').toBe(true);

  say('a second restart: the parked copy is left alone');
  await desktop.reload();
  await desktop.settle();
  const log = await desktop.log();
  expect(log.some((l) => l.includes('is parked')), 'the start says it is parked').toBe(true);
  expect(log.some((l) => l.includes('unsent copy of "JURAJ"') && l.includes('uploading')), 'and does NOT try it again').toBe(false);
  const again = await desktop.read();
  expect(again.frames.length, 'BEACH CLUB is on screen again').toBe(4);
  expect(again.projectName).toBe('BEACH CLUB');

  say('and BEACH CLUB, made with no signal, reaches the server by itself');
  // The timer looks every 40 s; two looks, with room (run 365: silent for 90 s).
  const deadline = Date.now() + 120_000;
  let id = again.projectId;
  while (!id && Date.now() < deadline) {
    await desktop.nudge();
    await desktop.page.waitForTimeout(1000);
    id = (await desktop.read()).projectId;
  }
  if (!id) say('   the app\'s log:\n' + (await desktop.log()).slice(0, 30).map((l) => '      ' + l).join('\n'));
  expect(id, 'BEACH CLUB has a cloud id').toBeTruthy();
  expect((await Device.projectNames(token)), 'the server lists it').toContain('BEACH CLUB');

  await desktop.close();
  await ipad.close();
});

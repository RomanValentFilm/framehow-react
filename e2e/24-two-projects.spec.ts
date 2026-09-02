// TWO PROJECTS ARE TWO PROJECTS (#423).
//
// The door that makes a project used to call startFromScratch, which empties
// the storyboard but leaves the app still pointing at the project that was
// open. saveNow() then wrote the "new" project INTO the old one and handed back
// the old id — so every test that made two projects was really working on one,
// and nothing could ever catch a fault in switching between them.
//
// That is not a small hole. The project-switch path is where the frames of one
// project got adopted by another (#417), and it went months unnoticed because
// no test could reach it.
//
//     npm run t -- e2e/24-two-projects.spec.ts

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test('two projects made one after the other stay separate', async ({ browser }) => {
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);

  say('desktop: making the first project, three frames');
  const first = await desktop.newProject('ONE', 3);
  await desktop.settle();
  expect(first, 'the first project should have an id on the server').toBeTruthy();
  expect((await desktop.read()).frames.length, 'ONE holds three frames').toBe(3);

  say('desktop: making a second project, two frames');
  const second = await desktop.newProject('TWO', 2);
  await desktop.settle();

  expect(second, 'THE SECOND PROJECT GOT THE FIRST ONE\'S ID — they are the same project')
    .not.toBe(first);
  expect((await desktop.read()).frames.length, 'TWO holds two frames, not five')
    .toBe(2);

  say('desktop: back to the first one');
  await desktop.openProject(first!);
  await desktop.settle();
  expect((await desktop.read()).frames.length,
    'ONE STILL HOLDS ITS OWN THREE FRAMES — nothing from TWO came with it')
    .toBe(3);

  say('desktop: and forward to the second again');
  await desktop.openProject(second!);
  await desktop.settle();
  expect((await desktop.read()).frames.length,
    'AND TWO STILL HOLDS TWO — nothing from ONE was adopted')
    .toBe(2);

  await desktop.close();
});

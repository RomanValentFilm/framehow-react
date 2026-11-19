// WHAT THE SHOTS OF AN IMPORTED PROJECT ARE CALLED (19 November, list item 13).
//
// "Load Images from Folder" names each shot after its file. Pictures from the
// Photos picker on an iPhone or iPad arrive under a long random code, and the
// shots were labelled "9406091e 2a7" in any order. Such pictures are now
// numbered in the order they were picked.
//
// Roman: "write a test that checks the frame names of the ordinary frames
// extracted from the shooting board and properly named frames from the folder
// … just to be sure that we don't break anything else." So, all in one place:
//   · properly named files keep their names, exactly as before
//   · files named by a code are numbered 1, 2, 3 in the order picked
//   · both together: the named keep theirs, the coded go on after the highest number
//   · a camera's own names (IMG_8813 …): the person is asked — number them from a
//     start of their own, or keep the numbers
//   · the storyboard PDFs: shots are extracted and none is named by a code (their
//     names come from the PDF itself — that code is not touched by any of this);
//     their names are pinned below as run 829 read them
//
//     npm run t -- -g "names of imported shots"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const CODE = /^[0-9a-f]{8}[- ][0-9a-f]{4}/i;
const PDF_NAMES: Record<string, { shots: number; first: string[] }> = {
  'storyboard01.pdf': { shots: 18, first: ['1.', '2.', '3.', '4.', '5A.', '5B.', '6.', '7.', '8.', '9.', '10.', '11.'] },
  'storyboard02.pdf': { shots: 23, first: ['FRAME 01', 'FRAME 02', 'FRAME 03', 'FRAME 05', 'FRAME 06A', 'FRAME 06B', 'FRAME 07', 'FRAME 08', 'FRAME 09', 'FRAME 10A', 'FRAME 10B', 'FRAME 11'] },
  'storyboard03.pdf': { shots: 12, first: ['#1', '#2', '#3', '#4', '#5', '#6', '#7', '#8', '#9', '#10', '#11', '#12'] },
};
const pictures = (d: Device, name: string, files: string[]) => d.page.evaluate(([n, f]) =>
  (window as never as { __fh_test: { importPicturesProject(n: string, c: number, names: string[]): Promise<string | null> } })
    .__fh_test.importPicturesProject(n as string, (f as string[]).length, f as string[]), [name, files] as [string, string[]]);
const labels = async (d: Device) => (await d.read()).frames.map((f) => f.label);

test('names of imported shots: named files keep their names, files named by a code are numbered as picked, the storyboard PDFs are named as ever', async ({ browser }) => {
  const { token } = await freshAccount();
  const d = await Device.open(browser, 'desktop', token);

  say('a folder of properly named pictures: beach_01 … beach_04 → 01 02 03 04, as before');
  await pictures(d, 'NAMED', ['beach_01.jpg', 'beach_02.jpg', 'beach_03.jpg', 'beach_04.jpg']);
  expect(await labels(d)).toEqual(['01', '02', '03', '04']);

  say('…picked in another order: still put in the order of their numbers, as before');
  await pictures(d, 'NAMED, SHUFFLED', ['beach_03.jpg', 'beach_01.jpg', 'beach_02.jpg']);
  expect(await labels(d)).toEqual(['01', '02', '03']);

  say('…names with words of their own are kept whole, as before');
  await pictures(d, 'WORDS', ['kitchen wide.jpg', 'garden close.jpg']);
  expect((await labels(d)).slice().sort()).toEqual(['garden close', 'kitchen wide']);

  say('pictures from the Photos picker (a random code each): 1 2 3, in the order picked');
  await pictures(d, 'FROM PHOTOS', ['9406091e-2a71-4759-80ad-76b1b6478787.jpeg', '0a11c3d2-7b6e-4f00-9a1b-2c3d4e5f6a7b.jpeg', 'fe01aa22-0000-4bbb-8ccc-123456789abc.jpeg']);
  expect(await labels(d)).toEqual(['1', '2', '3']);

  say('both together: the named keep theirs, the coded go on after the highest number');
  await pictures(d, 'MIXED', ['scene_07.jpg', '9406091e-2a71-4759-80ad-76b1b6478787.jpeg', 'scene_03.jpg', '0a11c3d2-7b6e-4f00-9a1b-2c3d4e5f6a7b.jpeg']);
  expect(await labels(d)).toEqual(['03', '07', '8', '9']);

  // A CAMERA'S OWN NAMES: THE PERSON IS ASKED (19 Nov, words agreed with Roman).
  const box = d.page.locator('#shotNamesOverlay');
  const fromCamera = ['IMG_8817.png', 'IMG_8813.jpeg', 'IMG_8820.png', 'IMG_8814.jpeg'];

  say('pictures with a camera\'s names (IMG_8813 …): the question, with its agreed words — OK as it stands numbers them 01 02 03 04');
  let making = pictures(d, 'FROM THE CAMERA', fromCamera);
  await expect(box, 'THE QUESTION NEVER CAME').toBeVisible({ timeout: 10_000 });
  await expect(box).toContainText('PLEASE CHECK THE IMPORTED SHOT NAMES:');
  await expect(box).toContainText('These pictures carry names (IMG_8813 … IMG_8820).');
  await expect(box).toContainText('CHANGE NUMBERS TO');
  await expect(box).toContainText('Start numbering at:');
  await expect(box).toContainText('KEEP ORIGINAL NUMBERS');
  await expect(d.page.locator('#shotNamesStart')).toHaveValue('01');
  await expect(d.page.locator('#shotNamesChange'), 'CHANGE is ticked to begin with').toBeChecked();
  await d.page.locator('#shotNamesKeep').check();
  await expect(d.page.locator('#shotNamesChange'), 'only one of the two can be ticked').not.toBeChecked();
  await d.page.locator('#shotNamesChange').check();
  await expect(d.page.locator('#shotNamesKeep')).not.toBeChecked();
  await d.page.locator('#shotNamesOk').click();
  await making;
  expect(await labels(d), 'numbered from 01, in the order the photos were taken').toEqual(['01', '02', '03', '04']);

  say('…a start of one\'s own: 5 → 5 6 7 8');
  making = pictures(d, 'FROM THE CAMERA, FROM 5', fromCamera);
  await expect(box).toBeVisible({ timeout: 10_000 });
  await d.page.locator('#shotNamesStart').fill('5');
  await d.page.locator('#shotNamesOk').click();
  await making;
  expect(await labels(d)).toEqual(['5', '6', '7', '8']);

  say('…KEEP ORIGINAL NUMBERS: 8813 8814 8817 8820, as before');
  making = pictures(d, 'FROM THE CAMERA, KEPT', fromCamera);
  await expect(box).toBeVisible({ timeout: 10_000 });
  await d.page.locator('#shotNamesKeep').check();
  await d.page.locator('#shotNamesOk').click();
  await making;
  expect(await labels(d)).toEqual(['8813', '8814', '8817', '8820']);
  await expect(box, 'a folder somebody named is never asked about (the plays above)').toHaveCount(0);

  for (const pdf of Device.fixturePdfs()) {
    const id = await d.importPdfProject(`PDF — ${pdf}`, pdf);
    if (!id) continue;
    await d.settle();
    const got = await labels(d);
    say(`   ${pdf}: ${got.length} shot(s) — ${got.slice(0, 12).join(' · ')}${got.length > 12 ? ' …' : ''}`);
    expect(got.length, `${pdf}: shots were extracted`).toBeGreaterThan(0);
    expect(got.filter((l) => CODE.test(l)), `${pdf}: no shot is named by a code`).toEqual([]);
    // THE NAMES AS RUN 829 READ THEM (19 Nov) — pinned, so a later change shows.
    const pinned = PDF_NAMES[pdf];
    if (pinned) {
      expect(got.length, `${pdf}: the number of shots`).toBe(pinned.shots);
      expect(got.slice(0, pinned.first.length), `${pdf}: the names of its first shots`).toEqual(pinned.first);
    }
  }

  await d.close();
});

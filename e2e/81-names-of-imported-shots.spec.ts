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
//   · the storyboard PDFs: shots are extracted and none is named by a code (their
//     names come from the PDF itself — that code is not touched by any of this);
//     the names are written into the log, to be pinned here after the first run
//
//     npm run t -- -g "names of imported shots"

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 300_000 });

const CODE = /^[0-9a-f]{8}[- ][0-9a-f]{4}/i;
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

  for (const pdf of Device.fixturePdfs()) {
    const id = await d.importPdfProject(`PDF — ${pdf}`, pdf);
    if (!id) continue;
    await d.settle();
    const got = await labels(d);
    say(`   ${pdf}: ${got.length} shot(s) — ${got.slice(0, 12).join(' · ')}${got.length > 12 ? ' …' : ''}`);
    expect(got.length, `${pdf}: shots were extracted`).toBeGreaterThan(0);
    expect(got.filter((l) => CODE.test(l)), `${pdf}: no shot is named by a code`).toEqual([]);
    // (the names themselves are written into the log above: after this first run
    // they are pinned here, per PDF, so that any later change to them shows)
  }

  await d.close();
});

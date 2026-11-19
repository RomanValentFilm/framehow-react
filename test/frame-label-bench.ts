// WHAT A NEW FRAME IS CALLED — the rule, proven (9 October, Roman).
//
//   npm run bench:label
//
// Every line of the rule in src/lib/frameLabel.ts, as a plain statement with
// the answer next to it. One second, no browser.

import { nextFrameLabel, nameIsOnlyACode, labelsForPickedPictures } from '../src/lib/frameLabel';

let failed = 0;
function is(what: string, got: string, want: string): void {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? '  ok ' : 'FAIL'}  ${what}  →  ${got}${ok ? '' : `   (wanted ${want})`}`);
}

console.log('NEW ON THE LAST FRAME, labels are numbers → the next number');
is('1 2 3, NEW on 3',                       nextFrameLabel(['1', '2', '3'], 2, 'landscape'), '4');
is('1 2 3 3#1, NEW on 3#1',                 nextFrameLabel(['1', '2', '3', '3#1'], 3, 'landscape'), '4');
is('a single frame 1, NEW on it',           nextFrameLabel(['1'], 0, 'landscape'), '2');
is('1 2 3 4 5 with 4 and 5 hidden, NEW on 5', nextFrameLabel(['1', '2', '3', '4', '5'], 4, 'landscape'), '6');
is('9x16 project 1 2, NEW on 2',            nextFrameLabel(['1', '2'], 1, 'portrait'), '3');
is('PDF of 48 shots, NEW on 48',            nextFrameLabel(Array.from({ length: 48 }, (_, i) => String(i + 1)), 47, 'landscape'), '49');
is('3#1 2 9 — numbers out of order, NEW on 9', nextFrameLabel(['3#1', '2', '9'], 2, 'landscape'), '10');
is('1 2 5 — a gap, NEW on 5',               nextFrameLabel(['1', '2', '5'], 2, 'landscape'), '6');

console.log('\nNEW ON THE LAST FRAME, but the last label is not a number → the #1 form');
is('1 2 INTRO, NEW on INTRO',               nextFrameLabel(['1', '2', 'INTRO'], 2, 'landscape'), 'INTRO#1');
is('… 12A 12B, NEW on 12B',                 nextFrameLabel(['11', '12A', '12B'], 2, 'landscape'), '12B#1');
is('… 12B#1, NEW on it',                    nextFrameLabel(['11', '12A', '12B', '12B#1'], 3, 'landscape'), '12B#2');
is('an empty label, NEW on it',             nextFrameLabel(['1', ''], 1, 'landscape'), '#1');

console.log('\nNEW IN THE MIDDLE → the #1 form, as before');
is('after 21, with 22 behind it',           nextFrameLabel(['21', '22'], 0, 'landscape'), '21#1');
is('after 21#1, with 22 behind it',         nextFrameLabel(['21', '21#1', '22'], 1, 'landscape'), '21#2');
is('after 4a, with 5 behind it',            nextFrameLabel(['4a', '5'], 0, 'landscape'), '4a#1');
is('1 2 3 with a hidden 4 at the end, NEW on 3', nextFrameLabel(['1', '2', '3', '4'], 2, 'landscape'), '3#1');
is('9x16: after 1, with 2 behind it',       nextFrameLabel(['1', '2'], 0, 'portrait'), '1#1');

console.log('\nA NAME NOBODY HAS YET (10 Nov) — the new shot only, nothing existing is renamed');
is('after 2, with 2#1 2#2 behind it',       nextFrameLabel(['1', '2', '2#1', '2#2', '3'], 1, 'landscape'), '2#3');
is('after 2#1, with 2#2 behind it',         nextFrameLabel(['1', '2', '2#1', '2#2', '3'], 2, 'landscape'), '2#3');
is('after 2, with only 2#2 behind it — 2#1 is free', nextFrameLabel(['1', '2', '2#2', '3'], 1, 'landscape'), '2#1');
is('after INTRO, with INTRO#1 behind it',   nextFrameLabel(['INTRO', 'INTRO#1', '5'], 0, 'landscape'), 'INTRO#2');
is('two shots already both called 7 — NEW on the first', nextFrameLabel(['7', '7', '8'], 0, 'landscape'), '7#1');
is('…and again, 7#1 now taken',             nextFrameLabel(['7', '7#1', '7', '8'], 0, 'landscape'), '7#2');

console.log('\nFITTING keeps its own rule');
is('fitting, NEW anywhere',                 nextFrameLabel(['Name', 'Name'], 1, 'fitting'), 'Name');
is('fitting, NEW in the middle',            nextFrameLabel(['Name', 'Name'], 0, 'fitting'), 'Name');

console.log('\nA PROJECT FROM PICTURES: a file name that is only a code is no name (19 Nov)');
is('a UUID from the Photos picker is a code',   String(nameIsOnlyACode('9406091e-2a71-4759-80ad-76b1b6478787')), 'true');
is('a long hex run is a code',                  String(nameIsOnlyACode('3f2a91bc77de0041aa')), 'true');
is('IMG_4021 is a name',                        String(nameIsOnlyACode('IMG_4021')), 'false');
is('beach_01 is a name',                        String(nameIsOnlyACode('beach_01')), 'false');
is('20261119-153000 (only digits) is a name',   String(nameIsOnlyACode('20261119-153000')), 'false');
is('"deadbeef" (short) is a name',              String(nameIsOnlyACode('deadbeef')), 'false');
const codes = ['9406091e-2a71-4759-80ad-76b1b6478787', '0a11c3d2-7b6e-4f00-9a1b-2c3d4e5f6a7b', 'fe01aa22-0000-4bbb-8ccc-123456789abc'];
is('three pictures from Photos → 1 2 3, in the order picked', labelsForPickedPictures(codes, ['9406091e 2a71', '0a11c3d2 7b6e', 'fe01aa22 0000']).join(' '), '1 2 3');
is('real names keep theirs',                    labelsForPickedPictures(['beach_01', 'beach_02'], ['01', '02']).join(' '), '01 02');
is('mixed: codes go on after the highest number', labelsForPickedPictures(['shot_07', codes[0], 'shot_03', codes[1]], ['07', 'x', '03', 'y']).join(' '), '07 8 03 9');

console.log(failed ? `\n${failed} FAILED` : '\nall green');
process.exit(failed ? 1 : 0);

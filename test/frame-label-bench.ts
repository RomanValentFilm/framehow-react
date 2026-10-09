// WHAT A NEW FRAME IS CALLED — the rule, proven (9 October, Roman).
//
//   npm run bench:label
//
// Every line of the rule in src/lib/frameLabel.ts, as a plain statement with
// the answer next to it. One second, no browser.

import { nextFrameLabel } from '../src/lib/frameLabel';

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

console.log('\nFITTING keeps its own rule');
is('fitting, NEW anywhere',                 nextFrameLabel(['Name', 'Name'], 1, 'fitting'), 'Name');
is('fitting, NEW in the middle',            nextFrameLabel(['Name', 'Name'], 0, 'fitting'), 'Name');

console.log(failed ? `\n${failed} FAILED` : '\nall green');
process.exit(failed ? 1 : 0);

// WHAT A NEW FRAME IS CALLED (9 October, Roman's rule).
//
// One rule for every project except fitting:
//
//   NEW on the LAST frame of the project, when the labels are numbers
//     → the next number: highest number anywhere in the project, plus one.
//       1 2 3        → 4
//       1 2 3 3#1    → 4        (3#1 counts as 3; the next is still 4)
//       1 2 INTRO    → INTRO#1  (the last one is not a number — nothing to count from)
//       1 … 12A 12B  → 12B#1    (12B is not a number; 13 or 12C would be a guess)
//
//   NEW anywhere else → the #1 form, exactly as before:
//       after 21, with 22 behind it → 21#1, then 21#2
//       after 4a → 4a#1
//
// "Last" means last in the WHOLE project, hidden frames included — a hidden 4
// behind a visible 3 makes NEW on 3 a middle insert (3#1), because a second 4
// would be a double and a 5 would hide a gap. "Highest number" is likewise
// taken over every frame, hidden or not.
//
// Fitting keeps its own rule ("Name"), and 9x16 is no longer special: it used
// to call every new frame "name", which was a placeholder nobody asked for —
// names are a fitting thing, numbers are for everything else.
//
// Pure: given the labels and the place, it answers. Nothing here touches the
// store, so the bench can prove every line of the rule in a millisecond.

/** A label that is a plain number, with or without a #n tail: "3", "12", "3#2". */
const NUMBERED = /^(\d+)(?:#\d+)$|^(\d+)$/;

function numberOf(label: string): number | null {
  const m = (label || '').trim().match(NUMBERED);
  if (!m) return null;
  return parseInt(m[1] ?? m[2], 10);
}

/** The #1 form: "3" → "3#1", "3#1" → "3#2", "4a" → "4a#1". */
export function hashLabel(prevLabel: string): string {
  const m = (prevLabel || '').match(/^(.+)#(\d+)$/);
  return m ? `${m[1]}#${parseInt(m[2], 10) + 1}` : `${prevLabel || ''}#1`;
}

export function nextFrameLabel(
  allLabels: readonly string[],
  afterIndex: number,
  projectType: string,
): string {
  if (projectType === 'fitting') return 'Name';
  const prev = allLabels[afterIndex] ?? '';
  const isLast = afterIndex === allLabels.length - 1;
  if (isLast && numberOf(prev) !== null) {
    let highest = 0;
    for (const l of allLabels) {
      const n = numberOf(l);
      if (n !== null && n > highest) highest = n;
    }
    return String(highest + 1);
  }
  return hashLabel(prev);
}

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
  // A NAME NOBODY HAS YET (Roman, 10 Nov). After "2", with "2#1" and "2#2"
  // already behind it, the new shot was called "2#1" again — two shots with
  // one name. The #n counts on until the name is free: "2#3". Only the NEW
  // shot's name is chosen here; no existing shot is ever renamed — a
  // storyboard may well hold two shots of the same name on purpose.
  const taken = new Set(allLabels.map((l) => (l || '').trim()));
  let name = hashLabel(prev);
  for (let guard = 0; taken.has(name.trim()) && guard < 1000; guard++) name = hashLabel(name);
  return name;
}

// ---------------------------------------------------------------------------
// A PROJECT MADE FROM PICTURES: THE NAME OF A FILE THAT IS ONLY A CODE (19 Nov,
// list item 13 — found in the simulator on 5 Nov).
//
// "Load Images from Folder" names each shot after its file: beach_01.jpg, 02,
// 03… From the Photos picker on an iPhone or iPad there is no such name: every
// picture arrives as a long random code ("9406091e-2a71-4759-80ad-76b1b6478787"),
// the shots were labelled "9406091e 2a7", and they were put in order by the
// first digits of that code — any order at all.
//
// A name that is only a code is no name. Such pictures are NUMBERED, in the
// order they were picked: after the highest number the other files bring, or
// 1, 2, 3 when all of them are codes. Files with real names keep them.
// ---------------------------------------------------------------------------

/** Is this file name (without its ending) only a random code? */
export function nameIsOnlyACode(base: string): boolean {
  const n = (base || '').trim();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(n)) return true;   // a UUID
  // …or a long run of hex digits and dashes with both letters and digits in it
  return n.length >= 16 && /^[0-9a-f-]+$/i.test(n) && /[a-f]/i.test(n) && /\d/.test(n);
}

/** The labels for a project made from pictures: `labels[i]` is what file i would
 *  be called by its name; where that name is only a code, a number takes its place. */
export function labelsForPickedPictures(baseNames: readonly string[], labels: readonly string[]): string[] {
  let highest = 0;
  baseNames.forEach((n, i) => {
    if (nameIsOnlyACode(n)) return;
    const m = (labels[i] || '').match(/\d+/);
    if (m && parseInt(m[0], 10) > highest) highest = parseInt(m[0], 10);
  });
  let next = highest;
  return baseNames.map((n, i) => (nameIsOnlyACode(n) ? String(++next) : labels[i]));
}

// ---------------------------------------------------------------------------
// …AND A FILE NAMED BY THE CAMERA (19 Nov, Roman's iPhone: five pictures from
// Photos, "IMG_8813.jpeg" … — the shots were called 8813, 8814, 8817: "that's
// weird if an image is called 8813"). That number is the phone's running photo
// counter, not a shot number. The person is asked (modals.ts,
// askImportedShotNames): number them from a start they choose, or keep them.
// ---------------------------------------------------------------------------

/** The counter in a camera's own file name — IMG_8813, DSC_0042, PXL_2026…,
 *  GOPR0123 — or null when the name is not a camera's. */
export function cameraNumberOf(base: string): number | null {
  const m = (base || '').trim().match(/^(?:IMG|DSC|DSCN|DSCF|PXL|MVI|GOPR|DJI|SAM|PICT|P)[ _-]?(\d{3,})(?:[ _-]\d+)*$/i);
  return m ? parseInt(m[1], 10) : null;
}

/** "01" → 01 02 03 …; "5" → 5 6 7; "010" → 010 011. The form that was typed is kept. */
export function numberedFrom(start: string, count: number): string[] {
  const typed = /^\d+$/.test((start || '').trim()) ? start.trim() : '01';
  const from = parseInt(typed, 10);
  return Array.from({ length: count }, (_, i) => String(from + i).padStart(typed.length, '0'));
}


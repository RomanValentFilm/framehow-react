// DID A HAND MOVE SOMETHING, OR DID THE APP JUST FILL ONE IN? (#490)
//
// THE FAULT, in Roman's words: "you rearrange on the Desktop, the iPad keeps the
// old order." The breaks arrived; the shots did not. The iPad's own log said
// why — "arrangement NOT taken: mine is newer and unsent" — and the Desktop was
// saying the same thing about the iPad. Both refused the other, for ever.
//
// WHY BOTH THOUGHT THEY HAD SOMETHING TO DEFEND. An arrangement is a list of the
// shots' permanent names. It can be short: a project's first arrangement is
// written while it still has the one shot `startFromScratch` makes, and a shot
// added on another device is not in it until someone sends it again. So a device
// opens the project, holds sixteen shots against a list naming one, and
// `applyArrangement` slots the fifteen in behind the shots they already follow —
// which is right, and is #398 and #405.
//
// But the list it now holds is not the list that arrived, so the settings
// machinery recorded it as an edit THIS DEVICE made. Two devices did that
// seconds apart, and "the later one wins" then chose between two corrections
// nobody made — throwing away the one real rearrangement.
//
// Roman's rule, which this exists to protect: "the only thing in an order that
// is truly data is the hand rearranging, because nothing else can recreate it."
// Filling in a shot the list forgot is not a hand. It must never win an argument.
//
// THE TEST NEEDS NOTHING REMEMBERED. A hand move changes the SEQUENCE of shots
// both sides know about. Filling in only inserts shots one side had never heard
// of. So take the shots that appear in both lists, in each side's own order, and
// compare those two sequences. Same — neither of us moved anything, whatever
// else differs, and there is nothing to fight about. Different — a hand moved a
// card, and the ordinary "later wins" decides it.

/**
 * The shots BOTH lists name, in the order the first list has them.
 *
 * Duplicates are impossible here — #426 made the arrangement unique on the way
 * out — but a damaged copy is exactly when this matters most, so the second
 * appearance of a name is ignored rather than trusted.
 */
function sharedInOrder(mine: readonly string[], theirs: readonly string[]): string[] {
  const known = new Set(theirs);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of mine) {
    if (!known.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}

/**
 * Did a hand move a card here, as against the arrangement that arrived?
 *
 * `false` means: every shot we both know about is in the same sequence on both
 * sides. This device may hold more shots, or fewer, but it has not REARRANGED
 * anything — so it has no claim, and what arrived should simply be taken.
 *
 * `true` means two shots we both know have swapped places. That is data, it can
 * only have come from a person, and the ordinary rule decides who wins.
 */
export function aHandMovedSomething(
  mine: readonly string[],
  theirs: readonly string[],
): boolean {
  const a = sharedInOrder(mine, theirs);
  const b = sharedInOrder(theirs, mine);
  if (a.length !== b.length) return true;      // cannot happen; treat as a change
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return true;
  return false;
}

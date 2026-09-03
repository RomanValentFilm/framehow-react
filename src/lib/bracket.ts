// THE SORTING SHEET, ON ITS OWN (#411).
//
// A shooting order is built from a sheet of boxes: "DAY 1 first, then DAY 2".
// Everything here works on that sheet and on plain lists of frame numbers —
// no screen, no sync, no project. It lives apart from sortOrder.ts so it can be
// put on the bench and run in a second (test/resort-bench.ts), which is how the
// fault that took 27 shots out of Roman's order is kept out for good.

import { state } from '../store/state';
import type { BracketNodeData, NeedTable } from '../store/state';

/** Tree node — selected goes right, remaining goes down. Like Finder folders. */
export interface BracketNode {
  inputIds: number[];          // frames entering this node
  categoryId: string | null;   // 'setup' | needTable.id | null
  categoryName: string | null;
  itemId: string | null;       // setup.id | needItem.id | null
  itemName: string | null;
  matchedIds: number[];        // frames matching selection → right child
  right: BracketNode | null;   // next selection step (matched frames)
  down: BracketNode | null;    // remaining frames node (auto-created)
  expanded: boolean;           // is the remaining dropdown open?
}

/** Convert BracketNode tree → serialisable BracketNodeData for persistence. */
/** No box may name the same frame twice (#416). */
function once(ids: number[]): number[] {
  const seen = new Set<number>();
  return ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

export function serializeBracket(node: BracketNode): BracketNodeData {
  const d: BracketNodeData = {
    inputIds: once(node.inputIds),
    matchedIds: once(node.matchedIds),
  };
  if (node.categoryId) d.categoryId = node.categoryId;
  if (node.categoryName) d.categoryName = node.categoryName;
  if (node.itemId) d.itemId = node.itemId;
  if (node.itemName) d.itemName = node.itemName;
  if (node.expanded) d.expanded = true;
  if (node.right) d.right = serializeBracket(node.right);
  if (node.down) d.down = serializeBracket(node.down);
  return d;
}

/** Restore BracketNode tree from persisted BracketNodeData. */
export function deserializeBracket(d: BracketNodeData): BracketNode {
  return {
    // Deduped coming back in as well, so a sheet already damaged on the server
    // is cleaned the first time it is read (#416).
    inputIds: once(d.inputIds),
    categoryId: d.categoryId ?? null,
    categoryName: d.categoryName ?? null,
    itemId: d.itemId ?? null,
    itemName: d.itemName ?? null,
    matchedIds: once(d.matchedIds),
    right: d.right ? deserializeBracket(d.right) : null,
    down: d.down ? deserializeBracket(d.down) : null,
    expanded: d.expanded ?? false,
  };
}

/** Which of these frames answer yes to this one step, as things stand now. */
export function framesMatching(categoryId: string, itemId: string, frameIds: number[]): number[] {
  const s = state();

  // SETUP is not in the needs — it is the frame's own colour tag.
  if (categoryId === 'setup') {
    return frameIds.filter((fid) => s.frames.find((f) => f.id === fid)?.setupId === itemId);
  }

  let table: NeedTable | undefined;
  for (const tab of s.needDefinitions.tabs) {
    table = tab.tables.find((t) => t.id === categoryId);
    if (table) break;
  }
  // The category itself is gone — renamed away or deleted. Say nobody matches
  // rather than guessing; the step then has nothing under it and the frames
  // fall through to the next step, which is what the sheet already does for an
  // empty step.
  if (!table) return [];

  return frameIds.filter((fid) => {
    const fn = s.frameNeeds[fid];
    if (!fn) return false;
    return table!.type === 'counter'
      ? (fn.counters?.[itemId] || 0) > 0
      : !!fn.toggles?.[itemId];
  });
}

/** Ask every step of the sheet again with today's needs. Says whether anything
 *  came out differently. Walks top down, because each step only ever sees the
 *  frames the step above it did not take. */
export function rematchToNeeds(node: BracketNode): boolean {
  if (!node.categoryId || !node.itemId) return false;   // step never chosen

  // KEEP ORDER AND REMAINING ARE NOT NEEDS (#437).
  //
  // Both are stored under made-up category names — '__keep__' when somebody
  // presses KEEP ORDER, '__remaining__' for the box the sheet fills in by
  // itself. Asking the needs about them finds no such category, which reads as
  // "the category is gone, nobody matches", so the box was EMPTIED — and then
  // the emptied sheet was saved.
  //
  // What that looked like: the box showing 0, its icons disappearing from the
  // sheet, and the shots inside it losing their box — so shots nobody had
  // touched turned red in the middle of the order. It fired on every single
  // open.
  //
  // KEEP ORDER holds exactly the shots it was given; REMAINING holds whatever
  // reaches it. Neither has anything to do with today's needs.
  if (node.categoryId === '__keep__') {
    // IT HOLDS WHAT REACHES IT, AND NOTHING ELSE (#452).
    //
    // #437 stopped this box being emptied, but left its list frozen — so a shot
    // that later moved UP into a real box was still listed here as well, and the
    // sheet drew its icon TWICE. Roman's own test caught it: the red icons came
    // back as ["12", "10", "2", "5", "10"].
    //
    // KEEP ORDER means "keep the order you were given". So the shots it was
    // given are kept, in that order — but only those still arriving in it.
    //
    // A NEWCOMER GOES AT ITS NUMBER, NOT ON THE END (#455). Roman: "why does a
    // new one come at the end?" — and he is right, there is no reason for it.
    // Every other place in the app slips a shot in behind the shot it follows in
    // the storyboard, and this is the same job: fillTheGaps against the shots
    // arriving here, which are in storyboard order.
    const before = node.matchedIds;
    const here = new Set(node.inputIds);
    const kept = before.filter((id) => here.has(id));
    const fresh = fillTheGaps(kept, node.inputIds);
    const changed = fresh.length !== before.length || fresh.some((id, i) => id !== before[i]);
    node.matchedIds = fresh;
    if (node.right) { node.right.inputIds = [...fresh]; rematchToNeeds(node.right); }
    if (node.down) {
      node.down.inputIds = node.inputIds.filter((id) => !fresh.includes(id));
      rematchToNeeds(node.down);
    }
    return changed;
  }
  if (node.categoryId === '__remaining__') {
    const before = node.matchedIds;
    const fresh = [...node.inputIds];
    node.matchedIds = fresh;
    if (node.down) { node.down.inputIds = []; rematchToNeeds(node.down); }
    return fresh.length !== before.length || fresh.some((id, i) => id !== before[i]);
  }

  const fresh = framesMatching(node.categoryId, node.itemId, node.inputIds);
  const before = node.matchedIds;
  let changed = fresh.length !== before.length || fresh.some((id, i) => id !== before[i]);
  node.matchedIds = fresh;

  // Matched frames are refined by the step to the right; everyone else drops to
  // the step below. Exactly how fixInputIds cascades — but with the answers
  // asked again rather than taken from the shelf.
  if (node.right) {
    node.right.inputIds = [...fresh];
    if (rematchToNeeds(node.right)) changed = true;
  }
  if (node.down) {
    node.down.inputIds = node.inputIds.filter((id) => !fresh.includes(id));
    if (rematchToNeeds(node.down)) changed = true;
  }
  return changed;
}

/**
 * WHICH FRAMES' NEEDS ACTUALLY CHANGED.
 *
 * Every box in the sheet remembers which frames matched it when it was made.
 * Ask the boxes again with today's needs, and a frame that has moved from one
 * box to another is a frame whose needs changed. Everything else answered
 * exactly as it did before.
 *
 * This is the whole trick, and it is Roman's: instead of asking "which frames
 * did the user move by hand" — which cannot be answered honestly, because the
 * app never recorded it and dragging one frame shifts everything behind it —
 * ask "which frames' needs changed". Then the hand moves survive without ever
 * being identified, because nothing else is touched.
 */
/**
 * IS THIS "NOWHERE"? — the two ways a shot can be in no box at all.
 *
 * Either nothing claimed it, or the deepest thing that claimed it asks the needs
 * nothing at all — REMAINING, which the sheet writes for the tail of a chain,
 * and KEEP ORDER, which holds whatever reaches it in the order it was given.
 * Neither places a shot; they catch the shots no need placed. So a shot sitting
 * in one has not been put there by the boxes: it is grey, and it is left exactly
 * where it is.
 *
 * KEEP ORDER WAS MISSING FROM THIS (#454). A new shot with no needs fell through
 * into KEEP ORDER, which counted as "the boxes have placed it", so the app
 * carried it off to the end of that box — when Roman's rule is that a shot with
 * no needs stays where it was made. Roman's own test caught it: "the new shot
 * 6#1 sits at place 13, behind 11" instead of behind the shot it came from.
 *
 * This says nothing about RED. Red is worked out from the box ranks, so a
 * KEEP ORDER shot dragged up among the DAY 1 shots is still marked.
 */
export function isLeftovers(box: string | undefined): boolean {
  // TWO REMAINING BOXES, AND THEY MEAN DIFFERENT THINGS (#456).
  //
  //   THE ONE AT THE BOTTOM OF THE SHEET is the leftovers. NOT "shots with no
  //   needs" — Roman: a shot can carry LOCATION 1 and no day at all, and since
  //   the first column sorts by DAY 1, 2, 3 it is turned down by every one of
  //   them and falls to the bottom. It has needs; just none the first column
  //   asked about. Nothing placed it, so it is grey and it is never moved.
  //
  //   THE ONE INSIDE A BRANCH is a real place: "DAY 1, no location". A shot
  //   moves into it, and is marked green for it.
  //
  // This used to call BOTH the leftovers, so a shot whose needs went from
  // DAY 1 + LOCATION 1 to DAY 1 only sat still and stayed grey — when it had
  // plainly changed place. Roman: "the app always judges the shots by the
  // results of the bracket."
  //
  // A box path carries its whole chain, so the bottom ones are exactly the
  // paths with no box in front of them.
  return box === undefined
    || box === '/__remaining__|__remaining__'
    || box === '/__keep__|__keep__';
}

/**
 * A BREAK STAYS BETWEEN THE SAME TWO SHOTS (#451).
 *
 * Roman: "the break must stay behind the shot above. If a shot above it was
 * removed it goes one higher; if a shot was added above, it goes +1."
 *
 * A break's `position` is simply how many shots are above it, so both halves
 * are one comparison. `at` is the place the shot was put in or taken out of.
 * Removal already did this; ADDING DID NOT — a new shot made above a break left
 * the break where it was, and it ended up between the wrong two shots.
 *
 * This is the same sentence as breaksAfterResort ("follow the shot above you"),
 * said for a list that grew or shrank rather than one that was rearranged.
 */
export function breaksAfterInsert(
  breaks: readonly { id: string; text: string; position: number }[],
  at: number,
): { id: string; text: string; position: number }[] {
  return breaks.map((b) => (b.position > at ? { ...b, position: b.position + 1 } : { ...b }));
}

export function breaksAfterRemoval(
  breaks: readonly { id: string; text: string; position: number }[],
  at: number,
): { id: string; text: string; position: number }[] {
  return breaks.map((b) => (b.position > at ? { ...b, position: b.position - 1 } : { ...b }));
}

/**
 * WHICH ICONS ARE GREEN AND WHICH ARE RED (#447).
 *
 * The decision only — no screen, no store — so it can be put on the bench in a
 * second like every other rule. It lived inside the drawing code, which the
 * bench does not reach, and that is exactly how #443 came to switch green off
 * along with red: the change was untested, the bench was green, and I reported
 * the bench as if it covered the change. It did not. This is that hole closed.
 *
 *   GREEN  the app moved this shot because its needs changed, and nobody has
 *          pressed DONE on it yet. Remembered per device. It answers "look at
 *          this one", which is true whatever state the sheet is in — so it is
 *          NEVER held back.
 *   RED    this shot is not where the boxes put it, because somebody moved it.
 *          Worked out fresh every time, never remembered. It is only a question
 *          worth asking once the boxes have actually placed the shots, so it
 *          waits for `sheetApplied` — while a sheet is being built, nobody has
 *          moved anything and nothing can be out of place.
 *   GREY   everything else, including the leftovers at the end.
 *
 * A shot cannot be both: green wins, because "its needs changed" is the newer
 * and more useful thing to say about it.
 */
export function iconStates(
  currentOrder: readonly number[],
  root: BracketNode,
  waiting: ReadonlySet<number>,
  sheetApplied: boolean,
): { green: Set<number>; red: Set<number> } {
  const green = new Set<number>();
  for (const id of currentOrder) if (waiting.has(id)) green.add(id);
  if (!sheetApplied) return { green, red: new Set<number>() };

  const red = shotsOutsideTheirBox(
    [...currentOrder], boxOfEachFrame(root), boxOrderOfSheet(root));
  for (const id of green) red.delete(id);
  return { green, red };
}

/**
 * SORT NOW: THE ORDER BECOMES WHAT THE SHEET SAYS (#445).
 *
 * One function, used by every path that applies a sheet to an order. There used
 * to be three: this one, the SORT NOW button's own copy, and a third behind the
 * "overwrite your frame order" question. The two copies had none of the
 * protections and no test anywhere near them, so the bench stayed green while a
 * real order broke. Roman's log: `showing 57 of 55` — an order holding two of
 * his shots twice. Their loop was
 *
 *     for (const fid of order.frameOrder) { if (visible) push(answer[bi++]); else push(fid); }
 *     while (bi < answer.length) push(answer[bi++]);
 *
 * and that trailing line can only ever make the list longer: whatever the sheet
 * named twice was pushed on to the end a second time.
 *
 * WHAT THIS PROMISES, and the reason it is one function:
 *   - the shots on screen come out in the sheet's order
 *   - a shot NOT on screen (another group) does not move at all
 *   - a shot the sheet does not name keeps the place it had
 *   - the list never grows, never shrinks, and never holds a shot twice —
 *     and if it arrived holding one twice, it comes back holding it once
 */
export function orderFromSheet(
  standsAs: readonly number[],
  sheetSays: readonly number[],
  visible: readonly number[],
): number[] {
  // Whatever arrives, we work from a list with no repeats in it.
  const clean: number[] = [];
  const have = new Set<number>();
  for (const id of standsAs) if (!have.has(id)) { clean.push(id); have.add(id); }

  const here = new Set(visible);
  const mine = clean.filter((id) => here.has(id));   // the shots the sheet is allowed to move
  const wanted = new Set(mine);

  // The sheet's answer, kept to shots that are actually in this order and on
  // screen, and each of them once.
  const queue: number[] = [];
  const placed = new Set<number>();
  for (const id of sheetSays) {
    if (!wanted.has(id) || placed.has(id)) continue;
    queue.push(id);
    placed.add(id);
  }
  // Anybody the sheet did not name goes back in behind the shot they follow now
  // — the sheet is not allowed to lose a shot by omitting it.
  const full = fillTheGaps(queue, mine);

  // Same number of slots as shots to put in them, so the length cannot change.
  const out: number[] = [];
  let qi = 0;
  for (const id of clean) out.push(here.has(id) ? full[qi++] : id);
  return out;
}

/**
 * A SHOT DELETED FROM THE PROJECT HAS TO LEAVE THE ORDER TOO (#442).
 *
 * An order that lists a shot the project no longer holds is not merely untidy —
 * it is FROZEN. The re-sort refuses to judge an order whose shots are not all
 * here, because an order opened halfway through a load would otherwise be
 * sorted against half a storyboard. It cannot tell "not arrived yet" from "gone
 * for good", so one deleted shot stops that order re-sorting ever again. Roman,
 * on his own project: `only 19 of 20 frames here yet — too early to judge`, on
 * every open, and nothing he did to a shot's needs moved anything.
 *
 * So the ghosts are dropped — but only by the caller, and only once the project
 * has finished arriving. That condition is the whole safety of this: a shot
 * missing because it has not downloaded yet must NEVER be dropped, or the order
 * loses it for good. See noShotThatIsGone in sortOrder.ts.
 *
 * `breaks` come back moved up by however many shots in front of them went.
 */
export function withoutShotsThatAreGone(
  frameOrder: readonly number[],
  framesHeld: readonly number[],
  breaks: readonly { id: string; text: string; position: number }[] = [],
): { frameOrder: number[]; breaks: { id: string; text: string; position: number }[]; gone: number[] } {
  const here = new Set(framesHeld);
  const keep = frameOrder.filter((id) => here.has(id));
  const gone = frameOrder.filter((id) => !here.has(id));
  const goneBefore = (pos: number): number =>
    frameOrder.slice(0, pos).filter((id) => !here.has(id)).length;
  return {
    frameOrder: keep,
    breaks: breaks.map((b) => ({ ...b, position: Math.max(0, b.position - goneBefore(b.position)) })),
    gone,
  };
}

/** The same boxes, but named the way they read on screen: "DAY 2 > LOCATION 1". */
export function boxNamesOfSheet(root: BracketNode): Map<string, string> {
  const names = new Map<string, string>();
  const walk = (n: BracketNode, path: string, said: string): void => {
    const mine = n.categoryId && n.itemId;
    const here = mine ? `${path}/${n.categoryId}|${n.itemId}` : path;
    const hereSaid = mine
      ? (said ? `${said} > ${n.itemName || n.itemId}` : (n.itemName || n.itemId)!)
      : said;
    if (mine) names.set(here, hereSaid);
    if (n.right) walk(n.right, here, hereSaid);
    if (n.down) walk(n.down, path, said);
  };
  walk(root, '', '');
  return names;
}

export function boxOfEachFrame(root: BracketNode): Map<number, string> {
  const where = new Map<number, string>();
  // THE WHOLE CHAIN, NOT THE FIRST BOX.
  //
  // Boxes lead into boxes: DAY 1, and inside it LOCATION 2. A frame matched by
  // DAY 1 is matched AGAIN by the box to its right, and it is that deepest box
  // that decides where the frame sits. Recording the first box to claim it
  // would file both LOCATION 2 and LOCATION 3 under plain "DAY 1", so moving a
  // frame from one location to the other inside the same day would look like
  // no change at all. Parents are walked before their children, so a child
  // simply writes over its parent and the deepest box wins.
  const walk = (n: BracketNode, path: string): void => {
    const here = n.categoryId && n.itemId ? `${path}/${n.categoryId}|${n.itemId}` : path;
    if (n.categoryId && n.itemId) for (const fid of n.matchedIds) where.set(fid, here);
    if (n.right) walk(n.right, here);
    if (n.down) walk(n.down, path);
  };
  walk(root, '');
  return where;
}

/**
 * Move ONLY the frames whose needs changed; leave every other frame exactly
 * where it is.
 *
 * `fresh` is the order the sheet would give if it were sorted from scratch, and
 * it is used for one thing only: to say where each changed frame now belongs.
 * Each one is dropped in behind the nearest frame in front of it that is
 * staying put. So the list keeps its shape — including every frame somebody
 * moved by hand — and only the frames that answered differently move.
 *
 * A frame moved by hand whose needs then changed DOES move: changing its needs
 * is a later and more deliberate statement about that frame than the drag was.
 * Agreed with Roman explicitly.
 */
export function placeChangedFrames(
  standsAs: number[],
  fresh: number[],
  changed: Set<number>,
  boxOf?: Map<number, string>,
  // Shots that are ALREADY out of their box because somebody dragged them
  // there. They are not part of their box's run, so they must not be used to
  // work out where a newcomer's number falls (#453) — otherwise the app places
  // a shot next to a misplaced one and then marks the newcomer red for it.
  misplaced: ReadonlySet<number> = new Set(),
): { list: number[]; outOfStep: Set<number> } {
  const outOfStep = new Set<number>(changed);
  if (changed.size === 0) return { list: standsAs, outOfStep };

  const out = standsAs.filter((id) => !changed.has(id));

  // A SHOT JOINS ITS BOX IN STORYBOARD ORDER (#427).
  //
  // Roman: "in the continuous count... so a shot 7 lands after 6". Not at the
  // end of the box — where it would belong if you had sorted from scratch.
  //
  // `fresh` is the order the sheet gives when it sorts everything, so it
  // already has each box's shots in storyboard order. Finding the shot in there
  // and looking at who is in front of it inside the SAME box gives the place it
  // should take. Only if it is the first of its box does it go at the front of
  // that box's run.
  const sameBoxBefore = (fid: number): number | null => {
    const myBox = boxOf?.get(fid);
    if (myBox === undefined) return null;
    const at = fresh.indexOf(fid);
    for (let j = at - 1; j >= 0; j--) {
      if (boxOf!.get(fresh[j]) === myBox && !changed.has(fresh[j])
          && !misplaced.has(fresh[j])) return fresh[j];
    }
    return null;
  };

  const placed = new Map<number | null, number[]>();
  for (const fid of fresh) {
    if (!changed.has(fid)) continue;
    let anchor: number | null = sameBoxBefore(fid);

    if (anchor === null) {
      // First of its box, or its box holds nobody else: sit in front of the
      // box's first shot if there is one, otherwise fall back to the nearest
      // shot in front that is staying put.
      const myBox = boxOf?.get(fid);
      const firstOfBox = myBox === undefined ? -1
        : out.findIndex((id) => boxOf!.get(id) === myBox && !misplaced.has(id));
      // IT GOES AT ITS NUMBER, WHATEVER THE NEIGHBOUR IS (#453).
      //
      // This used to refuse to take the lead of a box from a shot somebody had
      // hand-placed there, and slotted the newcomer in behind it instead. Roman
      // settled it the other way: "a shot moving into a box shall be the next in
      // the continuity of a number — 7 comes after 6, no matter what 6 is, hand
      // moved or bracket result."
      //
      // It also fixes something worse. Sitting behind a hand-placed shot can
      // itself be out of box order, so the app could place a shot and then mark
      // it RED for being where the app had just put it. Roman: "I don't see a
      // reason for that."
      //
      // So: first of its box by number means first of its box. anchor stays
      // null, which puts it at the very front — it must NOT fall through to the
      // "nearest shot in front of it" fallback below, which is for a shot whose
      // box holds nobody else at all.
      if (firstOfBox === 0) anchor = null;
      else if (firstOfBox > 0) anchor = out[firstOfBox - 1];
      else {
        // firstOfBox === -1: nobody else is in this box at all.
        const at = fresh.indexOf(fid);
        for (let j = at - 1; j >= 0; j--) {
          if (!changed.has(fresh[j])) { anchor = fresh[j]; break; }
        }
      }
    }
    const list = placed.get(anchor) ?? [];
    list.push(fid);
    placed.set(anchor, list);
  }

  for (const [anchor, group] of placed) {
    if (anchor === null) { out.unshift(...group); continue; }
    const at = out.indexOf(anchor);
    if (at === -1) out.push(...group); else out.splice(at + 1, 0, ...group);
  }

  // NOTHING ELSE IS MARKED (#427).
  //
  // Green means one thing: the app moved this shot because its needs changed.
  // An earlier version also marked a shot somebody had placed by hand when its
  // neighbour left — but Roman's rule is that a hand-placed shot simply stays
  // where it is, and staying put is not news.
  return { list: fillTheGaps(out, standsAs), outOfStep };
}

/**
 * WHICH SHOTS SIT OUTSIDE THE BOX THEY BELONG TO (#427) — the red icons.
 *
 * The old rule was "its position number is not the one the boxes gave it", and
 * that marks far too much: drag one shot to the top and every shot behind it
 * has a different number, so the whole order turns red. Roman: "why do the
 * other shots go red as well?"
 *
 * A shot is out of place only if it BREAKS THE ORDER OF THE BOXES — a DAY 2
 * shot sitting among the DAY 1 shots. So: give every shot the rank of its box,
 * find the longest run through the list whose ranks never go backwards, and
 * mark everything not in it. Move one shot and exactly one shot is marked.
 *
 * A shot no box matches has no rank and is never marked: the leftover shots at
 * the end are a legitimate place to be.
 */
export function shotsOutsideTheirBox(list: number[], boxOf: Map<number, string>,
                                     boxOrder: string[]): Set<number> {
  // REMAINING IS A BOX TOO (#433).
  //
  // A shot no box matches is not nowhere — it belongs with the leftovers, at
  // the end, and that is a place like any other. Roman moved a shot with no
  // needs up among the DAY 2 shots and nothing marked it, because a shot
  // without a box had no place in the order and so could never be out of it.
  // The leftovers rank last.
  const rankOf = new Map(boxOrder.map((b, i) => [b, i]));
  const LEFTOVERS = boxOrder.length;
  const ranked = list.map((id) => ({ id, rank: rankOf.get(boxOf.get(id) ?? '') ?? LEFTOVERS }));
  if (ranked.length === 0) return new Set();

  // Longest non-decreasing run, kept by patience sorting so it is the LARGEST
  // set that is in order — everything outside it is what actually moved.
  const tails: number[] = [];
  const tailIdx: number[] = [];
  const prev: number[] = new Array(ranked.length).fill(-1);
  for (let i = 0; i < ranked.length; i++) {
    const r = ranked[i].rank;
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tails[mid] <= r) lo = mid + 1; else hi = mid; }
    tails[lo] = r;
    tailIdx[lo] = i;
    prev[i] = lo > 0 ? tailIdx[lo - 1] : -1;
  }
  const inOrder = new Set<number>();
  for (let i = tailIdx[tails.length - 1]; i >= 0; i = prev[i]) {
    inOrder.add(ranked[i].id);
    if (prev[i] === -1) break;
  }
  return new Set(ranked.filter((x) => !inOrder.has(x.id)).map((x) => x.id));
}

/**
 * The boxes in the order the sheet puts them, top to bottom (#429).
 *
 * EVERY box that can hold a shot, not only the ones at the end of a chain. A
 * box with another box to its right still holds the shots the refinement did
 * not take — DAY 2 keeps whatever is not 1ST UNIT — and those shots have to
 * have a place in the order, or they can never be judged out of place.
 *
 * That was the fault: Roman moved a DAY 3 shot above the DAY 2 shots and it did
 * not go red, because his sheet has chains and only the ends of chains were
 * being ranked. A box is listed just before its own refinements, which is where
 * its unrefined shots sit.
 */
export function boxOrderOfSheet(root: BracketNode): string[] {
  const out: string[] = [];
  const walk = (n: BracketNode, path: string): void => {
    const here = n.categoryId && n.itemId ? `${path}/${n.categoryId}|${n.itemId}` : path;
    // The refinements first, then the box itself: the sheet lists the shots a
    // box refined to its right BEFORE whatever the refinement did not take.
    if (n.right) walk(n.right, here);
    if (n.categoryId && n.itemId) out.push(here);
    if (n.down) walk(n.down, path);
  };
  walk(root, '');
  return out;
}

/**
 * PUT BACK ANYBODY THE SHEET LEFT OUT.
 *
 * The sheet's answer is not a complete list. When a box has nothing below it,
 * the frames it did not match are simply left out — so `flattenBracketOrder`
 * can return five of six frames and say nothing about it.
 *
 * That has bitten twice. Once as a loss: 27 shots taken out of Roman's order
 * with nowhere to put them back. Once as a wrong position: a frame moved to
 * another day anchored itself to the wrong neighbour, because the neighbour it
 * should have followed was one of the ones left out.
 *
 * So every list that comes out of the sheet is completed here first: anybody
 * missing goes straight back in behind the frame they currently follow.
 */
export function fillTheGaps(list: number[], standsAs: number[]): number[] {
  // Deduped on the way in. The sheet can name the same frame twice — a box
  // whose matches overlap another's — and a list with a shot in it twice draws
  // that shot twice. Roman: "it duplicates the frames again", and his log:
  // `1 frame(s) moved to match NEEDS · list 18 → 19`. A rebuild must never
  // come out LONGER than it went in.
  const out: number[] = [];
  const have = new Set<number>();
  for (const id of list) if (!have.has(id)) { out.push(id); have.add(id); }
  for (let i = 0; i < standsAs.length; i++) {
    if (have.has(standsAs[i])) continue;
    const before = standsAs.slice(0, i).reverse().find((id) => have.has(id));
    const at = before === undefined ? -1 : out.indexOf(before);
    if (at === -1) out.unshift(standsAs[i]); else out.splice(at + 1, 0, standsAs[i]);
    have.add(standsAs[i]);
  }
  return out;
}


/** After swap, fix inputIds down the chain so dropdowns show correct items.
 *  matchedIds stay unchanged — groupings are preserved. */
export function fixInputIds(node: BracketNode): void {
  if (!node.itemId) return;
  if (node.right) {
    node.right.inputIds = [...node.matchedIds];
    fixInputIds(node.right);
  }
  const remaining = node.inputIds.filter((id) => !node.matchedIds.includes(id));
  if (node.down) {
    node.down.inputIds = remaining;
    fixInputIds(node.down);
  }
}

/** Sync bracket tree with current visible frames.
 *  - Adds new frames to root.inputIds (they cascade to "remaining" buckets via fixInputIds)
 *  - Removes deleted frames from the tree
 *  Returns true if any changes were made. */
export function syncBracketWithVisibleFrames(root: BracketNode, visibleIds: number[]): boolean {
  // WHO IS ALREADY IN THE SHEET — asked of every box, not of the flattened
  // answer (#416).
  //
  // flattenBracketOrder leaves out the frames a box did not match when it has
  // nothing below it. Asking IT who is already here therefore says "not here"
  // about frames that are, and they get added a second time. Roman: "have a
  // look at 4B and 5A in the last REMAINING box." It never showed before
  // because the sheet was thrown away after each use; now it is kept, so the
  // repeats pile up.
  const bracketIds = new Set<number>();
  const gather = (n: BracketNode): void => {
    for (const id of n.inputIds) bracketIds.add(id);
    for (const id of n.matchedIds) bracketIds.add(id);
    if (n.right) gather(n.right);
    if (n.down) gather(n.down);
  };
  gather(root);
  const visibleSet = new Set(visibleIds);
  let changed = false;
  // A NEW SHOT ENTERS THE SHEET AT ITS NUMBER, NOT AT THE BACK (#439).
  //
  // A box hands out its shots in the order they entered it, so a shot pushed on
  // to the end of the root's list ends up at the end of whichever box takes it —
  // shot 7, made between 1 and 2, would sit behind shot 6 in DAY 2. Rule 2 says
  // it joins its box in storyboard order. So it is slipped in behind the shot it
  // follows in the storyboard, which is what fillTheGaps already does for lists
  // coming out of the sheet.
  if (visibleIds.some((id) => !bracketIds.has(id))) {
    root.inputIds = fillTheGaps(root.inputIds, visibleIds);
    changed = true;
  }
  // Remove deleted frames from bracket
  const removeFromNode = (node: BracketNode) => {
    const before = node.inputIds.length;
    node.inputIds = node.inputIds.filter((id) => visibleSet.has(id));
    node.matchedIds = node.matchedIds.filter((id) => visibleSet.has(id));
    if (node.inputIds.length !== before) changed = true;
    if (node.right) removeFromNode(node.right);
    if (node.down) removeFromNode(node.down);
  };
  removeFromNode(root);
  // Cascade inputIds through the tree so new frames land in correct remaining buckets
  if (changed) fixInputIds(root);
  return changed;
}

/** Extract final frame order from the bracket tree (depth-first: right then down). */
export function flattenBracketOrder(node: BracketNode): number[] {
  if (!node.itemId) {
    // Pending — not yet sorted, keep input order
    return [...node.inputIds];
  }
  const result: number[] = [];
  // Matched frames — refined by right subtree, or as-is
  if (node.right) {
    // A BOX KEEPS EVERY SHOT IT TOOK, EVEN THE ONES ITS INNER BOX REFUSED
    // (#441).
    //
    // DAY 3 leads into 1ST UNIT. A shot with DAY 3 and no unit is taken by
    // DAY 3 and turned down by the box inside it — and this used to hand back
    // only what the inner box said, so that shot fell out of the sheet's answer
    // completely. It then had nowhere to be put, fillTheGaps returned it to
    // where it already sat, and the re-sort reported "order comes out the same"
    // for ever. Roman's log: `3.#1: no box → DAY 3`, and it never moved.
    //
    // They go after the shots the inner box did claim, which is also how the
    // boxes are ranked (boxOrderOfSheet places a refinement before its parent),
    // so the sheet's answer and the red-icon ranking agree.
    const refined = flattenBracketOrder(node.right);
    result.push(...refined);
    const claimed = new Set(refined);
    for (const id of node.matchedIds) if (!claimed.has(id)) result.push(id);
  } else {
    result.push(...node.matchedIds);
  }
  // Remaining frames — refined by down subtree
  if (node.down) {
    result.push(...flattenBracketOrder(node.down));
  }
  return result;
}

/**
 * DOES THIS ORDER STILL MATCH THE NEEDS, AND IF NOT, WHAT SHOULD IT LOOK LIKE?
 *
 * The whole decision, and nothing else — no store, no screen, no sync. Given an
 * order and the frames that are on screen, it says either "leave it alone, and
 * here is why" or "here is the new list".
 *
 * Kept apart from sortOrder.ts on purpose: this is the part that can lose
 * somebody's shooting order, so it has to be runnable on the bench in a second
 * (test/resort-bench.ts) rather than only through two browsers and a deploy.
 */
export interface ResortSaid {
  /** The order's new list, or undefined when nothing should change. */
  frameOrder?: number[];
  /** The sheet with each box's frames brought up to date — SAVE THIS.
   *  Only the matches change; the boxes, their order and the frames entering
   *  them are left exactly as they were. */
  sheet?: BracketNodeData;
  /** What the boxes produce now — what "modified by hand" is measured against. */
  fresh?: number[];
  /** The frames whose needs changed. These are the ones marked green. */
  moved?: Set<number>;
  /** Where the breaks should sit afterwards, when any of them move. */
  breaks?: { id: string; text: string; position: number }[];
  /** Why nothing is changing, in words, for the log. */
  why?: string;
}

/**
 * WHERE A BREAK GOES AFTERWARDS (#428).
 *
 * A break belongs BETWEEN two shots — Roman uses them for a lunch break, the
 * end of a day, a change of location. So it follows the nearest shot above it
 * THAT STAYED PUT.
 *
 * Both of his examples fall out of that one sentence:
 *   - a break after shot 9, and 9 moves away down the list: the break now sits
 *     behind shot 8, because 8 is the nearest shot above it that did not move.
 *     It is NOT dragged down with 9.
 *   - a shot is added above the break: everything above it grew by one, so the
 *     break moves from 10 to 11 and stays between the same two shots.
 *
 * An earlier version anchored on whichever shot happened to be above it, moved
 * or not, which carried a lunch break into another day when that shot changed.
 *
 * A break at the very top has no shot above it and stays at the top.
 */
export function breaksAfterResort(
  breaks: readonly { id: string; text: string; position: number }[],
  was: number[],
  now: number[],
  moved: ReadonlySet<number>,
): { id: string; text: string; position: number }[] {
  return breaks.map((b) => {
    // The nearest shot above it that is not one of the shots being moved.
    let stayed: number | undefined;
    for (let i = b.position - 1; i >= 0; i--) {
      if (!moved.has(was[i])) { stayed = was[i]; break; }
    }
    if (stayed === undefined) return { ...b, position: 0 };   // nothing above it stayed
    const at = now.indexOf(stayed);
    return at === -1 ? { ...b } : { ...b, position: at + 1 };
  });
}

export function decideResort(
  order: { frameOrder: number[]; bracketTree?: BracketNodeData; sortedSnapshot?: number[];
           breaks?: readonly { id: string; text: string; position: number }[] },
  visibleIds: number[],
  framesHeld = state().frames.length,
): ResortSaid {
  if (!order.bracketTree || !order.sortedSnapshot) {
    return { why: 'no sorting sheet yet — nothing to follow' };
  }
  if (visibleIds.length === 0) return { why: 'no frames on screen yet' };

  // NOT YET. An order opened before the frames are all there would be sorted
  // against half a storyboard. Roman: "it shows sometimes all frames, sometimes
  // not." If this device is holding fewer frames than the order lists, it is
  // not ready to judge anything.
  const here = new Set(visibleIds);
  const listed = new Set(order.frameOrder);
  if ([...listed].filter((id) => here.has(id)).length < listed.size
      && framesHeld < order.frameOrder.length) {
    return { why: `only ${framesHeld} of ${order.frameOrder.length} frames here yet — too early to judge` };
  }

  // A COPY. Working the answer out prunes the sheet to what is on screen, which
  // is right for the answer and quite wrong to keep.
  const root = deserializeBracket(order.bracketTree);
  syncBracketWithVisibleFrames(root, visibleIds);

  const was = boxOfEachFrame(root);
  if (!rematchToNeeds(root)) return { why: 'the boxes match the needs — nothing to do' };
  const now = boxOfEachFrame(root);

  // A frame that changed box is a frame whose needs changed. Nothing else moves.
  // A SHOT THAT LANDS IN THE LEFTOVERS IS NOT MARKED (#432).
  //
  // Green means "the boxes put this somewhere new". A shot that no box matches
  // any more has not been put anywhere — it belongs with the leftovers, which
  // is a legitimate place, and Roman's rule for it is grey.
  //
  // Without this, one change that stops a lot of shots matching turns the whole
  // REMAINING box green at once. Roman: "in the last box remaining 38... they
  // are green" — 38 shots he had not touched.
  //
  // AND NEITHER IS A SHOT THAT LANDS IN "REMAINING" (#439).
  //
  // The rule above was only half applied. A sheet leaves the tail of a chain
  // empty sometimes and writes a REMAINING box for it other times, and those
  // two are the same thing to the user: the place for shots no need matched.
  // Only the first was treated as grey. So the second went green — and worse,
  // it counted as "the boxes put this shot somewhere", which MOVED the shot
  // down into that box. That is what happened to a newly created shot with no
  // needs: made after shot 5, it was carried off to the end of the order.
  // Roman: "the new frame's position is somehow off."
  //
  // AND IT SAYS WHICH BOXES, BY NAME (#440). "1 frame(s) changed box, order
  // comes out the same" was true and useless: neither Roman nor I could tell
  // from it whether the shot had gone where he meant it to. The line now reads
  // `6#1: no box → DAY 3` and the question answers itself.
  const names = boxNamesOfSheet(root);
  const boxName = (p: string | undefined): string =>
    p === undefined ? 'no box' : (names.get(p) ?? p);
  const labelOf = (fid: number): string =>
    state().frames.find((f) => f.id === fid)?.label || String(fid);

  const moved = new Set<number>();
  const changes: string[] = [];
  for (const fid of new Set([...was.keys(), ...now.keys()])) {
    if (was.get(fid) === now.get(fid)) continue;
    changes.push(`${labelOf(fid)}: ${boxName(was.get(fid))} → ${boxName(now.get(fid))}`);
    if (isLeftovers(now.get(fid))) continue;       // in no box, or only in REMAINING: grey
    moved.add(fid);
  }
  const tell = changes.join(' · ');
  if (moved.size === 0) {
    return { why: 'answers moved inside their boxes — no frame changed box'
      + (tell ? ` · ${tell}` : '') };
  }

  // ONLY FRAMES THE SHEET CAN ACTUALLY PLACE.
  //
  // flattenBracketOrder does NOT return everybody: when a box has nothing below
  // it, the frames it did not match are left out entirely. So a frame can be
  // "no longer in a box" and also have no place in the fresh list — and moving
  // a frame the sheet cannot place means taking it out of the order with
  // nowhere to put it back. Roman's log: 27 frames moved, 5 left on screen.
  // Completed first — see fillTheGaps. Anchoring against a list with holes in
  // it puts frames in the wrong place.
  const fresh = fillTheGaps(flattenBracketOrder(root), order.frameOrder);
  // Belt and braces: the rebuild is checked for repeats below, and refused.
  const canBePlaced = new Set(fresh);
  let cannotPlace = 0;
  for (const fid of [...moved]) if (!canBePlaced.has(fid)) { cannotPlace++; moved.delete(fid); }
  if (moved.size === 0) {
    return { why: `${cannotPlace} frame(s) changed box but the sheet cannot place them — left alone` };
  }

  // Who is already sitting outside their box — the shots somebody dragged. The
  // placement must step around them, or it puts a shot next to a misplaced one
  // and the shot it just placed comes out red (#453).
  const misplaced = shotsOutsideTheirBox(order.frameOrder, now, boxOrderOfSheet(root));
  const { list: frameOrder, outOfStep } =
    placeChangedFrames(order.frameOrder, fresh, moved, now, misplaced);

  // Never fewer than we started with. If this ever trips, the order is left
  // untouched rather than shortened.
  if (frameOrder.length < order.frameOrder.length) {
    return { why: `re-sort would have lost ${order.frameOrder.length - frameOrder.length} frame(s) — left alone` };
  }
  // NEVER LONGER, AND NEVER THE SAME SHOT TWICE. Between them these two say the
  // rebuild is a rearrangement of the list it was given, and nothing else.
  if (frameOrder.length > order.frameOrder.length || new Set(frameOrder).size !== frameOrder.length) {
    return { why: `re-sort would have repeated a shot (${order.frameOrder.length} → ${frameOrder.length}) — left alone` };
  }
  // The order does not always move when the boxes do — a frame can change day
  // and still sit in the same place. The SHEET has still learned something, and
  // it has to be written down: without this it repeated "4 frame(s) changed
  // box, order comes out the same" on every open for ever, and the next real
  // change was buried in with those four. Seen live on try411.
  const same = frameOrder.length === order.frameOrder.length
    && frameOrder.every((id, i) => id === order.frameOrder[i]);
  if (same) {
    return {
      why: `${moved.size} frame(s) changed box, order comes out the same`
        + ` — ${tell}`,
      sheet: serializeBracket(root),
      // STILL GREEN (#418). Green means "its needs changed", not "it moved" —
      // a shot can change day and stay exactly where it was, and that is
      // precisely when the user has no other way of noticing. Roman doubted
      // this worked; it did not. The set was simply not passed back.
      moved,
    };
  }

  return {
    // WHAT THE SHEET PRODUCED IS THE LIST IT PRODUCED (#420).
    //
    // This used to write down `fresh` — the sheet's own order — while the order
    // itself became something else, because a changed shot is put at the end of
    // its box rather than wherever `fresh` had it. The gap between the two was
    // then read as "the user moved these by hand", which it was not: the app
    // had done it. So a later change marked shots nobody had touched.
    //
    // Hand work now means exactly one thing: what you moved since the last
    // sort.
    frameOrder, fresh: frameOrder, moved: outOfStep, sheet: serializeBracket(root),
    breaks: breaksAfterResort(order.breaks ?? [], order.frameOrder, frameOrder, moved),
    why: tell,
  };
}

/**
 * THE SHEET HAS TO LEARN WHAT IT NOW HOLDS (#411).
 *
 * Written back whole, and here is why it must be whole.
 *
 * The first try copied only the MATCHES into the sheet as it was saved, leaving
 * each box's incoming frames untouched — the idea being to change as little as
 * possible. That leaves a sheet contradicting itself: a box holding frames that
 * never entered it. The screen then draws the same shot in several boxes at
 * once. Roman: "chaos, the frames are duplicated or even tripled, even the
 * boxes." Nothing was wrong with his project — 13 frames, all present — the
 * sheet describing it was impossible.
 *
 * The worked-out copy is consistent by construction: every box's matches come
 * out of its own incoming frames, and what it does not take drops to the box
 * below. So that is what gets saved.
 *
 * The reason not to save it used to be that working it out prunes the sheet to
 * whatever is on screen, which once cost an order 27 shots. That is now caught
 * earlier: decideResort refuses to run at all while this device is holding
 * fewer frames than the order lists.
 */


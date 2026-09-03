// THE RULES FOR A SHOOTING ORDER WHEN THE NEEDS CHANGE (#427).
//
// Run:  npm run bench:resort        (about a second, no browser, no deploy)
//
// Written to the rules as Roman settled them, one section per rule, so the file
// can be read as the specification and not only as a test. Where a rule was
// changed, the section says what it replaced and why — several of these exist
// because an earlier version of the rule did something surprising to a real
// shooting order.
//
// THE RULES, AND THE SECTION THAT PROVES EACH ONE.
// Nothing here lives only in a conversation. If a rule is not in this list, it
// is not a rule.
//
//   WHAT MOVES
//    1  Only a shot whose BOX changed moves. Its needs changed; nothing else
//       has.                                                             [1,2]
//    2  It joins its box in storyboard order — shot 7 after shot 6.      [2b]
//    3  It joins its box AT ITS NUMBER — 7 after 6, whatever 6 is, hand moved
//       or put there by the boxes. And a shot the app placed is never red.  [3]
//    4  A shot already in the right place does not move, and is still
//       marked.                                                            [4]
//    5  Everything else is untouched, including shots moved by hand.        [5]
//    5b …but a shot moved by hand DOES move when its OWN needs change: the
//       needs are the later and more deliberate statement.                 [5b]
//    6  THE LEFTOVERS ARE THE BOX AT THE VERY BOTTOM OF THE SHEET — the shots
//       every box in the FIRST COLUMN turned down. Not "shots with no needs": a
//       shot can have LOCATION 1 and no day, and the first column sorts by day,
//       so it falls through all of them. Nothing placed it — grey, never moved.
//       A REMAINING INSIDE A BRANCH is a different thing: "DAY 1, no location"
//       is a real place, moved into and marked green. KEEP ORDER at the bottom
//       is the leftovers too, by the user's own choice.        [6,13b,20,21]
//    7  The list can never grow, shrink, or hold the same shot twice.  [7,16]
//    8  Boxes are read as a whole chain: DAY 1 > LOCATION 1 is its own
//       place.                                                            [11b]
//    9  The sheet learns what it now holds, so a change is announced once.  [9]
//
//   THE ICONS
//   11  RED marks only the shot that breaks the order of the boxes — not
//       everything behind it.                                         [11,11b]
//   11b GREEN says "your needs change moved this; look at it" and is NEVER
//       held back. RED says "you moved this out of its box" and waits until
//       the sheet has been applied — while a sheet is being built, nobody has
//       moved anything.                                                   [17]
//   11c A shot cannot be both. Green wins.                                [17]
//
//   BREAKS
//   10  A break follows the nearest shot above it THAT STAYED PUT.        [10]
//   10b A shot added above it pushes it down one; a shot removed above it
//       brings it up one. It stays between the same two shots.           [18]
//
//   A NEW SHOT
//   12  With needs: it goes into the box those needs name, at its number.
//       With none: it stays where it was made. Either way it is GREEN, and
//       after DONE it is red or grey like any other shot.          [13,13c,13d]
//
//   HOUSEKEEPING
//   13  A box keeps every shot it took, including the ones the box INSIDE it
//       refused.                                                          [14]
//   14  KEEP ORDER and REMAINING are not needs and are never emptied.     [12]
//   15  A shot deleted from the project leaves every order too — a ghost in
//       the list freezes that order for ever.                             [15]

import { useStore, DEFAULT_NEED_DEFINITIONS, createDefaultFrameNeedState } from '../src/store/state';
import type { Frame, SortOrder, BracketNodeData, FrameNeedState } from '../src/store/state';
import {
  decideResort, placeChangedFrames, breaksAfterResort, deserializeBracket,
  serializeBracket, syncBracketWithVisibleFrames, boxOfEachFrame, boxOrderOfSheet,
  shotsOutsideTheirBox, rematchToNeeds, flattenBracketOrder, withoutShotsThatAreGone, orderFromSheet, iconStates, breaksAfterInsert, breaksAfterRemoval,
} from '../src/lib/bracket';

const DAY = 'tbl_shootday';
const D1 = 'ti_day1';
const D2 = 'ti_day2';
const LOC = 'tbl_location';
const L1 = 'ti_loc1';
const ALL = [1, 2, 3, 4, 5, 6];

let failures = 0;
function check(what: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  if (g === w) { console.log(`  ok    ${what}`); return; }
  failures++;
  console.log(`  FAIL  ${what}\n        wanted ${w}\n        got    ${g}`);
}

const frame = (id: number): Frame => ({
  id, src: '', label: String(id), cropW: 0, cropH: 0, strokes: [],
  drawMode: false, textContent: '', tableData: null, serverFrameId: `srv-${id}`,
});

/** Six shots, the given day each, in the given order, with the given sheet. */
function setUp(days: Record<number, string>, order: number[],
               sheet: BracketNodeData, sorted: number[]): void {
  const frames = ALL.map(frame);
  const frameNeeds: Record<number, FrameNeedState> = {};
  for (const f of frames) {
    const n = createDefaultFrameNeedState();
    n.toggles = { [days[f.id]]: true };
    frameNeeds[f.id] = n;
  }
  useStore.setState({
    frames, frameNeeds, activeGroupId: null,
    needDefinitions: JSON.parse(JSON.stringify(DEFAULT_NEED_DEFINITIONS)),
    sortOrders: [{ id: 'o1', name: 'ORDER', description: '', frameOrder: [...order],
                   breaks: [], bracketTree: sheet, sortedSnapshot: [...sorted] }],
  } as never);
}

/** "DAY 1 first, then DAY 2." */
const twoBoxes = (day1: number[], day2: number[]): BracketNodeData => ({
  inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
  itemId: D1, itemName: 'DAY 1', matchedIds: [...day1],
  down: { inputIds: [...day2], categoryId: DAY, categoryName: 'SHOOT DAY',
          itemId: D2, itemName: 'DAY 2', matchedIds: [...day2] },
});

const EVERY_DAY: Record<number, string> = { 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 };
const order = (): SortOrder => useStore.getState().sortOrders[0];

/** Change one shot's day. */
function moveToDay(fid: number, day: string): void {
  const needs = { ...useStore.getState().frameNeeds };
  needs[fid] = { ...needs[fid], toggles: { [day]: true } };
  useStore.setState({ frameNeeds: needs } as never);
}

/** What the app does on opening: ask, then write the answer down. */
function openTheOrder(): number {
  const said = decideResort(order(), ALL);
  if (!said.frameOrder) {
    if (said.sheet) {
      useStore.setState({ sortOrders: [{ ...order(), bracketTree: said.sheet }] } as never);
    }
    return said.moved?.size ?? 0;
  }
  useStore.setState({
    sortOrders: [{ ...order(), frameOrder: said.frameOrder, sortedSnapshot: said.fresh!,
                   bracketTree: said.sheet!, ...(said.breaks ? { breaks: said.breaks } : {}) }],
  } as never);
  return said.moved!.size;
}

console.log('\n1 & 2. a shot whose needs changed joins its box in storyboard order');
{
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);
  check('one shot moved', openTheOrder(), 1);
  // Shot 1 is now a day 2 shot, and 1 comes before 4, 5 and 6.
  check('and it sits at its number among them', order().frameOrder, [2, 3, 1, 4, 5, 6]);
}

console.log('\n2b. …and at its number, not at the end of the box');
{
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(6, D1);
  check('one shot moved', openTheOrder(), 1);
  check('shot 6 joins the day 1 shots after shot 3', order().frameOrder, [1, 2, 3, 6, 4, 5]);
}

console.log('\n3. a shot joins its box AT ITS NUMBER, whatever the neighbour is');
{
  // REPLACED (#453). The rule here used to be "it never takes the lead of a box
  // from a shot somebody hand-placed there", and the newcomer was slotted in
  // behind. Roman settled it the other way: "a shot moving into a box shall be
  // the next in the continuity of a number — 7 comes after 6, no matter what 6
  // is, hand moved or bracket result."
  //
  // It also cured something worse: sitting behind a hand-placed shot could
  // itself be out of box order, so the app placed a shot and then marked it RED
  // for being where the app had just put it. Roman: "I don't see a reason for
  // that."
  //
  // Shot 6 was dragged to the HEAD OF ITS OWN BOX — the day 2 run reads 6,4,5,
  // which is still in box order, so nobody is out of place. Shot 1 now becomes
  // a day 2 shot, and 1 comes before 6.
  setUp(EVERY_DAY, [1, 2, 3, 6, 4, 5], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);
  check('the changed shot is marked', decideResort(order(), ALL).moved
    ? [...decideResort(order(), ALL).moved!] : [], [1]);
  openTheOrder();
  // The OLD rule slid it in behind shot 6 — [2,3,6,1,4,5] — because a
  // hand-placed shot could not be overtaken. Roman's rule says the number wins.
  check('SHOT 1 TAKES THE LEAD OF THE DAY 2 SHOTS, BECAUSE 1 COMES BEFORE 6',
    order().frameOrder, [2, 3, 1, 6, 4, 5]);

  {
    const root = deserializeBracket(order().bracketTree!);
    const red = shotsOutsideTheirBox(order().frameOrder, boxOfEachFrame(root), boxOrderOfSheet(root));
    check('and nobody is red at all', [...red], []);
  }
}

console.log('\n3b. …but it steps around a shot that is out of its box');
{
  // Shot 6 dragged to the very FRONT, among the day 1 shots: it is out of its
  // box and red. It is not part of the day 2 run, so it must not be used to
  // decide where a newcomer's number falls — otherwise the app places shot 1
  // beside it and then marks shot 1 red for being where the app put it.
  setUp(EVERY_DAY, [6, 1, 2, 3, 4, 5], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);
  openTheOrder();
  check('it joins the day 2 shots that ARE in their box',
    order().frameOrder, [6, 2, 3, 1, 4, 5]);

  const root = deserializeBracket(order().bracketTree!);
  const red = shotsOutsideTheirBox(order().frameOrder, boxOfEachFrame(root), boxOrderOfSheet(root));
  check('A SHOT THE APP PLACED IS NEVER RED', red.has(1), false);
  check('only the shot somebody dragged is red', [...red], [6]);
}

console.log('\n4. a shot already in the right place does not move, and is still marked');
{
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(3, D2);              // 3 already sits at the head of the day 2 run
  const said = decideResort(order(), ALL);
  check('nothing has to move', said.frameOrder, undefined);
  check('but it is still marked', said.moved ? [...said.moved] : [], [3]);
  check('and the sheet has learned', !!said.sheet, true);
}

console.log('\n5. shots whose needs did not change are untouched');
{
  setUp(EVERY_DAY, [1, 5, 2, 3, 4, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(6, D1);              // only shot 6 changed
  openTheOrder();
  const list = order().frameOrder;
  check('the hand-placed shot 5 is where it was put', list.indexOf(5), 1);
  check('and only shot 6 moved', list, [1, 5, 2, 3, 6, 4]);
}

console.log('\n5b. …but a shot moved by hand DOES move when its OWN needs change');
{
  // Agreed with Roman: changing a shot's needs is a later and more deliberate
  // statement about that shot than the drag was, so the needs win. Rule 5 keeps
  // a hand-placed shot still while OTHER shots change; it does not freeze it
  // for ever.
  setUp(EVERY_DAY, [1, 5, 2, 3, 4, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  // Shot 5 was dragged up to second place. Now it is given DAY 1.
  moveToDay(5, D1);
  check('it moves', openTheOrder(), 1);
  check('and it joins the day 1 shots at its number', order().frameOrder, [1, 2, 3, 5, 4, 6]);
}

console.log('\n6. a shot no box matches belongs with the leftovers');
{
  // One box only: day 1. Shot 1 leaves for day 2, which no box covers.
  const oneBox: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
  };
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], oneBox, [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);
  // It left day 1, but no box covers day 2 — so it has not been PUT anywhere.
  // It belongs with the leftovers, which is a legitimate place, so it is grey
  // and nothing moves. Roman: "in the last box remaining 38... they are green"
  // — 38 shots he had never touched, all marked because they stopped matching.
  check('it is NOT marked', openTheOrder(), 0);
  check('and nothing is moved', order().frameOrder, [1, 2, 3, 4, 5, 6]);
}

console.log('\n7. the list can never grow, shrink, or hold a shot twice');
{
  // The sheet names shot 2 in two boxes at once — what a damaged sheet looks
  // like. It cost a real order 27 shots once, and doubled another.
  const overlapping: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    down: { inputIds: [2, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
            itemId: D2, itemName: 'DAY 2', matchedIds: [2, 4, 5, 6] },
  };
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], overlapping, [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);
  openTheOrder();
  const list = order().frameOrder;
  check('the order did not grow', list.length <= 6, true);
  check('and no shot is in it twice', new Set(list).size, list.length);

  // And the rebuild itself, handed a sheet that cannot place two of the shots.
  const rebuilt = placeChangedFrames([1, 2, 3, 4, 5, 6], [2, 1, 4, 5], new Set([1, 3, 6])).list;
  check('nobody is dropped when the sheet leaves them out',
    [...rebuilt].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  check('and nobody is doubled', new Set(rebuilt).size, 6);
}

console.log('\n8. a chain: DAY 1 > LOCATION 1 is its own place');
{
  const chain: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    right: { inputIds: [1, 2, 3], categoryId: LOC, categoryName: 'LOCATION',
             itemId: L1, itemName: 'LOCATION 1', matchedIds: [1, 2] },
    down: { inputIds: [4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
            itemId: D2, itemName: 'DAY 2', matchedIds: [4, 5, 6] },
  };
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], chain, [1, 2, 3, 4, 5, 6]);
  const withLoc = { ...useStore.getState().frameNeeds };
  for (const id of [1, 2]) withLoc[id] = { ...withLoc[id], toggles: { [D1]: true, [L1]: true } };
  useStore.setState({ frameNeeds: withLoc } as never);
  check('nothing to do to start with', openTheOrder(), 0);

  // Shot 1 leaves for day 2. It keeps LOCATION 1, which no longer helps it.
  const moved = { ...useStore.getState().frameNeeds };
  moved[1] = { ...moved[1], toggles: { [D2]: true, [L1]: true } };
  useStore.setState({ frameNeeds: moved } as never);
  check('it leaves the first box', openTheOrder(), 1);
  check('and joins the day 2 shots at its number', order().frameOrder, [2, 3, 1, 4, 5, 6]);
}

console.log('\n9. the sheet learns, so a change is announced once');
{
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);
  check('the first open follows it', openTheOrder(), 1);
  check('the second open has nothing to say',
    decideResort(order(), ALL).why, 'the boxes match the needs — nothing to do');

  moveToDay(6, D1);
  check('and a later change is noticed on its own', openTheOrder(), 1);
}

console.log('\n9b. …even when the order did not move');
{
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(3, D2);                       // no movement needed
  openTheOrder();                          // …but the sheet must still learn
  check('the next open is quiet',
    decideResort(order(), ALL).why, 'the boxes match the needs — nothing to do');
}

console.log('\n9c. the saved sheet never contradicts itself');
{
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);
  const said = decideResort(order(), ALL);
  const problems: string[] = [];
  const seen = new Set<number>();
  const walk = (b: BracketNodeData | undefined): void => {
    if (!b) return;
    const input = new Set(b.inputIds);
    for (const id of b.matchedIds) {
      if (!input.has(id)) problems.push(`shot ${id} matched by a box it never entered`);
      if (seen.has(id)) problems.push(`shot ${id} is in two boxes at once`);
      seen.add(id);
    }
    walk(b.right); walk(b.down);
  };
  walk(said.sheet);
  check('every box holds only shots that entered it', problems, []);
}

console.log('\n10. a break follows the nearest shot above it that stayed put');
{
  // Roman's first case: a break sitting after shot 9, and shot 9 moves away
  // down the list. The break must NOT be dragged with it — it now sits behind
  // shot 8, the nearest shot above it that stayed.
  check('the break stays behind the shot above it',
    breaksAfterResort([{ id: 'b', text: 'LUNCH', position: 9 }],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],       // was: break after shot 9
      [1, 2, 3, 4, 5, 6, 7, 8, 10, 9],       // now: 9 moved down
      new Set([9])),
    [{ id: 'b', text: 'LUNCH', position: 8 }]);

  // His second case: a shot is added above it, so everything above grew by one
  // and the break goes with it — it is still between the same two shots.
  check('and moves down when a shot is added above it',
    breaksAfterResort([{ id: 'b', text: 'LUNCH', position: 9 }],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      [1, 2, 3, 4, 5, 99, 6, 7, 8, 9, 10],   // 99 slotted in after 5
      new Set([99])),
    [{ id: 'b', text: 'LUNCH', position: 10 }]);

  check('one at the top stays at the top',
    breaksAfterResort([{ id: 'b3', text: 'CALL', position: 0 }],
      [1, 2, 3], [2, 1, 3], new Set([1])),
    [{ id: 'b3', text: 'CALL', position: 0 }]);
}

console.log('\n10b. shots swapped INSIDE their own box stay swapped');
{
  // 4, 6, 9, 7 — somebody swapped 7 and 9 by hand, and both are in the same
  // box, so neither has changed box. Nothing may reorder them.
  setUp(EVERY_DAY, [1, 2, 3, 5, 6, 4], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);                       // something else changes entirely
  openTheOrder();
  const list = order().frameOrder;
  check('the swap inside the box survives',
    [list.indexOf(5) < list.indexOf(6), list.indexOf(6) < list.indexOf(4)], [true, true]);
}

console.log('\n11. RED marks only the shot that breaks the order of the boxes');
{
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  const root = deserializeBracket(order().bracketTree!);
  const box = boxOfEachFrame(root);
  const ranks = boxOrderOfSheet(root);

  check('a list in box order marks nobody',
    [...shotsOutsideTheirBox([1, 2, 3, 4, 5, 6], box, ranks)], []);
  // Shot 6 dragged to the front. It used to mark every shot behind it — Roman:
  // "why do the other shots go red as well?"
  check('one shot dragged to the front marks exactly that shot',
    [...shotsOutsideTheirBox([6, 1, 2, 3, 4, 5], box, ranks)], [6]);
  check('and putting it back marks nobody again',
    [...shotsOutsideTheirBox([1, 2, 3, 4, 5, 6], box, ranks)], []);
  // REMAINING IS A BOX TOO (#433). A shot no box matches belongs at the END
  // with the other leftovers, so it can be out of place like anything else.
  // Roman moved a shot with no needs up among the day 2 shots and nothing
  // marked it.
  const halfSheet = new Map(box);
  halfSheet.delete(5);                    // shot 5 matches no box
  check('a leftover shot left at the end is not marked',
    [...shotsOutsideTheirBox([1, 2, 3, 4, 6, 5], halfSheet, ranks)], []);
  check('BUT A LEFTOVER SHOT MOVED UP AMONG THE BOXES IS MARKED',
    [...shotsOutsideTheirBox([1, 2, 5, 3, 4, 6], halfSheet, ranks)], [5]);
}

console.log('\n11b. RED works on a sheet with chains, not only a plain one');
{
  // Roman's sheet looks like this: DAY 2 refined to the right by 1ST UNIT, and
  // DAY 3 below. He moved a DAY 3 shot above the DAY 2 shots and it did not go
  // red — because only the ENDS of chains were being ranked, so DAY 3 had no
  // place in the order and a shot with no place can never be out of place.
  const DAY3 = 'ti_day3';
  const UNIT = 'tbl_unit';
  const U1 = 'ti_unit1';
  const chained: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2],
    down: {
      inputIds: [3, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
      itemId: D2, itemName: 'DAY 2', matchedIds: [3, 4],
      right: { inputIds: [3, 4], categoryId: UNIT, categoryName: 'UNIT',
               itemId: U1, itemName: '1ST UNIT', matchedIds: [3] },
      down: { inputIds: [5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
              itemId: DAY3, itemName: 'DAY 3', matchedIds: [5, 6] },
    },
  };
  setUp({ 1: D1, 2: D1, 3: D2, 4: D2, 5: DAY3, 6: DAY3 },
        [1, 2, 3, 4, 5, 6], chained, [1, 2, 3, 4, 5, 6]);
  const root = deserializeBracket(chained);
  const box = boxOfEachFrame(root);
  const ranks = boxOrderOfSheet(root);

  check('every box has a place, including one above a refinement', ranks.length, 4);
  check('a list in box order marks nobody',
    [...shotsOutsideTheirBox([1, 2, 3, 4, 5, 6], box, ranks)], []);
  check('A DAY 3 SHOT MOVED ABOVE THE DAY 2 SHOTS IS MARKED',
    [...shotsOutsideTheirBox([1, 2, 5, 3, 4, 6], box, ranks)], [5]);
  check('a day 1 shot dragged to the end is marked',
    [...shotsOutsideTheirBox([2, 3, 4, 5, 6, 1], box, ranks)], [1]);
  check('but a swap inside one box is nobody\'s business',
    [...shotsOutsideTheirBox([1, 2, 3, 4, 6, 5], box, ranks)], []);
}

console.log('\n12. KEEP ORDER and REMAINING are not needs, and must never be emptied');
{
  // Both are stored under made-up category names. Asking the needs about them
  // found no such category, which read as "the category is gone, nobody
  // matches" — so the box was emptied and the emptied sheet SAVED. The box then
  // showed 0, its icons vanished, and the shots inside it lost their box, so
  // shots nobody had touched went red. It fired on every open.
  const withKeep: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    down: {
      inputIds: [4, 5, 6], categoryId: '__keep__', categoryName: 'KEEP ORDER',
      itemId: '__keep__', itemName: 'KEEP ORDER', matchedIds: [4, 5, 6],
    },
  };
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], withKeep, [1, 2, 3, 4, 5, 6]);

  const said = decideResort(order(), ALL);
  check('a sheet with a KEEP ORDER box has nothing to do', said.why,
    'the boxes match the needs — nothing to do');

  // And asking the boxes again leaves it holding exactly what it was given.
  // Before the fix it was emptied, its icons vanished from the sheet, and the
  // shots in it lost their box.
  const root = deserializeBracket(withKeep);
  syncBracketWithVisibleFrames(root, ALL);
  rematchToNeeds(root);
  check('KEEP ORDER still holds its shots', root.down?.matchedIds, [4, 5, 6]);
  const boxes = boxOfEachFrame(root);
  check('and those shots still have a box',
    [4, 5, 6].map((id) => boxes.get(id) !== undefined), [true, true, true]);
}

console.log('\n13. a shot created after the order was sorted');
{
  // Roman's rule: needs → it belongs in the box those needs name; no needs →
  // it stays where it was made. Both end green. Green for the second half is
  // written when the shot is created (addFrameToSortOrders) because nothing
  // moves and so nothing here would mark it; what is checked here is that the
  // shot is put in the right PLACE, which is all decideResort decides.
  // Born from shot 1: it takes its place right behind shot 1 in the STORYBOARD,
  // which is the order the boxes count in, and right behind shot 1 in the order.
  const ALL7 = [1, 7, 2, 3, 4, 5, 6];

  function newShotAfterOne(day: string | null): void {
    setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
    const s = useStore.getState();
    const needs = { ...s.frameNeeds };
    const n = createDefaultFrameNeedState();
    n.toggles = day ? { [day]: true } : {};
    needs[7] = n;
    const storyboard = [...s.frames];
    storyboard.splice(1, 0, frame(7));
    useStore.setState({
      frames: storyboard, frameNeeds: needs,
      sortOrders: [{ ...s.sortOrders[0], frameOrder: [1, 7, 2, 3, 4, 5, 6] }],
    } as never);
  }

  newShotAfterOne(D2);
  const withNeeds = decideResort(order(), ALL7);
  check('a new DAY 2 shot is one shot moved', [...(withNeeds.moved ?? [])], [7]);
  // AT ITS NUMBER, NOT AT THE BACK OF THE BOX. Made between 1 and 2, it is the
  // first of the day 2 shots — not behind shot 6.
  check('and it joins the day 2 shots at its number',
    withNeeds.frameOrder, [1, 2, 3, 7, 4, 5, 6]);

  newShotAfterOne(null);
  const noNeeds = decideResort(order(), ALL7);
  check('a new shot with no needs is not moved at all', noNeeds.frameOrder, undefined);
  check('and the order still has it where it was made',
    order().frameOrder, [1, 7, 2, 3, 4, 5, 6]);
}

console.log('\n13b. …and REMAINING is not a place the boxes PUT anybody');
{
  // Roman: "the new frame's position is somehow off — if I make a new frame
  // after 5 it should be after 5 in the shooting order too."
  //
  // The sheet fills the tail of a chain in for you as a REMAINING box. It is
  // not a need: it holds whatever nobody else matched. So when a new shot with
  // no needs arrived, it landed in REMAINING, and "it is in a box now, it was
  // in none before" read as "its needs changed" — the shot was carried off to
  // the REMAINING box at the end of the order. Same reason 38 untouched shots
  // once went green: rule 6 was only half applied, to the tail a sheet leaves
  // empty and not to the REMAINING box it writes out.
  const withRemaining: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    down: { inputIds: [4, 5, 6], categoryId: '__remaining__', categoryName: 'REMAINING',
            itemId: '__remaining__', itemName: 'REMAINING', matchedIds: [4, 5, 6] },
  };
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], withRemaining, [1, 2, 3, 4, 5, 6]);
  const s = useStore.getState();
  const needs = { ...s.frameNeeds };
  const blank = createDefaultFrameNeedState();
  blank.toggles = {};
  needs[7] = blank;
  const storyboard = [...s.frames];
  storyboard.splice(5, 0, frame(7));            // made from shot 5
  useStore.setState({
    frames: storyboard, frameNeeds: needs,
    sortOrders: [{ ...s.sortOrders[0], frameOrder: [1, 2, 3, 4, 5, 7, 6] }],
  } as never);

  const said = decideResort(order(), [1, 2, 3, 4, 5, 7, 6]);
  check('a new shot with no needs is not moved into REMAINING', said.frameOrder, undefined);
  check('and it is not marked either', [...(said.moved ?? [])], []);
  check('so it stays behind the shot it was made from', order().frameOrder, [1, 2, 3, 4, 5, 7, 6]);
}

console.log('\n13c. the whole story: made, seen, DONE, and only later given needs');
{
  // Roman: "I added needs to a new frame that had been approved by DONE, and
  // when I changed its needs it was not put in a new position."
  const withRemaining = (): BracketNodeData => ({
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    down: { inputIds: [4, 5, 6], categoryId: '__remaining__', categoryName: 'REMAINING',
            itemId: '__remaining__', itemName: 'REMAINING', matchedIds: [4, 5, 6] },
  });
  const HERE = [1, 2, 3, 4, 5, 7, 6];              // the storyboard, 7 made from 5

  /** Opening the order, exactly as the app does it — sheet written back and all. */
  function open(): { moved: number[]; why: string | undefined } {
    const said = decideResort(order(), HERE);
    if (!said.frameOrder) {
      if (said.sheet) useStore.setState({ sortOrders: [{ ...order(), bracketTree: said.sheet }] } as never);
      return { moved: [...(said.moved ?? [])], why: said.why };
    }
    useStore.setState({
      sortOrders: [{ ...order(), frameOrder: said.frameOrder, sortedSnapshot: said.fresh!,
                     bracketTree: said.sheet! }],
    } as never);
    return { moved: [...(said.moved ?? [])], why: said.why };
  }

  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], withRemaining(), [1, 2, 3, 4, 5, 6]);
  const s = useStore.getState();
  const needs = { ...s.frameNeeds };
  const blank = createDefaultFrameNeedState();
  blank.toggles = {};
  needs[7] = blank;
  const storyboard = [...s.frames];
  storyboard.splice(5, 0, frame(7));
  useStore.setState({
    frames: storyboard, frameNeeds: needs,
    sortOrders: [{ ...s.sortOrders[0], frameOrder: [1, 2, 3, 4, 5, 7, 6] }],
  } as never);

  // Opened once with no needs — it stays put. (DONE only clears the green mark,
  // which lives on the device and has no say in any of this.)
  open();
  check('after the first look it is still behind shot 5', order().frameOrder, [1, 2, 3, 4, 5, 7, 6]);
  open();
  check('and after a second look too', order().frameOrder, [1, 2, 3, 4, 5, 7, 6]);

  // NOW its needs are set — DAY 1 — and it has to join the day 1 shots.
  moveToDay(7, D1);
  const said = open();
  check('giving it needs moves it', said.moved, [7]);
  check('and it joins the day 1 shots', order().frameOrder, [1, 2, 3, 7, 4, 5, 6]);
}

console.log('\n13d. a new shot given a DIFFERENT day from the shot it was made from');
{
  // Roman: "6 is DAY 1, I made 6#1 from it and gave 6#1 DAY 3 on purpose" —
  // and the app said "changed box, order comes out the same".
  const D3 = 'ti_day3';
  const threeBoxes: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2],
    down: {
      inputIds: [3, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
      itemId: D2, itemName: 'DAY 2', matchedIds: [3, 4],
      down: { inputIds: [5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
              itemId: D3, itemName: 'DAY 3', matchedIds: [5, 6] },
    },
  };
  setUp({ 1: D1, 2: D1, 3: D2, 4: D2, 5: D3, 6: D3 },
        [1, 2, 3, 4, 5, 6], threeBoxes, [1, 2, 3, 4, 5, 6]);
  const s = useStore.getState();
  const needs = { ...s.frameNeeds };
  const n = createDefaultFrameNeedState();
  n.toggles = { [D3]: true };                    // made from shot 1 (DAY 1), given DAY 3
  needs[7] = n;
  const storyboard = [...s.frames];
  storyboard.splice(1, 0, frame(7));
  useStore.setState({
    frames: storyboard, frameNeeds: needs,
    sortOrders: [{ ...s.sortOrders[0], frameOrder: [1, 7, 2, 3, 4, 5, 6] }],
  } as never);

  const said = decideResort(order(), [1, 7, 2, 3, 4, 5, 6]);
  check('it is marked', [...(said.moved ?? [])], [7]);
  check('AND IT LEAVES THE DAY 1 SHOTS FOR THE DAY 3 ONES',
    said.frameOrder, [1, 2, 3, 4, 7, 5, 6]);
}

console.log('\n14. a shot its box takes but the box INSIDE it does not');
{
  // Roman's log: `3.#1: no box → DAY 3` — and the order came out the same.
  //
  // DAY 3 leads into 1ST UNIT. A shot with DAY 3 and no unit is taken by DAY 3
  // and refused by the box inside it. flattenBracketOrder then LEFT IT OUT
  // altogether: it hands back what the inner box says and nothing else. So the
  // shot had no place in the sheet's own answer, fillTheGaps put it back where
  // it already was — and the order "came out the same" every single time.
  //
  // A box's shots all belong inside that box's run. The ones its inner box did
  // not claim come after the ones it did, which is also the order the boxes are
  // ranked in (boxOrderOfSheet puts a refinement before its parent).
  const UNIT = 'tbl_unit';
  const U1 = 'ti_unit1';
  const inner: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    right: { inputIds: [1, 2, 3], categoryId: UNIT, categoryName: 'UNIT',
             itemId: U1, itemName: '1ST UNIT', matchedIds: [1, 2] },
    down: { inputIds: [4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
            itemId: D2, itemName: 'DAY 2', matchedIds: [4, 5, 6] },
  };
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], inner, [1, 2, 3, 4, 5, 6]);
  {
    const s = useStore.getState();
    const needs = { ...s.frameNeeds };
    for (const id of [1, 2]) needs[id] = { ...needs[id], toggles: { [D1]: true, [U1]: true } };
    useStore.setState({ frameNeeds: needs } as never);
  }
  check('THE SHOT THE INNER BOX REFUSED IS STILL IN THE ANSWER',
    flattenBracketOrder(deserializeBracket(inner)), [1, 2, 3, 4, 5, 6]);

  // And the whole story: a new shot made low down, then given DAY 1 and no
  // unit, has to climb to the day 1 shots — behind shot 3, the other shot its
  // inner box refused.
  const s = useStore.getState();
  const needs = { ...s.frameNeeds };
  const n = createDefaultFrameNeedState();
  n.toggles = { [D1]: true };
  needs[7] = n;
  const storyboard = [...s.frames];
  storyboard.splice(5, 0, frame(7));            // made from shot 5, down in day 2
  useStore.setState({
    frames: storyboard, frameNeeds: needs,
    sortOrders: [{ ...s.sortOrders[0], frameOrder: [1, 2, 3, 4, 5, 7, 6] }],
  } as never);

  const said = decideResort(order(), [1, 2, 3, 4, 5, 7, 6]);
  check('it is marked', [...(said.moved ?? [])], [7]);
  check('AND IT CLIMBS TO THE DAY 1 SHOTS', said.frameOrder, [1, 2, 3, 7, 4, 5, 6]);
}

console.log('\n15. a shot deleted from the project leaves the order too');
{
  // Roman's log, on every open, for ever:
  //   `only 19 of 20 frames here yet — too early to judge`
  // The order still listed 3.#1, which he had deleted. The re-sort will not
  // judge an order whose shots are not all here — a load half done must not be
  // sorted — so one ghost froze that order completely.
  const cleaned = withoutShotsThatAreGone(
    [1, 2, 3, 99, 4, 5, 6], [1, 2, 3, 4, 5, 6],
    [{ id: 'b1', text: 'LUNCH', position: 2 }, { id: 'b2', text: 'WRAP', position: 6 }]);
  check('the ghost is dropped', cleaned.frameOrder, [1, 2, 3, 4, 5, 6]);
  check('and it is named', cleaned.gone, [99]);
  check('a break in front of it does not move', cleaned.breaks[0].position, 2);
  check('a break behind it comes up one', cleaned.breaks[1].position, 5);
  check('and an order with no ghosts is left alone',
    withoutShotsThatAreGone([1, 2, 3], [1, 2, 3]).gone, []);

  // And the freeze itself: with the ghost gone, the order judges again.
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  useStore.setState({
    sortOrders: [{ ...order(), frameOrder: [1, 2, 3, 99, 4, 5, 6] }],
  } as never);
  moveToDay(6, D1);
  check('WITH A GHOST IN THE LIST IT REFUSES TO JUDGE',
    decideResort(order(), ALL).why, 'only 6 of 7 frames here yet — too early to judge');

  useStore.setState({
    sortOrders: [{ ...order(),
      frameOrder: withoutShotsThatAreGone(order().frameOrder, ALL).frameOrder }],
  } as never);
  check('and with the ghost gone it moves the shot', openTheOrder(), 1);
  check('to where its box puts it', order().frameOrder, [1, 2, 3, 6, 4, 5]);
}

console.log('\n16. SORT NOW: the order becomes what the sheet says');
{
  // THE LOOP THAT BROKE ROMAN'S ORDER, kept here so it cannot come back.
  // This is what the SORT NOW button used to do on its own, with none of the
  // protections decideResort has. `showing 57 of 55`.
  function theOldWay(standsAs: number[], sheetSays: number[], visible: number[]): number[] {
    const here = new Set(visible);
    const out: number[] = [];
    let bi = 0;
    for (const fid of standsAs) {
      if (here.has(fid)) { if (bi < sheetSays.length) out.push(sheetSays[bi++]); }
      else out.push(fid);
    }
    while (bi < sheetSays.length) out.push(sheetSays[bi++]);
    return out;
  }

  // A sheet that names shot 2 twice — which flattenBracketOrder can do, and
  // which is why every other path runs its answer through fillTheGaps first.
  const repeats = [4, 5, 6, 1, 2, 2, 3];
  check('THE OLD WAY GREW THE LIST AND REPEATED A SHOT',
    theOldWay([1, 2, 3, 4, 5, 6], repeats, ALL), [4, 5, 6, 1, 2, 2, 3]);
  check('the new way does not', orderFromSheet([1, 2, 3, 4, 5, 6], repeats, ALL),
    [4, 5, 6, 1, 2, 3]);

  // The plain case.
  check('a plain sort is just the sheet',
    orderFromSheet([1, 2, 3, 4, 5, 6], [4, 5, 6, 1, 2, 3], ALL), [4, 5, 6, 1, 2, 3]);

  // A shot in another group is not on screen: it does not move, and the shots
  // that ARE on screen sort around it.
  check('a shot not on screen stays exactly where it is',
    orderFromSheet([1, 2, 3, 4, 5, 6], [6, 5, 4, 2, 1], [1, 2, 4, 5, 6]),
    [6, 5, 3, 4, 2, 1]);

  // The sheet leaves somebody out — it must not cost them their place.
  check('a shot the sheet does not name keeps its place',
    orderFromSheet([1, 2, 3, 4, 5, 6], [1, 2, 4, 5, 6], ALL), [1, 2, 3, 4, 5, 6]);

  // And an order that is ALREADY damaged comes back clean.
  check('an order holding a shot twice comes back holding it once',
    orderFromSheet([1, 2, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6], ALL), [1, 2, 3, 4, 5, 6]);

  // The three promises, on every case above.
  for (const [name, got] of [
    ['plain', orderFromSheet([1, 2, 3, 4, 5, 6], [4, 5, 6, 1, 2, 3], ALL)],
    ['repeating sheet', orderFromSheet([1, 2, 3, 4, 5, 6], repeats, ALL)],
    ['sheet with a gap', orderFromSheet([1, 2, 3, 4, 5, 6], [1, 2, 4, 5, 6], ALL)],
  ] as [string, number[]][]) {
    check(`${name}: 6 shots, each once`,
      [got.length, new Set(got).size, [...got].sort().join(',')], [6, 6, '1,2,3,4,5,6']);
  }
}

console.log('\n17. which icons are green and which are red');
{
  // The rule that #443 broke and #446 put back. It is here now, so it can be
  // asked in a second instead of on Roman's screen.
  const sheet = twoBoxes([1, 2, 3], [4, 5, 6]);
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], sheet, [1, 2, 3, 4, 5, 6]);
  const root = deserializeBracket(sheet);
  const none = new Set<number>();

  // GREEN, WHATEVER THE SHEET IS DOING. This is the one that broke: building a
  // sheet must not silence "your needs change moved this shot".
  check('a waiting shot is green once the sheet is applied',
    [...iconStates(ALL, root, new Set([3]), true).green], [3]);
  check('AND GREEN WHILE THE SHEET IS STILL BEING BUILT',
    [...iconStates(ALL, root, new Set([3]), false).green], [3]);

  // RED waits, because until the boxes have placed anybody nobody can be out of
  // place. Shot 6 is a day 2 shot dragged up among the day 1 shots.
  const dragged = [1, 6, 2, 3, 4, 5];
  check('a displaced shot is red once the sheet is applied',
    [...iconStates(dragged, root, none, true).red], [6]);
  check('but not while the sheet is being built',
    [...iconStates(dragged, root, none, false).red], []);

  // Never both.
  const both = iconStates(dragged, root, new Set([6]), true);
  check('a shot that is green is not also red', [[...both.green], [...both.red]], [[6], []]);

  // And a settled order marks nobody.
  const calm = iconStates(ALL, root, none, true);
  check('a settled order marks nobody', [[...calm.green], [...calm.red]], [[], []]);
}

console.log('\n18. a break stays between the same two shots');
{
  // Roman: "the break must stay behind the shot above. If a shot above it was
  // removed it goes one higher; if a shot was added above, it goes +1."
  //
  // Order 1..6 with LUNCH after shot 2 and WRAP after shot 5.
  const breaks = [{ id: 'b1', text: 'LUNCH', position: 2 },
                  { id: 'b2', text: 'WRAP', position: 5 }];

  // A shot made from shot 1 goes in at place 2 — above both breaks.
  check('A SHOT ADDED ABOVE PUSHES THE BREAK DOWN ONE',
    breaksAfterInsert(breaks, 0).map((b) => b.position), [3, 6]);
  // A shot made from shot 2 — the last shot above LUNCH — is still above it.
  check('and a shot made from the shot just above it counts as above',
    breaksAfterInsert(breaks, 1).map((b) => b.position), [3, 6]);
  // A shot made from shot 3 is below LUNCH and above WRAP.
  check('a shot added between them moves only the one below',
    breaksAfterInsert(breaks, 2).map((b) => b.position), [2, 6]);
  check('and one added at the very end moves neither',
    breaksAfterInsert(breaks, 5).map((b) => b.position), [2, 5]);

  // Removal is the same sentence backwards.
  check('A SHOT REMOVED ABOVE BRINGS THE BREAK UP ONE',
    breaksAfterRemoval(breaks, 0).map((b) => b.position), [1, 4]);
  check('a shot removed between them moves only the one below',
    breaksAfterRemoval(breaks, 2).map((b) => b.position), [2, 4]);
  check('and one removed below both moves neither',
    breaksAfterRemoval(breaks, 5).map((b) => b.position), [2, 5]);

  // Added then removed at the same place leaves everything as it was.
  check('add then remove is a round trip',
    breaksAfterRemoval(breaksAfterInsert(breaks, 0), 0).map((b) => b.position), [2, 5]);
}

console.log('\n19. no shot may be drawn in two boxes at once');
{
  // Roman's own test caught this: the red icons came back as
  // ["12","10","2","5","10"] — shot 10 twice. #437 stopped KEEP ORDER being
  // emptied, but left its list frozen, so a shot that later moved UP into a
  // real box was still listed in KEEP ORDER as well and the sheet drew it twice.
  const withKeep: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2],
    down: {
      inputIds: [3, 4, 5, 6], categoryId: '__keep__', categoryName: 'KEEP ORDER',
      itemId: '__keep__', itemName: 'KEEP ORDER', matchedIds: [3, 4, 5, 6],
    },
  };
  setUp({ 1: D1, 2: D1, 3: D2, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6], withKeep, [1, 2, 3, 4, 5, 6]);
  moveToDay(5, D1);                      // shot 5 climbs out of KEEP ORDER

  const root = deserializeBracket(withKeep);
  syncBracketWithVisibleFrames(root, ALL);
  rematchToNeeds(root);
  check('the day 1 box takes it', root.matchedIds, [1, 2, 5]);
  check('AND KEEP ORDER LETS IT GO', root.down?.matchedIds, [3, 4, 6]);

  const everyPill: number[] = [];
  const walk = (n: typeof root): void => {
    if (n.categoryId && n.itemId) everyPill.push(...n.matchedIds);
    if (n.right) walk(n.right);
    if (n.down) walk(n.down);
  };
  walk(root);
  check('SO NO SHOT IS DRAWN TWICE',
    [everyPill.length, new Set(everyPill).size], [6, 6]);

  // And KEEP ORDER still keeps the order it was given, newcomers at the end.
  const back: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1],
    down: {
      inputIds: [2, 3, 4, 5, 6], categoryId: '__keep__', categoryName: 'KEEP ORDER',
      itemId: '__keep__', itemName: 'KEEP ORDER', matchedIds: [6, 4, 3],
    },
  };
  setUp({ 1: D1, 2: D2, 3: D2, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6], back, [1, 2, 3, 4, 5, 6]);
  const r2 = deserializeBracket(back);
  rematchToNeeds(r2);
  // A NEWCOMER GOES AT ITS NUMBER (#455). The box was given 6, 4, 3 in that
  // order — somebody put them that way round on purpose — and keeps it. Shots
  // 2 and 5 are new to it: 5 slips in behind 4, the shot it follows in the
  // storyboard, and 2 has nobody above it at all so it goes to the front.
  check('the shots it was given keep their order, newcomers go at their number',
    r2.down?.matchedIds, [2, 6, 4, 5, 3]);
}

console.log('\n20. a shot falling into KEEP ORDER is left where it is');
{
  // Roman's rule: a shot with no needs stays where it was made. A new shot
  // falls through every box and lands in KEEP ORDER — and that counted as "the
  // boxes placed it", so the app carried it off to the end of that box. His own
  // test caught it: "the new shot 6#1 sits at place 13, behind 11".
  const withKeep: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2],
    down: {
      inputIds: [3, 4, 5, 6], categoryId: '__keep__', categoryName: 'KEEP ORDER',
      itemId: '__keep__', itemName: 'KEEP ORDER', matchedIds: [3, 4, 5, 6],
    },
  };
  setUp({ 1: D1, 2: D1, 3: D2, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6], withKeep, [1, 2, 3, 4, 5, 6]);

  // A new shot with no needs at all, made from shot 1 — so it sits BETWEEN the
  // two day 1 shots, which is where the boxes would never put it.
  const here = [1, 7, 2, 3, 4, 5, 6];
  const s0 = useStore.getState();
  const needs = { ...s0.frameNeeds };
  const blank = createDefaultFrameNeedState();
  blank.toggles = {};
  needs[7] = blank;
  const storyboard = [...s0.frames];
  storyboard.splice(1, 0, frame(7));
  useStore.setState({
    frames: storyboard, frameNeeds: needs,
    sortOrders: [{ ...s0.sortOrders[0], frameOrder: [...here] }],
  } as never);

  const said = decideResort(order(), here);
  check('IT IS NOT CARRIED OFF TO KEEP ORDER', said.frameOrder, undefined);
  check('and it is not marked by the boxes either', [...(said.moved ?? [])], []);
  check('so it stays behind the shot it was made from', order().frameOrder, here);

  // …but it IS red, because it is sitting among the day 1 shots and belongs
  // with the leftovers. Red is worked out from the box ranks, and this rule
  // says nothing about it.
  const root = deserializeBracket(withKeep);
  syncBracketWithVisibleFrames(root, here);
  rematchToNeeds(root);
  const red = shotsOutsideTheirBox(here, boxOfEachFrame(root), boxOrderOfSheet(root));
  check('AND IT IS STILL RED FOR SITTING THERE', [...red], [7]);
}

console.log('\n21. the REMAINING inside a branch is a real place');
{
  // Roman: "inside a branch — DAY 1 minus LOCATION 1. A real place. Moved into,
  // and marked green." Only the box at the very BOTTOM of the sheet is the
  // leftovers. Both used to be called leftovers, so a shot whose needs went
  // from DAY 1 + LOCATION 1 to DAY 1 only sat still and stayed grey.
  const LOCATION = 'tbl_location';
  const branch: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    right: {
      inputIds: [1, 2, 3], categoryId: LOCATION, categoryName: 'LOCATION',
      itemId: L1, itemName: 'LOCATION 1', matchedIds: [1, 2, 3],
      down: { inputIds: [], categoryId: '__remaining__', categoryName: 'REMAINING',
              itemId: '__remaining__', itemName: 'REMAINING', matchedIds: [] },
    },
    down: {
      inputIds: [4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
      itemId: D2, itemName: 'DAY 2', matchedIds: [4, 5, 6],
    },
  };
  setUp(EVERY_DAY, [1, 2, 3, 4, 5, 6], branch, [1, 2, 3, 4, 5, 6]);
  {
    const s0 = useStore.getState();
    const needs = { ...s0.frameNeeds };
    for (const id of [1, 2, 3]) needs[id] = { ...needs[id], toggles: { [D1]: true, [L1]: true } };
    useStore.setState({ frameNeeds: needs } as never);
  }

  // Shot 1 keeps DAY 1 but loses LOCATION 1 — so it leaves the LOCATION 1 box
  // for the REMAINING inside DAY 1. That is a real move.
  {
    const s0 = useStore.getState();
    const needs = { ...s0.frameNeeds };
    needs[1] = { ...needs[1], toggles: { [D1]: true } };
    useStore.setState({ frameNeeds: needs } as never);
  }
  const said = decideResort(order(), ALL);
  check('IT IS MARKED — the branch REMAINING is a place, not the leftovers',
    [...(said.moved ?? [])], [1]);
  check('and it says which boxes', said.why?.includes('REMAINING'), true);

  // …while a shot falling out of every box, to the box at the very BOTTOM of
  // the sheet, is the leftovers and is not marked. That is section 6.
}

console.log('\n22. a shot joining a box whose only other shot is out of place');
{
  // Roman's 7A. It moved into DAY 2 > LOCATION 1 > 1st UNIT > REVERSE, a box
  // whose only other shot was 3 — and 3 was red, sitting where he had dragged
  // it. The placement stepped around misplaced shots when picking a NEIGHBOUR
  // but not in the last fallback, so 7A anchored to whatever happened to
  // precede it. "It changed position correctly in the bracket, but wrongly in
  // the order of frame-cards."
  //
  // Three boxes; shot 5 is the only DAY 3 shot and it has been dragged to the
  // very front, out of its box. Shot 2 now becomes a DAY 3 shot.
  const D3 = 'ti_day3';
  const threeBoxes: BracketNodeData = {
    inputIds: [...ALL], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2],
    down: {
      inputIds: [3, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
      itemId: D2, itemName: 'DAY 2', matchedIds: [3, 4, 6],
      down: { inputIds: [5], categoryId: DAY, categoryName: 'SHOOT DAY',
              itemId: D3, itemName: 'DAY 3', matchedIds: [5] },
    },
  };
  setUp({ 1: D1, 2: D1, 3: D2, 4: D2, 5: D3, 6: D2 },
        [5, 1, 2, 3, 4, 6], threeBoxes, [1, 2, 3, 4, 6, 5]);

  // Shot 5 is out of its box, at the front.
  {
    const root = deserializeBracket(threeBoxes);
    const red = shotsOutsideTheirBox([5, 1, 2, 3, 4, 6],
      boxOfEachFrame(root), boxOrderOfSheet(root));
    check('shot 5 is the misplaced one', [...red], [5]);
  }

  moveToDay(2, D3);              // shot 2 joins DAY 3 — where only shot 5 lives
  openTheOrder();
  const now = order().frameOrder;
  const root = deserializeBracket(order().bracketTree!);
  const red = shotsOutsideTheirBox(now, boxOfEachFrame(root), boxOrderOfSheet(root));

  check('IT IS NOT PARKED NEXT TO THE MISPLACED SHOT', now.indexOf(2), 5);
  check('and the app has not made it red', red.has(2), false);
  check('only the shot somebody dragged is red', [...red], [5]);
}

console.log(failures === 0 ? '\nALL GOOD\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

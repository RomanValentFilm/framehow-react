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
// THE RULES
//   1  Only a shot whose BOX changed moves. Its needs changed; nothing else has.
//   2  It joins its box in storyboard order — shot 7 after shot 6.
//   3  It never displaces a shot somebody placed at the head of that box.
//   4  A shot already in the right place does not move, and is still marked.
//   5  Everything else is untouched, including shots moved by hand.
//   6  A shot no box matches belongs with the leftovers. That is a real place.
//   7  The list can never grow, shrink, or hold the same shot twice.
//   8  Boxes are read as a whole chain: DAY 1 > LOCATION 1 is its own place.
//   9  The sheet learns what it now holds, so a change is announced once.
//  10  Breaks follow the shot above them, unless that shot is one that changed.
//  11  RED marks only the shot that breaks the order of the boxes.

import { useStore, DEFAULT_NEED_DEFINITIONS, createDefaultFrameNeedState } from '../src/store/state';
import type { Frame, SortOrder, BracketNodeData, FrameNeedState } from '../src/store/state';
import {
  decideResort, placeChangedFrames, breaksAfterResort, deserializeBracket,
  serializeBracket, syncBracketWithVisibleFrames, boxOfEachFrame, boxOrderOfSheet,
  shotsOutsideTheirBox,
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

console.log('\n3. it never displaces a shot placed at the head of that box by hand');
{
  // Shot 6 (a day 2 shot) was dragged to the very front. Shot 1 becomes day 2.
  setUp(EVERY_DAY, [6, 1, 2, 3, 4, 5], twoBoxes([1, 2, 3], [4, 5, 6]), [1, 2, 3, 4, 5, 6]);
  moveToDay(1, D2);
  const said = decideResort(order(), ALL);
  check('the changed shot is marked', said.moved ? [...said.moved] : [], [1]);
  openTheOrder();
  check('the hand-placed shot keeps the lead', order().frameOrder[0], 6);
  check('and the newcomer sits in behind it', order().frameOrder[1], 1);
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

console.log(failures === 0 ? '\nALL GOOD\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

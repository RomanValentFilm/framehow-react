// THE BENCH: does a shooting order follow the NEEDS without losing anything?
//
// Run:  npm run bench:resort
//
// #411 re-sorts an order when the needs behind it change. The first version of
// it took 27 shots out of Roman's shooting order and could not put them back,
// because the sorting sheet does NOT list every frame: a box with nothing below
// it silently leaves out the frames it did not match. This drives the real
// function against a real store — no browser, no deploy — and the third case is
// that exact fault.

import { useStore, DEFAULT_NEED_DEFINITIONS, createDefaultFrameNeedState } from '../src/store/state';
import type { Frame, SortOrder, BracketNodeData, FrameNeedState } from '../src/store/state';
import { decideResort, placeChangedFrames, breaksAfterResort,
         deserializeBracket, serializeBracket, syncBracketWithVisibleFrames } from '../src/lib/bracket';

const DAY = 'tbl_shootday';
const D1 = 'ti_day1';
const D2 = 'ti_day2';

let failures = 0;
function check(what: string, got: unknown, want: unknown): void {
  const g = JSON.stringify(got); const w = JSON.stringify(want);
  if (g === w) { console.log(`  ok    ${what}`); return; }
  failures++;
  console.log(`  FAIL  ${what}\n        wanted ${w}\n        got    ${g}`);
}

function frame(id: number): Frame {
  return {
    id, src: '', label: `${id}.`, cropW: 0, cropH: 0, strokes: [],
    drawMode: false, textContent: '', tableData: null,
    serverFrameId: `srv-${id}`,
  };
}

/** Put six frames on the bench, with the given day for each. */
function setUp(days: Record<number, string>, order: number[], sheet: BracketNodeData,
               snapshot: number[]): SortOrder {
  const frames = [1, 2, 3, 4, 5, 6].map(frame);
  const frameNeeds: Record<number, FrameNeedState> = {};
  for (const f of frames) {
    const n = createDefaultFrameNeedState();
    n.toggles = { [days[f.id]]: true };
    frameNeeds[f.id] = n;
  }
  const theOrder: SortOrder = {
    id: 'sort_1', name: 'SHOOTING ORDER 1', description: '',
    frameOrder: [...order], breaks: [],
    bracketTree: sheet, sortedSnapshot: [...snapshot],
  };
  useStore.setState({
    frames, frameNeeds, sortOrders: [theOrder], activeGroupId: null,
    needDefinitions: JSON.parse(JSON.stringify(DEFAULT_NEED_DEFINITIONS)),
  });
  return theOrder;
}

/** A sheet: "DAY 1 first, then DAY 2." */
function twoBoxes(day1: number[], day2: number[], all: number[]): BracketNodeData {
  return {
    inputIds: [...all], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [...day1],
    down: {
      inputIds: [...day2], categoryId: DAY, categoryName: 'SHOOT DAY',
      itemId: D2, itemName: 'DAY 2', matchedIds: [...day2],
    },
  };
}

const order = (): SortOrder => useStore.getState().sortOrders[0];
const allIds = [1, 2, 3, 4, 5, 6];

/** What the app does on opening: ask, then write the answer down. */
function openTheOrder(): number {
  const said = decideResort(order(), allIds);
  if (!said.frameOrder) {
    console.log(`        (${said.why})`);
    // Nothing moved, but the boxes may have learned who they hold — the app
    // writes that down quietly, and so must the bench.
    if (said.sheet) useStore.setState({ sortOrders: [{ ...order(), bracketTree: said.sheet }] });
    return 0;
  }
  useStore.setState({
    sortOrders: [{ ...order(), frameOrder: said.frameOrder, sortedSnapshot: said.fresh!,
                   bracketTree: said.sheet! }],
  });
  return said.moved!.size;
}

console.log('\n1. a frame moved to another day moves in the order');
{
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6],
        twoBoxes([1, 2, 3], [4, 5, 6], [1, 2, 3, 4, 5, 6]),
        [1, 2, 3, 4, 5, 6]);
  // Frame 1 is now a DAY 2 shot.
  const needs = { ...useStore.getState().frameNeeds };
  needs[1] = { ...needs[1], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  check('one frame moved', openTheOrder(), 1);
  check('it goes to the end of its box', order().frameOrder, [2, 3, 4, 5, 6, 1]);
  check('nobody was lost', order().frameOrder.length, 6);
}

console.log('\n2. a frame moved BY HAND stays where it was put');
{
  // Frame 6 was dragged to the front. The sheet knows nothing about that.
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [6, 1, 2, 3, 4, 5],
        twoBoxes([1, 2, 3], [4, 5, 6], [1, 2, 3, 4, 5, 6]),
        [1, 2, 3, 4, 5, 6]);
  const needs = { ...useStore.getState().frameNeeds };
  needs[1] = { ...needs[1], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  check('one frame moved', openTheOrder(), 1);
  check('the hand-moved frame is still at the front', order().frameOrder[0], 6);
  check('and the needs frame went to the end of its box', order().frameOrder, [6, 2, 3, 4, 5, 1]);
}

console.log('\n3. THE 27 SHOTS: a sheet that cannot place a frame must not move it');
{
  // One box and nothing below it — so the sheet lists only the DAY 1 frames.
  // Frame 1 becomes a DAY 2 shot, which no box covers.
  const oneBox: BracketNodeData = {
    inputIds: [1, 2, 3, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
  };
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6], oneBox, [1, 2, 3, 4, 5, 6]);
  const needs = { ...useStore.getState().frameNeeds };
  needs[1] = { ...needs[1], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  // The sheet has no opinion about where a frame it cannot place should go, so
  // that frame stays exactly where it is and the order comes out unchanged.
  const said = decideResort(order(), allIds);
  check('nothing was moved', openTheOrder(), 0);
  check('and it says so', said.why, '1 frame(s) changed box, order comes out the same');
  check('ALL SIX SHOTS ARE STILL IN THE ORDER', order().frameOrder, [1, 2, 3, 4, 5, 6]);
}

console.log('\n5. the last-ditch guard: rebuilding never loses a frame');
{
  // The sheet cannot place 3 or 6 — they are simply not in the fresh list. This
  // is the shape that took 27 shots out of Roman's order: pulled out, and with
  // nowhere to go back to. Nobody may be dropped, whatever the sheet says.
  const rebuilt = placeChangedFrames(
    [1, 2, 3, 4, 5, 6],           // the order as it stands
    [2, 1, 4, 5],                 // what the sheet can place — 3 and 6 missing
    new Set([1, 3, 6]),           // the frames said to have moved
  ).list;
  check('every shot is still there', [...rebuilt].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
  check('and none of them twice', new Set(rebuilt).size, 6);
}

console.log('\n6. once it has followed a change, it does not keep re-announcing it');
{
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6],
        twoBoxes([1, 2, 3], [4, 5, 6], [1, 2, 3, 4, 5, 6]),
        [1, 2, 3, 4, 5, 6]);
  const needs = { ...useStore.getState().frameNeeds };
  needs[1] = { ...needs[1], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  check('the first open follows it', openTheOrder(), 1);
  // Opening it again must be quiet. It used to say "1 frame changed box, order
  // comes out the same" for ever, which buried every later change.
  const again = decideResort(order(), allIds);
  check('the second open has nothing to say', again.why, 'the boxes match the needs — nothing to do');

  // And a NEW change is seen on its own, not lost among the old ones.
  const more = { ...useStore.getState().frameNeeds };
  more[6] = { ...more[6], toggles: { [D1]: true } };
  useStore.setState({ frameNeeds: more });
  check('a later change is noticed', openTheOrder(), 1);
  check('and frame 6 joined the day 1 shots', order().frameOrder, [2, 3, 6, 4, 5, 1]);
}

console.log('\n7. a change that does not move the order still settles');
{
  // Frame 3 becomes a DAY 2 shot. It already sits next to the day 2 block, so
  // the order comes out identical — but the boxes have changed, and the sheet
  // has to learn it. Live on try411 this repeated "4 frame(s) changed box,
  // order comes out the same" on every single open, for ever.
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6],
        twoBoxes([1, 2, 3], [4, 5, 6], [1, 2, 3, 4, 5, 6]),
        [1, 2, 3, 4, 5, 6]);
  const needs = { ...useStore.getState().frameNeeds };
  needs[3] = { ...needs[3], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  // Since #419 a shot that changes day goes to the END of that day, so this
  // one does move — it was written when a changed shot stayed put.
  const first = decideResort(order(), allIds);
  check('it goes to the end of its new box', first.frameOrder, [1, 2, 4, 5, 6, 3]);
  check('and the sheet has learned', !!first.sheet, true);
  // GREEN EVEN THOUGH NOTHING MOVED (#418). Roman doubted this worked, and he
  // was right — the set was not passed back, so the shot he had just changed
  // was never marked.
  check('and the changed shot is reported', first.moved ? [...first.moved] : [], [3]);
  openTheOrder();                       // the app writes the sheet down
  const second = decideResort(order(), allIds);
  check('so the next open is quiet', second.why, 'the boxes match the needs — nothing to do');
}

console.log('\n8. A CHAIN: DAY 1 > LOCATION 1, and a frame leaves for DAY 2');
{
  // The sheet goes two deep: of the DAY 1 shots, which are at LOCATION 1.
  // Frame 1 is a DAY 1 / LOCATION 1 shot. Change it to DAY 2 and it has to
  // leave the first box altogether and join the day 2 shots — which only works
  // if a frame is filed by its WHOLE chain and not just the box it starts in.
  const LOC = 'tbl_location';
  const L1 = 'ti_loc1';
  const chain: BracketNodeData = {
    inputIds: [1, 2, 3, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    right: {
      inputIds: [1, 2, 3], categoryId: LOC, categoryName: 'LOCATION',
      itemId: L1, itemName: 'LOCATION 1', matchedIds: [1, 2],
    },
    down: {
      inputIds: [4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
      itemId: D2, itemName: 'DAY 2', matchedIds: [4, 5, 6],
    },
  };
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6], chain, [1, 2, 3, 4, 5, 6]);
  // Frames 1 and 2 are also at LOCATION 1.
  const withLoc = { ...useStore.getState().frameNeeds };
  for (const id of [1, 2]) withLoc[id] = { ...withLoc[id], toggles: { [D1]: true, [L1]: true } };
  useStore.setState({ frameNeeds: withLoc });
  check('nothing to do to start with', openTheOrder(), 0);

  // Now frame 1 is a DAY 2 shot. It keeps LOCATION 1, which no longer helps it.
  const moved = { ...useStore.getState().frameNeeds };
  moved[1] = { ...moved[1], toggles: { [D2]: true, [L1]: true } };
  useStore.setState({ frameNeeds: moved });

  check('the frame leaves the first box', openTheOrder(), 1);
  check('and sits with the day 2 shots', order().frameOrder, [2, 3, 4, 5, 6, 1]);
  check('nobody was lost', order().frameOrder.length, 6);
}

console.log('\n9. the sheet that gets saved must not contradict itself');
{
  // Every box's matches have to come out of its own incoming frames, and what
  // it does not take has to drop to the box below. A sheet where a box holds a
  // frame that never entered it draws the same shot in two places at once —
  // Roman: "chaos, the frames are duplicated or even tripled, even the boxes."
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6],
        twoBoxes([1, 2, 3], [4, 5, 6], [1, 2, 3, 4, 5, 6]),
        [1, 2, 3, 4, 5, 6]);
  const needs = { ...useStore.getState().frameNeeds };
  needs[1] = { ...needs[1], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  const said = decideResort(order(), allIds);
  const problems: string[] = [];
  const seen = new Set<number>();
  const walk = (b: BracketNodeData | undefined): void => {
    if (!b) return;
    const input = new Set(b.inputIds);
    for (const id of b.matchedIds) {
      if (!input.has(id)) problems.push(`frame ${id} matched by a box it never entered`);
      if (seen.has(id)) problems.push(`frame ${id} is in two boxes at once`);
      seen.add(id);
    }
    walk(b.right); walk(b.down);
  };
  walk(said.sheet);
  check('the saved sheet makes sense', problems, []);
}

console.log('\n10. A SHEET THAT NAMES A FRAME TWICE MUST NOT DOUBLE THE ORDER');
{
  // Two boxes both claiming frame 2 — which is what a corrupted sheet looks
  // like. The rebuild must still be a rearrangement of the list it was given:
  // never longer, never the same shot twice. Roman's log: `list 18 → 19`, and
  // the same shot drawn again and again on screen.
  const overlapping: BracketNodeData = {
    inputIds: [1, 2, 3, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2, 3],
    down: {
      inputIds: [2, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
      itemId: D2, itemName: 'DAY 2', matchedIds: [2, 4, 5, 6],
    },
  };
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6], overlapping, [1, 2, 3, 4, 5, 6]);
  const needs = { ...useStore.getState().frameNeeds };
  needs[1] = { ...needs[1], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  openTheOrder();
  const list = order().frameOrder;
  check('the order did not grow', list.length <= 6, true);
  check('and no shot is in it twice', new Set(list).size, list.length);
}

console.log('\n11. breaks follow the shot above them — unless that shot changed');
{
  const was = [1, 2, 3, 4, 5, 6];
  const now = [2, 3, 1, 4, 5, 6];        // frame 1 changed day and moved down
  const moved = new Set([1]);

  // A break after frame 3 — frame 3 did not change, so the break goes with it.
  check('a break follows the shot above it',
    breaksAfterResort([{ id: 'b1', text: 'LUNCH', position: 3 }], was, now, moved),
    [{ id: 'b1', text: 'LUNCH', position: 2 }]);

  // A break after frame 1 — frame 1 is the one that changed day, so the break
  // stays where it was rather than being dragged to another day.
  check('but not one whose shot changed',
    breaksAfterResort([{ id: 'b2', text: 'DAY 2', position: 1 }], was, now, moved),
    [{ id: 'b2', text: 'DAY 2', position: 1 }]);

  // A break at the very top has no shot above it.
  check('and one at the top stays at the top',
    breaksAfterResort([{ id: 'b3', text: 'CALL', position: 0 }], was, now, moved),
    [{ id: 'b3', text: 'CALL', position: 0 }]);
}

console.log('\n12. a sheet must not gain the same frame twice');
{
  // The sheet already holds all six, but flattening it leaves out 3 (the box
  // has nothing below it). Taking the frames on screen must not add 3 again.
  const oneBox: BracketNodeData = {
    inputIds: [1, 2, 3, 4, 5, 6], categoryId: DAY, categoryName: 'SHOOT DAY',
    itemId: D1, itemName: 'DAY 1', matchedIds: [1, 2],
  };
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6], oneBox, [1, 2, 3, 4, 5, 6]);
  const root = deserializeBracket(oneBox);
  syncBracketWithVisibleFrames(root, allIds);
  const saved = serializeBracket(root);
  check('no box lists a frame twice', saved.inputIds.length, new Set(saved.inputIds).size);
  check('and the sheet did not grow', saved.inputIds.length, 6);
}

console.log('\n13. A SHOT GOES TO THE END OF ITS BOX, WHEREVER THAT BOX IS');
{
  // The list is NOT in box order — 6 (a day 2 shot) was dragged to the front.
  // Frame 1 becomes a day 2 shot. Under the old rule it anchored to whichever
  // shot happened to sit in front of it and could land among the wrong day —
  // Roman: "8B ... its green card landed behind DAY 3". It must join the day 2
  // shots as they actually sit in this list.
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [6, 1, 2, 3, 4, 5],
        twoBoxes([1, 2, 3], [4, 5, 6], [1, 2, 3, 4, 5, 6]),
        [1, 2, 3, 4, 5, 6]);
  const needs = { ...useStore.getState().frameNeeds };
  needs[1] = { ...needs[1], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  check('one shot moved', openTheOrder(), 1);
  const list = order().frameOrder;
  check('the hand-moved shot is still at the front', list[0], 6);
  check('and the changed shot is at the end of its box', list[list.length - 1], 1);
  check('nobody lost or repeated', new Set(list).size, 6);
}

console.log('\n14. a hand-placed shot is told when its neighbour moves away');
{
  // Frame 5 was placed by hand right after frame 2. Frame 2 then changes box
  // and leaves. Frame 5 has not changed at all — but it is no longer where it
  // was put, and nobody would know.
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 5, 3, 4, 6],
        twoBoxes([1, 2, 3], [4, 5, 6], [1, 2, 3, 4, 5, 6]),
        [1, 2, 3, 4, 5, 6]);
  const needs = { ...useStore.getState().frameNeeds };
  needs[2] = { ...needs[2], toggles: { [D2]: true } };
  useStore.setState({ frameNeeds: needs });

  const said = decideResort(order(), allIds);
  const marked = said.moved ? [...said.moved].sort((a, b) => a - b) : [];
  check('the changed shot is marked', marked.includes(2), true);
  check('and so is the hand-placed shot it left behind', marked.includes(5), true);
}

console.log('\n4. needs unchanged — the order is left completely alone');
{
  setUp({ 1: D1, 2: D1, 3: D1, 4: D2, 5: D2, 6: D2 },
        [1, 2, 3, 4, 5, 6],
        twoBoxes([1, 2, 3], [4, 5, 6], [1, 2, 3, 4, 5, 6]),
        [1, 2, 3, 4, 5, 6]);
  check('nothing moved', openTheOrder(), 0);
  check('order untouched', order().frameOrder, [1, 2, 3, 4, 5, 6]);
}

console.log(failures === 0 ? '\nALL GOOD\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);

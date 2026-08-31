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
import { decideResort, placeChangedFrames } from '../src/lib/bracket';

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
  check('it sits with the day 2 shots', order().frameOrder, [2, 3, 1, 4, 5, 6]);
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
  check('and the needs frame moved', order().frameOrder, [6, 2, 3, 1, 4, 5]);
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
  );
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
  check('and frame 6 is with the day 1 shots', order().frameOrder, [2, 3, 6, 1, 4, 5]);
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

  const first = decideResort(order(), allIds);
  check('the order does not move', first.frameOrder, undefined);
  check('but the sheet has learned', !!first.sheet, true);
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
  check('and sits with the day 2 shots', order().frameOrder, [2, 3, 1, 4, 5, 6]);
  check('nobody was lost', order().frameOrder.length, 6);
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

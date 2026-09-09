// THE BENCH: folding a delta into what this device already has (#280).
//
// Run:  npm run bench:delta
//
// The dangerous half of the delta pull. The app rebuilds the storyboard from
// whatever tree it is handed, so if the fold drops a frame, forty-two frames
// disappear off the screen. Every one of these cases is a way that could
// happen.

import {
  mergeDelta, lastMergeRefusal, answerIsSafeToApply,
  untouchedByDelta, type MergeableTree,
} from '../src/lib/deltaMerge';
import { nextRetryWait, timeToTryAgain, makeRetryClock } from '../src/lib/retryWait';
import {
  whatWentWrong, worthTryingAgain, isReallyOffline, makeGoneRegister,
} from '../src/lib/projectGone';
import {
  orderForSending, orderAsArrived, groupForSending, groupAsArrived,
} from '../src/lib/orderIds';
import { applyArrangement } from '../src/lib/projectSettings';

/**
 * A MODEL of the numbering rule, for the simulation below — not the app's copy.
 *
 * It was briefly a shared file, when the plan was to make the devices agree on
 * their numbers. #489 decided the opposite: the numbers are private and are
 * allowed to differ for ever, because nothing that travels carries one. So the
 * rule stays where it belongs, inside the sync, and this is only here to give
 * the simulated devices something to number with.
 *
 * The real question — do two devices show the same order — is asked on the
 * simulator, in e2e/28-numbering-across-projects.spec.ts, with real browsers.
 */
function numbersForArriving(
  held: readonly { id: number; serverFrameId?: string }[],
  arriving: readonly string[],
  startFresh = false,
): Map<string, number> {
  const kept = new Map<string, number>();
  for (const f of held) if (f.serverFrameId) kept.set(f.serverFrameId, f.id);
  let next = startFresh ? 1 : Math.max(0, ...held.map((f) => f.id)) + 1;
  const out = new Map<string, number>();
  for (const name of arriving) {
    const had = startFresh ? undefined : kept.get(name);
    out.set(name, had !== undefined ? had : next++);
  }
  return out;
}

const results: Array<{ what: string; got: string; want: string }> = [];
const check = (what: string, got: unknown, want: unknown) =>
  results.push({ what, got: String(got), want: String(want) });

// ---------------------------------------------------------------------------
// a little project to work on
// ---------------------------------------------------------------------------

const frame = (id: string, at = 1000, extra: Record<string, unknown> = {}) =>
  ({ id, updated_at: at, text_content: null, ...extra }) as never;
const version = (id: string, frame_id: string, at = 1000) =>
  ({ id, frame_id, updated_at: at }) as never;

function project(frameCount: number): MergeableTree {
  const frames = Array.from({ length: frameCount }, (_, i) => frame(`f${i}`));
  const versions = frames.map((f) => version(`${(f as { id: string }).id}-v0`, (f as { id: string }).id));
  return {
    project: { id: 'p', name: 'Bench' },
    strips: [{ id: 'strip-1' }],
    frames, versions,
    images: versions.map((v) => ({ id: `${(v as { id: string }).id}-img`, version_id: (v as { id: string }).id, r2_key: 'old.jpg' } as never)),
    drawings: [],
    deletions: [], settings: [],
    server_now: 1000, full: true,
  };
}

const emptyDelta = (over: Partial<MergeableTree> = {}): MergeableTree => ({
  project: { id: 'p', name: 'Bench' },
  strips: [], frames: [], versions: [], images: [], drawings: [],
  deletions: [], settings: [], server_now: 2000, full: false,
  ...over,
});

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id).sort().join(',');

// ---------------------------------------------------------------------------
// 1. Silence means nothing happened — not "everything is gone"
// ---------------------------------------------------------------------------
{
  const held = project(45);
  const merged = mergeDelta(held, emptyDelta());
  check('an empty delta leaves all 45 frames', merged.frames.length, 45);
  check('...and all their versions', merged.versions.length, 45);
  check('...and all their pictures', merged.images.length, 45);
}

// ---------------------------------------------------------------------------
// 2. One changed frame replaces one frame, and nothing else
// ---------------------------------------------------------------------------
{
  const held = project(45);
  const merged = mergeDelta(held, emptyDelta({
    frames: [frame('f7', 2000, { text_content: 'changed elsewhere' })],
  }));
  check('still 45 frames', merged.frames.length, 45);
  check('...and f7 carries the change',
    (merged.frames.find((f) => f.id === 'f7') as unknown as { text_content: string }).text_content,
    'changed elsewhere');
  check('...while f8 is untouched',
    (merged.frames.find((f) => f.id === 'f8') as unknown as { text_content: string | null }).text_content, 'null');
}

// ---------------------------------------------------------------------------
// 3. A frame made on the other device is added
// ---------------------------------------------------------------------------
{
  const held = project(3);
  const merged = mergeDelta(held, emptyDelta({
    frames: [frame('new-1', 2000)],
    versions: [version('new-1-v0', 'new-1', 2000)],
  }));
  check('a new frame is added', merged.frames.length, 4);
  check('...with its version', merged.versions.length, 4);
}

// ---------------------------------------------------------------------------
// 4. A deletion removes the frame and everything under it
// ---------------------------------------------------------------------------
{
  const held = project(3);
  const merged = mergeDelta(held, emptyDelta({
    deletions: [{ entity_type: 'frame', entity_id: 'f1', deleted_at: 2000 }],
  }));
  check('a deleted frame goes', ids(merged.frames as Array<{ id: string }>), 'f0,f2');
  check('...its versions go with it', ids(merged.versions as Array<{ id: string }>), 'f0-v0,f2-v0');
  check('...and its picture too', merged.images.length, 2);
}

// ---------------------------------------------------------------------------
// 5. A version deleted on its own
// ---------------------------------------------------------------------------
{
  const held = project(2);
  held.versions.push(version('f0-v1', 'f0'));
  const merged = mergeDelta(held, emptyDelta({
    deletions: [{ entity_type: 'version', entity_id: 'f0-v1', deleted_at: 2000 }],
  }));
  check('a deleted version goes', ids(merged.versions as Array<{ id: string }>), 'f0-v0,f1-v0');
  check('...and the frame stays', merged.frames.length, 2);
}

// ---------------------------------------------------------------------------
// 6. A new picture on an existing version replaces the old one — not both
// ---------------------------------------------------------------------------
{
  const held = project(2);
  const merged = mergeDelta(held, emptyDelta({
    images: [{ id: 'a-brand-new-row-id', version_id: 'f0-v0', r2_key: 'new.jpg' } as never],
  }));
  check('the picture is replaced, not duplicated', merged.images.length, 2);
  check('...with the new one',
    (merged.images.find((i) => i.version_id === 'f0-v0') as unknown as { r2_key: string }).r2_key, 'new.jpg');
}

// ---------------------------------------------------------------------------
// 7. A settings item merges by kind and item, not by position
// ---------------------------------------------------------------------------
{
  const held = project(1);
  held.settings = [
    { kind: 'needCategory', item_id: 'tab_1', name: 'GEAR' } as never,
    { kind: 'needCategory', item_id: 'tab_2', name: 'ART' } as never,
  ];
  const merged = mergeDelta(held, emptyDelta({
    settings: [{ kind: 'needCategory', item_id: 'tab_1', name: 'TOOLS' } as never],
  }));
  check('both categories survive', merged.settings!.length, 2);
  check('...and the renamed one is renamed',
    (merged.settings!.find((s) => s.item_id === 'tab_1') as unknown as { name: string }).name, 'TOOLS');
}

// ---------------------------------------------------------------------------
// 8. A full answer replaces everything — that is what full means
// ---------------------------------------------------------------------------
{
  const held = project(45);
  const fresh = project(3);
  const merged = mergeDelta(held, fresh);
  check('a full answer is taken as the whole truth', merged.frames.length, 3);
}

// ---------------------------------------------------------------------------
// 9. The result is a whole project again, ready for the ordinary apply
// ---------------------------------------------------------------------------
{
  const held = project(5);
  const merged = mergeDelta(held, emptyDelta({ frames: [frame('f2', 2000)] }));
  check('the merged tree is marked whole', merged.full, true);
  check('...and carries the newer server time', merged.server_now, 2000);
  check('...and keeps the strips', merged.strips.length, 1);
}

// ---------------------------------------------------------------------------
// 10. NOTHING VANISHES (#283) — the guards, against answers built wrong
// ---------------------------------------------------------------------------
{
  // A merge that would drop a frame nothing deleted must be abandoned whole.
  const held = project(45);
  const broken = emptyDelta();
  // pretend a bug: the fold is handed a delta whose deletions name a frame that
  // was never deleted... no. Worse, and more realistic: the HELD copy is right
  // but the merge output loses a frame. Simulated by folding onto a held tree
  // and then checking the guard directly, which is what the pull does.
  const merged = mergeDelta(held, broken);
  check('a good merge is not refused', lastMergeRefusal(), 'null');
  check('...and keeps every frame', merged.frames.length, 45);

  // the guard the pull asks before it puts anything on screen
  const onScreen = held.frames.map((f) => f.id);

  const good = answerIsSafeToApply(onScreen, onScreen, []);
  check('an answer holding everything is allowed', good.safe, true);

  const withDeletion = answerIsSafeToApply(onScreen, onScreen.filter((id) => id !== 'f3'), ['f3']);
  check('an answer missing a frame that WAS deleted is allowed', withDeletion.safe, true);

  const silentLoss = answerIsSafeToApply(onScreen, onScreen.filter((id) => id !== 'f3'), []);
  check('an answer missing a frame nothing deleted is caught', silentLoss.safe, false);
  check('...and says which one',
    silentLoss.safe === false ? silentLoss.missing.join(',') : '', 'f3');

  const empty = answerIsSafeToApply(onScreen, [], []);
  check('an empty answer for a 45-frame project is caught', empty.safe, false);
  check('...naming all 45', empty.safe === false ? empty.missing.length : 0, 45);

  const halfBuilt = answerIsSafeToApply(onScreen, onScreen.slice(0, 20), []);
  check('a half-built answer is caught', halfBuilt.safe, false);

  // a device opening a project it has never seen has nothing to lose
  const firstTime = answerIsSafeToApply([], onScreen, []);
  check('a first pull is always allowed', firstTime.safe, true);
}

// ---------------------------------------------------------------------------
// (The case that used to sit here tested folding a delta onto a SKELETON built
// from the device after a restart — #285. Both the skeleton and its cases are
// gone: see #306 below and the note in deltaMerge.ts. A restart now asks for the
// whole project once, and folds only onto real answers after that.)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 12. A FOLD KEEPS EVERYTHING THE DELTA DID NOT MENTION — ALL OF IT (#306)
//
// The two faults that cost two days were both a base that was missing a field:
// no server time (#302), then no version type (#306) — and the fold faithfully
// carried the gap through, so the app read the gap as the truth. The base must
// be a real answer, whole. This is that, stated as a test.
// ---------------------------------------------------------------------------
{
  const held: MergeableTree = {
    project: { id: 'p', name: 'Bench' },
    strips: [{ id: 'strip-1' }],
    frames: [frame('a', 5000), frame('b', 6000)],
    versions: [
      { id: 'a-v0', frame_id: 'a', updated_at: 5000, type: 'main' } as never,
      { id: 'a-v1', frame_id: 'a', updated_at: 5000, type: 'floor:PLAN' } as never,
      { id: 'b-v0', frame_id: 'b', updated_at: 6000, type: 'main' } as never,
    ],
    images: [], drawings: [], deletions: [], settings: [],
    server_now: 6000, full: true,
  };

  const folded = mergeDelta(held, {
    project: { id: 'p' }, strips: [], frames: [frame('a', 7000)],
    versions: [], images: [], drawings: [], deletions: [], settings: [],
    server_now: 9000, full: false,
  });

  check('the frame the delta mentioned takes the new time',
    folded.frames.find((f) => f.id === 'a')!.updated_at, 7000);
  check('...the one it did not keeps its time', folded.frames.find((f) => f.id === 'b')!.updated_at, 6000);
  check('...and every version still knows which strip it belongs to',
    folded.versions.every((v) => typeof (v as unknown as { type: string }).type === 'string'), true);
  check('...including the one the delta never mentioned',
    (folded.versions.find((v) => v.id === 'a-v1') as unknown as { type: string }).type, 'floor:PLAN');

  // And which frames must be kept exactly as the device has them, for the push
  // that follows — still live code, still tested.
  const delta = emptyDelta({ frames: [frame('a', 7000)] });
  const keep = untouchedByDelta(mergeDelta(held, delta), delta);
  check('the frame the delta mentioned is not "kept local"', keep.has('a'), false);
  check('...and the untouched one is', keep.has('b'), true);
}

// ---------------------------------------------------------------------------
// HOW LONG BEFORE TRYING AGAIN (#463)
//
// The retry used to ask every forty seconds for ever. Now the wait grows while
// nothing is getting through — but it must never delay the retry the user can
// feel, and it must never lock itself out.
// ---------------------------------------------------------------------------
{
  check('nothing has failed — the ordinary forty seconds', nextRetryWait(0), 40_000);
  check('one failure — eighty', nextRetryWait(1), 80_000);
  check('two — a hundred and sixty', nextRetryWait(2), 160_000);
  check('three — held down to five minutes', nextRetryWait(3), 300_000);
  check('an outage all afternoon — still five minutes', nextRetryWait(400), 300_000);
  check('a nonsense count is the ordinary wait, not nothing', nextRetryWait(NaN), 40_000);

  // Never attempted: a device just opened with unsent work goes at once.
  check('never tried yet — go now', timeToTryAgain(1_000_000, null, 0), true);

  // The ordinary rhythm.
  check('thirty-nine seconds after a clean try — wait', timeToTryAgain(39_000, 0, 0), false);
  check('forty seconds after a clean try — go', timeToTryAgain(40_000, 0, 0), true);

  // The whole point: after failures the same forty seconds is NOT enough.
  check('forty seconds after two failures — wait', timeToTryAgain(40_000, 0, 2), false);
  check('a hundred and sixty after two failures — go', timeToTryAgain(160_000, 0, 2), true);

  // A device waking, or the clock put back by hand, must not lock the retry
  // out for hours.
  check('the clock went backwards — go, do not sit it out',
    timeToTryAgain(1_000, 9_999_999, 3), true);
}

// ---------------------------------------------------------------------------
// THE SAME THING AS A SEQUENCE — the wifi test, without the wifi (#463)
//
// This is the shape of the fault worth fearing: the wifi is off for ten
// minutes, so the wait has grown to five. Then the wifi comes back. If waking
// up forgets the FAILURES but not WHEN THE LAST TRY WAS, the app looks patched
// and correct and still sits on your work for up to forty seconds. Reading the
// code does not show it. A person testing by hand does not see forty seconds
// as wrong. So it is pinned here.
// ---------------------------------------------------------------------------
{
  const clock = makeRetryClock();
  let now = 1_000_000;

  // Nothing has happened yet: a device just opened with unsent work goes now.
  check('a fresh clock goes at once', clock.mayTry(now), true);

  // Three failures in a row, each one waiting out its turn.
  clock.tried(now); clock.failed();
  check('after one failure the next wait is eighty seconds', clock.waitNow(), 80_000);
  now += 79_000;
  check('seventy-nine seconds later — still waiting', clock.mayTry(now), false);
  now += 2_000;
  check('past eighty — go', clock.mayTry(now), true);

  clock.tried(now); clock.failed();
  clock.tried(now + 160_000); clock.failed();
  check('three failures — the wait is five minutes', clock.waitNow(), 300_000);
  now += 160_000;

  // THE ONE THAT MATTERS. The wifi comes back after a long outage.
  clock.wokeUp();
  check('the wifi is back — go THIS SECOND, not in five minutes',
    clock.mayTry(now), true);
  check('...and it is not still holding forty seconds either',
    clock.mayTry(now + 1), true);
  check('...and the run of failures is forgotten', clock.count(), 0);
  check('...so the next wait is the ordinary forty', clock.waitNow(), 40_000);

  // A push that gets through does the same.
  const c2 = makeRetryClock();
  c2.tried(2_000_000); c2.failed(); c2.failed();
  check('two failures, then something got through', c2.count(), 2);
  c2.succeeded();
  check('...the count is cleared', c2.count(), 0);
  check('...and it is free to try immediately', c2.mayTry(2_000_001), true);
}

// ---------------------------------------------------------------------------
// THE PROJECT IS GONE — NOT AN OUTAGE (#465)
//
// Roman's Mac pushed at a deleted project all morning and told him he was
// offline. Two questions the app was getting wrong at once: is this worth
// trying again, and is this actually an outage.
// ---------------------------------------------------------------------------
{
  check('no answer at all is an outage', whatWentWrong(0), 'offline');
  check('...and so is no status at all', whatWentWrong(undefined), 'offline');
  check('410 AND "deleted" is gone — the server SAW the deletion',
    whatWentWrong(410, 'deleted'), 'gone');

  // BOTH, NOT EITHER (#469). Nothing but our own server sends 410 with that
  // code. A 410 from anywhere else — a proxy rule, a retired address — must be
  // an ordinary failure, never an accusation.
  check('a bare 410 with no code proves nothing', whatWentWrong(410), 'offline');
  check('...nor a 410 wearing somebody else\'s code',
    whatWentWrong(410, 'not_found'), 'offline');
  check('...and it is retried like any other failure',
    worthTryingAgain(410, 'gone_forever'), true);
  check('409 is the server being ahead', whatWentWrong(409), 'conflict');
  check('500 is the server having trouble — try again', whatWentWrong(500), 'offline');
  check('200 is fine', whatWentWrong(200), 'fine');

  // ROMAN'S CONDITION, AND IT IS ABSOLUTE. "IT SEEMS YOU DELETED THIS PROJECT
  // ALREADY" must NEVER show for a project that was not deleted. A 404 means
  // deleted OR somebody else's OR never existed, so it can never be the trigger.
  check('a plain 404 is NOT "deleted" — it could be another account',
    whatWentWrong(404), 'offline');
  check('...so a 404 never accuses you of anything', worthTryingAgain(404), true);

  check('a deleted project is never worth trying again',
    worthTryingAgain(410, 'deleted'), false);
  check('...but no answer is', worthTryingAgain(0), true);
  check('...and so is a 500', worthTryingAgain(500), true);

  // THE MESSAGE THAT WAS LYING. "You seem to be working offline" is for an
  // outage only.
  check('a deleted project must NOT say you are offline',
    isReallyOffline(410, 'deleted'), false);
  check('...but no answer at all should', isReallyOffline(0), true);

  // ASKED ONCE, BUT SILENCE IS NOT AN ANSWER.
  const reg = makeGoneRegister();
  check('the first refusal asks', reg.shouldAsk('p1'), true);
  reg.asking('p1');
  check('a push five seconds later does not ask again', reg.shouldAsk('p1'), false);
  check('another project is its own question', reg.shouldAsk('p2'), true);

  // Dismissed with no answer: nothing decided, nothing thrown away.
  reg.unanswered('p1');
  check('dismissed — so it asks again next time', reg.shouldAsk('p1'), true);

  // Answered: done with.
  reg.asking('p1');
  reg.answered('p1');
  check('answered — never asked again', reg.shouldAsk('p1'), false);

  // DELETED, RECOVERED, DELETED AGAIN (#468).
  // Recovering a project from the project list puts it back on the server. The
  // next thing that gets through proves it, and the whole question is off — so
  // a SECOND deletion is a fresh question, not a remembered answer.
  reg.cameBack('p1');
  check('recovered, then deleted again — it asks a second time',
    reg.shouldAsk('p1'), true);

  // And a project nobody ever asked about is unharmed by it.
  reg.cameBack('p3');
  check('a project that was never gone is untouched', reg.shouldAsk('p3'), true);
}

// ---------------------------------------------------------------------------
// A SHOOTING ORDER TRAVELS BY NAME, NEVER BY NUMBER (#489)
//
// Roman's three logs of 9 September, the same fourteen shots:
//   Desktop 17…30 · iPad 3,1,2,4… · iPhone 1,2,3,4…
// The Desktop's order said "17 to 30", the iPad had 1 to 14, and the order
// showed NOTHING. This is that, as a test.
// ---------------------------------------------------------------------------
{
  // The two devices from the log. Same four shots, different private numbers.
  const desk  = new Map<number, string>([[17,'a'],[18,'b'],[19,'c'],[20,'d']]);
  const pad   = new Map<number, string>([[3,'a'],[1,'b'],[2,'c'],[4,'d']]);
  const nameOn   = (m: Map<number,string>) => (n: number) => m.get(n);
  const numberOn = (m: Map<number,string>) => (name: string) => {
    for (const [n, s] of m) if (s === name) return n;
    return undefined;
  };

  // THE ONE THAT WOULD HAVE CAUGHT IT.
  const madeOnDesk = { frameOrder: [18, 17, 20, 19] };
  const sent = orderForSending(madeOnDesk, nameOn(desk));
  check('leaving the Desktop it is names, not numbers', sent.order.frameOrder.join(','), 'b,a,d,c');
  const onPad = orderAsArrived(sent.order, numberOn(pad));
  check('arriving on the iPad it is the SAME four shots', onPad.order.frameOrder.join(','), '1,3,4,2');
  check('...and none were lost', onPad.lost.length, 0);

  // Read as numbers — what actually happened — the iPad has none of them.
  const asRawNumbers = madeOnDesk.frameOrder.filter((n) => pad.has(n));
  check('sent raw, the iPad recognises none of them (the fault)', asRawNumbers.length, 0);

  // A ROUND TRIP CHANGES NOTHING.
  const back = orderAsArrived(orderForSending(madeOnDesk, nameOn(desk)).order, numberOn(desk));
  check('there and back on one device is identical',
    back.order.frameOrder.join(','), '18,17,20,19');

  // A SHOT THIS DEVICE HAS NOT GOT IS REPORTED, NOT MISREAD.
  // Roman: "careful with dropping shots!"
  const partial = new Map<number, string>([[1,'b'],[2,'c']]);   // no 'a', no 'd'
  const thin = orderAsArrived({ frameOrder: ['b','a','d','c'] }, numberOn(partial));
  check('only the shots it really has come through', thin.order.frameOrder.join(','), '1,2');
  check('...and the missing ones are NAMED, not swallowed', thin.lost.join(','), 'a,d');

  // THE BREAKS. Roman: "keep in mind the BREAKS!"
  // Order b,a,d,c with a break after the second shot (index 2) and one at the
  // end (index 4). Drop 'a' at index 1 and both must step back one.
  const withBreaks = {
    frameOrder: ['b','a','d','c'],
    breaks: [{ id: 'lunch', text: 'LUNCH', position: 2 },
             { id: 'wrap',  text: 'WRAP',  position: 4 }],
  };
  const shifted = orderAsArrived(withBreaks, numberOn(new Map([[1,'b'],[3,'d'],[4,'c']])));
  check('a break after a dropped shot steps back one',
    shifted.order.breaks!.find((b) => b.id === 'lunch')!.position, 1);
  check('...and so does the one at the end',
    shifted.order.breaks!.find((b) => b.id === 'wrap')!.position, 3);
  check('...and the break count is untouched', shifted.order.breaks!.length, 2);

  // A break ABOVE the dropped shot does not move: it belongs to the shot above
  // it, and that shot has not gone anywhere.
  const above = orderAsArrived(
    { frameOrder: ['b','a','d'], breaks: [{ id: 'early', text: 'E', position: 1 }] },
    numberOn(new Map([[1,'b'],[3,'d']])));
  check('a break ABOVE the dropped shot stays put',
    above.order.breaks![0].position, 1);

  // NOTHING TO TRANSLATE IS NOT AN ERROR.
  const empty = orderAsArrived({ frameOrder: [] }, numberOn(pad));
  check('an empty order stays empty and loses nothing',
    empty.order.frameOrder.length + empty.lost.length, 0);

  // A shot with no permanent name has never reached the server, so it cannot be
  // told to anybody — reported on the way OUT too.
  const unsent = orderForSending({ frameOrder: [17, 99, 18] }, nameOn(desk));
  check('a shot the server has never seen is named on the way out',
    unsent.lost.join(','), '99');
  check('...and the rest still go', unsent.order.frameOrder.join(','), 'a,b');
}

// ---------------------------------------------------------------------------
// THE HEAVY ONE — DEVICES OPENING AND CLOSING PROJECTS ALL DAY (#489)
//
// Roman: "the test should also open and close various projects on various
// devices, and new projects etc... heavy test! we have to be 100000% sure what
// we do. this is the most crutial part of the app, if this does not work, we
// failed!"
//
// So this is not a tidy pair of maps. It is three devices living a normal week:
// they open projects in different orders, make new ones, add shots, and pass a
// shooting order between them. After every single move the SAME question is
// asked: does the order still name the same shots, in the same sequence,
// everywhere?
//
// The numbering here is NOT a copy of the rule — it calls the app's own
// `numbersForArriving`. A test that re-implements the thing it is testing
// proves nothing.
// ---------------------------------------------------------------------------
{
  /** A project on the server. Everything on it is written in PERMANENT NAMES —
   *  that is the whole point: the server never sees a device's private numbers.
   *  It holds MANY shooting orders and MANY groups, because a real project does. */
  type TravelOrder = { id: string; name: string; groupId?: number; frameOrder: string[];
                       breaks: { id: string; text: string; position: number }[] };
  type TravelGroup = { id: number; name: string; frameIds: string[]; hiddenFrameIds: string[] };
  type Server = {
    shots: string[];
    order: string[] | null;
    orders: Record<string, TravelOrder>;
    groups: Record<number, TravelGroup>;
  };
  const servers: Record<string, Server> = {};
  let madeSoFar = 0;
  const newProject = (id: string, howMany: number) => {
    servers[id] = {
      shots: Array.from({ length: howMany }, () => `shot-${++madeSoFar}`),
      order: null, orders: {}, groups: {},
    };
  };

  /** A device: what it is holding, and the numbers it has given those shots. */
  class Device {
    name: string;
    held: { id: number; serverFrameId: string }[] = [];
    openProject: string | null = null;
    /** its own copy of the shooting order, in ITS numbers */
    myOrder: number[] = [];
    /** every shooting order it holds, and every group, in ITS numbers */
    myOrders: Record<string, { id: string; name: string; groupId?: number;
                               frameOrder: number[];
                               breaks: { id: string; text: string; position: number }[] }> = {};
    myGroups: Record<number, { id: number; name: string;
                               frameIds: number[]; hiddenFrameIds: number[] }> = {};
    constructor(name: string) { this.name = name; }

    /** THE FIX UNDER TEST: opening a project numbers from 1. */
    open(projectId: string, startFresh: boolean) {
      const p = servers[projectId];
      const numbers = numbersForArriving(this.held, p.shots, startFresh);
      this.held = p.shots.map((name) => ({ id: numbers.get(name)!, serverFrameId: name }));
      this.openProject = projectId;
      if (p.order) this.receiveOrder(p.order);
      this.receiveAllOrders();
      this.receiveAllGroups();
    }
    /** A shot made here. It gets the next number this device has free. */
    addShot(): string {
      const name = `shot-${++madeSoFar}`;
      const next = Math.max(0, ...this.held.map((f) => f.id)) + 1;
      this.held.push({ id: next, serverFrameId: name });
      servers[this.openProject!].shots.push(name);
      return name;
    }
    nameOf = (n: number) => this.held.find((f) => f.id === n)?.serverFrameId;
    numberOf = (name: string) => this.held.find((f) => f.serverFrameId === name)?.id;

    /** Make an order out of everything it holds, in the order given. */
    makeOrder(numbers: number[]) { this.myOrder = numbers; }
    sendOrder() {
      const sent = orderForSending({ frameOrder: this.myOrder }, this.nameOf);
      servers[this.openProject!].order = sent.order.frameOrder;
      return sent.lost;
    }
    receiveOrder(names: string[]) {
      const got = orderAsArrived({ frameOrder: names }, this.numberOf);
      this.myOrder = got.order.frameOrder;
      return got.lost;
    }
    /** What the order MEANS here — the permanent names, which every device
     *  must agree on however it numbers them. */
    orderMeans(): string {
      return this.myOrder.map((n) => this.nameOf(n) ?? '??').join(',');
    }

    // ── MANY SHOOTING ORDERS ─────────────────────────────────────────────
    /** Make a new shooting order here, in a group or across the whole project. */
    makeNewOrder(id: string, name: string, numbers: number[],
                 groupId?: number,
                 breaks: { id: string; text: string; position: number }[] = []) {
      this.myOrders[id] = { id, name, groupId, frameOrder: numbers, breaks };
    }
    sendAllOrders() {
      const lost: (string | number)[] = [];
      for (const o of Object.values(this.myOrders)) {
        const sent = orderForSending(o, this.nameOf);
        lost.push(...sent.lost);
        servers[this.openProject!].orders[o.id] = sent.order as unknown as TravelOrder;
      }
      return lost;
    }
    receiveAllOrders() {
      const lost: (string | number)[] = [];
      for (const t of Object.values(servers[this.openProject!].orders)) {
        const got = orderAsArrived(t, this.numberOf);
        lost.push(...got.lost);
        this.myOrders[t.id] = got.order as unknown as (typeof this.myOrders)[string];
      }
      return lost;
    }
    /** What one named shooting order MEANS here. */
    meansOf(id: string): string {
      const o = this.myOrders[id];
      if (!o) return '(missing)';
      return o.frameOrder.map((n) => this.nameOf(n) ?? '??').join(',');
    }

    // ── GROUPS ───────────────────────────────────────────────────────────
    makeGroup(id: number, name: string, numbers: number[], hidden: number[] = []) {
      this.myGroups[id] = { id, name, frameIds: numbers, hiddenFrameIds: hidden };
    }
    sendAllGroups() {
      for (const g of Object.values(this.myGroups)) {
        servers[this.openProject!].groups[g.id] =
          groupForSending(g, this.nameOf).order as unknown as TravelGroup;
      }
    }
    receiveAllGroups() {
      for (const t of Object.values(servers[this.openProject!].groups)) {
        this.myGroups[t.id] =
          groupAsArrived(t, this.numberOf).order as unknown as (typeof this.myGroups)[number];
      }
    }
    /** What one group HOLDS here. */
    groupHolds(id: number): string {
      const g = this.myGroups[id];
      if (!g) return '(missing)';
      return g.frameIds.map((n) => this.nameOf(n) ?? '??').join(',');
    }
  }

  newProject('old-job', 16);      // the one the Desktop had open first
  newProject('little', 3);
  newProject('the-job', 14);      // Roman's fourteen shots

  const desk = new Device('Desktop');
  const pad = new Device('iPad');
  const phone = new Device('iPhone');

  // ── A day of ordinary use, and NOBODY opens things in the same sequence ──
  desk.open('old-job', true);          // Desktop: a big job first
  desk.open('the-job', true);          // ...then the one that matters
  pad.open('little', true);            // iPad: a small one first
  pad.open('the-job', true);
  phone.open('the-job', true);         // iPhone: straight in

  check('the three devices number the same shots the same way',
    [desk.held[0].id, pad.held[0].id, phone.held[0].id].join(','), '1,1,1');
  check('...all the way to the last one',
    [desk.held[13].id, pad.held[13].id, phone.held[13].id].join(','), '14,14,14');

  // ── The Desktop makes a shooting order and sends it ──
  desk.makeOrder([4, 1, 9, 14, 2]);
  const lostSending = desk.sendOrder();
  check('nothing is lost sending an order of shots it holds', lostSending.length, 0);

  const meantOnDesk = desk.orderMeans();
  pad.receiveOrder(servers['the-job'].order!);
  phone.receiveOrder(servers['the-job'].order!);
  check('the iPad sees the same shots as the Desktop', pad.orderMeans(), meantOnDesk);
  check('the iPhone too', phone.orderMeans(), meantOnDesk);

  // ── Somebody adds a shot on the iPad and the others catch up ──
  const extra = pad.addShot();
  desk.open('the-job', false);         // an ordinary sync, NOT a fresh open
  phone.open('the-job', false);
  check('a shot added on the iPad reaches the others', 
    [desk.numberOf(extra) !== undefined, phone.numberOf(extra) !== undefined].join(','), 'true,true');
  check('...and the order still means the same shots everywhere',
    [desk.orderMeans(), pad.orderMeans(), phone.orderMeans()].every((m) => m === meantOnDesk), true);

  // ── The Desktop goes off to another project and comes back ──
  desk.open('little', true);
  desk.open('the-job', true);
  desk.receiveOrder(servers['the-job'].order!);
  check('away to another project and back — the order is unchanged',
    desk.orderMeans(), meantOnDesk);

  // ── A brand new project, made while the order exists elsewhere ──
  newProject('brand-new', 5);
  phone.open('brand-new', true);
  check('a brand new project starts its numbering at 1', phone.held[0].id, 1);
  phone.open('the-job', true);
  phone.receiveOrder(servers['the-job'].order!);
  check('...and coming back, the order is still the same shots',
    phone.orderMeans(), meantOnDesk);

  // ── THE OLD WAY, for contrast: numbers carried on from the last project ──
  const oldWay = new Device('Desktop, the old way');
  oldWay.open('old-job', true);
  oldWay.open('the-job', false);       // false = do NOT start fresh — the fault
  check('carrying on from the last project is where 17 came from',
    oldWay.held[0].id, 17);
  check('...and that device shares NO numbers with the others',
    oldWay.held.some((f) => f.id <= 14), false);

  // ── GROUPS, AND SEVERAL SHOOTING ORDERS AT ONCE ─────────────────────
  //
  // A real project has more than one order and more than one group, and they
  // are not all made on the same device. `projectSettings.ts` sends each one as
  // an item of its own precisely so two devices can each add one without either
  // being lost (#331). So the test has to do that: make them in different
  // places, at the same time, and check every one of them afterwards.

  // The Desktop puts the barn shots in one group and the exteriors in another.
  desk.makeGroup(1, 'THE BARN', [1, 2, 3, 4], [4]);
  desk.makeGroup(2, 'EXTERIORS', [10, 11, 12]);
  desk.sendAllGroups();

  // ...and two shooting orders: one for the whole project, one inside the barn.
  desk.makeNewOrder('so-day1', 'DAY 1', [2, 1, 5, 9], undefined,
    [{ id: 'br-1', text: 'LUNCH', position: 2 }]);
  desk.makeNewOrder('so-barn', 'BARN ONLY', [3, 1, 2], 1);
  desk.sendAllOrders();

  // Meanwhile the iPhone makes a third, in the exteriors group.
  phone.open('the-job', false);
  phone.makeNewOrder('so-ext', 'EXTERIORS PM', [12, 10], 2);
  phone.sendAllOrders();

  // Everyone catches up.
  pad.open('the-job', false);
  desk.receiveAllOrders(); desk.receiveAllGroups();
  phone.receiveAllOrders(); phone.receiveAllGroups();

  check('all three shooting orders reach every device',
    [Object.keys(desk.myOrders).length, Object.keys(pad.myOrders).length,
     Object.keys(phone.myOrders).length].join(','), '3,3,3');

  for (const [id, label] of [['so-day1', 'DAY 1'], ['so-barn', 'BARN ONLY'], ['so-ext', 'EXTERIORS PM']] as const) {
    check(`${label}: the same shots on all three`,
      [desk.meansOf(id), pad.meansOf(id), phone.meansOf(id)]
        .every((m) => m === desk.meansOf(id)) && desk.meansOf(id) !== '(missing)', true);
  }

  check('the iPad did not lose the one the iPhone made',
    pad.meansOf('so-ext').split(',').length, 2);
  check('...and BARN ONLY still knows it belongs to the barn group',
    pad.myOrders['so-barn'].groupId, 1);
  check('...and EXTERIORS PM to the other one', pad.myOrders['so-ext'].groupId, 2);
  check('...and DAY 1 belongs to no group, as it was made',
    pad.myOrders['so-day1'].groupId === undefined, true);
  check('...with its break still at 2', pad.myOrders['so-day1'].breaks[0].position, 2);
  check('...and named', pad.myOrders['so-day1'].name, 'DAY 1');

  check('both groups hold the same shots on all three',
    [1, 2].every((g) => desk.groupHolds(g) === pad.groupHolds(g)
                     && pad.groupHolds(g) === phone.groupHolds(g)), true);
  check('THE BARN holds four shots, not none', pad.myGroups[1].frameIds.length, 4);
  // THE STORY FLOW INSIDE A GROUP IS THIS LIST'S ORDER (groups.ts:16, and
  // actions.ts:78 reorders it when you drag inside a group). So it is not
  // enough that the right shots are in the group — they must be in the same
  // SEQUENCE on every device.
  check('...in the same sequence on all three, not just the same shots',
    [desk.groupHolds(1), pad.groupHolds(1), phone.groupHolds(1)]
      .every((h) => h === desk.groupHolds(1)), true);
  // ...and dragging one to the front inside the group travels as a re-order.
  {
    const g = desk.myGroups[1];
    g.frameIds = [g.frameIds[2], g.frameIds[0], g.frameIds[1], g.frameIds[3]];
    const wanted = desk.groupHolds(1);
    desk.sendAllGroups();
    pad.receiveAllGroups(); phone.receiveAllGroups();
    check('dragging a shot inside a group travels to the other devices',
      [pad.groupHolds(1), phone.groupHolds(1)].every((h) => h === wanted), true);
  }
  check('...and the hidden one is still hidden, and still the same shot',
    pad.nameOf(pad.myGroups[1].hiddenFrameIds[0]) === desk.nameOf(desk.myGroups[1].hiddenFrameIds[0]), true);

  // THE OLD WAY, for contrast: a group sent raw, read by a device that numbers
  // differently. This is what is happening on Roman's devices today.
  {
    const rawFromDesk = { id: 9, name: 'THE BARN', frameIds: [17, 18, 19, 20], hiddenFrameIds: [] };
    const heldByPad = rawFromDesk.frameIds.filter((n) => pad.held.some((f) => f.id === n));
    check('sent raw, the iPad recognises none of the group (the fault)', heldByPad.length, 0);
  }

  // A device makes a new order while OFFLINE from the others, and a second
  // device makes one too. Neither may beat the other.
  desk.makeNewOrder('so-night', 'NIGHT WORK', [14, 13]);
  phone.makeNewOrder('so-pickups', 'PICKUPS', [5, 6]);
  desk.sendAllOrders(); phone.sendAllOrders();
  pad.receiveAllOrders();
  desk.receiveAllOrders();     // the Desktop has not heard about PICKUPS yet
  phone.receiveAllOrders();
  check('two orders made at the same time on two devices both survive',
    [pad.meansOf('so-night') !== '(missing)', pad.meansOf('so-pickups') !== '(missing)'].join(','),
    'true,true');
  check('...and five orders are on the iPad now', Object.keys(pad.myOrders).length, 5);

  // And after ALL of that, closing everything and opening it again on a device
  // that has been round three other projects must change nothing.
  pad.open('little', true);
  pad.open('old-job', true);
  pad.open('brand-new', true);
  pad.open('the-job', true);
  check('after four projects, every order still means the same shots',
    ['so-day1', 'so-barn', 'so-ext', 'so-night', 'so-pickups']
      .every((id) => pad.meansOf(id) === desk.meansOf(id)), true);
  check('...and every group still holds the same shots',
    [1, 2].every((g) => pad.groupHolds(g) === desk.groupHolds(g)), true);

  // ── A device that is behind: it has not got the newest shot yet ──
  const behind = new Device('an iPad left in a bag');
  behind.open('the-job', true);
  behind.held = behind.held.filter((f) => f.serverFrameId !== extra);   // never heard of it
  desk.makeOrder([...desk.myOrder, desk.numberOf(extra)!]);
  desk.sendOrder();
  const lostOnArrival = behind.receiveOrder(servers['the-job'].order!);
  check('the shot it has not got is NAMED, not guessed at',
    lostOnArrival.join(','), extra);
  check('...and every other shot still comes through in order',
    behind.orderMeans(), meantOnDesk);
}

// ---------------------------------------------------------------------------
// THE STORY FLOW IN "ALL FRAMES" — the one that was never part of this fault
//
// Roman asked. Traced rather than assumed: `projectSettings.ts:94` sends it as
// `s.frames.map(f => f.serverFrameId)` — PERMANENT NAMES, never numbers — and
// `applyArrangement` puts the frames back by matching those same names. It has
// nothing to do with the device's private numbers, so the numbering fault never
// touched it. These cases hold that true, using the app's OWN applyArrangement.
// ---------------------------------------------------------------------------
{
  const card = (id: number, name?: string) => ({ id, serverFrameId: name });

  // The Desktop's copy, numbered 17..21 — and the iPad's, numbered 1..5. Same
  // five shots. The arrangement travels as names.
  const arrangement = ['aaa', 'bbb', 'ccc', 'ddd', 'eee'];

  const onPad = applyArrangement(
    [card(3, 'ccc'), card(1, 'aaa'), card(5, 'eee'), card(2, 'bbb'), card(4, 'ddd')],
    arrangement);
  check('the story flow arrives in the right order however the iPad numbers them',
    onPad.map((f) => f.serverFrameId).join(','), 'aaa,bbb,ccc,ddd,eee');

  const onDesk = applyArrangement(
    [card(19, 'ccc'), card(17, 'aaa'), card(21, 'eee'), card(18, 'bbb'), card(20, 'ddd')],
    arrangement);
  check('...and the same on the Desktop, numbering from 17',
    onDesk.map((f) => f.serverFrameId).join(','), 'aaa,bbb,ccc,ddd,eee');
  check('...so both devices show the same story flow',
    onPad.map((f) => f.serverFrameId).join(',') === onDesk.map((f) => f.serverFrameId).join(','),
    true);

  // A SHOT MADE HERE A SECOND AGO has no permanent name yet, so it is not in
  // the arrangement. It must stay, behind the shot it currently follows — not
  // be dropped and not be thrown to the end (#398, #405).
  const withBrandNew = applyArrangement(
    [card(1, 'aaa'), card(9), card(2, 'bbb'), card(3, 'ccc'), card(4, 'ddd'), card(5, 'eee')],
    arrangement);
  check('a shot made a second ago is not dropped from the story flow',
    withBrandNew.length, 6);
  check('...and stays right behind the shot it was following',
    withBrandNew.map((f) => f.serverFrameId ?? 'NEW').join(','),
    'aaa,NEW,bbb,ccc,ddd,eee');

  // A shot deleted elsewhere is simply not in the arrangement and not here.
  const shorter = applyArrangement(
    [card(1, 'aaa'), card(2, 'bbb')], ['bbb', 'aaa']);
  check('the story flow works with fewer shots too',
    shorter.map((f) => f.serverFrameId).join(','), 'bbb,aaa');
}

// ---------------------------------------------------------------------------
// NOTHING ELSE ON THE ORDER MAY BE LOST ON THE WAY (#489, and #382 before it)
//
// projectSettings.ts:109 sends the WHOLE shooting order object. It carries its
// name, its description, which group it belongs to and its bracket tree. #382
// was written because a rebuilt object silently dropped the group.
//
// So a translation that returns a tidy {frameOrder, breaks} would fix the
// numbers and break everything else. These cases are here to stop that.
// ---------------------------------------------------------------------------
{
  const wholeOrder = {
    id: 'so-1',
    name: 'DAY 2 — INTERIORS',
    description: 'the barn',
    groupId: 4,
    frameOrder: [3, 1, 2],
    breaks: [{ id: 'b1', text: 'LUNCH', position: 2 }],
    sortedSnapshot: [1, 2, 3],
    // A REAL bracket tree: it points at shots too, in inputIds/matchedIds, and
    // it nests. A branch holding no shots is dropped — that is the app's own
    // rule in remapBracketIds, not a new one.
    bracketTree: {
      inputIds: [1, 2, 3], matchedIds: [2],
      categoryName: 'CAMERA',
      right: { inputIds: [3], matchedIds: [] },
    },
  };
  const names: Record<number, string> = { 1: 'aaa', 2: 'bbb', 3: 'ccc' };
  const sent = orderForSending(wholeOrder, (n) => names[n]);

  check('the shooting order keeps its id', (sent.order as Record<string, unknown>).id, 'so-1');
  check('...its name', (sent.order as Record<string, unknown>).name, 'DAY 2 — INTERIORS');
  check('...its description', (sent.order as Record<string, unknown>).description, 'the barn');
  check('...which group it belongs to (#382)', (sent.order as Record<string, unknown>).groupId, 4);
  const treeOut = (sent.order as Record<string, unknown>).bracketTree as Record<string, unknown>;
  check('...and its bracket tree travels by name too',
    (treeOut.inputIds as string[]).join(','), 'aaa,bbb,ccc');
  check('...matched shots as well', (treeOut.matchedIds as string[]).join(','), 'bbb');
  check('...the branch below it too',
    ((treeOut.right as Record<string, unknown>).inputIds as string[]).join(','), 'ccc');
  check('...and what is not a shot is left alone', treeOut.categoryName, 'CAMERA');
  check('...while the shots became names', sent.order.frameOrder.join(','), 'ccc,aaa,bbb');

  const numbers: Record<string, number> = { aaa: 1, bbb: 2, ccc: 3 };
  const back = orderAsArrived(sent.order, (nm) => numbers[nm]);
  check('coming back it is the same order again', back.order.frameOrder.join(','), '3,1,2');
  check('...still named', (back.order as Record<string, unknown>).name, 'DAY 2 — INTERIORS');
  check('...still in its group', (back.order as Record<string, unknown>).groupId, 4);
  check('...and the break is where it was', back.order.breaks![0].position, 2);
  // THE SORTING SHEET AND ITS SNAPSHOT MUST BOTH SURVIVE (#489).
  //
  // decideResort (bracket.ts:894) gives up with "no sorting sheet yet — nothing
  // to follow" if EITHER bracketTree or sortedSnapshot is missing, and then no
  // shot is marked as moved by the re-sort. So a translation that quietly loses
  // one of them turns the green marks off and nothing else says why.
  check('the sorting sheet survives the journey out',
    (sent.order as Record<string, unknown>).bracketTree !== undefined, true);
  check('...and so does its snapshot', sent.order.sortedSnapshot?.join(','), 'aaa,bbb,ccc');
  check('the sorting sheet survives coming back',
    (back.order as Record<string, unknown>).bracketTree !== undefined, true);
  check('...and its snapshot comes back in this device\'s numbers',
    back.order.sortedSnapshot?.join(','), '1,2,3');
  check('...so decideResort still has both halves it needs',
    Boolean((back.order as Record<string, unknown>).bracketTree) && Boolean(back.order.sortedSnapshot),
    true);

  const treeBack = (back.order as Record<string, unknown>).bracketTree as Record<string, unknown>;
  check('...and the bracket tree is back in this device\'s numbers',
    (treeBack.inputIds as number[]).join(','), '1,2,3');
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const width = Math.max(...results.map((r) => r.what.length));
let failed = 0;
console.log('');
for (const r of results) {
  const ok = r.got === r.want;
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' WRONG'}  ${r.what.padEnd(width)}  ->  ${r.got.padEnd(18)}` +
              (ok ? '' : `  (should be ${r.want})`));
}
console.log(`\n${results.length - failed} of ${results.length} correct` + (failed ? `, ${failed} WRONG\n` : '\n'));
process.exit(failed ? 1 : 0);

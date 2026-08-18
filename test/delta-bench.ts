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
  skeletonFromDevice, untouchedByDelta, type MergeableTree,
} from '../src/lib/deltaMerge';

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
// 11. After a restart: fold onto the frames that are on the device (#285)
// ---------------------------------------------------------------------------
{
  // The app has just reopened. The project is on the device; the copy of what
  // the server holds is not. All it needs is the frames' names and places.
  const onDevice = Array.from({ length: 45 }, (_, i) => ({
    serverFrameId: `f${i}`, label: String(i + 1),
    mainVersionId: `f${i}-v0`, versionIds: [`f${i}-v1`],
  }));
  const skeleton = skeletonFromDevice(onDevice, 'strip-1', 5000);
  check('the skeleton names every frame on the device', skeleton.frames.length, 45);
  check('...and their versions', skeleton.versions.length, 90);
  check('...but carries no content to go stale',
    JSON.stringify(skeleton.frames[0]).includes('text_content'), false);

  const delta = emptyDelta({
    strips: [{ id: 'strip-1' }],
    frames: [frame('f7', 6000, { text_content: 'changed while away' })],
  });
  const folded = mergeDelta(skeleton, delta);
  check('folding onto it keeps all 45 frames', folded.frames.length, 45);

  const keep = untouchedByDelta(folded, delta);
  check('44 frames are kept exactly as the device has them', keep.size, 44);
  check('...and the changed one is NOT kept — it takes the answer', keep.has('f7'), false);

  // A frame the device has never sent has no server id, so there is nothing to
  // fold onto — it must not appear in the skeleton and claim to be known.
  const withUnsent = skeletonFromDevice(
    [...onDevice, { serverFrameId: undefined, label: '46' }], 'strip-1', 5000);
  check('a frame never sent to the server is left out of the skeleton', withUnsent.frames.length, 45);
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

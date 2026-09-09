// WHY A REARRANGED STORY FLOW DOES NOT REACH A DEVICE THAT CAME FROM ANOTHER
// PROJECT — a reproduction small enough to run in a second.
//
// The simulator has the fault but takes four minutes and two browsers. This
// drives the real projectSettings functions against the real store, in the same
// sequence the app uses when a device opens project B having had project A open.
//
//   npx tsc test/settings-probe.ts --module commonjs --moduleResolution node \
//     --target es2022 --esModuleInterop --skipLibCheck --outDir .bench --types node \
//     && node -r ./test/shim.cjs .bench/test/settings-probe.js

import { useStore } from '../src/store/state';
import {
  seedSettings, stampChangedSettings, applySettingsToStore,
  adoptSettingsFromServer, settingsForPush, type SettingItem,
} from '../src/lib/projectSettings';

const frame = (id: number, name: string) => ({
  id, serverFrameId: name, src: '', label: String(id), cropW: 9, cropH: 5,
  strokes: [], drawMode: false, textContent: '', tableData: null,
}) as never;

const hold = (frames: unknown[]) => useStore.setState({ frames } as never);
const order = () => (useStore.getState().frames as Array<{ serverFrameId?: string }>)
  .map((f) => f.serverFrameId).join(',');

const item = (kind: string, id: string, data: unknown, at: number): SettingItem =>
  ({ kind, item_id: id, value: JSON.stringify({ idx: 0, data }), changed_at: at, deleted_at: null } as never);

console.log('--- the iPad has LITTLE open (3 shots), and has stamped it ---');
hold([frame(1, 'lit-a'), frame(2, 'lit-b'), frame(3, 'lit-c')]);
seedSettings('project-LITTLE', 1000);
stampChangedSettings('project-LITTLE');
console.log('  its memory for the story flow:',
  JSON.stringify(settingsForPush().find((i) => i.kind === 'frameOrder')));

console.log('\n--- now it opens THE JOB. The app puts the new frames in the store');
console.log('    (from the server, by position), THEN applies the settings ---');
hold([frame(4, 'job-a'), frame(5, 'job-b'), frame(6, 'job-c')]);
console.log('  frames as they arrived:', order());

// The Desktop rearranged it: c, a, b — changed later than anything LITTLE did.
const arriving = [item('frameOrder', 'main', ['job-c', 'job-a', 'job-b'], 5000)];
applySettingsToStore(arriving);
console.log('  after applying the arriving story flow:', order());
console.log('  EXPECTED job-c,job-a,job-b');

adoptSettingsFromServer(arriving, 'project-THE-JOB');
console.log('\n--- and what it now believes about its own copy ---');
stampChangedSettings('project-THE-JOB');
console.log('  ', JSON.stringify(settingsForPush().find((i) => i.kind === 'frameOrder')));

console.log('\n=== AND NOW THE ONE THAT MATTERS ==========================');
console.log('WHAT MAKES A DEVICE THAT ONLY *OPENED* A PROJECT BELIEVE ITS OWN');
console.log('STORY FLOW CHANGED? Both devices in the failing run thought exactly');
console.log('that, so neither would take the other\'s.');

const tryIt = (what: string, storeFrames: unknown[], arrivingList: string[]) => {
  hold([frame(1, 'lit-a')]);
  seedSettings('project-LITTLE', 1000);
  stampChangedSettings('project-LITTLE');

  hold(storeFrames);
  const arrived = [item('frameOrder', 'main', arrivingList, 5000)];
  applySettingsToStore(arrived);
  adoptSettingsFromServer(arrived, 'project-B');
  stampChangedSettings('project-B');
  const mine = settingsForPush().find((i) => i.kind === 'frameOrder')!;
  const unsent = mine.changed_at > (mine.base_changed_at ?? 0);
  console.log(`  ${unsent ? 'CHANGED — and it will fight' : 'quiet, as it should be'}`
    + `   ${what}`);
  console.log(`      on screen: ${order()}`);
  console.log(`      it will send: ${JSON.parse(mine.value!).data.join(',')}`);
};

tryIt('every shot is named in the arrangement',
  [frame(4, 'b-a'), frame(5, 'b-b'), frame(6, 'b-c')], ['b-c', 'b-a', 'b-b']);

tryIt('this device holds a shot the arrangement does not name (#398/#405)',
  [frame(4, 'b-a'), frame(5, 'b-b'), frame(6, 'b-c'), frame(7, 'b-new')],
  ['b-c', 'b-a', 'b-b']);

tryIt('the arrangement names a shot this device has not got yet',
  [frame(4, 'b-a'), frame(5, 'b-b')], ['b-c', 'b-a', 'b-b']);

tryIt('a shot with no permanent name at all is in the store',
  [frame(4, 'b-a'), { ...(frame(5, 'b-b') as object), serverFrameId: undefined },
   frame(6, 'b-c')], ['b-c', 'b-a', 'b-b']);

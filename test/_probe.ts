import { useStore } from '../src/store/state';
import {
  settingsForPush, exportSettingStamps, importSettingStamps,
  stampChangedSettings, seedSettings, reconcileRestoredSettings,
} from '../src/lib/projectSettings';

const CREATED = 1_700_000_000_000;
let NOW = CREATED + 3600_000;
Date.now = () => NOW;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

const TABS = [{ id: 'tab_1', name: 'GEAR', tables: [] }, { id: 'tab_2', name: 'ART', tables: [] }];
const frames = [
  { id: 1, serverFrameId: 'a', label: '1' },
  { id: 2, serverFrameId: 'b', label: '2' },
] as never[];

function fillStore(): void {
  useStore.setState({
    needDefinitions: { tabs: clone(TABS), locations: [] },
    groups: [], sortOrders: [{ id: 'sort_1', name: 'DAY 1', frameIds: [] }],
    setups: [], nextSetupId: 1, storyFlowBreaks: [],
    frames, stripVersions: {}, frameNeeds: {}, frameNotes: {},
  } as never);
}

// session one: open, work, save
fillStore();
seedSettings('p', CREATED);
NOW += 60_000;
stampChangedSettings('p');
// pretend the server confirmed everything, as a successful push does
const saved = clone(exportSettingStamps()).map((i) => ({ ...i, base_changed_at: i.changed_at }));
console.log('SAVED:', saved.map((i) => `${i.kind}/${i.item_id}@${i.changed_at}`).join(' '));

// session two: the app restarts. store first, memory second, look third.
NOW += 24 * 3600_000;
fillStore();
importSettingStamps(saved);
console.log('unknown to memory:', reconcileRestoredSettings());
stampChangedSettings('p');
const after = settingsForPush();
for (const i of after) {
  const before = saved.find((s) => s.kind === i.kind && s.item_id === i.item_id);
  const moved = before && i.changed_at !== before.changed_at;
  console.log(`${moved ? 'RE-STAMPED' : 'ok        '}  ${i.kind}/${i.item_id}  ${before?.changed_at} -> ${i.changed_at}`);
}

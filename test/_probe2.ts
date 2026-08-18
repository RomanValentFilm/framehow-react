import { useStore } from '../src/store/state';
import {
  settingsForPush, exportSettingStamps, importSettingStamps, stampChangedSettings,
  seedSettings, settingsNeedPush, adoptSettingsFromServer, reconcileRestoredSettings,
} from '../src/lib/projectSettings';

const CREATED = 1_700_000_000_000;
let NOW = CREATED + 3600_000;
Date.now = () => NOW;
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));
const TABS = [{ id: 'tab_1', name: 'GEAR', tables: [] }];
const frames = [{ id: 1, serverFrameId: 'a' }, { id: 2, serverFrameId: 'b' }] as never[];

function fill(): void {
  useStore.setState({
    needDefinitions: { tabs: clone(TABS), locations: [] },
    groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [],
    frames, stripVersions: {}, frameNeeds: {}, frameNotes: {},
  } as never);
}

// session one: open, work, push, and take the server's echo as the real app does
fill();
seedSettings('p', CREATED);
NOW += 60_000;
stampChangedSettings('p');
const sent = clone(settingsForPush());
console.log('wants push before:', settingsNeedPush());
// the server replies with the merged settings — same times, since ours won
adoptSettingsFromServer(sent.map((i) => ({ ...i, base_changed_at: undefined })), 'p');
console.log('wants push after the reply:', settingsNeedPush());
const saved = clone(exportSettingStamps());
console.log('saved bases:', saved.map((i) => `${i.kind}@${i.changed_at}/base ${i.base_changed_at}`).join(' '));

// session two: reload
NOW += 3600_000;
fill();
importSettingStamps(saved);
reconcileRestoredSettings();
stampChangedSettings('p');
console.log('AFTER RELOAD wants push:', settingsNeedPush());
for (const i of settingsForPush()) {
  console.log(`  ${i.kind}/${i.item_id}  changed ${i.changed_at}  server has ${i.base_changed_at}`);
}

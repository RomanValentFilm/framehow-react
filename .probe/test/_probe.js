"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const state_1 = require("../src/store/state");
const projectSettings_1 = require("../src/lib/projectSettings");
const CREATED = 1_700_000_000_000;
let NOW = CREATED + 3600_000;
Date.now = () => NOW;
const clone = (x) => JSON.parse(JSON.stringify(x));
const TABS = [{ id: 'tab_1', name: 'GEAR', tables: [] }, { id: 'tab_2', name: 'ART', tables: [] }];
const frames = [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
];
function fillStore() {
    state_1.useStore.setState({
        needDefinitions: { tabs: clone(TABS), locations: [] },
        groups: [], sortOrders: [{ id: 'sort_1', name: 'DAY 1', frameIds: [] }],
        setups: [], nextSetupId: 1, storyFlowBreaks: [],
        frames, stripVersions: {}, frameNeeds: {}, frameNotes: {},
    });
}
// session one: open, work, save
fillStore();
(0, projectSettings_1.seedSettings)('p', CREATED);
NOW += 60_000;
(0, projectSettings_1.stampChangedSettings)('p');
// pretend the server confirmed everything, as a successful push does
const saved = clone((0, projectSettings_1.exportSettingStamps)()).map((i) => ({ ...i, base_changed_at: i.changed_at }));
console.log('SAVED:', saved.map((i) => `${i.kind}/${i.item_id}@${i.changed_at}`).join(' '));
// session two: the app restarts. store first, memory second, look third.
NOW += 24 * 3600_000;
fillStore();
(0, projectSettings_1.importSettingStamps)(saved);
console.log('unknown to memory:', (0, projectSettings_1.reconcileRestoredSettings)());
(0, projectSettings_1.stampChangedSettings)('p');
const after = (0, projectSettings_1.settingsForPush)();
for (const i of after) {
    const before = saved.find((s) => s.kind === i.kind && s.item_id === i.item_id);
    const moved = before && i.changed_at !== before.changed_at;
    console.log(`${moved ? 'RE-STAMPED' : 'ok        '}  ${i.kind}/${i.item_id}  ${before?.changed_at} -> ${i.changed_at}`);
}

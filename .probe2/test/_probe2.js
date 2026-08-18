"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const state_1 = require("../src/store/state");
const projectSettings_1 = require("../src/lib/projectSettings");
const CREATED = 1_700_000_000_000;
let NOW = CREATED + 3600_000;
Date.now = () => NOW;
const clone = (x) => JSON.parse(JSON.stringify(x));
const TABS = [{ id: 'tab_1', name: 'GEAR', tables: [] }];
const frames = [{ id: 1, serverFrameId: 'a' }, { id: 2, serverFrameId: 'b' }];
function fill() {
    state_1.useStore.setState({
        needDefinitions: { tabs: clone(TABS), locations: [] },
        groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [],
        frames, stripVersions: {}, frameNeeds: {}, frameNotes: {},
    });
}
// session one: open, work, push, and take the server's echo as the real app does
fill();
(0, projectSettings_1.seedSettings)('p', CREATED);
NOW += 60_000;
(0, projectSettings_1.stampChangedSettings)('p');
const sent = clone((0, projectSettings_1.settingsForPush)());
console.log('wants push before:', (0, projectSettings_1.settingsNeedPush)());
// the server replies with the merged settings — same times, since ours won
(0, projectSettings_1.adoptSettingsFromServer)(sent.map((i) => ({ ...i, base_changed_at: undefined })), 'p');
console.log('wants push after the reply:', (0, projectSettings_1.settingsNeedPush)());
const saved = clone((0, projectSettings_1.exportSettingStamps)());
console.log('saved bases:', saved.map((i) => `${i.kind}@${i.changed_at}/base ${i.base_changed_at}`).join(' '));
// session two: reload
NOW += 3600_000;
fill();
(0, projectSettings_1.importSettingStamps)(saved);
(0, projectSettings_1.reconcileRestoredSettings)();
(0, projectSettings_1.stampChangedSettings)('p');
console.log('AFTER RELOAD wants push:', (0, projectSettings_1.settingsNeedPush)());
for (const i of (0, projectSettings_1.settingsForPush)()) {
    console.log(`  ${i.kind}/${i.item_id}  changed ${i.changed_at}  server has ${i.base_changed_at}`);
}

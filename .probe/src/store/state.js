"use strict";
// Zustand store mirroring the original's mutable globals.
// The data shape (frames, versions, activeTab, draw* maps, etc.) is preserved
// verbatim so the imperative renderers can be ported with minimal change.
//
// Mutations happen through `useStore.setState` or via the helper actions below.
// Imperative code reads with `getState()` and either mutates the returned
// object in place + calls `bumpRenderTick()` (for things React doesn't need
// to react to), or uses an action.
Object.defineProperty(exports, "__esModule", { value: true });
exports.COLORS = exports.isTouch = exports.setState = exports.state = exports.useStore = exports.DEFAULT_STRIP_DEFS = exports.DEFAULT_NEED_DEFINITIONS = exports.SETUP_COLORS = exports.CAM_RATIOS = exports.APP_VERSION = void 0;
exports.createDefaultExportMeta = createDefaultExportMeta;
exports.migrateNeedDefinitions = migrateNeedDefinitions;
exports.createDefaultFrameNeedState = createDefaultFrameNeedState;
exports.createDefaultFrameNoteState = createDefaultFrameNoteState;
exports.bumpRenderTick = bumpRenderTick;
exports.resetStoryboardState = resetStoryboardState;
const zustand_1 = require("zustand");
const constants_1 = require("../lib/constants");
Object.defineProperty(exports, "COLORS", { enumerable: true, get: function () { return constants_1.COLORS; } });
/** 12-colour palette for setups. */
/** App version — bump before every deploy. */
exports.APP_VERSION = 'v4.9.060';
function createDefaultExportMeta() {
    return { shootingOrder: '', userName: '', version: '', date: '' };
}
exports.CAM_RATIOS = [
    { key: '2.39', label: '2.39:1', value: 2.39 },
    { key: '2.0', label: '2:1', value: 2 },
    { key: '1.85', label: '1.85:1', value: 1.85 },
    { key: 'canvas', label: 'CANVAS', value: null },
    { key: '16:9', label: '16:9', value: 16 / 9 },
    { key: '4:3', label: '4:3', value: 4 / 3 },
    { key: '1:1', label: '1:1', value: 1 },
    { key: '9:16', label: '9:16', value: 9 / 16 },
];
exports.SETUP_COLORS = [
    { name: 'DAYLIGHT', hex: '#CFE2F6' },
    { name: 'EARLY MORNING', hex: '#88BDE6' },
    { name: 'LATE MORNING', hex: '#4DB6B3' },
    { name: 'MIDDAY', hex: '#FFD23F' },
    { name: 'AFTERNOON', hex: '#F97316' },
    { name: 'GOLDEN HOUR', hex: '#E23A2F' },
    { name: 'SUNSET', hex: '#FF4D6D' },
    { name: 'BLUE HOUR', hex: '#9D1B60' },
    { name: 'NIGHT', hex: '#1974D2' },
    { name: 'FOREST NIGHT', hex: '#2E7D56' },
    { name: 'BROWN', hex: '#8B5E3C' },
    { name: 'NIGHT BLACK', hex: '#0A0A0A' },
];
/** Default need definitions for new projects. */
exports.DEFAULT_NEED_DEFINITIONS = {
    tabs: [
        {
            id: 'tab_shoot', name: 'SHOOT',
            tables: [
                { id: 'tbl_shootday', name: 'SHOOT DAY', type: 'toggle', items: [
                        { id: 'ti_day1', name: 'DAY 1' },
                        { id: 'ti_day2', name: 'DAY 2' },
                        { id: 'ti_day3', name: 'DAY 3' },
                    ] },
                { id: 'tbl_unit', name: 'UNIT', type: 'toggle', items: [
                        { id: 'ti_unit1', name: '1st UNIT' },
                        { id: 'ti_unit2', name: '2nd UNIT' },
                        { id: 'ti_unit3', name: '3rd UNIT' },
                    ] },
                { id: 'tbl_location', name: 'LOCATION', type: 'toggle', items: [
                        { id: 'ti_loc1', name: 'LOCATION 1' },
                        { id: 'ti_loc2', name: 'LOCATION 2' },
                    ] },
                { id: 'tbl_extint', name: 'INT/EXT', type: 'toggle', items: [
                        { id: 'ti_int', name: 'INT' },
                        { id: 'ti_ext', name: 'EXT' },
                    ] },
                { id: 'tbl_daytime', name: 'DAYTIME', type: 'toggle', items: [
                        { id: 'ti_sunrise', name: 'SUNRISE' },
                        { id: 'ti_day', name: 'DAY' },
                        { id: 'ti_sunset', name: 'SUNSET' },
                        { id: 'ti_night', name: 'NIGHT' },
                    ] },
            ],
        },
        {
            id: 'tab_talents', name: 'TALENTS',
            tables: [
                { id: 'tbl_talent', name: 'TALENT', type: 'toggle', items: [
                        { id: 'ti_actor1', name: 'ACTOR 1' },
                        { id: 'ti_actor2', name: 'ACTOR 2' },
                        { id: 'ti_actor3', name: 'ACTOR 3' },
                    ] },
                { id: 'tbl_ward', name: 'WARDR/M&H', type: 'toggle', items: [
                        { id: 'ti_fit1', name: 'FIT 1' },
                        { id: 'ti_fit2', name: 'FIT 2' },
                        { id: 'ti_fit3', name: 'FIT 3' },
                    ] },
                { id: 'tbl_extras', name: 'EXTRAS', type: 'counter', items: [
                        { id: 'ti_crowd1', name: 'CROWD 1' },
                        { id: 'ti_crowd2', name: 'CROWD 2' },
                    ] },
            ],
        },
        {
            id: 'tab_gear', name: 'GEAR',
            tables: [
                { id: 'tbl_cam', name: 'CAM', type: 'toggle', items: [
                        { id: 'ti_alexa', name: 'ALEXA' },
                        { id: 'ti_bcam', name: 'B CAM' },
                        { id: 'ti_zoom', name: 'ZOOM' },
                    ] },
                { id: 'tbl_grip', name: 'GRIP', type: 'toggle', items: [
                        { id: 'ti_dolly', name: 'DOLLY' },
                        { id: 'ti_steadicam', name: 'STEADICAM' },
                        { id: 'ti_crane', name: 'CRANE' },
                        { id: 'ti_drone', name: 'DRONE' },
                    ] },
                { id: 'tbl_sfx', name: 'SFX', type: 'toggle', items: [
                        { id: 'ti_haze', name: 'HAZE' },
                        { id: 'ti_wetdown', name: 'WETDOWN' },
                        { id: 'ti_snow', name: 'SNOW' },
                        { id: 'ti_fire', name: 'FIRE' },
                    ] },
            ],
        },
        {
            id: 'tab_art', name: 'ART',
            tables: [
                { id: 'tbl_set', name: 'SET', type: 'toggle', items: [
                        { id: 'ti_set1', name: 'SET 1' },
                        { id: 'ti_set2', name: 'SET 2' },
                        { id: 'ti_set3', name: 'SET 3' },
                    ] },
                { id: 'tbl_props', name: 'PROPS', type: 'toggle', items: [
                        { id: 'ti_prop1', name: 'PROP 1' },
                        { id: 'ti_prop2', name: 'PROP 2' },
                        { id: 'ti_prop3', name: 'PROP 3' },
                    ] },
                { id: 'tbl_build', name: 'BUILD', type: 'toggle', items: [
                        { id: 'ti_build1', name: 'BUILD 1' },
                        { id: 'ti_build2', name: 'BUILD 2' },
                        { id: 'ti_build3', name: 'BUILD 3' },
                    ] },
            ],
        },
    ],
    locations: [],
};
/** Merge saved needDefinitions with DEFAULT_NEED_DEFINITIONS.
 *  Tab order follows defaults; new tabs/tables added; user customizations preserved. */
function migrateNeedDefinitions(saved) {
    const defaults = exports.DEFAULT_NEED_DEFINITIONS;
    const savedTabMap = new Map(saved.tabs.map(t => [t.id, t]));
    const resultTabs = [];
    for (const defTab of defaults.tabs) {
        const savedTab = savedTabMap.get(defTab.id);
        if (!savedTab) {
            resultTabs.push(defTab);
        }
        else {
            const savedTableMap = new Map(savedTab.tables.map(tbl => [tbl.id, tbl]));
            const mergedTables = [];
            for (const defTable of defTab.tables) {
                const saved = savedTableMap.get(defTable.id);
                // Merge structural props from defaults while keeping user's items
                mergedTables.push(saved ? { ...saved, type: defTable.type } : defTable);
                savedTableMap.delete(defTable.id);
            }
            for (const extra of savedTableMap.values())
                mergedTables.push(extra);
            resultTabs.push({ ...savedTab, tables: mergedTables });
        }
        savedTabMap.delete(defTab.id);
    }
    for (const extra of savedTabMap.values())
        resultTabs.push(extra);
    return { tabs: resultTabs, locations: saved.locations ?? defaults.locations };
}
/** Create default per-frame need state (all toggles off, no memos). */
function createDefaultFrameNeedState() {
    return {
        label: 'needs',
        activeTabId: exports.DEFAULT_NEED_DEFINITIONS.tabs[0]?.id ?? '',
        toggles: {},
        counters: {},
        locationToggles: {},
        memos: {},
    };
}
/** Create default per-frame note state. */
function createDefaultFrameNoteState() {
    return {
        label: 'note',
        mode: 'note',
        noteText: '',
        tableData: { headers: ['', '', ''], rows: [['', '', ''], ['', '', ''], ['', '', '']] },
    };
}
// Internal strip IDs are legacy names kept for backward compat with persisted data.
// MAIN  = 'main'  (hardcoded, not in this array)
// STRIP1 = 'ver'   (originally "versions")
// STRIP2 = 'floor' (originally "floor plan")
// STRIP3 = 'refs'  (originally "references")
// The buttonLabel is what users see and can rename via Customise.
exports.DEFAULT_STRIP_DEFS = [
    { id: 'ver', buttonLabel: 'HOW', defaultFrameLabel: 'versn', prefix: 'v' },
    { id: 'floor', buttonLabel: 'SKETCH', defaultFrameLabel: 'sketch', prefix: 's' },
    { id: 'refs', buttonLabel: 'REFS', defaultFrameLabel: 'refs', prefix: 'r' },
];
// Create shared objects so legacy aliases and generic maps point to the same data.
// Iterates DEFAULT_STRIP_DEFS — adding a strip there auto-creates its state buckets.
function createStripState() {
    const stripVersions = {};
    const stripActiveTab = {};
    const stripCrossCompare = {};
    const stripPrevFrameState = {};
    for (const def of exports.DEFAULT_STRIP_DEFS) {
        stripVersions[def.id] = {};
        stripActiveTab[def.id] = {};
        stripCrossCompare[def.id] = {};
        stripPrevFrameState[def.id] = {};
    }
    return {
        stripVersions,
        stripActiveTab,
        stripCrossCompare,
        stripPrevFrameState,
        // Legacy aliases point to the SAME objects (for backward compat)
        versions: stripVersions.ver,
        activeTab: stripActiveTab.ver,
        crossCompare: stripCrossCompare.ver,
        prevFrameState: stripPrevFrameState.ver,
        floorVersions: stripVersions.floor,
        floorActiveTab: stripActiveTab.floor,
        floorCrossCompare: stripCrossCompare.floor,
        floorPrevFrameState: stripPrevFrameState.floor,
        refsVersions: stripVersions.refs,
        refsActiveTab: stripActiveTab.refs,
        refsCrossCompare: stripCrossCompare.refs,
        refsPrevFrameState: stripPrevFrameState.refs,
    };
}
const initialStrips = createStripState();
const initial = {
    frames: [],
    ...initialStrips,
    stripDefs: exports.DEFAULT_STRIP_DEFS,
    activeStrips: ['main', 'ver'],
    layoutMode: 'auto',
    drawColor: {},
    drawWidth: {},
    drawEraser: {},
    drawActive: {},
    showText: {},
    crossCompareStrip: {},
    nextId: 1,
    reorderFid: null,
    verReorderFid: null,
    verReorderStrip: null,
    verSlideDir: null,
    swipeHighlightFid: null,
    stripClipboard: null,
    imgTarget: null,
    mainImgTarget: null,
    currentViewMode: 'both',
    ovExpandedFid: null,
    drawingInProgress: false,
    drawSuppressClick: false,
    overviewAction: false,
    fsOverlayActive: null,
    lastPdfName: '',
    centerFid: null,
    scrollHideGuard: 0,
    swipeHintShown: false,
    portraitMode: false,
    projectType: 'landscape',
    groups: [],
    activeGroupId: null,
    nextGroupId: 1,
    setups: [],
    activeSetupId: null,
    setupMode: false,
    setupEditing: false,
    nextSetupId: 1,
    stripTagInfoDismissed: false,
    stripUntagInfoDismissed: false,
    needDefinitions: exports.DEFAULT_NEED_DEFINITIONS,
    frameNeeds: {},
    needsStripVisible: false,
    frameNotes: {},
    notesStripVisible: false,
    storyFlowBreaks: [],
    sortOrders: [],
    activeSortOrderId: null,
    sortMode: false,
    scribbleMode: false,
    sortEditingId: null,
    nextSortOrderId: 1,
    camAspectRatio: 'canvas',
    exportMeta: createDefaultExportMeta(),
    renderTick: 0,
};
exports.useStore = (0, zustand_1.create)(() => initial);
// Convenience accessors used widely by the imperative core.
const state = () => exports.useStore.getState();
exports.state = state;
exports.setState = exports.useStore.setState;
function bumpRenderTick() {
    exports.useStore.setState((s) => ({ renderTick: s.renderTick + 1 }));
}
function resetStoryboardState() {
    const freshStrips = createStripState();
    exports.useStore.setState({
        frames: [],
        ...freshStrips,
        stripDefs: exports.DEFAULT_STRIP_DEFS,
        activeStrips: ['main', 'ver'],
        layoutMode: 'auto',
        drawColor: {},
        drawWidth: {},
        drawEraser: {},
        drawActive: {},
        showText: {},
        crossCompareStrip: {},
        nextId: 1,
        reorderFid: null,
        verReorderFid: null,
        verReorderStrip: null,
        stripClipboard: null,
        imgTarget: null,
        mainImgTarget: null,
        currentViewMode: 'both',
        portraitMode: false,
        projectType: 'landscape',
        groups: [],
        activeGroupId: null,
        nextGroupId: 1,
        setups: [],
        activeSetupId: null,
        setupMode: false,
        nextSetupId: 1,
        stripTagInfoDismissed: false,
        stripUntagInfoDismissed: false,
        needDefinitions: exports.DEFAULT_NEED_DEFINITIONS,
        frameNeeds: {},
        needsStripVisible: false,
        frameNotes: {},
        notesStripVisible: false,
        sortOrders: [],
        storyFlowBreaks: [],
        activeSortOrderId: null,
        sortMode: false,
        sortEditingId: null,
        nextSortOrderId: 1,
        camAspectRatio: 'canvas',
        exportMeta: createDefaultExportMeta(),
        renderTick: (0, exports.state)().renderTick + 1,
    });
    // Clean up sort DOM elements if they exist
    const sortDropdown = document.getElementById('sortDropdown');
    if (sortDropdown) {
        sortDropdown.style.display = 'none';
        sortDropdown.innerHTML = '';
    }
    const sortEditView = document.getElementById('sortEditView');
    if (sortEditView) {
        sortEditView.style.display = 'none';
        sortEditView.innerHTML = '';
    }
    // Restore normal content visibility
    const columns = document.querySelector('.columns');
    if (columns)
        columns.style.display = '';
    document.getElementById('sortByBtn')?.classList.remove('active');
}
// Touch detection — used in many places.
exports.isTouch = matchMedia('(hover:none) and (pointer:coarse)').matches;

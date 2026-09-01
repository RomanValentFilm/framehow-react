// Zustand store mirroring the original's mutable globals.
// The data shape (frames, versions, activeTab, draw* maps, etc.) is preserved
// verbatim so the imperative renderers can be ported with minimal change.
//
// Mutations happen through `useStore.setState` or via the helper actions below.
// Imperative code reads with `getState()` and either mutates the returned
// object in place + calls `bumpRenderTick()` (for things React doesn't need
// to react to), or uses an action.

import { create } from 'zustand';
import { COLORS } from '../lib/constants';

export interface Stroke {
  type?: 'text' | 'stroke';
  text?: string;
  color?: string;
  x?: number;
  y?: number;
  width?: number;
  points?: { x: number; y: number }[];
  eraser?: boolean;
}

export interface TableData {
  headers: string[];
  rows: string[][];
  colWidths?: number[];   // percentage widths per column (optional, for resize)
}

export interface Frame {
  id: number;
  src: string;
  label: string;
  cropW: number;
  cropH: number;
  strokes: Stroke[];
  drawMode: boolean;
  textContent: string;
  tableData: TableData | null;
  hidden?: boolean;
  stripLabels?: Record<string, string>;
  setupId?: string | null;
  /** Server UUID — persists across syncs so we can diff local vs cloud. */
  serverFrameId?: string;
  /** Server UUID for the implicit "main" version entry (holds strokes + image). */
  serverMainVersionId?: string;
  /** R2 object key for the main frame image. Null/undefined = local or empty. */
  r2Key?: string;
  /** Free-text note attached to this frame (shown via notepad icon in fullscreen canvas). */
  note?: string;
  /** Scribble strokes drawn over this frame in 3×2 view. Stored per-frame so they move with reorder. */
  scribbles?: Stroke[];
  /** Frame was not found in the latest PDF re-adjust — kept but visually flagged. */
  orphaned?: boolean;
}

/** A named colour-coded setup (lighting / time-of-day label for frames). */
export interface Setup {
  id: string;
  name: string;        // max 7 chars, stored UPPERCASE
  colorIndex: number;  // 0-11 index into SETUP_COLORS
}

/** 12-colour palette for setups. */
/** App version — bump before every deploy. */
export const APP_VERSION = 'v4.9.115';

/** Free-text fields printed in the header of every exported page. */
export interface ExportMeta {
  shootingOrder: string;
  userName: string;
  version: string;
  date: string;
}

export function createDefaultExportMeta(): ExportMeta {
  return { shootingOrder: '', userName: '', version: '', date: '' };
}

/** Camera guide aspect-ratio presets. 'canvas' = use the frame's own canvas AR. */
export type CamRatioKey = '2.39' | '2.0' | '1.85' | 'canvas' | '16:9' | '4:3' | '1:1' | '9:16';

export const CAM_RATIOS: { key: CamRatioKey; label: string; value: number | null }[] = [
  { key: '2.39',   label: '2.39:1', value: 2.39 },
  { key: '2.0',    label: '2:1',    value: 2 },
  { key: '1.85',   label: '1.85:1', value: 1.85 },
  { key: 'canvas', label: 'CANVAS', value: null },
  { key: '16:9',   label: '16:9',   value: 16 / 9 },
  { key: '4:3',    label: '4:3',    value: 4 / 3 },
  { key: '1:1',    label: '1:1',    value: 1 },
  { key: '9:16',   label: '9:16',   value: 9 / 16 },
];

export const SETUP_COLORS: { name: string; hex: string }[] = [
  { name: 'DAYLIGHT',      hex: '#CFE2F6' },
  { name: 'EARLY MORNING', hex: '#88BDE6' },
  { name: 'LATE MORNING',  hex: '#4DB6B3' },
  { name: 'MIDDAY',        hex: '#FFD23F' },
  { name: 'AFTERNOON',     hex: '#F97316' },
  { name: 'GOLDEN HOUR',   hex: '#E23A2F' },
  { name: 'SUNSET',        hex: '#FF4D6D' },
  { name: 'BLUE HOUR',     hex: '#9D1B60' },
  { name: 'NIGHT',         hex: '#1974D2' },
  { name: 'FOREST NIGHT',  hex: '#2E7D56' },
  { name: 'BROWN',         hex: '#8B5E3C' },
  { name: 'NIGHT BLACK',   hex: '#0A0A0A' },
];

export interface Version {
  id: number;
  label: string;
  type: 'empty' | 'drawing' | 'upload';
  strokes: Stroke[];
  bgImage: string | null;
  hidden?: boolean;
  /** Legacy single star. Kept in step with `stars` (true when stars > 0) so
   *  exports and older data keep working unchanged. */
  starred?: boolean;
  /** Rating 0-3. FITTING shows three stars; other project types only ever
   *  set 0 or 1, which behaves exactly as the single star always did. */
  stars?: number;
  /** Tagged with parent MAIN frame's SETUP — shares content across same-SETUP frames.
   *  'origin' = the source version where the user clicked TAG.
   *  'copy'   = image propagated from an origin to other same-SETUP frames. */
  setupTagged?: 'origin' | 'copy';
  /** Server UUID — persists across syncs so we can diff local vs cloud. */
  serverVersionId?: string;
  /** R2 object key for this version's image. Null/undefined = local or empty. */
  r2Key?: string;
  /** Free-text note attached to this version (shown via notepad icon). */
  note?: string;
}

// ─── Tags Strip Types ─────────────────────────────────────────────────

/** A single row item inside a tag table (e.g. "ACTOR 1", "DOLLY"). */
export interface NeedItem {
  id: string;
  name: string;
}

/** A column/table inside a tag tab (e.g. "TALENT", "EXTRAS"). */
export interface NeedTable {
  id: string;
  name: string;
  type: 'toggle' | 'counter';  // circle dot or number input
  items: NeedItem[];
}

/** A tab inside the tags card (e.g. "TALENTS", "GEAR", "ART"). */
export interface NeedTab {
  id: string;
  name: string;
  tables: NeedTable[];
}

/** Project-wide need definitions — same in every frame. */
export interface NeedDefinitions {
  tabs: NeedTab[];
  locations: NeedItem[];
}

/** Per-frame need state — toggles, counters, memos for each frame. */
export interface FrameNeedState {
  label: string;                              // editable, default "tags"
  activeTabId: string;                        // which tab is visible
  toggles: Record<string, boolean>;           // itemId → on/off
  counters: Record<string, number>;           // itemId → count (for counter-type items)
  locationToggles: Record<string, boolean>;   // locationId → on/off
  memos: Record<string, string>;              // tabId → memo text
}

/** Default need definitions for new projects. */
export const DEFAULT_NEED_DEFINITIONS: NeedDefinitions = {
  tabs: [
    {
      id: 'tab_shoot', name: 'SHOOT',
      tables: [
        { id: 'tbl_shootday', name: 'SHOOT DAY', type: 'toggle', items: [
          { id: 'ti_day1', name: 'DAY 1' },
          { id: 'ti_day2', name: 'DAY 2' },
          { id: 'ti_day3', name: 'DAY 3' },
        ]},
        { id: 'tbl_unit', name: 'UNIT', type: 'toggle', items: [
          { id: 'ti_unit1', name: '1st UNIT' },
          { id: 'ti_unit2', name: '2nd UNIT' },
          { id: 'ti_unit3', name: '3rd UNIT' },
        ]},
        { id: 'tbl_location', name: 'LOCATION', type: 'toggle', items: [
          { id: 'ti_loc1', name: 'LOCATION 1' },
          { id: 'ti_loc2', name: 'LOCATION 2' },
        ]},
        // DIRECTION (#386). Sits after LOCATION: where you are, then which way
        // you are pointing. New default tables reach projects that already
        // exist through migrateNeedDefinitions, which follows this order.
        { id: 'tbl_direction', name: 'DIRECTION', type: 'toggle', items: [
          { id: 'ti_dir_a', name: 'DIRECTION A' },
          { id: 'ti_dir_reverse', name: 'REVERSE' },
          { id: 'ti_dir_plusminus', name: '+/-' },
        ]},
        { id: 'tbl_extint', name: 'INT/EXT', type: 'toggle', items: [
          { id: 'ti_int', name: 'INT' },
          { id: 'ti_ext', name: 'EXT' },
        ]},
        { id: 'tbl_daytime', name: 'DAYTIME', type: 'toggle', items: [
          { id: 'ti_sunrise', name: 'SUNRISE' },
          { id: 'ti_day', name: 'DAY' },
          { id: 'ti_sunset', name: 'SUNSET' },
          { id: 'ti_night', name: 'NIGHT' },
        ]},
      ],
    },
    {
      id: 'tab_talents', name: 'TALENTS',
      tables: [
        { id: 'tbl_talent', name: 'TALENT', type: 'toggle', items: [
          { id: 'ti_actor1', name: 'ACTOR 1' },
          { id: 'ti_actor2', name: 'ACTOR 2' },
          { id: 'ti_actor3', name: 'ACTOR 3' },
        ]},
        { id: 'tbl_ward', name: 'WARDR/M&H', type: 'toggle', items: [
          { id: 'ti_fit1', name: 'FIT 1' },
          { id: 'ti_fit2', name: 'FIT 2' },
          { id: 'ti_fit3', name: 'FIT 3' },
        ]},
        { id: 'tbl_extras', name: 'EXTRAS', type: 'counter', items: [
          { id: 'ti_crowd1', name: 'CROWD 1' },
          { id: 'ti_crowd2', name: 'CROWD 2' },
        ]},
      ],
    },
    {
      id: 'tab_gear', name: 'GEAR',
      tables: [
        { id: 'tbl_cam', name: 'CAM', type: 'toggle', items: [
          { id: 'ti_alexa', name: 'ALEXA' },
          { id: 'ti_bcam', name: 'B CAM' },
          { id: 'ti_zoom', name: 'ZOOM' },
        ]},
        { id: 'tbl_grip', name: 'GRIP', type: 'toggle', items: [
          { id: 'ti_dolly', name: 'DOLLY' },
          { id: 'ti_steadicam', name: 'STEADICAM' },
          { id: 'ti_crane', name: 'CRANE' },
          { id: 'ti_drone', name: 'DRONE' },
        ]},
        { id: 'tbl_sfx', name: 'SFX', type: 'toggle', items: [
          { id: 'ti_haze', name: 'HAZE' },
          { id: 'ti_wetdown', name: 'WETDOWN' },
          { id: 'ti_snow', name: 'SNOW' },
          { id: 'ti_fire', name: 'FIRE' },
        ]},
      ],
    },
    {
      id: 'tab_art', name: 'ART',
      tables: [
        { id: 'tbl_set', name: 'SET', type: 'toggle', items: [
          { id: 'ti_set1', name: 'SET 1' },
          { id: 'ti_set2', name: 'SET 2' },
          { id: 'ti_set3', name: 'SET 3' },
        ]},
        { id: 'tbl_props', name: 'PROPS', type: 'toggle', items: [
          { id: 'ti_prop1', name: 'PROP 1' },
          { id: 'ti_prop2', name: 'PROP 2' },
          { id: 'ti_prop3', name: 'PROP 3' },
        ]},
        { id: 'tbl_build', name: 'BUILD', type: 'toggle', items: [
          { id: 'ti_build1', name: 'BUILD 1' },
          { id: 'ti_build2', name: 'BUILD 2' },
          { id: 'ti_build3', name: 'BUILD 3' },
        ]},
      ],
    },
  ],
  locations: [],
};

/**
 * A FRESH COPY OF THE DEFAULTS, EVERY TIME (#332).
 *
 * DEFAULT_NEED_DEFINITIONS was handed out by reference, and every NEEDS edit
 * writes into the object it is given rather than replacing it. So renaming a
 * category did not change the project — it changed the TEMPLATE, for the rest
 * of the session. Start From Scratch after that and the new project opened
 * holding the last project's categories, and then pushed them to the server as
 * though they had been typed there.
 *
 * It half looked like a feature, which is worse than looking like a bug: it
 * only survived while the app stayed open, so the same action carried over
 * sometimes and not others.
 *
 * Every new project now starts from the plain defaults, by decision.
 */
export function freshNeedDefinitions(): NeedDefinitions {
  return structuredClone(DEFAULT_NEED_DEFINITIONS);
}

/** Merge saved needDefinitions with DEFAULT_NEED_DEFINITIONS.
 *  Tab order follows defaults; new tabs/tables added; user customizations preserved. */
export function migrateNeedDefinitions(saved: NeedDefinitions): NeedDefinitions {
  const defaults = freshNeedDefinitions();   // never the shared one (#332)
  const savedTabMap = new Map(saved.tabs.map(t => [t.id, t]));
  const resultTabs: NeedTab[] = [];

  for (const defTab of defaults.tabs) {
    const savedTab = savedTabMap.get(defTab.id);
    if (!savedTab) {
      resultTabs.push(defTab);
    } else {
      const savedTableMap = new Map(savedTab.tables.map(tbl => [tbl.id, tbl]));
      const mergedTables: NeedTable[] = [];
      for (const defTable of defTab.tables) {
        const saved = savedTableMap.get(defTable.id);
        // Merge structural props from defaults while keeping user's items
        mergedTables.push(saved ? { ...saved, type: defTable.type } : defTable);
        savedTableMap.delete(defTable.id);
      }
      for (const extra of savedTableMap.values()) mergedTables.push(extra);
      resultTabs.push({ ...savedTab, tables: mergedTables });
    }
    savedTabMap.delete(defTab.id);
  }
  for (const extra of savedTabMap.values()) resultTabs.push(extra);

  return { tabs: resultTabs, locations: saved.locations ?? defaults.locations };
}

/** Create default per-frame need state (all toggles off, no memos). */
export function createDefaultFrameNeedState(): FrameNeedState {
  return {
    label: 'needs',
    activeTabId: DEFAULT_NEED_DEFINITIONS.tabs[0]?.id ?? '',
    toggles: {},
    counters: {},
    locationToggles: {},
    memos: {},
  };
}

// ─── Notes Strip Types ──────────────────────────────────────────────

/** Per-frame note state — text note or table, displayed in the NOTES strip. */
export interface FrameNoteState {
  label: string;                   // editable suffix, default "note"
  mode: 'note' | 'table';         // current view toggle
  noteText: string;                // free-text note content
  tableData: TableData;            // table data (always present, toggle switches view)
}

/** Create default per-frame note state. */
export function createDefaultFrameNoteState(): FrameNoteState {
  return {
    label: 'note',
    mode: 'note',
    noteText: '',
    tableData: { headers: ['', '', ''], rows: [['', '', ''], ['', '', ''], ['', '', '']] },
  };
}

export type StripType = 'main' | 'ver' | 'floor' | 'refs';
export type LayoutMode = 'auto' | 'overview' | 'grid4';
// Keep ViewMode for backward compat during transition
export type ViewMode = 'main' | 'ver' | 'both' | 'overview' | 'grid4' | 'grid3x2';
export type DrawActiveOrigin = 'main' | 'ver' | 'floor' | 'refs' | null;

export interface FrameSnapshot {
  origin: 'main' | 'ver' | 'floor' | 'refs';
  main: {
    src: string;
    strokes: Stroke[];
    drawMode: boolean;
    textContent: string;
    tableData: TableData | null;
  };
  versions: Version[];
  activeTab: number;
  crossCompare: number | undefined;
}

export interface FrameGroup {
  id: number;
  name: string;
  frameIds: number[];
  hiddenFrameIds: number[];
}

export interface StripDef {
  id: StripType;
  buttonLabel: string;       // max 6 chars, displayed CAPS on the button
  defaultFrameLabel: string; // default label inside frame cards
  prefix: string;            // tab prefix: 'v', 'f', 'r'
}

// Internal strip IDs are legacy names kept for backward compat with persisted data.
// MAIN  = 'main'  (hardcoded, not in this array)
// STRIP1 = 'ver'   (originally "versions")
// STRIP2 = 'floor' (originally "floor plan")
// STRIP3 = 'refs'  (originally "references")
// The buttonLabel is what users see and can rename via Customise.
export const DEFAULT_STRIP_DEFS: StripDef[] = [
  { id: 'ver',   buttonLabel: 'HOW', defaultFrameLabel: 'versn',  prefix: 'v' },
  { id: 'floor', buttonLabel: 'SKETCH', defaultFrameLabel: 'sketch', prefix: 's' },
  { id: 'refs',  buttonLabel: 'REFS',  defaultFrameLabel: 'refs',  prefix: 'r' },
];

/** A break/spacer inserted between frames in a custom sort order. */
export interface SortBreak {
  id: string;
  text: string;       // e.g. "LUNCH BREAK — 60 min"
  position: number;   // index in the order array where this break sits
}

/** Bracket tree node – serialisable subset (no DOM refs). */
export interface BracketNodeData {
  inputIds: number[];
  categoryId?: string;
  categoryName?: string;
  itemId?: string;
  itemName?: string;
  matchedIds: number[];
  right?: BracketNodeData;
  down?: BracketNodeData;
  expanded?: boolean;
}

/** A named custom frame ordering (e.g. "Shooting order", "VFX priority"). */
export interface SortOrder {
  id: string;
  name: string;
  description: string;
  /** Frame ids in user-defined order. */
  frameOrder: number[];
  /** Breaks inserted between frames. */
  breaks: SortBreak[];
  /** Persisted bracket tree (last state when user pressed SORT NOW / DONE / YES). */
  bracketTree?: BracketNodeData;
  /** Snapshot of bracket-derived order used for manual-change detection. */
  sortedSnapshot?: number[];
  /**
   * WHICH GROUP THIS ORDER WAS MADE IN (#382).
   *
   * An order made while a group is open holds only that group's frames, because
   * it is built from getVisibleFrames(). Until now it was filed in the same flat
   * list as every other order with nothing to say so — picked from ALL it showed
   * a short list of frames and no reason why.
   *
   * null / missing means it belongs to the whole project, which is also what
   * every order made before this change looks like. There is no way to work out
   * afterwards which group an old one came from, so they stay as they are.
   */
  groupId?: number | null;
}

export interface StripClipboard {
  bgImage: string | null;
  strokes: Stroke[];
  cropW?: number;
  cropH?: number;
}

/** Project kinds. 'fitting' currently behaves like 'portrait' but is tracked separately. */
export type ProjectType = 'landscape' | 'portrait' | 'fitting';

export interface FrameHowState {
  frames: Frame[];
  /** Generic per-strip data — keyed by StripType, then by frame id */
  stripVersions: Record<string, Record<number, Version[]>>;
  stripActiveTab: Record<string, Record<number, number>>;
  stripCrossCompare: Record<string, Record<number, number>>;
  stripPrevFrameState: Record<string, Record<number, FrameSnapshot | null>>;
  // Legacy aliases (kept for backward compat during migration, point to same objects)
  versions: Record<number, Version[]>;
  activeTab: Record<number, number>;
  floorVersions: Record<number, Version[]>;
  floorActiveTab: Record<number, number>;
  floorCrossCompare: Record<number, number>;
  floorPrevFrameState: Record<number, FrameSnapshot | null>;
  refsVersions: Record<number, Version[]>;
  refsActiveTab: Record<number, number>;
  refsCrossCompare: Record<number, number>;
  refsPrevFrameState: Record<number, FrameSnapshot | null>;
  /** Strip definitions — user-configurable button labels & defaults */
  stripDefs: StripDef[];
  /** Which strips are selected in the middle buttons (ordered) */
  activeStrips: StripType[];
  /** Layout mode from the right buttons */
  layoutMode: LayoutMode;
  drawColor: Record<number, string>;
  /** THE PEN COLOUR — one for the whole app (#336).
   *
   *  It used to be per frame, with a SECOND copy of its own inside the
   *  fullscreen view, and the two never told each other. Pick red on a card,
   *  open fullscreen, and it silently went back to whatever fullscreen last
   *  had; pick red in fullscreen and every card still showed its own old
   *  colour. A sync arriving in the background emptied the per-frame list
   *  altogether, so everything went back to white in the middle of working.
   *
   *  One colour, chosen last, used everywhere, kept across a sync and a
   *  restart, until the user picks another. */
  penColor: string;
  drawWidth: Record<number, number>;
  drawEraser: Record<number, boolean>;
  drawActive: Record<number, DrawActiveOrigin>;
  showText: Record<number, 'text' | 'table' | null>;
  crossCompare: Record<number, number>;
  crossCompareStrip: Record<number, StripType>;
  prevFrameState: Record<number, FrameSnapshot | null>;
  nextId: number;
  reorderFid: number | null;
  verReorderFid: number | null;
  verReorderStrip: StripType | null;
  verSlideDir: string | null;
  swipeHighlightFid: number | null;
  stripClipboard: StripClipboard | null;
  imgTarget: { fid: number; div: HTMLElement; fromCompare?: boolean; stripType?: StripType } | null;
  mainImgTarget: {
    fid: number;
    div: HTMLElement;
    toVersion: boolean;
    fromOverview?: boolean;
  } | null;
  currentViewMode: ViewMode;
  ovExpandedFid: number | null;
  drawingInProgress: boolean;
  drawSuppressClick: boolean;
  overviewAction: boolean;
  fsOverlayActive: { fid: number; vi: number; origin: 'main' | 'ver' | 'floor' | 'refs' } | null;
  lastPdfName: string;
  centerFid: string | null;
  scrollHideGuard: number;
  swipeHintShown: boolean;
  /** 9:16 portrait storyboard mode (true for both 'portrait' and 'fitting' projects) */
  portraitMode: boolean;
  /** Which kind of project this is. 'fitting' shares 9:16 behaviour but can diverge. */
  projectType: ProjectType;
  /** Frame groups */
  groups: FrameGroup[];
  activeGroupId: number | null;  // null = ALL
  nextGroupId: number;
  /** Setups — colour-coded lighting/time-of-day labels for frames */
  setups: Setup[];
  activeSetupId: string | null;
  setupMode: boolean;
  setupEditing: boolean;   // true = toggle buttons visible, assigning frames
  nextSetupId: number;
  /** Per-project: user dismissed the strip-tag info overlay */
  stripTagInfoDismissed: boolean;
  /** Per-project: user dismissed the strip-untag info overlay */
  stripUntagInfoDismissed: boolean;
  /** Needs strip — project-wide item/table/tab definitions */
  needDefinitions: NeedDefinitions;
  /** Needs strip — per-frame toggle/counter/memo state */
  frameNeeds: Record<number, FrameNeedState>;
  /** Needs strip — visible in view bar */
  needsStripVisible: boolean;
  /** Notes strip — per-frame note/table state */
  frameNotes: Record<number, FrameNoteState>;
  /** Notes strip — visible in view bar */
  notesStripVisible: boolean;
  /** Breaks for story flow (default frame order) */
  storyFlowBreaks: SortBreak[];
  /** Custom frame orderings (e.g. "Shooting order") */
  sortOrders: SortOrder[];
  /** Which sort order is active; null = Story flow (default frame order) */
  activeSortOrderId: string | null;
  /** True while the sort-order dropdown or edit view is active */
  sortMode: boolean;
  /** True when scribble overlay is active in 3×2 view */
  scribbleMode: boolean;
  /** ID of sort order currently being edited in frame-set view; null = not editing */
  sortEditingId: string | null;
  nextSortOrderId: number;
  /** Camera guide aspect ratio preset — 'canvas' uses the frame's own canvas AR */
  camAspectRatio: CamRatioKey;
  /** Header text fields carried into every export, remembered per project */
  exportMeta: ExportMeta;
  // bumped manually by the imperative core to wake any React subscribers
  // that need to react to mutable state changes (e.g., frame badge count).
  renderTick: number;
}

// Create shared objects so legacy aliases and generic maps point to the same data.
// Iterates DEFAULT_STRIP_DEFS — adding a strip there auto-creates its state buckets.
function createStripState() {
  const stripVersions: Record<string, Record<number, Version[]>> = {};
  const stripActiveTab: Record<string, Record<number, number>> = {};
  const stripCrossCompare: Record<string, Record<number, number>> = {};
  const stripPrevFrameState: Record<string, Record<number, FrameSnapshot | null>> = {};
  for (const def of DEFAULT_STRIP_DEFS) {
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

const initial: FrameHowState = {
  frames: [],
  ...initialStrips,
  stripDefs: DEFAULT_STRIP_DEFS,
  activeStrips: ['main', 'ver'],
  layoutMode: 'auto',
  drawColor: {},
  penColor: COLORS[0],
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
  needDefinitions: freshNeedDefinitions(),
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

export const useStore = create<FrameHowState>(() => initial);

// Convenience accessors used widely by the imperative core.
export const state = (): FrameHowState => useStore.getState();
export const setState = useStore.setState;

export function bumpRenderTick(): void {
  useStore.setState((s) => ({ renderTick: s.renderTick + 1 }));
}

export function resetStoryboardState(): void {
  const freshStrips = createStripState();
  useStore.setState({
    frames: [],
    ...freshStrips,
    stripDefs: DEFAULT_STRIP_DEFS,
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
    needDefinitions: freshNeedDefinitions(),
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
    renderTick: state().renderTick + 1,
  });
  // Clean up sort DOM elements if they exist
  const sortDropdown = document.getElementById('sortDropdown');
  if (sortDropdown) { sortDropdown.style.display = 'none'; sortDropdown.innerHTML = ''; }
  const sortEditView = document.getElementById('sortEditView');
  if (sortEditView) { sortEditView.style.display = 'none'; sortEditView.innerHTML = ''; }
  // Restore normal content visibility
  const columns = document.querySelector('.columns') as HTMLElement | null;
  if (columns) columns.style.display = '';
  document.getElementById('sortByBtn')?.classList.remove('active');
}

// Touch detection — used in many places.
export const isTouch = matchMedia('(hover:none) and (pointer:coarse)').matches;

// Re-export so imperative modules can pick this up alongside state.
export { COLORS };

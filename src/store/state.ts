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
}

export interface Version {
  id: number;
  label: string;
  type: 'empty' | 'drawing' | 'upload';
  strokes: Stroke[];
  bgImage: string | null;
  hidden?: boolean;
  starred?: boolean;
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
  { id: 'ver',   buttonLabel: 'VERSN', defaultFrameLabel: 'vers',  prefix: 'v' },
  { id: 'floor', buttonLabel: 'FLOOR', defaultFrameLabel: 'floor', prefix: 'f' },
  { id: 'refs',  buttonLabel: 'REFS',  defaultFrameLabel: 'refs',  prefix: 'r' },
];

export interface StripClipboard {
  bgImage: string | null;
  strokes: Stroke[];
  cropW?: number;
  cropH?: number;
}

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
  /** 9:16 portrait storyboard mode */
  portraitMode: boolean;
  /** Frame groups */
  groups: FrameGroup[];
  activeGroupId: number | null;  // null = ALL
  nextGroupId: number;
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
  groups: [],
  activeGroupId: null,
  nextGroupId: 1,
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
    groups: [],
    activeGroupId: null,
    nextGroupId: 1,
    renderTick: state().renderTick + 1,
  });
}

// Touch detection — used in many places.
export const isTouch = matchMedia('(hover:none) and (pointer:coarse)').matches;

// Re-export so imperative modules can pick this up alongside state.
export { COLORS };

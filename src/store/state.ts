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
  versionLabel?: string;
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

export type ViewMode = 'main' | 'ver' | 'both' | 'overview';
export type DrawActiveOrigin = 'main' | 'ver' | null;

export interface FrameSnapshot {
  origin: 'main' | 'ver';
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

export interface StripClipboard {
  bgImage: string | null;
  strokes: Stroke[];
  cropW?: number;
  cropH?: number;
}

export interface FrameHowState {
  frames: Frame[];
  versions: Record<number, Version[]>;
  activeTab: Record<number, number>;
  drawColor: Record<number, string>;
  drawWidth: Record<number, number>;
  drawEraser: Record<number, boolean>;
  drawActive: Record<number, DrawActiveOrigin>;
  showText: Record<number, 'text' | 'table' | null>;
  crossCompare: Record<number, number>;
  prevFrameState: Record<number, FrameSnapshot | null>;
  nextId: number;
  reorderFid: number | null;
  verReorderFid: number | null;
  verSlideDir: string | null;
  swipeHighlightFid: number | null;
  stripClipboard: StripClipboard | null;
  imgTarget: { fid: number; div: HTMLElement; fromCompare?: boolean } | null;
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
  fsOverlayActive: { fid: number; vi: number; origin: 'main' | 'ver' } | null;
  lastPdfName: string;
  centerFid: string | null;
  scrollHideGuard: number;
  swipeHintShown: boolean;
  // bumped manually by the imperative core to wake any React subscribers
  // that need to react to mutable state changes (e.g., frame badge count).
  renderTick: number;
}

const initial: FrameHowState = {
  frames: [],
  versions: {},
  activeTab: {},
  drawColor: {},
  drawWidth: {},
  drawEraser: {},
  drawActive: {},
  showText: {},
  crossCompare: {},
  prevFrameState: {},
  nextId: 1,
  reorderFid: null,
  verReorderFid: null,
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
  useStore.setState({
    frames: [],
    versions: {},
    activeTab: {},
    drawColor: {},
    drawWidth: {},
    drawEraser: {},
    drawActive: {},
    showText: {},
    crossCompare: {},
    prevFrameState: {},
    nextId: 1,
    reorderFid: null,
    verReorderFid: null,
    stripClipboard: null,
    imgTarget: null,
    mainImgTarget: null,
    renderTick: state().renderTick + 1,
  });
}

// Touch detection — used in many places.
export const isTouch = matchMedia('(hover:none) and (pointer:coarse)').matches;

// Re-export so imperative modules can pick this up alongside state.
export { COLORS };

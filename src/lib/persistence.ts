// Single-key IndexedDB store for "the user's current unsaved project".
// Spec: there is only ever one unsaved project at a time, and it must
// survive browser restarts so a returning user can be reminded to save.
//
// We only persist the storyboard payload (frames + per-frame versions /
// active tab) — UI-only state (drawActive, hover, etc.) is omitted. On
// restore we merge the payload back into the live store.

import type { Frame, Version, FrameGroup, StripDef, Setup } from '../store/state';
import { useStore, DEFAULT_STRIP_DEFS } from '../store/state';

const DB_NAME = 'framehow';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const KEY = 'currentProject';

export interface CurrentProjectSnapshot {
  /** Set once the project has been saved to the cloud. Null = never saved. */
  projectId: string | null;
  /** User-chosen project name, or null if not yet named. */
  name: string | null;
  /** Wall-clock ms of last local edit. */
  lastModified: number;
  /** Storyboard payload — minimal subset of FrameHowState. */
  frames: Frame[];
  versions: Record<number, Version[]>;
  activeTab: Record<number, number>;
  nextId: number;
  portraitMode?: boolean;
  groups?: FrameGroup[];
  nextGroupId?: number;
  /** Generic strip data (v4.1+) */
  stripVersions?: Record<string, Record<number, Version[]>>;
  stripActiveTab?: Record<string, Record<number, number>>;
  /** Legacy fields — kept for backward compat when loading old snapshots */
  floorVersions?: Record<number, Version[]>;
  floorActiveTab?: Record<number, number>;
  refsVersions?: Record<number, Version[]>;
  refsActiveTab?: Record<number, number>;
  /** Strip definitions (v4.0+) */
  stripDefs?: StripDef[];
  /** Setups — colour-coded labels (v4.6+) */
  setups?: Setup[];
  nextSetupId?: number;
  /** Whether the strip-tag confirmation overlay has been dismissed */
  stripTagInfoDismissed?: boolean;
  /** Copies the user manually removed via untag — prevents recreation */
  dismissedCopies?: Record<string, boolean>;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSnapshot(snap: CurrentProjectSnapshot): Promise<void> {
  await withStore('readwrite', (s) => s.put(snap, KEY));
}

export async function loadSnapshot(): Promise<CurrentProjectSnapshot | null> {
  try {
    const value = await withStore('readonly', (s) => s.get(KEY));
    return (value as CurrentProjectSnapshot | undefined) ?? null;
  } catch (e) {
    console.warn('[persistence] loadSnapshot failed', e);
    return null;
  }
}

export async function clearSnapshot(): Promise<void> {
  await withStore('readwrite', (s) => s.delete(KEY));
}

/**
 * Snapshot what we care about from the live store. Called by the autosave
 * scheduler in currentProject.ts.
 */
export function snapshotFromStore(projectId: string | null, name: string | null): CurrentProjectSnapshot {
  const s = useStore.getState();
  return {
    projectId,
    name,
    lastModified: Date.now(),
    frames: s.frames,
    versions: s.stripVersions.ver || {},
    activeTab: s.stripActiveTab.ver || {},
    nextId: s.nextId,
    portraitMode: s.portraitMode,
    groups: s.groups,
    nextGroupId: s.nextGroupId,
    stripVersions: s.stripVersions,
    stripActiveTab: s.stripActiveTab,
    // Legacy fields for backward compat when loading on older versions
    floorVersions: s.stripVersions.floor || {},
    floorActiveTab: s.stripActiveTab.floor || {},
    refsVersions: s.stripVersions.refs || {},
    refsActiveTab: s.stripActiveTab.refs || {},
    stripDefs: s.stripDefs,
    setups: s.setups,
    nextSetupId: s.nextSetupId,
    stripTagInfoDismissed: s.stripTagInfoDismissed || undefined,
    dismissedCopies: Object.keys(s.dismissedCopies).length > 0 ? s.dismissedCopies : undefined,
  };
}

/**
 * Apply a previously-saved snapshot back into the live store. UI state is
 * left at its defaults; the renderer will redraw from the restored data.
 */
export function applySnapshotToStore(snap: CurrentProjectSnapshot): void {
  // Migrate old per-field strip labels to consolidated stripLabels map
  for (const f of snap.frames) {
    const old = f as any;
    if (old.versionLabel || old.floorLabel || old.refsLabel) {
      if (!f.stripLabels) f.stripLabels = {};
      if (old.versionLabel) { f.stripLabels.ver = old.versionLabel; delete old.versionLabel; }
      if (old.floorLabel) { f.stripLabels.floor = old.floorLabel; delete old.floorLabel; }
      if (old.refsLabel) { f.stripLabels.refs = old.refsLabel; delete old.refsLabel; }
    }
  }

  // Build generic strip maps — prefer new format, fall back to legacy fields
  const verVersions = snap.stripVersions?.ver || snap.versions || {};
  const verActiveTab = snap.stripActiveTab?.ver || snap.activeTab || {};
  const floorVersions = snap.stripVersions?.floor || snap.floorVersions || {};
  const floorActiveTab = snap.stripActiveTab?.floor || snap.floorActiveTab || {};
  const refsVersions = snap.stripVersions?.refs || snap.refsVersions || {};
  const refsActiveTab = snap.stripActiveTab?.refs || snap.refsActiveTab || {};
  // IMPORTANT: Legacy aliases must reference the SAME objects as stripXxx maps.
  const verCC: Record<number, number> = {};
  const floorCC: Record<number, number> = {};
  const refsCC: Record<number, number> = {};
  const verPFS: Record<number, any> = {};
  const floorPFS: Record<number, any> = {};
  const refsPFS: Record<number, any> = {};

  useStore.setState((prev) => ({
    frames: snap.frames,
    // Generic maps
    stripVersions: { ver: verVersions, floor: floorVersions, refs: refsVersions },
    stripActiveTab: { ver: verActiveTab, floor: floorActiveTab, refs: refsActiveTab },
    stripCrossCompare: { ver: verCC, floor: floorCC, refs: refsCC },
    stripPrevFrameState: { ver: verPFS, floor: floorPFS, refs: refsPFS },
    // Legacy aliases (SAME objects as above)
    versions: verVersions,
    activeTab: verActiveTab,
    crossCompare: verCC,
    prevFrameState: verPFS,
    floorVersions,
    floorActiveTab,
    floorCrossCompare: floorCC,
    floorPrevFrameState: floorPFS,
    refsVersions,
    refsActiveTab,
    refsCrossCompare: refsCC,
    refsPrevFrameState: refsPFS,
    nextId: snap.nextId,
    portraitMode: snap.portraitMode ?? false,
    groups: snap.groups ?? [],
    nextGroupId: snap.nextGroupId ?? 1,
    stripDefs: snap.stripDefs ?? DEFAULT_STRIP_DEFS,
    setups: snap.setups ?? [],
    nextSetupId: snap.nextSetupId ?? 1,
    stripTagInfoDismissed: snap.stripTagInfoDismissed ?? false,
    dismissedCopies: snap.dismissedCopies ?? {},
    renderTick: prev.renderTick + 1,
  }));
}

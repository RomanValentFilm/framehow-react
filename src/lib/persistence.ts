// Single-key IndexedDB store for "the user's current unsaved project".
// Spec: there is only ever one unsaved project at a time, and it must
// survive browser restarts so a returning user can be reminded to save.
//
// We only persist the storyboard payload (frames + per-frame versions /
// active tab) — UI-only state (drawActive, hover, etc.) is omitted. On
// restore we merge the payload back into the live store.

import type { Frame, Version, FrameGroup } from '../store/state';
import { useStore } from '../store/state';

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
    versions: s.versions,
    activeTab: s.activeTab,
    nextId: s.nextId,
    portraitMode: s.portraitMode,
    groups: s.groups,
    nextGroupId: s.nextGroupId,
  };
}

/**
 * Apply a previously-saved snapshot back into the live store. UI state is
 * left at its defaults; the renderer will redraw from the restored data.
 */
export function applySnapshotToStore(snap: CurrentProjectSnapshot): void {
  useStore.setState((prev) => ({
    frames: snap.frames,
    versions: snap.versions,
    activeTab: snap.activeTab,
    nextId: snap.nextId,
    portraitMode: snap.portraitMode ?? false,
    groups: snap.groups ?? [],
    nextGroupId: snap.nextGroupId ?? 1,
    renderTick: prev.renderTick + 1,
  }));
}

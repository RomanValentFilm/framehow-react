// Single-key IndexedDB store for "the user's current unsaved project".
// Spec: there is only ever one unsaved project at a time, and it must
// survive browser restarts so a returning user can be reminded to save.
//
// We only persist the storyboard payload (frames + per-frame versions /
// active tab) — UI-only state (drawActive, hover, etc.) is omitted. On
// restore we merge the payload back into the live store.

import type { Frame, Version, FrameGroup, StripDef, Setup, NeedDefinitions, FrameNeedState, FrameNoteState, SortOrder, SortBreak, ProjectType } from '../store/state';
import { useStore, DEFAULT_STRIP_DEFS, DEFAULT_NEED_DEFINITIONS, migrateNeedDefinitions, createDefaultExportMeta } from '../store/state';

const DB_NAME = 'framehow';
const DB_VERSION = 2;
const STORE_NAME = 'state';
const KEY = 'currentProject';
/** Projects with work that has NOT been confirmed by the server yet.
 *  One record per project, keyed by project id — so opening a second project
 *  can never overwrite the unsent work of the first. */
const PENDING_STORE = 'pending';

export interface CurrentProjectSnapshot {
  /** Set once the project has been saved to the cloud. Null = never saved. */
  projectId: string | null;
  /** User-chosen project name, or null if not yet named. */
  name: string | null;
  /** Wall-clock ms of last local edit. */
  lastModified: number;
  /** Server ids of frames changed here but not yet confirmed by the server.
   *  Kept with the snapshot because this is what stops a cloud pull from
   *  overwriting local edits — and it used to live only in memory, so closing
   *  the app threw it away and the next pull replaced offline work. */
  dirtyFrameIds?: string[];
  /** What was last successfully sent to the server, per frame. Remembering
   *  this across a restart is what stops the app pushing the whole project
   *  every time it opens — which made every other device pull for nothing. */
  pushedFingerprints?: Record<string, string>;
  /** This project's identity ON THIS DEVICE. Restored on boot so a project
   *  that has never reached the cloud keeps the same key across restarts —
   *  otherwise reopening it would file the same work a second time. */
  localId?: string;
  /** Storyboard payload — minimal subset of FrameHowState. */
  frames: Frame[];
  versions: Record<number, Version[]>;
  activeTab: Record<number, number>;
  nextId: number;
  portraitMode?: boolean;
  projectType?: ProjectType;
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
  /** Whether the strip-untag confirmation overlay has been dismissed */
  stripUntagInfoDismissed?: boolean;
  /** NEEDS strip — project-wide definitions (v4.9+) */
  needDefinitions?: NeedDefinitions;
  /** NEEDS strip — per-frame state keyed by local frame id (v4.9+) */
  frameNeeds?: Record<number, FrameNeedState>;
  /** NOTES strip — per-frame note state (v4.9+) */
  frameNotes?: Record<number, FrameNoteState>;
  /** Sort orders — custom frame orderings (v4.9+) */
  sortOrders?: SortOrder[];
  nextSortOrderId?: number;
  activeSortOrderId?: string | null;
  /** Story flow breaks — section dividers in default view (v4.9+) */
  storyFlowBreaks?: SortBreak[];
  /** Camera guide aspect ratio preset (v4.9+) */
  camAspectRatio?: string;
  /** Export header fields (v4.9+) */
  exportMeta?: import('../store/state').ExportMeta;
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
      if (!db.objectStoreNames.contains(PENDING_STORE)) {
        db.createObjectStore(PENDING_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, storeName = STORE_NAME): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
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
    projectType: s.projectType,
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
    stripUntagInfoDismissed: s.stripUntagInfoDismissed || undefined,
    needDefinitions: s.needDefinitions,
    frameNeeds: s.frameNeeds,
    frameNotes: s.frameNotes,
    sortOrders: s.sortOrders.length > 0 ? s.sortOrders : undefined,
    nextSortOrderId: s.nextSortOrderId > 1 ? s.nextSortOrderId : undefined,
    activeSortOrderId: s.activeSortOrderId ?? undefined,
    storyFlowBreaks: s.storyFlowBreaks?.length > 0 ? s.storyFlowBreaks : undefined,
    camAspectRatio: s.camAspectRatio !== 'canvas' ? s.camAspectRatio : undefined,
    exportMeta: s.exportMeta && Object.values(s.exportMeta).some((v) => v) ? s.exportMeta : undefined,
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
    portraitMode: snap.portraitMode ?? (snap.projectType ? snap.projectType !== 'landscape' : false),
    projectType: snap.projectType ?? (snap.portraitMode ? 'portrait' : 'landscape'),
    groups: snap.groups ?? [],
    nextGroupId: snap.nextGroupId ?? 1,
    stripDefs: snap.stripDefs ?? DEFAULT_STRIP_DEFS,
    setups: snap.setups ?? [],
    nextSetupId: snap.nextSetupId ?? 1,
    stripTagInfoDismissed: snap.stripTagInfoDismissed ?? false,
    stripUntagInfoDismissed: snap.stripUntagInfoDismissed ?? false,
    needDefinitions: migrateNeedDefinitions(snap.needDefinitions ?? DEFAULT_NEED_DEFINITIONS),
    frameNeeds: snap.frameNeeds ?? {},
    frameNotes: snap.frameNotes ?? {},
    sortOrders: snap.sortOrders ?? [],
    nextSortOrderId: snap.nextSortOrderId ?? 1,
    activeSortOrderId: snap.activeSortOrderId ?? null,
    storyFlowBreaks: snap.storyFlowBreaks ?? [],
    camAspectRatio: (snap.camAspectRatio as any) ?? 'canvas',
    exportMeta: snap.exportMeta ?? createDefaultExportMeta(),
    renderTick: prev.renderTick + 1,
  }));
}

// ---------------------------------------------------------------------------
// Unsent work — projects whose changes the server has NOT confirmed.
//
// These are kept per project, so starting or opening another project can never
// overwrite work that has not reached the cloud. A record is removed ONLY when
// the server has confirmed it has the changes; nothing else deletes it.
// ---------------------------------------------------------------------------

export interface PendingRecord {
  /** The key this record is filed under — its cloud id, or its device-only id. */
  key: string;
  /** Project id, or null for a project never yet saved to the cloud. */
  projectId: string | null;
  name: string | null;
  /** When the last change was made on this device. */
  savedAt: number;
  /** The one-time "you are offline" notice has been shown for this project. */
  warned?: boolean;
  /** When the user deleted this copy. It is kept, greyed out and recoverable,
   *  for 24 hours — the same grace a deleted project gets. */
  deletedAt?: number;
  /** When the server confirmed it has this work. The copy is then kept for a
   *  further 24 hours as a safety net before being removed. */
  uploadedAt?: number;
  snapshot: CurrentProjectSnapshot;
}

/** Key a project is filed under while its work is unsent. */
export async function savePending(key: string, projectId: string | null, name: string | null,
                                  snapshot: CurrentProjectSnapshot): Promise<boolean> {
  // An empty snapshot must NEVER replace real work. The store is momentarily
  // empty while switching or starting a project, and a save landing in that
  // window would otherwise wipe the copy this whole system exists to protect.
  if (!snapshot?.frames?.length) return false;

  const existing = await getPending(key);
  const rec: PendingRecord = {
    key, projectId, name, savedAt: Date.now(), snapshot,
    warned: existing?.warned ?? false,
  };
  await withStore('readwrite', (s) => s.put(rec, key), PENDING_STORE);
  return !rec.warned;   // true = the user has not been told about this one yet
}

/** Remember that the one-time notice has been shown, so it is not repeated. */
export async function markPendingWarned(key: string): Promise<void> {
  const rec = await getPending(key);
  if (!rec || rec.warned) return;
  rec.warned = true;
  await withStore('readwrite', (s) => s.put(rec, key), PENDING_STORE);
}

/** How long a confirmed copy is kept on the device as a safety net. The most
 *  recent copy of each project is held longer — it is the one most likely to
 *  be wanted, and by then the older two have served their purpose. */
export const UPLOADED_GRACE_MS = 24 * 60 * 60 * 1000;
export const NEWEST_GRACE_MS = 72 * 60 * 60 * 1000;

/**
 * The server has confirmed it has this work. The copy is NOT deleted yet — it
 * is stamped and kept for a further 24 hours, then swept.
 */
export async function markPendingUploaded(key: string): Promise<void> {
  const rec = await getPending(key);
  if (!rec || rec.uploadedAt) return;
  // Move it to an archive key of its own. Carrying on working — online or not
  // — writes to the live key, so the copy as it stood when it was offline is
  // never overwritten, only swept once its 24 hours are up.
  const archived: PendingRecord = { ...rec, key: `archive:${key}:${Date.now()}`, uploadedAt: Date.now() };
  await withStore('readwrite', (s) => s.put(archived, archived.key), PENDING_STORE);
  await clearPending(key);

  // A flaky connection can produce one archive per offline stretch, each a full
  // copy including photos. Keep only the most recent few per project.
  const all = await listPending();
  const mine = all
    .filter((r) => r.key.startsWith(`archive:${key}:`))
    .sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
  for (const old of mine.slice(MAX_ARCHIVES_PER_PROJECT)) await clearPending(old.key);
}

/** How many "as it stood when it finally uploaded" copies to keep per project. */
export const MAX_ARCHIVES_PER_PROJECT = 3;

/** True for a copy kept purely as a safety net — not work awaiting upload. */
export function isArchived(rec: PendingRecord): boolean {
  return !!rec.uploadedAt || rec.key.startsWith('archive:');
}

/** Remove confirmed copies once their 24 hours are up. */
export async function sweepUploaded(): Promise<void> {
  try {
    const recs = await listPending();
    const now = Date.now();

    // Newest copy per project first, so it can be given the longer window.
    const byProject = new Map<string, PendingRecord[]>();
    for (const r of recs) {
      if (!r.uploadedAt || r.deletedAt) continue;
      const base = r.key.replace(/^archive:/, '').replace(/:\d+$/, '');
      const list = byProject.get(base) ?? [];
      list.push(r);
      byProject.set(base, list);
    }

    // Deleted copies go for good once their 24 hours are up.
    for (const r of recs) {
      if (r.deletedAt && now - r.deletedAt > UPLOADED_GRACE_MS) await clearPending(r.key);
    }

    for (const list of byProject.values()) {
      list.sort((a, b) => (b.uploadedAt ?? 0) - (a.uploadedAt ?? 0));
      for (let i = 0; i < list.length; i++) {
        const grace = i === 0 ? NEWEST_GRACE_MS : UPLOADED_GRACE_MS;
        if (now - (list[i].uploadedAt ?? 0) > grace) await clearPending(list[i].key);
      }
    }
  } catch { /* nothing to sweep */ }
}

/** Called only after the server has confirmed it has the changes. */
export async function clearPending(key: string): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(key), PENDING_STORE);
  } catch (e) {
    console.warn('[persistence] clearPending failed', e);
  }
}

export async function listPending(): Promise<PendingRecord[]> {
  try {
    const values = await withStore<any[]>('readonly', (s) => s.getAll(), PENDING_STORE);
    return (values as PendingRecord[]) ?? [];
  } catch (e) {
    console.warn('[persistence] listPending failed', e);
    return [];
  }
}

export async function getPending(key: string): Promise<PendingRecord | null> {
  try {
    const v = await withStore('readonly', (s) => s.get(key), PENDING_STORE);
    return (v as PendingRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Last-known project list, so the list is not empty when there is no
// connection. These are cloud projects: they can be SEEN offline but not
// opened, because their contents live on the server.
// ---------------------------------------------------------------------------

const PROJECT_LIST_KEY = 'projectListCache';

export async function saveProjectListCache(list: unknown[]): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.put(list, PROJECT_LIST_KEY));
  } catch { /* cache is a convenience, never critical */ }
}

export async function loadProjectListCache<T>(): Promise<T[]> {
  try {
    const v = await withStore('readonly', (s) => s.get(PROJECT_LIST_KEY));
    return (v as T[] | undefined) ?? [];
  } catch {
    return [];
  }
}

/**
 * Delete an offline copy — but keep it for 24 hours so it can be recovered,
 * exactly as a deleted project can. Only the sweep removes it for good.
 */
export async function deletePending(key: string): Promise<void> {
  const rec = await getPending(key);
  if (!rec) return;
  rec.deletedAt = Date.now();
  await withStore('readwrite', (s) => s.put(rec, key), PENDING_STORE);
}

/** Undo a deletion made within the last 24 hours. */
export async function recoverPending(key: string): Promise<void> {
  const rec = await getPending(key);
  if (!rec?.deletedAt) return;
  delete rec.deletedAt;
  // Give it its window back. Its clock kept running while it sat deleted, so
  // a copy recovered late would otherwise be swept moments later.
  if (rec.uploadedAt) rec.uploadedAt = Date.now();
  await withStore('readwrite', (s) => s.put(rec, key), PENDING_STORE);
}

/** True for a copy the user deleted. Hidden unless the list is in Edit mode. */
export function isDeletedCopy(rec: PendingRecord): boolean {
  return !!rec.deletedAt;
}

/**
 * Ask the browser to treat this site's storage as durable.
 *
 * Without it, iOS clears everything a site has stored after about a week
 * without a visit — which would take offline projects with it. Safari grants
 * this readily once Framehow has been added to the Home Screen, and ignores it
 * otherwise, so it is safe to ask on every start.
 */
export async function requestDurableStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** Roughly how much room the device is willing to give us, in bytes. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
  } catch {
    return null;
  }
}

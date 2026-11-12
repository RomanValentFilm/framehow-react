// Single-key IndexedDB store for "the user's current unsaved project".
// Spec: there is only ever one unsaved project at a time, and it must
// survive browser restarts so a returning user can be reminded to save.
//
// We only persist the storyboard payload (frames + per-frame versions /
// active tab) — UI-only state (drawActive, hover, etc.) is omitted. On
// restore we merge the payload back into the live store.

import type { Frame, Version, FrameGroup, StripDef, ColumnName, Setup, NeedDefinitions, FrameNeedState, FrameNoteState, SortOrder, SortBreak, ProjectType } from '../store/state';
import { useStore, DEFAULT_STRIP_DEFS, DEFAULT_COLUMN_NAMES, freshNeedDefinitions, migrateNeedDefinitions, createDefaultExportMeta } from '../store/state';

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
  /** When each project setting last changed, so a restart does not forget and
   *  start claiming every setting is new. */
  settingStamps?: Array<{ kind: string; item_id: string; value: string | null; changed_at: number; deleted_at: number | null;
    /** What the server had confirmed when this was saved. Without it, a restart
     *  forgets WHICH settings are still unsent and an offline rename never
     *  travels (#267). */
    base_changed_at?: number }>;
  /** When each frame and version was last changed on this device, so being
   *  offline across a restart still orders edits honestly. */
  contentStamps?: Record<string, { fp: string; at: number }>;
  /** The pen colour, so red is still red after a restart (#336). */
  penColor?: string;
  /** Deletions made here that the server has not taken yet (#327).
   *
   *  These lived only in memory. Delete a frame while offline, close the app
   *  before it reached the server, and the frame was gone from this device AND
   *  the record of the deletion was gone with it — so the next pull brought it
   *  back from the cloud, and nothing objected, because the safety checks only
   *  guard frames going missing, never frames returning.
   *
   *  "Deleting is final" cannot survive a restart without this. */
  pendingTombstones?: Array<{
    id: string; entity_type: 'frame' | 'version'; entity_id: string;
    deleted_at: number; device_id: string;
  }>;
  /** The SERVER's clock as of the last answer this device received (#284).
   *
   *  Saved with the project so that reopening the app does not throw away the
   *  one fact needed to ask "what changed since?". Without it the first pull
   *  after every restart asked for the whole project — every frame, version and
   *  picture — to learn that nothing had happened. */
  heardAt?: number;
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
  columnNames?: ColumnName[];
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
    req.onsuccess = () => {
      // iOS closes the database behind the app's back (the native camera on
      // top, the app in the background). A closed one is forgotten, so the
      // next save opens a fresh one (11 Nov: "The database connection is
      // closing", then COULD NOT SAVE ON THIS DEVICE after a photo).
      req.result.onclose = () => { dbPromise = null; };
      req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
      resolve(req.result);
    };
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

/** FOR THE SIMULATOR: close the database the way iOS does behind the app's
 *  back, leaving the app holding a dead one (11 Nov). */
export async function closeDbAsIosDoes(): Promise<void> { (await openDb()).close(); }

/** The database was closed under us — worth one more try on a fresh one. */
export function closedUnderUs(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name ?? '';
  const msg = String((e as { message?: string } | null)?.message ?? e ?? '');
  return name === 'InvalidStateError' || /clos|connection.*lost|server lost/i.test(msg);
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>, storeName = STORE_NAME): Promise<T> {
  const once = async (): Promise<T> => {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error ?? new Error('the save was closed before it finished'));
    });
  };
  try { return await once(); }
  catch (e) {
    if (!closedUnderUs(e)) throw e;
    dbPromise = null;
    return once();
  }
}

/** WHICH project the device's save is of, and which pictures it names, kept
 *  beside it in a few bytes — so asking "whose is it?" does not read the whole
 *  project (12 Nov: a start read the open project twice, once only for its id). */
const KEY_WHOSE = 'currentProjectWhose';
type Whose = { projectId: string | null; pics?: string[] };

// One save or clear at a time, in the order asked: a save is several steps now
// (the pictures first, then the project that names them).
let _saveLine: Promise<unknown> = Promise.resolve();
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const mine = _saveLine.then(work, work);
  _saveLine = mine.catch(() => undefined);
  return mine;
}

const say = (line: string): void => { void import('./syncTrace').then(({ trace }) => trace(line)); };

/**
 * THE PROJECT IS SAVED WITHOUT ITS PICTURES INSIDE IT (12 Nov, picStore.ts has
 * the whole story). Each picture goes onto the device once, by itself; the
 * save names it. The save is written only after every picture it names is
 * there.
 */
let _lastSaveWasWhole = false;
/** The last save had to be written whole, pictures inside (the pictures could
 *  not be filed by themselves). The caller saves again a little later, so a
 *  save does not stay whole just because nothing changed afterwards (Roman,
 *  12 Nov: "and what then? does it stay whole?"). */
export function lastSaveWasWhole(): boolean { return _lastSaveWasWhole; }

export function saveSnapshot(snap: CurrentProjectSnapshot): Promise<void> {
  return inTurn(async () => {
    const { takePicturesOut } = await import('./picStore');
    // IF THE PICTURES CANNOT BE FILED BY THEMSELVES, THE SAVE IS WRITTEN WHOLE,
    // AS IT ALWAYS WAS — a save must never fail because of the tidier way.
    _lastSaveWasWhole = false;
    const out = await takePicturesOut(snap).catch((e) => {
      say(`  the pictures could not be put on the device by themselves (${String((e as Error)?.message ?? e)}) — this save is written whole`);
      _lastSaveWasWhole = true;
      return { light: snap, names: [] as string[], written: 0 };
    });
    if (out.written > 0) say(`  ${out.written} picture(s) put on this device, each by itself (the save names ${out.names.length})`);
    await withStore('readwrite', (s) => {
      s.put({ projectId: snap.projectId ?? null, pics: out.names } satisfies Whose, KEY_WHOSE);
      return s.put(out.light, KEY);
    });
    void tidyPictures();
  });
}

/** FOR THE SIMULATOR: the save exactly as it lies on the device (its pictures named, not inside). */
export async function rawSaveForTest(): Promise<unknown> {
  return withStore('readonly', (s) => s.get(KEY));
}

/** The cloud id of the project saved on this device (null: none, or not in the cloud). */
export async function savedProjectId(): Promise<string | null> {
  try {
    const w = await withStore('readonly', (s) => s.get(KEY_WHOSE)) as Whose | undefined;
    if (w) return w.projectId ?? null;
    return ((await withStore('readonly', (s) => s.get(KEY))) as CurrentProjectSnapshot | undefined)?.projectId ?? null;   // a save from before this note existed
  } catch { return null; }
}

export async function loadSnapshot(): Promise<CurrentProjectSnapshot | null> {
  try {
    const value = (await withStore('readonly', (s) => s.get(KEY))) as CurrentProjectSnapshot | undefined;
    if (!value) return null;
    const { putPicturesBack } = await import('./picStore');
    // once more after a moment if the pictures cannot be read (iOS's storage
    // process restarting) — a start with the project but without its pictures
    // must not be the answer to a hiccup
    const back = await putPicturesBack(value).catch(async () => {
      await new Promise((r) => setTimeout(r, 600));
      return putPicturesBack(value);
    });
    if (back.missing > 0) say(`THE SAVE ON THIS DEVICE NAMES ${back.missing} PICTURE(S) THAT ARE NOT ON THE DEVICE — those places are empty until the server sends them`);
    return back.whole;
  } catch (e) {
    console.warn('[persistence] loadSnapshot failed', e);
    return null;
  }
}

export function clearSnapshot(): Promise<void> {
  return inTurn(async () => {
    await withStore('readwrite', (s) => { s.delete(KEY_WHOSE); return s.delete(KEY); });
  });
}

/**
 * PICTURES NOTHING NAMES ANY MORE GO. Named = by the save of the open project,
 * or by any copy kept on the device. If either list cannot be read for
 * certain, nothing is removed. (And picStore removes a picture only at the
 * second look that finds it unnamed.)
 */
async function tidyPictures(now = false): Promise<void> {
  try {
    if (!now && !(await picStore()).dueForALook()) return;
    const named = new Set<string>();
    const whose = (await withStore('readonly', (s) => s.get(KEY_WHOSE))) as Whose | undefined;
    const hasSave = (await withStore<IDBValidKey | undefined>('readonly', (s) => s.getKey(KEY))) !== undefined;
    if (hasSave && !whose?.pics) return;                 // a save from before the pictures were named: not certain
    for (const n of whose?.pics ?? []) named.add(n);
    const copies = await pendingPicNames();
    if (!copies) return;                                 // the list of copies is not certain
    for (const n of copies) named.add(n);
    const { removeUnnamedPictures } = await import('./picStore');
    const gone = await removeUnnamedPictures(named, now);
    if (gone > 0) say(`  ${gone} picture(s) nothing names any more removed from this device`);
  } catch { /* another time */ }
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
    penColor: s.penColor,          // red stays red across a restart (#336)
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
    columnNames: s.columnNames,
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
    columnNames: snap.columnNames ?? DEFAULT_COLUMN_NAMES,
    setups: snap.setups ?? [],
    nextSetupId: snap.nextSetupId ?? 1,
    stripTagInfoDismissed: snap.stripTagInfoDismissed ?? false,
    stripUntagInfoDismissed: snap.stripUntagInfoDismissed ?? false,
    needDefinitions: migrateNeedDefinitions(snap.needDefinitions ?? freshNeedDefinitions()),
    ...(snap.penColor ? { penColor: snap.penColor } : {}),
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
  /** PARKED (12 Oct, Roman): the server answered that this project is not
   *  there any more (deleted, or purged for good). The copy stays on the
   *  device and in the project list — save as new, or Delete now — but it is
   *  never sent on its own again. Before this, a start tried it first every
   *  time, failed every time, and left the screen empty. */
  parkedAt?: number;
  snapshot: CurrentProjectSnapshot;
}

/** WHAT IS KNOWN ABOUT A COPY WITHOUT OPENING IT (12 Nov). A copy is a whole
 *  project, pictures and all. Listing the copies used to read every one of
 *  them in full — at each start three times, and again whenever the project
 *  list opened; on Roman's phone that was nine copies, two of them a 26-shot
 *  project with hundreds of photos (656 MB on the device), and the page fell
 *  over. The list is now kept apart, a few words per copy; a copy itself is
 *  read only when it is really needed, one at a time (getPending). */
export type PendingMeta = Omit<PendingRecord, 'snapshot'> & {
  /** how many shots the copy holds */
  frames: number;
  /** it carries change times — a copy without them is never sent on its own */
  stamped: boolean;
  /** the pictures it names (picStore) — none for a copy from before 12 Nov, which holds its pictures itself */
  pics?: string[];
};

/** THE LIST LIVES WITH THE COPIES, under a name of its own — it stays when a
 *  logout empties the project cache and goes when the copies go. It is shaped
 *  like an empty copy deleted long ago, so a page from before this change that
 *  meets it sees nothing to show and sweeps it; the next listing here makes it
 *  again. No copies, no list. */
const PENDING_INDEX_KEY = '__index';
type PendingIndex = Record<string, PendingMeta>;
type IndexRecord = PendingRecord & { index: PendingIndex };
const indexRecord = (index: PendingIndex): IndexRecord => ({
  key: PENDING_INDEX_KEY, projectId: null, name: null, savedAt: 0, deletedAt: 1,
  snapshot: { frames: [] } as unknown as CurrentProjectSnapshot, index,
});
const readIndex = (v: unknown): PendingIndex => ({ ...((v as IndexRecord | undefined)?.index ?? {}) });

function metaOf(rec: PendingRecord, pics?: string[]): PendingMeta {
  const { snapshot, ...rest } = rec;
  return {
    ...rest,
    frames: snapshot?.frames?.length ?? 0,
    stamped: !!snapshot?.contentStamps && Object.keys(snapshot.contentStamps).length > 0,
    pics: pics ?? _namesIn?.(snapshot) ?? [],
  };
}
// picStore's namesIn, once it has been loaded (it always has been by the time a
// light copy exists: taking the pictures out is what makes a copy light)
let _namesIn: ((light: unknown) => string[]) | null = null;
async function picStore(): Promise<typeof import('./picStore')> {
  const m = await import('./picStore');
  _namesIn = m.namesIn;
  return m;
}

/** The pictures the copies on this device name — null when that is not certain. */
async function pendingPicNames(): Promise<Set<string> | null> {
  await picStore();
  const v = await withStore('readonly', (s) => s.get(PENDING_INDEX_KEY), PENDING_STORE);
  const list = readIndex(v);
  const keys = await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys(), PENDING_STORE);
  const names = (keys ?? []).map(String).filter((k) => k !== PENDING_INDEX_KEY);
  if (!names.every((k) => list[k] && Array.isArray(list[k].pics))) return null;
  const out = new Set<string>();
  for (const k of names) for (const n of list[k].pics ?? []) out.add(n);
  return out;
}

/** One step on the database with the copies, tried once more on a database iOS closed. */
async function onCopies<T>(mode: IDBTransactionMode, work: (copies: IDBObjectStore, done: (v: T) => void) => void): Promise<T> {
  const once = async (): Promise<T> => {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(PENDING_STORE, mode);
      let out!: T;
      work(tx.objectStore(PENDING_STORE), (v) => { out = v; });
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('the save was closed before it finished'));
    });
  };
  try { return await once(); }
  catch (e) {
    if (!closedUnderUs(e)) throw e;
    dbPromise = null;
    return once();
  }
}

/** FOR THE SIMULATOR: the names in the list of copies, and the names in the store. */
export async function pendingIndexAndStore(): Promise<{ list: string[]; store: string[] }> {
  const v = await withStore('readonly', (s) => s.get(PENDING_INDEX_KEY), PENDING_STORE);
  return { list: Object.keys(readIndex(v)).sort(), store: (await pendingKeys()).sort() };
}

/** A copy is written (or removed) and the list with it: both or neither. */
async function writePending(key: string, rec: PendingRecord | null): Promise<void> {
  await picStore();
  await onCopies<void>('readwrite', (copies) => {
    if (rec) copies.put(rec, key); else copies.delete(key);
    const read = copies.get(PENDING_INDEX_KEY);
    read.onsuccess = () => {
      const index = readIndex(read.result);
      if (rec) index[key] = metaOf(rec); else delete index[key];
      if (Object.keys(index).length) copies.put(indexRecord(index), PENDING_INDEX_KEY);
      else copies.delete(PENDING_INDEX_KEY);
    };
  });
}

export async function markPendingParked(key: string): Promise<void> {
  const rec = await getPendingRaw(key);
  if (!rec || rec.parkedAt) return;
  rec.parkedAt = Date.now();
  await writePending(key, rec);
}

/** Key a project is filed under while its work is unsent. */
export async function savePending(key: string, projectId: string | null, name: string | null,
                                  snapshot: CurrentProjectSnapshot): Promise<boolean> {
  // An empty snapshot must NEVER replace real work. The store is momentarily
  // empty while switching or starting a project, and a save landing in that
  // window would otherwise wipe the copy this whole system exists to protect.
  if (!snapshot?.frames?.length) return false;

  // what is already known about a copy under this name — from the list, without
  // opening the copy (it is about to be written over anyway)
  const noted = readIndex(await withStore('readonly', (s) => s.get(PENDING_INDEX_KEY), PENDING_STORE).catch(() => undefined))[key];
  const existing: { warned?: boolean; parkedAt?: number } | null = noted ?? await getPendingRaw(key);
  // THE COPY NAMES ITS PICTURES, IT DOES NOT HOLD THEM (12 Nov): they go onto
  // the device once, by themselves; three safety copies share one set.
  const out = await (await picStore()).takePicturesOut(snapshot)
    .catch(() => ({ light: snapshot, names: [] as string[], written: 0 }));   // not by themselves, then whole — never not at all
  const rec: PendingRecord = {
    key, projectId, name, savedAt: Date.now(), snapshot: out.light,
    warned: existing?.warned ?? false,
    ...(existing?.parkedAt ? { parkedAt: existing.parkedAt } : {}),
  };
  await writePending(key, rec);
  return !rec.warned;   // true = the user has not been told about this one yet
}

/** Remember that the one-time notice has been shown, so it is not repeated. */
export async function markPendingWarned(key: string): Promise<void> {
  const rec = await getPendingRaw(key);
  if (!rec || rec.warned) return;
  rec.warned = true;
  await writePending(key, rec);
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
  const rec = await getPendingRaw(key);
  if (!rec || rec.uploadedAt) return;
  // Move it to an archive key of its own. Carrying on working — online or not
  // — writes to the live key, so the copy as it stood when it was offline is
  // never overwritten, only swept once its 24 hours are up.
  const archived: PendingRecord = { ...rec, key: `archive:${key}:${Date.now()}`, uploadedAt: Date.now() };
  await writePending(archived.key, archived);
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
export function isArchived(rec: { uploadedAt?: number; key: string }): boolean {
  return !!rec.uploadedAt || rec.key.startsWith('archive:');
}

/** Remove confirmed copies once their 24 hours are up. */
export async function sweepUploaded(): Promise<void> {
  try {
    const recs = await listPending();
    const now = Date.now();

    // Newest copy per project first, so it can be given the longer window.
    const byProject = new Map<string, PendingMeta[]>();
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
    await writePending(key, null);
  } catch (e) {
    console.warn('[persistence] clearPending failed', e);
  }
}

/** Only the NAMES the copies are filed under — nothing of their contents is
 *  read (12 Nov: a start read every whole copy, pictures and all, three times). */
export async function pendingKeys(): Promise<string[]> {
  try {
    return ((await withStore<IDBValidKey[]>('readonly', (s) => s.getAllKeys(), PENDING_STORE)) ?? [])
      .map(String).filter((k) => k !== PENDING_INDEX_KEY);
  } catch { return []; }
}

export async function listPending(): Promise<PendingMeta[]> {
  try {
    const [v, keys] = await Promise.all([
      withStore('readonly', (s) => s.get(PENDING_INDEX_KEY), PENDING_STORE),
      pendingKeys(),
    ]);
    const list = readIndex(v);
    // THE LIST IS CHECKED AGAINST THE NAMES IN THE STORE — names only, nothing
    // is opened. Agreeing is the ordinary case and ends here.
    const have = new Set(keys);
    const agrees = keys.every((k) => list[k] && Array.isArray(list[k].pics)) && Object.keys(list).every((k) => have.has(k));
    if (agrees) return keys.map((k) => list[k]);
    return await mendPendingIndex();
  } catch (e) {
    console.warn('[persistence] listPending failed', e);
    return [];
  }
}

/** The list and the store disagree: every copy the first time after this
 *  change, or a copy written by an older page. A copy the list does not know
 *  is opened ONCE, by itself, and noted; a note whose copy is gone is dropped.
 *  All in one step on the database, so a change made meanwhile is never
 *  written over. */
async function mendPendingIndex(): Promise<PendingMeta[]> {
  await picStore();
  return onCopies<PendingMeta[]>('readwrite', (copies, done) => {
    const first = copies.get(PENDING_INDEX_KEY);
    first.onsuccess = () => {
      const list = readIndex(first.result);
      const readKeys = copies.getAllKeys();
      readKeys.onsuccess = () => {
        const keys = (readKeys.result ?? []).map(String).filter((k) => k !== PENDING_INDEX_KEY);
        const have = new Set(keys);
        for (const k of Object.keys(list)) if (!have.has(k)) delete list[k];
        const missing = keys.filter((k) => !list[k] || !Array.isArray(list[k].pics));   // unknown, or noted before pictures were named
        const next = (): void => {
          const k = missing.shift();
          if (k === undefined) {
            if (keys.length) copies.put(indexRecord(list), PENDING_INDEX_KEY); else copies.delete(PENDING_INDEX_KEY);
            done(keys.map((x) => list[x]).filter(Boolean));
            return;
          }
          const one = copies.get(k);
          one.onsuccess = () => {
            const rec = one.result as PendingRecord | undefined;
            if (rec) list[k] = metaOf({ ...rec, key: rec.key ?? k });
            next();
          };
        };
        next();
      };
    };
  });
}

/** A copy as it lies on the device: light (its pictures named, not inside) —
 *  for the steps that only flip a mark on it and write it back. */
async function getPendingRaw(key: string): Promise<PendingRecord | null> {
  try {
    const v = await withStore('readonly', (s) => s.get(key), PENDING_STORE);
    return (v as PendingRecord | undefined) ?? null;
  } catch {
    return null;
  }
}

/** A copy, whole: its pictures put back in. One whole project — read it only
 *  when it is really going to be used. */
export async function getPending(key: string): Promise<PendingRecord | null> {
  const rec = await getPendingRaw(key);
  if (!rec?.snapshot) return rec;
  try {
    const back = await (await picStore()).putPicturesBack(rec.snapshot);
    if (back.missing > 0) say(`A COPY ON THIS DEVICE NAMES ${back.missing} PICTURE(S) THAT ARE NOT ON THE DEVICE — "${rec.name ?? key}"`);
    rec.snapshot = back.whole;
  } catch (e) { console.warn('[persistence] the pictures of a copy could not be read', e); return null; }
  return rec;
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
  const rec = await getPendingRaw(key);
  if (!rec) return;
  rec.deletedAt = Date.now();
  await writePending(key, rec);
}

/**
 * EVERY COPY OF ONE PROJECT, NOT JUST ONE (#466).
 *
 * A project leaves up to three sorts of record on the device:
 *
 *   1. the live one under its cloud id
 *   2. another under the device-only id it had before it was first uploaded
 *   3. `archive:<key>:<time>` copies, one per offline stretch
 *
 * `deletePending` marks ONE. So answering DELETE to "it seems you deleted this
 * project already" left the other two in the project list — which is exactly
 * what Roman saw: the project greyed out, a copy "on this device, not uploaded
 * yet", and an older offline copy underneath it.
 *
 * They are marked deleted, not destroyed: hidden from the list, recoverable in
 * Edit mode for 24 hours, swept after that. The same grace everything else
 * here gets.
 *
 * Returns how many were marked, for the log.
 */
export async function deleteEveryCopyOf(
  projectId: string, alsoTheseKeys: readonly string[] = [],
): Promise<number> {
  const wanted = new Set([projectId, ...alsoTheseKeys]);
  const recs = await listPending();
  let marked = 0;
  for (const rec of recs) {
    if (rec.deletedAt) continue;
    const mine = (rec.projectId !== null && rec.projectId === projectId)
      || wanted.has(rec.key)
      || [...wanted].some((k) => rec.key.startsWith(`archive:${k}:`));
    if (!mine) continue;
    await deletePending(rec.key);
    marked++;
  }
  return marked;
}

/** Undo a deletion made within the last 24 hours. */
export async function recoverPending(key: string): Promise<void> {
  const rec = await getPendingRaw(key);
  if (!rec?.deletedAt) return;
  delete rec.deletedAt;
  // Give it its window back. Its clock kept running while it sat deleted, so
  // a copy recovered late would otherwise be swept moments later.
  if (rec.uploadedAt) rec.uploadedAt = Date.now();
  await writePending(key, rec);
}

/** True for a copy the user deleted. Hidden unless the list is in Edit mode. */
export function isDeletedCopy(rec: { deletedAt?: number }): boolean {
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

// ---------------------------------------------------------------------------
// WHAT A DEVICE KEEPS WHEN YOU LEAVE (A13b, 9 Nov).
//
// LOGOUT keeps the UNSENT copies — a photo taken offline lives nowhere else,
// and it belongs to the account that signs in again. Everything else goes:
// the open project's cache, the project list, the previews, the per-project
// notes in localStorage. The device id and the camera preferences stay.
//
// ACCOUNT DELETION wipes it all, unsent copies included: the person asked for
// their data to go, and the account they would upload to is gone.
// ---------------------------------------------------------------------------
const KEEP_ON_LOGOUT_PREFIXES = ['fh_device_id', 'fh_cam', 'fh_test', 'fh_resort_note_off', 'fh_default_names'];

function clearLocalStorageExcept(keep: string[]): number {
  const gone: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && !keep.some((p) => k.startsWith(p))) gone.push(k);
  }
  for (const k of gone) localStorage.removeItem(k);
  return gone.length;
}

export async function clearDeviceOnLogout(): Promise<void> {
  await withStore('readwrite', (s) => s.clear());                 // the 'state' store: snapshot, project list cache
  const { clearAllPreviews } = await import('./pictsStore');
  await clearAllPreviews(true).catch(() => undefined);
  const n = clearLocalStorageExcept(KEEP_ON_LOGOUT_PREFIXES);
  const pending = await listPending();                            // (also brings the list of copies up to date, which the next line needs)
  await tidyPictures(true);                                       // the open project's pictures go; the unsent copies keep theirs
  console.log(`[device] logout: project cache and previews cleared, ${n} local note(s) removed, ${pending.length} unsent cop${pending.length === 1 ? 'y' : 'ies'} kept`);
}

export async function wipeDeviceOnAccountDeletion(): Promise<void> {
  await withStore('readwrite', (s) => s.clear());
  await withStore('readwrite', (s) => s.clear(), PENDING_STORE);   // the copies, and their list with them
  await (await picStore()).clearAllPictures().catch(() => undefined);
  const { clearAllPreviews } = await import('./pictsStore');
  await clearAllPreviews(false).catch(() => undefined);
  const n = clearLocalStorageExcept(['fh_device_id', 'fh_test']);
  console.log(`[device] account deleted: everything of it removed from this device (${n} local note(s))`);
}

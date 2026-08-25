// "Current project" coordination. Tracks the in-flight project — its server
// id (if saved), name, dirty flag — and debounces persistence to IndexedDB
// whenever the storyboard changes.
//
// ═══════════════════════════════════════════════════════════════════════════
// SYNC RULES (v4.7.010) — in plain English
// ═══════════════════════════════════════════════════════════════════════════
//
// PUSH (sending your changes to the server):
//  1. When you make a change, it waits 5 seconds then pushes — so rapid
//     actions batch into one push instead of flooding the server.
//  1b. During continuous work (changes every few seconds), the 5s timer
//      keeps resetting. To prevent data from never reaching the cloud,
//      a push fires every 5 seconds regardless of debounce.
//  1c. DELTA PUSH: only frames that changed since the last push are sent.
//      A fingerprint (lightweight string hash) tracks each frame's state.
//      The server UPSERTs dirty frames without touching clean ones.
//  2. When you leave the tab (blur), it pushes immediately — your work is
//     saved before you switch to another device.
//  3. Only NEW images get uploaded — images already in R2 reuse their key.
//  4. If the push fails (offline), it retries when you come back online.
//  5. If the server says "conflict" (409), it pulls first, then you can push.
//  6. Never pushes while a pull is loading or the project is still opening.
//
// PULL (getting the other device's changes):
//  7. When you open/switch to the tab, it checks for newer cloud data.
//  8. After the app boots from saved state, it pulls once (1.5s delay).
//  9. Per-frame merge: your dirty frames stay, clean frames take cloud.
// 10. If the same frame was changed on both devices → side-by-side picker.
// 11. Images that haven't changed are kept from local cache (no re-download).
//
// HEARTBEAT (device lock — prevents two people editing at once):
// 12. While you're active, your device sends a "heartbeat" every 5 seconds.
// 13. When you switch devices, the new device sees the heartbeat and waits.
// 14. When the first device goes idle (10s), heartbeat stops → lock clears.
// 15. Pull runs in parallel with the lock wait — data is ready instantly.
//
// SAFETY:
// 16. System actions (pulls, loads, renders) are wrapped so they don't
//     accidentally trigger a push of stale data.
// 17. Tombstones track frame/version deletions so they sync across devices.
// 18. Image-count guard refuses to push zero-image state over good data.
// ═══════════════════════════════════════════════════════════════════════════

import { useStore } from '../store/state';
import { trace } from './syncTrace';
import { clearSnapshot, saveSnapshot, snapshotFromStore, savePending, clearPending, listPending, markPendingWarned, markPendingUploaded, sweepUploaded, isArchived, storageEstimate } from './persistence';
import { isLoggedIn } from './session';
import { stampChangedSettings, exportSettingStamps } from './projectSettings';
import { stampChangedContent, exportChangeStamps } from './changeStamps';

interface CurrentProject {
  /** Server-side UUID once the project has been saved. Null = local-only. */
  projectId: string | null;
  /** User-given name, or null until the user names the project. */
  name: string | null;
  /** ms timestamp of last successful cloud sync; null if never synced. */
  lastSavedAt: number | null;
  /** True when local has unpersisted changes vs. last cloud save. */
  dirty: boolean;
}

let cp: CurrentProject = { projectId: null, name: null, lastSavedAt: null, dirty: false };

/**
 * Identity of the open project ON THIS DEVICE, which exists even before the
 * project has ever reached the cloud. Without it, a project that has never
 * been saved has nothing to be filed under, and starting a second project
 * would overwrite it — the exact case we must never lose.
 */
let _localId: string = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Key the open project is filed under while its work is unsent. */
function unsentKey(): string {
  return cp.projectId ?? _localId;
}

/** A different project is becoming the open one — give it its own identity. */
export function newLocalProjectIdentity(): void {
  _localId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) {
    try { l(); } catch (e) { console.error('[currentProject] listener', e); }
  }
}

export function getCurrentProject(): CurrentProject { return { ...cp }; }

export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function setCurrentProject(p: { projectId: string | null; name: string | null; lastSavedAt?: number | null }): void {
  cp = {
    projectId: p.projectId,
    name: p.name,
    lastSavedAt: p.lastSavedAt ?? (p.projectId ? Date.now() : null),
    dirty: false,
  };
  if (!p.projectId) newLocalProjectIdentity();   // a project of its own on this device
  scheduleAutosave();
  emit();
}

export function setProjectName(name: string): void {
  cp = { ...cp, name };
  cp.dirty = true;
  scheduleAutosave();
  emit();
}

export function markSaved(projectId: string): void {
  cp = { ...cp, projectId, lastSavedAt: Date.now(), dirty: false };
  scheduleAutosave();
  emit();
}

export function clearCurrentProject(): void {
  cp = { projectId: null, name: null, lastSavedAt: null, dirty: false };
  _dirty = false;
  _dirtyFrameIds.clear();
  // The next project is a different thing on this device and must be filed
  // separately — otherwise two projects that never reached the cloud would
  // share one key and the second would overwrite the first.
  newLocalProjectIdentity();
  emit();
  // Only the "currently open" record is cleared. Anything the server has not
  // confirmed stays exactly where it is, under its own key.
  void clearSnapshot();
}

// ---------------------------------------------------------------------------
// Autosave: persist the storyboard to IDB with debounce.
// ---------------------------------------------------------------------------

const AUTOSAVE_DEBOUNCE_MS = 2_000;  // Was 800 — give rapid actions room to finish
let autosaveTimer: number | null = null;
let cloudSyncInFlight = false;

// Lazy-loaded to avoid circular imports (accountFlow → currentProject).
let _syncFn: ((projectId: string) => Promise<void>) | null = null;

/** Creates the project on the server and uploads it — used for a project made
 *  offline that has no cloud id yet, so a plain push cannot carry it. */
let _createAndSyncFn: (() => Promise<void>) | null = null;
export function registerCreateAndSync(fn: () => Promise<void>): void {
  _createAndSyncFn = fn;
}
let _pullFn: ((force?: boolean) => Promise<void>) | null = null;
let _pullInFlight = false;

/**
 * Called once from accountFlow.ts at boot to hand us the sync function
 * without creating a circular import.
 */
export function registerCloudSync(fn: (projectId: string) => Promise<void>): void {
  _syncFn = fn;
}

/**
 * Called once from accountFlow.ts at boot to hand us the pull function
 * so we can trigger a pull when a push gets a 409 conflict.
 */
export function registerPullFn(fn: (force?: boolean) => Promise<void>): void {
  _pullFn = fn;
}

/** Ask for whatever is waiting, now. Used when a shooting order closes (#380):
 *  the fetching was held while it was open, and this is it catching up. */
export function pullNow(): void {
  // FORCED, on purpose. An ordinary ask is turned away by the "not too often"
  // guard, and then nothing arrives at all — holding the fetching is only
  // holding, it has to catch up the moment the order is closed (#380).
  void _pullFn?.(true);
}

/** Called by accountFlow to tell push-sync to pause during a pull. */
export function setPullInFlight(v: boolean): void {
  _pullInFlight = v;
}

/** Pause all cloud sync (used during project switches to prevent cross-contamination). */
let _projectSwitchInFlight = false;
export function setProjectSwitchInFlight(v: boolean): void {
  _projectSwitchInFlight = v;
}

/** True when the last cloud pull failed to load all images from R2.
 *  While set, both IDB autosave and cloud sync push are blocked. */
let _pullIncomplete = false;
export function setPullIncomplete(v: boolean): void { _pullIncomplete = v; }
export function isPullIncomplete(): boolean { return _pullIncomplete; }

// ---------------------------------------------------------------------------
// SYNC ENGINE — event-driven, no interval
// ---------------------------------------------------------------------------
//
// _isSystemAction: true while applying cloud data / loading projects.
//   When true, Zustand subscriber skips marking changes as dirty.
//
// _dirty: true when user has made changes that need pushing.
//
// _dirtyFrameIds: server UUIDs of frames modified by the user since last push.
//   Used during pull to decide which frames to keep (local) vs take (cloud).
// ---------------------------------------------------------------------------

let _isSystemAction = false;
let _dirty = false;
const _dirtyFrameIds = new Set<string>();

/** Wrap system operations (pull, load, apply snapshot) to prevent
 *  their setState calls from being treated as user changes. */
export function beginSystemAction(): void { _isSystemAction = true; }
export function endSystemAction(): void { _isSystemAction = false; }

/** True when user has made unpushed changes. */
export function isDirty(): boolean { return _dirty; }

/** Get the set of server frame UUIDs modified locally since last push. */
export function getDirtyFrameIds(): ReadonlySet<string> { return _dirtyFrameIds; }

// The fingerprint record lives in accountFlow; these are registered at boot so
// the snapshot can carry it without the two modules importing each other.
let _fingerprintsOut: (() => Record<string, string>) | null = null;
/** Deletions still to send, for the local save (#327). */
let _tombstonesOut: (() => Array<{ id: string; entity_type: 'frame' | 'version';
  entity_id: string; deleted_at: number; device_id: string }>) | null = null;
export function registerTombstoneBridge(out: typeof _tombstonesOut): void {
  _tombstonesOut = out;
}
let _fingerprintsIn: ((m: Record<string, string>) => void) | null = null;

/** Told about a push that got no answer, so the connection can be watched.
 *  Registered from accountFlow at boot — the two modules must not import each
 *  other. */
let _lastRememberedTraced = -1;
let _watchForConnection: (() => void) | null = null;
export function registerConnectionWatch(fn: () => void): void { _watchForConnection = fn; }

export function registerFingerprintBridge(
  out: () => Record<string, string>,
  into: (m: Record<string, string>) => void,
): void {
  _fingerprintsOut = out;
  _fingerprintsIn = into;
}

/** The server's clock at the last answer, read the same indirect way (#284). */
let _heardAtOut: (() => number) | null = null;
export function registerHeardAtBridge(out: () => number): void { _heardAtOut = out; }

/** Restore what the server already had, saved before the app was closed. */
export function adoptPushedFingerprints(m: Record<string, string> | undefined): void {
  if (m && _fingerprintsIn) _fingerprintsIn(m);
}

/** Restore the unconfirmed-frame list saved before the app was closed. */
export function adoptDirtyFrameIds(ids: string[] | undefined | null): void {
  if (!ids || ids.length === 0) return;
  for (const id of ids) _dirtyFrameIds.add(id);
  _dirty = true;   // there is work here the server has not taken
}

/** Explicitly mark a frame dirty by its server UUID.
 *  Use this for in-place mutations (e.g. setting noteHolder.note) where
 *  the object reference doesn't change so the ref-based subscriber can't
 *  detect the change automatically. */
/**
 * A HAND ON THE PAGE HOLDS THE FETCHING BACK (#371).
 *
 * Roman's rule, and a better one than the two I tried: "a device you write on in
 * scribble does not need to pull new stuff from the server while your pen is
 * down — and maybe pause for five seconds after the last stroke."
 *
 * Both earlier attempts held back the REDRAW, which tears the screen: the layer
 * ends up not rebuilt at all, or rebuilt from notes taken before the person
 * finished. Holding the FETCH instead costs nothing — nothing is torn down,
 * nothing goes stale, and the fetch simply happens a moment later when the
 * heartbeat comes round again.
 *
 * The grace period matters as much as the stroke itself: a series of quick marks
 * has gaps between them, and a rebuild landing in one of those gaps is the same
 * interruption.
 */
let _lastStrokeAt = 0;
const HAND_STILL_WARM_MS = 5_000;

/** Called when a stroke ends, wherever it was drawn. */
export function noteStrokeEnded(): void { _lastStrokeAt = Date.now(); }

/** Is somebody drawing, or have they only just stopped? */
export function handIsBusy(): boolean {
  if (useStore.getState().drawingInProgress) return true;
  return Date.now() - _lastStrokeAt < HAND_STILL_WARM_MS;
}

export function markFrameDirty(serverFrameId: string): void {
  _dirtyFrameIds.add(serverFrameId);
}

/**
 * THE FRAME LOST — LET IT GO (#307).
 *
 * The server refused this frame because its own copy was changed later. Ours is
 * not work to protect any more; it is simply out of date.
 *
 * Without this it stayed marked as unsent, so the very next pull PROTECTED it —
 * `keep-local <id>: local frame FOUND` — and the server's newer copy could never
 * land. Two devices each sat on their own drawing, for ever, each believing it
 * had the last word. Exactly what "newer wins" is supposed to prevent.
 */
export function dropDirtyFrame(serverFrameId: string): void {
  _dirtyFrameIds.delete(serverFrameId);
}

/**
 * Treat everything currently in the store as local work the server does not
 * have. Used when the user deliberately opens a copy held on this device: they
 * chose that version, so it must win over the cloud and be uploaded — without
 * this, the next pull quietly replaced it with the cloud copy again.
 */
export function claimStoreAsLocalWork(): void {
  for (const f of useStore.getState().frames) {
    if (f.serverFrameId) _dirtyFrameIds.add(f.serverFrameId);
  }
  _dirty = true;
  cp = { ...cp, dirty: true };
  emit();
}

/**
 * A DELETION IS WORK TOO (#317).
 *
 * Deleting a frame recorded a tombstone and then relied on something else to
 * cause a push. Nothing did. `flushSyncNow` returns immediately when nothing is
 * dirty, and a deletion marked nothing — there is no frame left to mark.
 *
 * So a frame deleted while offline never left the device. On the other device it
 * lived on, and every edit made to it there was thrown away in silence, because
 * the server discards writes to something it has been told is dead. Close the
 * app before the tombstone happened to ride along with some other change and it
 * was gone for good.
 *
 * This says only "there is something to send". It deliberately does NOT add a
 * frame to the unsent set: unsent FRAMES hold a pull back (#305), and a
 * deletion has no reason to.
 */
export function markSomethingToSend(): void {
  _dirty = true;
  cp = { ...cp, dirty: true };
  emit();
}

/** Called after a successful push to clear dirty state. */
export function clearDirtyState(): void {
  _dirty = false;
  _dirtyFrameIds.clear();
}


// ---------------------------------------------------------------------------
// Action-complete sync: pushes happen at end-of-action via flushSyncNow().
// The debounce below is a SAFETY NET only — catches any state change that
// somehow didn't get an explicit end-of-action sync point.  30 seconds is
// long enough to never interfere with normal operation, short enough to
// catch a missed sync within a reasonable window.
// ---------------------------------------------------------------------------

const SYNC_SAFETY_NET_MS = 30_000;  // 30s safety-net fallback (almost never fires)
let _syncDebounceTimer: number | null = null;

/** Cancel any pending safety-net push timer. Called when the device gains
 *  focus so we don't push stale data before pulling from the server. */
export function cancelPendingPush(): void {
  if (_syncDebounceTimer !== null) {
    clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = null;
  }
}

/** Safety-net fallback: schedule a push 30s from now.
 *  In normal operation, flushSyncNow() fires at every end-of-action and
 *  cancels this timer — so it almost never reaches zero.  If it does fire,
 *  it means a state change slipped through without an explicit sync point. */
function scheduleSyncSafetyNet(): void {
  if (_pullInFlight) return;
  if (_syncDebounceTimer !== null) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = window.setTimeout(() => {
    _syncDebounceTimer = null;
    void runCloudSync();
  }, SYNC_SAFETY_NET_MS);
}

/** Immediately push if dirty (used on blur and before project switch). */
export async function flushSyncNow(): Promise<void> {
  // Cancel any pending debounce
  if (_syncDebounceTimer !== null) {
    clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = null;
  }
  if (!_syncFn || !cp.projectId || !isLoggedIn()) {
    // No server id yet (never saved) or not signed in: there is nothing to push,
    // but the work still must not be lost when another project is opened. File
    // it on the device under this project's own key.
    if (_dirty && useStore.getState().frames.length > 0) {
      // Filed for safety, but silent: a project the user has not saved yet is
      // not "failing to reach the cloud" — it was never sent anywhere. The
      // notice belongs to the explicit Save that fails.
      void noticeUnsent(null, cp.name, snapshotFromStore(cp.projectId, cp.name), unsentKey(), false);
    }
    return;
  }
  if (cloudSyncInFlight) return;
  if (_pullInFlight) return;
  if (_projectSwitchInFlight) return;
  if (!_dirty) return;              // nothing dirty, nothing to send
  const pid = cp.projectId;
  cloudSyncInFlight = true;
  trace(`push start · online=${navigator.onLine}`);
  try {
    await _syncFn(pid);
    trace('push OK');

    // The server answered. Only now is the work known to be in the cloud, so
    // only now is it safe to drop the copy held on this device.
    clearDirtyState();
    cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
    _pendingSyncIds.delete(pid);
    // Clear both keys: a project saved to the cloud for the first time was
    // filed under its device-only id until it had a cloud id. Deleting a key
    // that is not there is harmless, and this only runs after confirmation.
    _unsentSince = null;                       // the run of failures is over
    void markPendingUploaded(pid);
    void markPendingUploaded(_localId);
    hideOfflineBanner();
    emit();
  } catch (e: unknown) {
    const err = e as { status?: number };
    trace(`push FAILED status=${err?.status ?? '(no response)'}`);
    // No answer at all is the one honest sign of being off — the browser's own
    // opinion is often wrong. Start watching for the connection to come back
    // (#298), so the check happens the moment it does.
    if (!err?.status) _watchForConnection?.();
    if (err?.status === 409 && _pullFn) {
      // 409 conflict: another device pushed since our last sync.
      // Pull to merge (our _dirtyFrameIds protect local changes),
      // then schedule a retry push with updated base_updated_at.
      cloudSyncInFlight = false; // release lock so pull can proceed
      try {
        // FORCED. An ordinary pull refuses while this device holds unsent
        // work — and after a 409 it always does, because the push that just
        // failed is that work. Push, refuse, retry, for ever. The 409 already
        // says the server is ahead, so taking its copy is the whole point.
        await _pullFn(true);
        // tryPullFromCloud calls clearDirtyState() after merge, but our
        // kept-local frames still need to be pushed. Re-mark dirty and
        // retry push quickly — base_updated_at is now up-to-date.
        _dirty = true;
        setTimeout(() => void flushSyncNow(), 500);
      } catch {
        _pendingSyncIds.add(pid);
        void noticeUnsent(pid, cp.name, snapshotFromStore(pid, cp.name), pid);
      }
      return; // skip the finally's cloudSyncInFlight = false (already cleared)
    }
    // Unsent. Keep this project's work under its own key so opening another
    // project cannot overwrite it, and so it survives closing the app.
    _pendingSyncIds.add(pid);
    void noticeUnsent(pid, cp.name, snapshotFromStore(pid, cp.name), pid);
  } finally {
    cloudSyncInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Pending sync queue: projects whose flush failed (offline). Retried when
// the device comes back online.
// ---------------------------------------------------------------------------

const _pendingSyncIds = new Set<string>();


/**
 * Told once per project, not on every failed attempt. The user needs to know
 * one thing: the work is safe on this device, and this is the device to open
 * the project on when there is a connection again.
 */
async function noticeUnsent(pid: string | null, name: string | null,
                            snapshot: ReturnType<typeof snapshotFromStore>,
                            key: string = pid ?? unsentKey(),
                            mayWarn = true): Promise<void> {
  const firstTime = await savePending(key, pid, name, snapshot);

  // The work is filed either way. Whether to SAY anything is a separate
  // question — a dropped signal that recovers on the next action is not worth
  // interrupting for.
  if (!mayWarn || !firstTime) return;
  if (_unsentSince === null) _unsentSince = Date.now();
  if (Date.now() - _unsentSince < OFFLINE_NOTICE_DELAY_MS) return;

  await markPendingWarned(key);
  const { showImportantNote } = await import('./modals');
  void showImportantNote(
    'IMPORTANT NOTE',
    'Your device seems to be working offline. Once THIS DEVICE is online again, ' +
    'open FRAMEHOW on THIS DEVICE and the project will upload to the cloud. ' +
    'Until then, your changes are not available on other devices.',
  );
}

/**
 * When the current run of failed saves began, or null if the last save worked.
 * The notice waits for this to pass OFFLINE_NOTICE_DELAY_MS, so a brief outage
 * that recovers on the next action is never mentioned.
 */
let _unsentSince: number | null = null;

/** How long the work must have been stuck before the user is told. Sits just
 *  past the retry cycle, so a retry has always been attempted and failed
 *  before the user is told — no warning about outages that clear themselves. */
const OFFLINE_NOTICE_DELAY_MS = 45_000;

/** How often to try again for work the server has not confirmed. */
const RETRY_INTERVAL_MS = 40_000;

/** Projects with unsent work found on the device, other than the open one. */
let _pendingOnDevice: Array<{ projectId: string | null; name: string | null; savedAt: number }> = [];

/** The device-only identity of the open project. */
export function localProjectId(): string { return _localId; }

/** Restore the identity a project had before the app was closed, so unsent
 *  work is not filed twice under two different keys. */
export function adoptLocalProjectId(id: string | undefined | null): void {
  if (id) _localId = id;
}

/** Unsent projects sitting on this device — shown in the project list. */
export function pendingOnDevice(): ReadonlyArray<{ projectId: string | null; name: string | null; savedAt: number }> {
  return _pendingOnDevice;
}

/**
 * Read back what the previous session could not send. The knowledge used to
 * live only in memory, so closing the app meant the app forgot there was
 * anything outstanding — the work stayed on the device but nothing ever tried
 * to send it again.
 */
async function restorePendingFromDevice(): Promise<void> {
  try {
    void sweepUploaded();                       // drop copies past their 24 hours
    const recs = (await listPending()).filter((r) => !isArchived(r));
    _pendingOnDevice = recs.map((r) => ({ projectId: r.projectId, name: r.name, savedAt: r.savedAt }));
    for (const r of recs) if (r.projectId) _pendingSyncIds.add(r.projectId);
    if (recs.length > 0) void retryPendingSyncs();
  } catch { /* nothing outstanding, or storage unavailable */ }
}

async function retryPendingSyncs(): Promise<void> {
  if (!_syncFn || !isLoggedIn() || !navigator.onLine) return;
  if (_pendingSyncIds.size === 0) return;
  if (cloudSyncInFlight || _projectSwitchInFlight) return;
  // Made offline and never uploaded: it needs creating on the server first.
  // Only when it already has a name — otherwise saving would have to stop and
  // ask for one, and this runs in the background.
  if (!cp.projectId && _dirty && cp.name && _createAndSyncFn
      && useStore.getState().frames.length > 0) {
    cloudSyncInFlight = true;
    try {
      await _createAndSyncFn();
    } catch { /* still unreachable — the device copy stays put */ }
    finally { cloudSyncInFlight = false; }
    return;
  }

  const currentPid = cp.projectId;
  if (currentPid && _pendingSyncIds.has(currentPid) && _dirty) {
    // Success below is the server's answer, not the browser's opinion.
    cloudSyncInFlight = true;
    trace('retry push start');
    try {
      await _syncFn(currentPid);
      trace('retry push OK');
      clearDirtyState();
      cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
      _pendingSyncIds.delete(currentPid);
      void markPendingUploaded(currentPid);
      _pendingOnDevice = _pendingOnDevice.filter((p) => p.projectId !== currentPid);
      hideOfflineBanner();
      emit();
    } catch (e) {
      trace(`retry push FAILED status=${(e as { status?: number })?.status ?? '(no response)'}`);
    } finally {
      cloudSyncInFlight = false;
    }
  }
}

/** True when the push-sync is actively syncing to cloud. */
export function isPushInFlight(): boolean {
  return cloudSyncInFlight;
}

/** Block/unblock cloud sync from outside (used by saveNow). */
export function setCloudSyncInFlight(v: boolean): void {
  cloudSyncInFlight = v;
}

/** True when a pull (load from cloud) is in progress, or the last pull failed to load all images. */
export function isLoadInFlight(): boolean {
  return _pullInFlight || _projectSwitchInFlight || _pullIncomplete;
}

function scheduleAutosave(): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(runAutosave, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Save to this device NOW, without waiting out the two-second pause (#269).
 *
 * The local save is debounced, and the timer is restarted by every change — so
 * anything done in the last couple of seconds exists only in memory. Putting the
 * app away then threw it out: rename a NEEDS category on an offline iPad, swipe
 * the app closed, and the rename was never written anywhere. The only copy went
 * with it.
 */
export async function saveLocalNow(): Promise<void> {
  if (autosaveTimer !== null) { clearTimeout(autosaveTimer); autosaveTimer = null; }
  await runAutosave();
}

let _autosaveInFlight = false;
async function runAutosave(): Promise<void> {
  autosaveTimer = null;
  if (_autosaveInFlight) return;              // Don't overlap heavy IDB writes
  if (_pullInFlight || _projectSwitchInFlight) {
    scheduleAutosave();
    return;
  }
  _autosaveInFlight = true;
  try {
    // Stamp any settings that changed since the last look. Done HERE, on the
    // local save, so the stamp is the time of the change — stamping at push
    // time would make every offline change look newest and win everything.
    stampChangedSettings(cp.projectId);
    stampChangedContent(cp.projectId);
    const snap = snapshotFromStore(cp.projectId, cp.name);
    snap.localId = _localId;   // survives restarts, so the key stays the same
    // Which frames are still unconfirmed. Without this a pull after a restart
    // sees everything as clean and replaces local work with the cloud copy.
    snap.dirtyFrameIds = [..._dirtyFrameIds];
    // Remember what the server already has, so reopening the app does not push
    // the entire project again.
    if (_fingerprintsOut) snap.pushedFingerprints = _fingerprintsOut();
    // Say how much memory is going into the save. An iPad came back from a
    // restart with NOTHING remembered about the server and, by the old rule,
    // read that as a brand new project (#300). Whether the save was empty or
    // the load lost it, this line and the one at boot tell us which.
    // Count FRAMES, not entries. The server's timestamps ride along in the same
    // record under a reserved name (see exportPushedFingerprints), so counting
    // keys reported one frame more than the project has — a six-frame project
    // saying "7 frame(s) remembered", every time, for no reason. The line is
    // read to decide whether a restart lost its memory, so it has to be exact.
    const remembered = Object.keys(snap.pushedFingerprints ?? {})
      .filter((k) => k !== '__serverTimes').length;
    if (remembered !== _lastRememberedTraced) {
      _lastRememberedTraced = remembered;
      trace(`  saving: ${remembered} frame(s) remembered as matching the server`);
    }
    // When each setting last changed, so a restart does not forget and start
    // claiming everything is new.
    snap.settingStamps = exportSettingStamps();
    snap.contentStamps = exportChangeStamps();
    // Deletions this device has made and not yet sent. Without these a frame
    // deleted offline came back on the next pull (#327).
    if (_tombstonesOut) snap.pendingTombstones = _tombstonesOut();
    // When the server last answered. Saved so that reopening the app can ask
    // for changes only, instead of the whole project (#284).
    if (_heardAtOut) snap.heardAt = _heardAtOut();
    if (snap.frames.length === 0 && cp.name === null) {
      await clearSnapshot();
      return;
    }
    await saveSnapshot(snap);
  } catch (e) {
    console.warn('[currentProject] autosave failed', e);
    // A local save failing is the one way work can disappear without anyone
    // noticing — almost always because the device has no room left. Say so.
    void reportStorageFailure(e);
  } finally {
    _autosaveInFlight = false;
  }
}

let _storageWarned = false;

/** Tell the user once that saving on this device has stopped working. */
async function reportStorageFailure(e: unknown): Promise<void> {
  if (_storageWarned) return;
  _storageWarned = true;
  const quotaish = e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
  const { showImportantNote } = await import('./modals');
  void showImportantNote(
    'COULD NOT SAVE ON THIS DEVICE',
    quotaish
      ? 'This iPad has no room left for Framehow, so your latest changes are ' +
        'NOT saved. Connect to the internet so your work can upload, or free ' +
        'up space on the device before carrying on.'
      : 'Your latest changes could not be saved on this device. Connect to the ' +
        'internet so your work can upload to the cloud.',
  );
}

/**
 * Warn while there is still room, rather than at the moment a save fails.
 * Checked at startup and whenever the connection drops — the points where a
 * long offline stretch is about to begin.
 */
export async function checkStorageHeadroom(): Promise<void> {
  if (_storageWarned) return;
  const est = await storageEstimate();
  if (!est || !est.quota) return;
  if (est.usage / est.quota < 0.8) return;
  _storageWarned = true;
  const leftMb = Math.max(0, Math.round((est.quota - est.usage) / 1024 / 1024));
  const { showImportantNote } = await import('./modals');
  void showImportantNote(
    'RUNNING OUT OF SPACE',
    `Framehow has used 80% of the space this iPad allows — about ${leftMb} MB left. ` +
    'Connect to internet so your work can upload, or free up space on the iPad.',
  );
}

// ---------------------------------------------------------------------------
// Cloud sync push — triggered by debounce timer or flush.
// ---------------------------------------------------------------------------

async function runCloudSync(): Promise<void> {
  if (!_syncFn) return;
  if (!cp.projectId) return;
  if (!isLoggedIn()) return;
  if (cloudSyncInFlight) return;
  if (_pullInFlight) return;
  if (_projectSwitchInFlight) return;
  if (!_dirty) return;

  cloudSyncInFlight = true;
  try {
    await _syncFn(cp.projectId);

    clearDirtyState();
    cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
    hideOfflineBanner();
    emit();
  } catch (e: any) {
    console.warn('[sync] push failed', e);
    if (e?.status === 409 && _pullFn) {
      // Conflict (409) — pull first, then user can push
      try { await _pullFn(true); } catch { /* pull handles its own errors */ }
    } else if (!navigator.onLine || (e instanceof TypeError)) {
      showOfflineBanner();
    }
  } finally {
    cloudSyncInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Offline banner
// ---------------------------------------------------------------------------

const OFFLINE_COOLDOWN_MS = 15 * 60 * 1000;
let offlineBanner: HTMLElement | null = null;
let isOffline = false;
let offlineDismissedAt = 0;

function showOfflineBanner(): void {
  if (isOffline) return;
  if (Date.now() - offlineDismissedAt < OFFLINE_COOLDOWN_MS) return;
  isOffline = true;
  if (!offlineBanner) {
    offlineBanner = document.createElement('div');
    offlineBanner.id = 'offlineBanner';
    offlineBanner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;' +
      'background:#d52632;color:#fff;text-align:center;' +
      'padding:8px 40px 8px 12px;font-size:13px;font-weight:500;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    offlineBanner.innerHTML =
      'Offline — changes saved on this device only' +
      '<button style="position:absolute;right:8px;top:50%;transform:translateY(-50%);' +
      'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;' +
      'padding:4px 8px;line-height:1;" id="offlineDismiss">×</button>';
    document.body.appendChild(offlineBanner);
    offlineBanner.querySelector('#offlineDismiss')!.addEventListener('click', dismissOfflineBanner);
  }
  offlineBanner.style.display = 'block';

  // It holds for five seconds so it is actually read — a tap during that time
  // does nothing to it. After that, tapping anywhere gets rid of it; the × is
  // easy to miss on a tablet. It stays gone for the cooldown, or until the
  // next time a save cannot get through.
  const onAnyTap = () => {
    document.removeEventListener('pointerdown', onAnyTap, true);
    dismissOfflineBanner();
  };
  window.setTimeout(() => document.addEventListener('pointerdown', onAnyTap, true), 5000);
}

function dismissOfflineBanner(): void {
  offlineDismissedAt = Date.now();
  isOffline = false;
  if (offlineBanner) offlineBanner.style.display = 'none';
}

function hideOfflineBanner(): void {
  if (!isOffline) return;
  isOffline = false;
  offlineDismissedAt = 0;
  if (offlineBanner) offlineBanner.style.display = 'none';
}

/**
 * Start the autosave and cloud-sync systems. Call once at app boot.
 *
 * IDB autosave: triggered by zustand subscriber.
 * Cloud sync: action-complete — pushes at the end of each discrete user action
 * via flushSyncNow(). A 30s safety-net timer catches anything missed.
 * System actions are wrapped to prevent false positives.
 */
export function startAutosave(): void {
  // Zustand subscriber: schedule IDB autosave + detect user changes.
  // Also tracks WHICH frames changed so the pull-merge logic can keep
  // dirty local frames instead of blindly overwriting them with cloud data.
  let _prevFrameRefs = new Map<number, object>(); // frame.id → frame object ref
  let _prevStripVerRefs = new Map<string, object>(); // "strip:fid" → versions array ref
  useStore.subscribe(() => {
    scheduleAutosave();
    const s = useStore.getState();
    // Only mark dirty when a USER (not system) action changes the store
    if (!_isSystemAction) {
      _dirty = true;
      // Track which frames changed — wrapped in try/catch so the safety-net
      // timer is ALWAYS reached even if the tracking logic has an edge-case error.
      try {
        for (const f of s.frames) {
          if (!f.serverFrameId) continue;
          if (_prevFrameRefs.get(f.id) !== f) _dirtyFrameIds.add(f.serverFrameId);
          for (const strip of ['ver', 'floor', 'refs'] as const) {
            const curVers = s.stripVersions[strip]?.[f.id];
            if (_prevStripVerRefs.get(`${strip}:${f.id}`) !== curVers) {
              _dirtyFrameIds.add(f.serverFrameId);
            }
          }
        }
      } catch { /* tracking is best-effort — sync must never break */ }
      scheduleSyncSafetyNet();
    }
    // ALWAYS update refs — including after system actions (pulls, loads) —
    // so the next user action only marks actually-changed frames as dirty.
    try {
      _prevFrameRefs = new Map(s.frames.map((f) => [f.id, f]));
      const newRefs = new Map<string, object>();
      for (const strip of ['ver', 'floor', 'refs'] as const) {
        const m = s.stripVersions[strip];
        if (m) for (const fid of Object.keys(m)) newRefs.set(`${strip}:${fid}`, m[+fid]);
      }
      _prevStripVerRefs = newRefs;
    } catch { /* best-effort */ }
  });

  // The app is being put away. Two different things have to happen, in this
  // order, and only the first one works without a network:
  //   1. write to this device, so nothing is lost if it is closed or swiped away
  //   2. send to the server, so the other device can see it
  // Only the second used to happen. Offline, that meant losing the work (#269).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    void saveLocalNow();
    if (_dirty && cp.projectId) void flushSyncNow();
  });
  // On iOS a home-screen app is hidden before it can be swiped away, so the
  // handler above usually runs first. pagehide is the belt to that braces.
  window.addEventListener('pagehide', () => { void saveLocalNow(); });

  // Listen for browser online/offline events. The browser saying "online" only
  // means a network exists — hotel wifi and captive portals claim it while
  // nothing gets through — so it is a hint to try, never proof of success.
  window.addEventListener('offline', () => { showOfflineBanner(); void checkStorageHeadroom(); });
  window.addEventListener('online', () => { void retryPendingSyncs(); });

  // Anything the server has not confirmed is retried on startup and then at
  // intervals, because the browser's online event may never arrive (the app
  // can simply be reopened later, already connected).
  void restorePendingFromDevice();
  void checkStorageHeadroom();
  window.setInterval(() => { void retryPendingSyncs(); }, RETRY_INTERVAL_MS);

}


// "Current project" coordination. Tracks the in-flight project — its server
// id (if saved), name, dirty flag — and debounces persistence to IndexedDB
// whenever the storyboard changes.
//
// SYNC MODEL (v4.7.005):
// - Push: debounced 5s after user action + immediate on blur. No interval.
// - Pull: on focus (visibility change). Per-frame merge on pull.
// - System actions (applying pulled data, rendering) are wrapped in
//   beginSystemAction/endSystemAction — they never trigger a push.
// - _dirtyFrameIds tracks which frames the user modified since last push.
//   On pull, dirty frames are kept; clean frames take cloud version.

import { useStore } from '../store/state';
import { clearSnapshot, saveSnapshot, snapshotFromStore } from './persistence';
import { isLoggedIn } from './session';

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
  emit();
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
let _pullFn: (() => Promise<void>) | null = null;
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
export function registerPullFn(fn: () => Promise<void>): void {
  _pullFn = fn;
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

/** Called after a successful push to clear dirty state. */
export function clearDirtyState(): void {
  _dirty = false;
  _dirtyFrameIds.clear();
}

/** Mark a frame as modified by the user. Pass the serverFrameId (UUID).
 *  Frames without a serverFrameId (new, not yet pushed) don't need marking —
 *  they'll be included in the push automatically.
 *  Also call for frame-level metadata changes (label, hidden, etc.). */
export function markDirtyFrame(serverFrameId: string | undefined): void {
  if (serverFrameId) _dirtyFrameIds.add(serverFrameId);
}

// ---------------------------------------------------------------------------
// Debounced push: 3 seconds after last user change.
// Also pushes immediately on blur (tab loses focus).
// ---------------------------------------------------------------------------

const SYNC_DEBOUNCE_MS = 5_000;  // Was 3s — let rapid edits settle before pushing
let _syncDebounceTimer: number | null = null;

function scheduleSyncPush(): void {
  if (_syncDebounceTimer !== null) clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = window.setTimeout(() => {
    _syncDebounceTimer = null;
    void runCloudSync();
  }, SYNC_DEBOUNCE_MS);
}

/** Immediately push if dirty (used on blur and before project switch). */
export async function flushSyncNow(): Promise<void> {
  // Cancel any pending debounce
  if (_syncDebounceTimer !== null) {
    clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = null;
  }
  if (!_syncFn || !cp.projectId || !isLoggedIn()) return;
  if (cloudSyncInFlight) return;
  if (_pullInFlight) return;
  if (_projectSwitchInFlight) return;
  if (_pullIncomplete) return;   // Never push while project is still loading images
  if (!_dirty) return;
  const pid = cp.projectId;
  cloudSyncInFlight = true;
  try {
    await _syncFn(pid);
    clearDirtyState();
    cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
    _pendingSyncIds.delete(pid);
    hideOfflineBanner();
    emit();
  } catch {
    _pendingSyncIds.add(pid);
  } finally {
    cloudSyncInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Pending sync queue: projects whose flush failed (offline). Retried when
// the device comes back online.
// ---------------------------------------------------------------------------

const _pendingSyncIds = new Set<string>();

async function retryPendingSyncs(): Promise<void> {
  if (!_syncFn || !isLoggedIn() || !navigator.onLine) return;
  if (_pendingSyncIds.size === 0) return;
  if (cloudSyncInFlight || _projectSwitchInFlight) return;
  const currentPid = cp.projectId;
  if (currentPid && _pendingSyncIds.has(currentPid) && _dirty) {
    cloudSyncInFlight = true;
    try {
      await _syncFn(currentPid);
      clearDirtyState();
      cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
      _pendingSyncIds.delete(currentPid);
      hideOfflineBanner();
      emit();
    } catch {
      // Still offline — will retry on next online event
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

let _autosaveInFlight = false;
async function runAutosave(): Promise<void> {
  autosaveTimer = null;
  if (_autosaveInFlight) return;              // Don't overlap heavy IDB writes
  if (_pullInFlight || _projectSwitchInFlight || _pullIncomplete) {
    scheduleAutosave();
    return;
  }
  _autosaveInFlight = true;
  try {
    const snap = snapshotFromStore(cp.projectId, cp.name);
    if (snap.frames.length === 0 && cp.name === null) {
      await clearSnapshot();
      return;
    }
    await saveSnapshot(snap);
  } catch (e) {
    console.warn('[currentProject] autosave failed', e);
  } finally {
    _autosaveInFlight = false;
  }
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
  if (_pullIncomplete) return;   // Never push while project is still loading images
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
      console.info('[sync] conflict (409), triggering pull');
      try { await _pullFn(); } catch { /* pull handles its own errors */ }
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
      'background:#e65100;color:#fff;text-align:center;' +
      'padding:8px 40px 8px 12px;font-size:13px;font-weight:500;' +
      'box-shadow:0 2px 8px rgba(0,0,0,0.3);';
    offlineBanner.innerHTML =
      'Offline — changes saved on this device only' +
      '<button style="position:absolute;right:8px;top:50%;transform:translateY(-50%);' +
      'background:none;border:none;color:#fff;font-size:18px;cursor:pointer;' +
      'padding:4px 8px;line-height:1;" id="offlineDismiss">×</button>';
    document.body.appendChild(offlineBanner);
    offlineBanner.querySelector('#offlineDismiss')!.addEventListener('click', () => {
      offlineDismissedAt = Date.now();
      isOffline = false;
      offlineBanner!.style.display = 'none';
    });
  }
  offlineBanner.style.display = 'block';
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
 * Cloud sync: event-driven — pushes on user action (debounced) and on blur.
 * No interval. System actions are wrapped to prevent false positives.
 */
export function startAutosave(): void {
  // Zustand subscriber: schedule IDB autosave + detect user changes
  useStore.subscribe(() => {
    scheduleAutosave();
    // Only mark dirty when a USER (not system) action changes the store
    if (!_isSystemAction) {
      _dirty = true;
      scheduleSyncPush();
    }
  });

  // Push immediately when tab loses focus (user switching to another device)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && _dirty && cp.projectId) {
      void flushSyncNow();
    }
  });

  // Listen for browser online/offline events
  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online', () => {
    hideOfflineBanner();
    void retryPendingSyncs();
  });

  // Safety net: retry pending syncs every 60 seconds (for edge cases only)
  setInterval(() => { void retryPendingSyncs(); }, 60_000);
}

// ---------------------------------------------------------------------------
// DEPRECATED / REMOVED (kept as no-ops for backward compat during transition)
// These were part of the old interval-based sync. They'll be cleaned up once
// all call sites are updated.
// ---------------------------------------------------------------------------

/** @deprecated Use beginSystemAction/endSystemAction instead. */
export function bumpStoreVersion(): void { /* no-op */ }
/** @deprecated No longer needed — dirty tracking is automatic. */
export function updateSyncHash(): void { /* no-op */ }
/** @deprecated Use isDirty() instead. */
export function hasLocalChanges(): boolean { return _dirty; }
/** @deprecated Use beginSystemAction/endSystemAction instead. */
export function suppressVersionBumps(_durationMs: number): void { /* no-op */ }

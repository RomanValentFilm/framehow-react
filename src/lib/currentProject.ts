// "Current project" coordination. Tracks the in-flight project — its server
// id (if saved), name, dirty flag — and debounces persistence to IndexedDB
// whenever the storyboard changes.
//
// This is intentionally separate from the Zustand store: project metadata
// has different lifecycle and concerns from the UI/data state, and keeping
// it here means the existing imperative core doesn't need to know about it.

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
  emit();
  void clearSnapshot();
}

// ---------------------------------------------------------------------------
// Autosave: persist the storyboard to IDB regularly, and sync to cloud
// every few seconds via a simple interval. The interval approach is
// deliberately mutation-agnostic — it doesn't need to detect individual
// changes. It just snapshots whatever the current state is and pushes it.
// ---------------------------------------------------------------------------

const AUTOSAVE_DEBOUNCE_MS = 800;
const CLOUD_SYNC_INTERVAL_MS = 5_000;
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

/**
 * Immediately push current project to cloud (if dirty). Returns when done.
 * Use before switching projects to ensure current work is saved first.
 * If the push fails (offline), queues the project for retry when back online.
 */
export async function flushSyncNow(): Promise<void> {
  if (!_syncFn || !cp.projectId || !isLoggedIn()) return;
  if (cloudSyncInFlight) return; // already syncing
  if (_storeVersion === lastSyncVersion) return; // nothing changed
  const pid = cp.projectId;
  const ver = _storeVersion;
  cloudSyncInFlight = true;
  try {
    await _syncFn(pid);
    lastSyncVersion = ver;
    cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
    _pendingSyncIds.delete(pid);
    emit();
  } catch {
    // Offline or failed — queue for retry when back online
    _pendingSyncIds.add(pid);
  } finally {
    cloudSyncInFlight = false;
  }
}

// ---------------------------------------------------------------------------
// Pending sync queue: projects whose flush failed (offline). Retried when
// the device comes back online or on the next sync interval while online.
// ---------------------------------------------------------------------------

const _pendingSyncIds = new Set<string>();

async function retryPendingSyncs(): Promise<void> {
  if (!_syncFn || !isLoggedIn() || !navigator.onLine) return;
  if (_pendingSyncIds.size === 0) return;
  if (cloudSyncInFlight || _projectSwitchInFlight) return;
  // Only retry if we're currently on one of the pending projects
  // (we can only push the project that's currently loaded in state)
  const currentPid = cp.projectId;
  if (currentPid && _pendingSyncIds.has(currentPid)) {
    cloudSyncInFlight = true;
    try {
      await _syncFn(currentPid);
      lastSyncVersion = _storeVersion;
      cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
      _pendingSyncIds.delete(currentPid);
      hideOfflineBanner();
      emit();
    } catch {
      // Still offline — will retry next tick
    } finally {
      cloudSyncInFlight = false;
    }
  }
}

/** True when the push-sync interval is actively syncing to cloud. */
export function isPushInFlight(): boolean {
  return cloudSyncInFlight;
}

function scheduleAutosave(): void {
  if (autosaveTimer !== null) clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(runAutosave, AUTOSAVE_DEBOUNCE_MS);
}

async function runAutosave(): Promise<void> {
  autosaveTimer = null;
  try {
    const snap = snapshotFromStore(cp.projectId, cp.name);
    // Only persist if there's actually something to remember. An empty
    // storyboard with no name is the equivalent of "no current project".
    if (snap.frames.length === 0 && cp.name === null) {
      await clearSnapshot();
      return;
    }
    await saveSnapshot(snap);
  } catch (e) {
    console.warn('[currentProject] autosave failed', e);
  }
}

// ---------------------------------------------------------------------------
// Cloud sync: runs on a fixed interval. Uses a lightweight change counter
// instead of JSON.stringify to detect mutations — the old approach serialized
// the entire store (including base64 images) every 5 seconds, which caused
// significant jank on iPad.
// ---------------------------------------------------------------------------

let _storeVersion = 0;
let lastSyncVersion = -1;

/** Bump the change counter. Called by the Zustand subscriber in startAutosave. */
export function bumpStoreVersion(): void { _storeVersion++; }

/**
 * Call after applying cloud data to the store (pull-on-focus, load project)
 * so the interval sync doesn't immediately re-push the same data.
 */
export function updateSyncHash(): void {
  lastSyncVersion = _storeVersion;
}

/** True when local store has changed since the last successful cloud sync. */
export function hasLocalChanges(): boolean {
  if (lastSyncVersion < 0) return false; // Never synced — no baseline
  return _storeVersion !== lastSyncVersion;
}

/** Cheap change detection — just compare counters. */
function storeHash(): string {
  return String(_storeVersion);
}

// ---------------------------------------------------------------------------
// Offline banner — shown once when sync fails. User can dismiss it.
// Won't show again for 15 minutes after dismissal. Clears when back online.
// ---------------------------------------------------------------------------

const OFFLINE_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes
let offlineBanner: HTMLElement | null = null;
let isOffline = false;
let offlineDismissedAt = 0;

function showOfflineBanner(): void {
  if (isOffline) return;
  // Respect the 15-minute cooldown after user dismissed the banner
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
  offlineDismissedAt = 0; // Reset cooldown on successful sync
  if (offlineBanner) offlineBanner.style.display = 'none';
}

async function runCloudSync(): Promise<void> {
  if (!_syncFn) return;
  if (!cp.projectId) return;       // Not yet saved to cloud — manual save first
  if (!isLoggedIn()) return;       // Can't sync without auth
  if (cloudSyncInFlight) return;   // Already in progress
  if (_pullInFlight) return;       // Don't push while pulling — images loading would cause false changes
  if (_projectSwitchInFlight) return; // Don't push during project switch — would contaminate the new project

  // Check if anything actually changed since last sync
  if (_storeVersion === lastSyncVersion) return;

  const ver = _storeVersion;
  cloudSyncInFlight = true;
  try {
    await _syncFn(cp.projectId);
    lastSyncVersion = ver;
    cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
    hideOfflineBanner();
    emit();
  } catch (e: any) {
    console.warn('[autosync] failed', e);
    // 409 = conflict: server has newer data from another device.
    // Trigger a pull so the user sees the conflict dialog.
    if (e?.status === 409 && _pullFn) {
      console.info('[autosync] conflict detected, triggering pull');
      // Don't retry pushing — let the pull handle reconciliation.
      lastSyncVersion = ver; // Mark as "handled" so we don't keep re-pushing
      try { await _pullFn(); } catch { /* pull handles its own errors */ }
    } else if (!navigator.onLine || (e instanceof TypeError)) {
      // Show offline banner if the failure looks like a network issue
      showOfflineBanner();
    }
    // Will retry on next interval tick
  } finally {
    cloudSyncInFlight = false;
  }
}

/**
 * Start the autosave and cloud-sync systems. Call once at app boot.
 *
 * IDB autosave: triggered by zustand subscriber (detects reference changes)
 *   AND by the cloud-sync interval (catches in-place mutations).
 * Cloud sync: a simple 5-second interval that hashes the store and syncs
 *   if anything changed. No need to detect individual mutations.
 */
export function startAutosave(): void {
  // Zustand subscriber: bump change counter (for sync) + schedule IDB autosave
  useStore.subscribe(() => {
    bumpStoreVersion();
    scheduleAutosave();
  });

  // Fixed-interval cloud sync — mutation-agnostic, catches everything
  setInterval(() => {
    // Also save to IDB on every tick to catch in-place mutations
    scheduleAutosave();
    // Sync to cloud
    void runCloudSync();
    // Retry any pending syncs from failed project switches
    void retryPendingSyncs();
  }, CLOUD_SYNC_INTERVAL_MS);

  // Listen for browser online/offline events to show/hide banner immediately
  window.addEventListener('offline', showOfflineBanner);
  window.addEventListener('online', () => {
    hideOfflineBanner();
    // Retry pending syncs now that we're back online
    void retryPendingSyncs();
  });
}

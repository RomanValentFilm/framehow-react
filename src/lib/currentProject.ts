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

/** Explicitly mark a frame dirty by its server UUID.
 *  Use this for in-place mutations (e.g. setting noteHolder.note) where
 *  the object reference doesn't change so the ref-based subscriber can't
 *  detect the change automatically. */
export function markFrameDirty(serverFrameId: string): void {
  _dirtyFrameIds.add(serverFrameId);
}

/** Called after a successful push to clear dirty state. */
export function clearDirtyState(): void {
  _dirty = false;
  _dirtyFrameIds.clear();
}


// ---------------------------------------------------------------------------
// Debounced push: 5 seconds after last user change.
// Also pushes immediately on blur (tab loses focus).
// ---------------------------------------------------------------------------

const SYNC_DEBOUNCE_MS = 5_000;  // Wait 5s after last change before pushing
const SYNC_MAX_INTERVAL_MS = 5_000;  // During continuous work, push at least every 5s (delta payloads are small)
let _syncDebounceTimer: number | null = null;
let _lastPushAt = 0;  // Timestamp of last successful push

/** Cancel any pending debounce push timer. Called when the device gains focus
 *  so we don't push stale data before pulling from the server. */
export function cancelPendingPush(): void {
  if (_syncDebounceTimer !== null) {
    clearTimeout(_syncDebounceTimer);
    _syncDebounceTimer = null;
  }
}

function scheduleSyncPush(): void {
  // Don't schedule pushes while a pull is in progress — we must not
  // push stale data before we've seen the latest cloud state.
  if (_pullInFlight) return;

  // Debounce: reset the 5-second timer on every change
  if (_syncDebounceTimer !== null) clearTimeout(_syncDebounceTimer);

  // If it's been more than 5 seconds since the last push, push NOW
  // instead of waiting for the user to stop making changes.
  // This ensures data reaches the cloud during continuous work sessions.
  const sinceLast = Date.now() - _lastPushAt;
  if (_lastPushAt > 0 && sinceLast >= SYNC_MAX_INTERVAL_MS) {
    _syncDebounceTimer = null;
    void runCloudSync();
    return;
  }

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
  if (!_dirty) return;
  const pid = cp.projectId;
  cloudSyncInFlight = true;
  try {
    await _syncFn(pid);
    _lastPushAt = Date.now();
    clearDirtyState();
    cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
    _pendingSyncIds.delete(pid);
    hideOfflineBanner();
    emit();
  } catch (e: unknown) {
    const err = e as { status?: number };
    if (err?.status === 409 && _pullFn) {
      // 409 conflict: another device pushed since our last sync.
      // Pull to merge (our _dirtyFrameIds protect local changes),
      // then schedule a retry push with updated base_updated_at.
      cloudSyncInFlight = false; // release lock so pull can proceed
      try {
        await _pullFn();
        // tryPullFromCloud calls clearDirtyState() after merge, but our
        // kept-local frames still need to be pushed. Re-mark dirty and
        // schedule a push — base_updated_at is now up-to-date.
        _dirty = true;
        scheduleSyncPush();
      } catch {
        _pendingSyncIds.add(pid);
      }
      return; // skip the finally's cloudSyncInFlight = false (already cleared)
    }
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
  if (_pullInFlight || _projectSwitchInFlight) {
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
  if (!_dirty) return;

  cloudSyncInFlight = true;
  try {
    await _syncFn(cp.projectId);
    _lastPushAt = Date.now();
    clearDirtyState();
    cp = { ...cp, lastSavedAt: Date.now(), dirty: false };
    hideOfflineBanner();
    emit();
  } catch (e: any) {
    console.warn('[sync] push failed', e);
    if (e?.status === 409 && _pullFn) {
      // Conflict (409) — pull first, then user can push
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
      // Track which frames changed — wrapped in try/catch so scheduleSyncPush
      // is ALWAYS reached even if the tracking logic has an edge-case error.
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
      scheduleSyncPush();
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

}


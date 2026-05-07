// "Current project" coordination. Tracks the in-flight project — its server
// id (if saved), name, dirty flag — and debounces persistence to IndexedDB
// whenever the storyboard changes.
//
// This is intentionally separate from the Zustand store: project metadata
// has different lifecycle and concerns from the UI/data state, and keeping
// it here means the existing imperative core doesn't need to know about it.

import { useStore } from '../store/state';
import { clearSnapshot, saveSnapshot, snapshotFromStore } from './persistence';

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
// Autosave: persist the storyboard to IDB on every storyboard mutation,
// debounced so rapid changes during interaction don't thrash the disk.
// ---------------------------------------------------------------------------

const AUTOSAVE_DEBOUNCE_MS = 800;
let autosaveTimer: number | null = null;

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

/**
 * Subscribe to storyboard changes and schedule an autosave whenever
 * frames/versions change. Call once at app boot.
 */
export function startAutosave(): void {
  let prev = useStore.getState();
  useStore.subscribe((s) => {
    const changed =
      s.frames !== prev.frames ||
      s.versions !== prev.versions ||
      s.activeTab !== prev.activeTab ||
      s.nextId !== prev.nextId;
    prev = s;
    if (!changed) return;
    cp.dirty = true;
    scheduleAutosave();
    emit();
  });
}

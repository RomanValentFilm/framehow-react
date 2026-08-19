// All UI flows for the account/sync system. Each "open*" function returns a
// Promise that resolves when the modal closes — same pattern as lib/modals.ts.
// Higher-level flows (saveNow, project list selection, etc.) compose these.
//
// Network calls go through ./api with the bearer token from ./session.

import { autoPhoneMainView, setViewMode, scrollAnchorTo } from './view';
import { dismissNewProjectModal } from './modals';
import { api, API_BASE_URL } from './api';
import { fhTrack } from './tracking';
import type { ApiError } from './api';
import {
  clearSession,
  getToken,
  getUser,
  isLoggedIn,
  loadCurrentUser,
  logout as serverLogout,
  setSession,
  setUser,
  type SessionUser,
} from './session';
import {
  clearCurrentProject,
  getCurrentProject,
  isDirty,
  getDirtyFrameIds,
  claimStoreAsLocalWork,
  clearDirtyState,
  markSaved,
  isLoadInFlight,
  isPullIncomplete,
  isPushInFlight,
  setCloudSyncInFlight,
  registerCloudSync,
  registerCreateAndSync,
  localProjectId,
  adoptLocalProjectId,
  adoptDirtyFrameIds,
  adoptPushedFingerprints,
  registerFingerprintBridge,
  registerHeardAtBridge,
  registerPullFn,
  registerConnectionWatch,
  dropDirtyFrame,
  setCurrentProject,
  setProjectName,
  setPullInFlight,
  setPullIncomplete,
  setProjectSwitchInFlight,
  flushSyncNow,
  cancelPendingPush,
  beginSystemAction,
  endSystemAction,
  pendingOnDevice,
  markSomethingToSend,
  registerTombstoneBridge,
} from './currentProject';
import { trace } from './syncTrace';
import { frameChangedAt, versionChangedAt, importChangeStamps, stampChangedContent, seedContentStamps, pictureFp, strokesFp } from './changeStamps';
import { shouldSendOnlyChanges } from './pushMode';
import { serverHasSomethingNew, whoseFrameWins, type DeviceMemory } from './sessionRules';
import { mergeDelta, lastMergeRefusal, answerIsSafeToApply, untouchedByDelta, type MergeableTree } from './deltaMerge';
import { settingsForPush, adoptSettingsFromServer, applySettingsToStore, importSettingStamps, stampChangedSettings, seedSettings, settingsNeedPush, reconcileRestoredSettings, captureMySettings, keepMyUnsentSettings, type SettingItem } from './projectSettings';
import { applySnapshotToStore, loadSnapshot, snapshotFromStore, listPending, isArchived, getPending, markPendingUploaded, saveProjectListCache, loadProjectListCache, deletePending, recoverPending, isDeletedCopy, requestDurableStorage } from './persistence';
import type { PendingRecord } from './persistence';
import { showThreeWayConflict, showConfirm, showToast } from './modals';
import { saveOpenTextEdits, saveOpenTableEdits, versionStars } from './helpers';
import { closeSortMode } from './sortOrder';
import { resetStoryboardState, state, useStore, freshNeedDefinitions, DEFAULT_STRIP_DEFS, migrateNeedDefinitions, createDefaultExportMeta } from '../store/state';
import type { Frame, Stroke, Version, FrameNeedState, FrameNoteState, NeedDefinitions, BracketNodeData, ProjectType } from '../store/state';
import { clearRectsForProject } from './pdfAdjust';

// ---------------------------------------------------------------------------
// Device identification — persistent ID + human-readable name
// ---------------------------------------------------------------------------

function getDeviceId(): string {
  const KEY = 'fh_device_id';
  let id = localStorage.getItem(KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(KEY, id);
  }
  return id;
}

function getDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua) || (/Android/i.test(ua) && /Mobile/i.test(ua))) return 'Phone';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'Tablet';
  return 'Desktop';
}

// ---------------------------------------------------------------------------
// Bracket tree frame-ID remapping for cloud sync
// ---------------------------------------------------------------------------

/** Deep-remap all frame IDs in a bracket tree using a lookup map. */
function remapBracketIds<T>(node: any, mapping: Map<number | string, T>): BracketNodeData | undefined {
  const inputIds = (node.inputIds || []).map((id: any) => mapping.get(id)).filter((v: any) => v != null);
  const matchedIds = (node.matchedIds || []).map((id: any) => mapping.get(id)).filter((v: any) => v != null);
  if (inputIds.length === 0 && matchedIds.length === 0) return undefined;
  const out: any = { inputIds, matchedIds };
  if (node.categoryId) out.categoryId = node.categoryId;
  if (node.categoryName) out.categoryName = node.categoryName;
  if (node.itemId) out.itemId = node.itemId;
  if (node.itemName) out.itemName = node.itemName;
  if (node.expanded) out.expanded = true;
  if (node.right) { const r = remapBracketIds(node.right, mapping); if (r) out.right = r; }
  if (node.down) { const d = remapBracketIds(node.down, mapping); if (d) out.down = d; }
  return out;
}

// ---------------------------------------------------------------------------
// Generic modal helpers
// ---------------------------------------------------------------------------

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`accountFlow: missing element #${id}`);
  return node as T;
}

function show(id: string): void {
  el(id).classList.remove('hidden');
}

function hide(id: string): void {
  el(id).classList.add('hidden');
}

function setText(id: string, text: string): void {
  el(id).textContent = text;
}

function setVisible(id: string, visible: boolean): void {
  el(id).style.display = visible ? '' : 'none';
}

function focusFirstInput(modalId: string): void {
  // setTimeout 0 lets the unhide reflow before focus moves.
  setTimeout(() => {
    const input = el(modalId).querySelector<HTMLInputElement | HTMLSelectElement>('input, select');
    if (input) input.focus();
  }, 0);
}

function asMessage(e: unknown, fallback: string): string {
  const err = e as ApiError | undefined;
  return err?.message ?? fallback;
}

function isOnIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1);
}

// ---------------------------------------------------------------------------
// Project name modal
// ---------------------------------------------------------------------------

function openProjectNameModal(initial: string = ''): Promise<string | null> {
  const input = el<HTMLInputElement>('projectNameInput');
  const errorEl = el('projectNameError');
  input.value = initial;
  errorEl.textContent = '';
  show('projectNameModal');
  focusFirstInput('projectNameModal');

  return new Promise((resolve) => {
    const cont = el<HTMLButtonElement>('projectNameContinue');
    const cancel = el<HTMLButtonElement>('projectNameCancel');
    function cleanup(result: string | null): void {
      cont.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
      hide('projectNameModal');
      resolve(result);
    }
    cont.onclick = () => {
      const name = input.value.trim();
      if (name.length === 0) {
        errorEl.textContent = 'Please enter a name.';
        return;
      }
      cleanup(name);
    };
    cancel.onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') cont.click();
      if (e.key === 'Escape') cancel.click();
    };
  });
}

// ---------------------------------------------------------------------------
// Account modal (signup / login toggle)
// ---------------------------------------------------------------------------

type AccountMode = 'signup' | 'login';

interface AccountResult {
  user: SessionUser;
  token: string;
}

function openAccountModal(initialMode: AccountMode = 'signup'): Promise<AccountResult | null> {
  let mode: AccountMode = initialMode;
  const titleEl = el('accountTitle');
  const hintEl = el('accountHint');
  const submit = el<HTMLButtonElement>('accountSubmit');
  const toggle = el<HTMLButtonElement>('accountToggle');
  const toggleTop = el<HTMLButtonElement>('accountToggleTop');
  const topToggleWrap = el('accountTopToggle');
  const forgot = el<HTMLButtonElement>('accountForgot');
  const cancel = el<HTMLButtonElement>('accountCancel');
  const errorEl = el('accountError');
  const nameInput = el<HTMLInputElement>('accountName');
  const emailInput = el<HTMLInputElement>('accountEmail');
  const passInput = el<HTMLInputElement>('accountPassword');
  const profSelect = el<HTMLSelectElement>('accountProfession');

  function switchMode(): void {
    mode = mode === 'signup' ? 'login' : 'signup';
    applyMode();
  }

  function applyMode(): void {
    if (mode === 'signup') {
      titleEl.textContent = 'Create your account';
      hintEl.textContent = 'A free account lets you save and edit on any device.';
      submit.textContent = 'Create account';
      passInput.autocomplete = 'new-password';
      toggle.textContent = 'Already have an account? Log in';
      setVisible('accountRowName', true);
      setVisible('accountRowProfession', true);
      // Top toggle hidden in signup; bottom toggle visible
      topToggleWrap.style.display = 'none';
      toggle.style.display = '';
    } else {
      titleEl.textContent = 'Log in';
      hintEl.textContent = 'Log in to access your projects on any device.';
      submit.textContent = 'Log in';
      passInput.autocomplete = 'current-password';
      toggle.textContent = 'New here? Create an account';
      setVisible('accountRowName', false);
      setVisible('accountRowProfession', false);
      // Top toggle visible in login; bottom toggle hidden
      topToggleWrap.style.display = '';
      toggle.style.display = 'none';
    }
    errorEl.textContent = '';
  }

  nameInput.value = '';
  emailInput.value = '';
  passInput.value = '';
  profSelect.value = '';
  applyMode();
  show('accountModal');
  focusFirstInput('accountModal');

  return new Promise((resolve) => {
    let resolved = false;
    function finish(result: AccountResult | null): void {
      if (resolved) return;
      resolved = true;
      submit.onclick = null;
      toggle.onclick = null;
      toggleTop.onclick = null;
      forgot.onclick = null;
      cancel.onclick = null;
      hide('accountModal');
      resolve(result);
    }

    submit.onclick = async () => {
      errorEl.textContent = '';
      const email = emailInput.value.trim();
      const password = passInput.value;
      try {
        if (mode === 'signup') {
          const name = nameInput.value.trim();
          if (name.length === 0) { errorEl.textContent = 'Please enter your name.'; return; }
          if (email.length === 0) { errorEl.textContent = 'Please enter your email.'; return; }
          if (password.length < 8) { errorEl.textContent = 'Password must be at least 8 characters.'; return; }
          submit.disabled = true;
          const profession = profSelect.value || null;
          const res = await api.post<{
            user: SessionUser;
            session: { token: string; expires_at: number };
          }>('/auth/signup', { name, email, password, profession });
          setSession(res.session.token, res.user);
          fhTrack('signup', { profession: profession || 'none' });
          finish({ user: res.user, token: res.session.token });
        } else {
          if (email.length === 0 || password.length === 0) {
            errorEl.textContent = 'Email and password are required.'; return;
          }
          submit.disabled = true;
          const res = await api.post<{
            user: SessionUser;
            session: { token: string; expires_at: number };
          }>('/auth/login', { email, password });
          setSession(res.session.token, res.user);
          fhTrack('login');
          finish({ user: res.user, token: res.session.token });
        }
      } catch (e) {
        errorEl.textContent = asMessage(e, 'Something went wrong. Please try again.');
      } finally {
        submit.disabled = false;
      }
    };

    toggle.onclick = () => {
      switchMode();
      focusFirstInput('accountModal');
    };

    toggleTop.onclick = () => {
      switchMode();
      focusFirstInput('accountModal');
    };

    forgot.onclick = async () => {
      finish(null);
      const sent = await openForgotModal(emailInput.value.trim());
      if (sent) showToast('Check your email for a reset link.');
    };

    cancel.onclick = () => finish(null);
  });
}

// ---------------------------------------------------------------------------
// Forgot / reset password
// ---------------------------------------------------------------------------

function openForgotModal(prefillEmail: string = ''): Promise<boolean> {
  const input = el<HTMLInputElement>('forgotEmail');
  const errorEl = el('forgotError');
  const successEl = el('forgotSuccess');
  input.value = prefillEmail;
  errorEl.textContent = '';
  successEl.textContent = '';
  show('forgotModal');
  focusFirstInput('forgotModal');

  return new Promise((resolve) => {
    const submit = el<HTMLButtonElement>('forgotSubmit');
    const cancel = el<HTMLButtonElement>('forgotCancel');
    let sent = false;
    function cleanup(result: boolean): void {
      submit.onclick = null;
      cancel.onclick = null;
      hide('forgotModal');
      resolve(result);
    }
    submit.onclick = async () => {
      const email = input.value.trim();
      if (email.length === 0) { errorEl.textContent = 'Please enter your email.'; return; }
      submit.disabled = true;
      try {
        await api.post('/auth/forgot-password', { email });
        sent = true;
        successEl.textContent = 'If an account exists for that email, a reset link is on the way.';
        setTimeout(() => cleanup(sent), 1200);
      } catch (e) {
        errorEl.textContent = asMessage(e, 'Could not send reset email.');
      } finally {
        submit.disabled = false;
      }
    };
    cancel.onclick = () => cleanup(sent);
  });
}

function openResetModal(token: string): Promise<boolean> {
  const input = el<HTMLInputElement>('resetPassword');
  const errorEl = el('resetError');
  input.value = '';
  errorEl.textContent = '';
  show('resetModal');
  focusFirstInput('resetModal');

  return new Promise((resolve) => {
    const submit = el<HTMLButtonElement>('resetSubmit');
    const cancel = el<HTMLButtonElement>('resetCancel');
    function cleanup(result: boolean): void {
      submit.onclick = null;
      cancel.onclick = null;
      hide('resetModal');
      resolve(result);
    }
    submit.onclick = async () => {
      const password = input.value;
      if (password.length < 8) { errorEl.textContent = 'Password must be at least 8 characters.'; return; }
      submit.disabled = true;
      try {
        await api.post('/auth/reset-password', { token, password });
        cleanup(true);
      } catch (e) {
        errorEl.textContent = asMessage(e, 'This reset link is invalid or has expired.');
      } finally {
        submit.disabled = false;
      }
    };
    cancel.onclick = () => cleanup(false);
  });
}

// ---------------------------------------------------------------------------
// Project list
// ---------------------------------------------------------------------------

interface CloudProject {
  id: string;
  name: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
}

export async function openProjectList(): Promise<void> {
  if (!isLoggedIn()) {
    await openLoginThenContinue();
    if (!isLoggedIn()) return;
  }
  const content = el('projectListContent');
  content.textContent = 'Loading…';
  show('projectListModal');

  let editMode = false;
  let projects: CloudProject[] = [];

  const editBtn = el<HTMLButtonElement>('projectListEdit');
  editBtn.textContent = 'Edit Projects';

  return new Promise((resolve) => {
    const closeBtn = el<HTMLButtonElement>('projectListClose');
    const newBtn = el<HTMLButtonElement>('projectListNew');
    const headerRow = newBtn.parentElement as HTMLElement;
    const title = headerRow.querySelector('h2') as HTMLElement;

    function setEditModeUI(on: boolean): void {
      editBtn.textContent = on ? 'Done' : 'Edit Projects';
      if (on) {
        editBtn.classList.add('btn-danger');
      } else {
        editBtn.classList.remove('btn-danger');
      }
      title.style.display = on ? 'none' : '';
      newBtn.style.display = on ? 'none' : '';
    }

    function cleanup(): void {
      closeBtn.onclick = null;
      newBtn.onclick = null;
      editBtn.onclick = null;
      editMode = false;
      setEditModeUI(false);
      hide('projectListModal');
      resolve();
    }
    closeBtn.onclick = () => {
      if (editMode) {
        editMode = false;
        setEditModeUI(false);
        renderList();
        return;
      }
      cleanup();
      if (state().frames.length === 0) {
        window.dispatchEvent(new CustomEvent('fh:open-signpost'));
      }
    };
    newBtn.onclick = async () => {
      cleanup();
      await startNewProject();
    };
    editBtn.onclick = () => {
      editMode = !editMode;
      setEditModeUI(editMode);
      renderList();
    };

    /** Open an offline copy that is already in the cloud. This replaces what
     *  you are working on, so it is a deliberate act and asks first. */
    async function onPickArchived(rec: PendingRecord): Promise<void> {
      if (editMode) return;
      const ok = await showConfirm(
        `Open the offline copy of "${rec.name || 'this project'}" from ` +
        `${formatClockTime(rec.savedAt)}?\n\n` +
        `It replaces what is currently open. The cloud version is updated only ` +
        `when this is saved.`,
      );
      if (!ok) return;
      cleanup();
      if (!rec.snapshot?.frames?.length) { showToast('That copy is empty — nothing to open.'); return; }
      beginSystemAction();
      try {
        applySnapshotToStore(rec.snapshot);
        setCurrentProject({ projectId: rec.projectId, name: rec.name });
      } finally {
        endSystemAction();
      }
      // The user picked this version, so it wins and gets uploaded. Without
      // this the next pull replaced it with the cloud copy seconds later.
      claimStoreAsLocalWork();
      (window as any).__fh_renderAll?.();
      setViewMode(state().currentViewMode);
    }

    /** Open a project that exists only on this device. */
    function onPickDevice(rec: PendingRecord): void {
      if (editMode) return;
      cleanup();
      if (!rec.snapshot?.frames?.length) { showToast('That copy is empty — nothing to open.'); return; }
      beginSystemAction();
      try {
        applySnapshotToStore(rec.snapshot);
        setCurrentProject({ projectId: rec.projectId, name: rec.name });
        // Keep the identity this copy is already filed under. Otherwise the
        // project would be filed a second time under a fresh key, and the
        // clear-on-confirmation would remove the wrong one.
        adoptLocalProjectId(rec.key);
      } finally {
        endSystemAction();
      }
      claimStoreAsLocalWork();
      (window as any).__fh_renderAll?.();
      // Put it in the cloud now if we can. saveNow() creates the project and
      // uploads it; on success the device copy is dropped, never before.
      void saveNow();
    }

    /** Every re-render goes through here, so the offline entries can never be
     *  dropped by a call site that forgot to pass them — which is exactly what
     *  made them vanish when EDIT was pressed. */
    function renderList(): void {
      renderProjectList(projects, editMode, onPick, onEdit, onDelete, onRecover,
                        deviceOnly, onPickDevice, archived, onPickArchived,
                        offlineListing, onDeleteLocal, deletedCopies, onRecoverLocal);
    }

    function onPick(p: CloudProject): void {
      if (editMode) return;
      cleanup();
      void loadCloudProject(p);
    }

    async function onEdit(p: CloudProject): Promise<void> {
      hide('projectListModal');
      const newName = await promptRenameProject(p.name);
      if (newName && newName !== p.name) {
        try {
          await api.put(`/projects/${encodeURIComponent(p.id)}`, { name: newName }, getToken());
          p.name = newName;
        } catch (e) {
          showToast(asMessage(e, 'Could not rename project.'));
        }
      }
      show('projectListModal');
      renderList();
    }

    async function onDelete(p: CloudProject): Promise<void> {
      hide('projectListModal');
      const confirmed = await promptDeleteConfirm();
      if (!confirmed) { show('projectListModal'); return; }
      const accepted = await promptDeleteNotice();
      if (!accepted) { show('projectListModal'); return; }
      try {
        await api.delete(`/projects/${encodeURIComponent(p.id)}`, getToken());
        p.deleted_at = Date.now();
        clearRectsForProject(p.id);
      } catch (e) {
        showToast(asMessage(e, 'Could not delete project.'));
      }
      show('projectListModal');
      renderList();
    }

    async function onRecover(p: CloudProject): Promise<void> {
      hide('projectListModal');
      const confirmed = await promptRecoverConfirm();
      if (!confirmed) { show('projectListModal'); return; }
      try {
        await api.post(`/projects/${encodeURIComponent(p.id)}/recover`, undefined, getToken());
        p.deleted_at = null;
      } catch (e) {
        showToast(asMessage(e, 'Could not recover project.'));
      }
      show('projectListModal');
      renderList();
    }

    let deviceOnly: PendingRecord[] = [];
    let archived: PendingRecord[] = [];
    let deletedCopies: PendingRecord[] = [];
    let offlineListing = false;

    /** Put a deleted copy back within its 24 hours. */
    async function onRecoverLocal(rec: PendingRecord): Promise<void> {
      await recoverPending(rec.key);
      deletedCopies = deletedCopies.filter((r) => r.key !== rec.key);
      if (isArchived(rec)) archived = [...archived, rec]; else deviceOnly = [...deviceOnly, rec];
      renderList();
    }

    /** Remove an offline copy the user does not want to keep. */
    async function onDeleteLocal(rec: PendingRecord): Promise<void> {
      const ok = await showConfirm(
        `Delete the offline copy of "${rec.name || 'this project'}" from ` +
        `${formatClockTime(rec.savedAt)}?\n\n` +
        (isArchived(rec)
          ? 'It is already in the cloud, so only this device copy goes.'
          : 'This work is NOT in the cloud yet. Deleting it cannot be undone.'),
      );
      if (!ok) return;
      await deletePending(rec.key);
      deviceOnly = deviceOnly.filter((r) => r.key !== rec.key);
      archived = archived.filter((r) => r.key !== rec.key);
      renderList();
    }
    void (async () => {
      try {
        // Projects that only exist on this device — made or edited offline and
        // never confirmed by the server. They belong in the same list, or the
        // user has no way to reach their own work.
        const allLocal = await listPending();
        // EVERY piece of unsent work gets its own openable row — not just
        // projects that have never been to the cloud. Work on a cloud project
        // used to appear only as a note on the cloud row, which offline is
        // dimmed and refuses to open: the work was on the device with no way
        // to reach it.
        // Deleted copies stay recoverable for 24 hours, so they are kept but
        // only shown while the list is in Edit mode — same as a deleted project.
        deviceOnly = allLocal.filter((r) => !isArchived(r) && !isDeletedCopy(r));
        archived = allLocal.filter((r) => isArchived(r) && !isDeletedCopy(r));
        deletedCopies = allLocal.filter((r) => isDeletedCopy(r));
        const res = await api.get<{ projects: CloudProject[] }>('/projects', getToken());
        projects = res.projects;
        void saveProjectListCache(projects);   // so the list is not empty offline
        renderList();
      } catch (e) {
        // No connection: still show whatever is held on this device.
        if (deviceOnly.length > 0) {
          renderList();
        } else {
          content.textContent = asMessage(e, 'Could not load your projects.');
        }
      }
    })();
  });
}

// ── Project list rendering ──────────────────────────────────────────────────

function renderProjectList(
  projects: CloudProject[],
  editMode: boolean,
  onPick: (p: CloudProject) => void,
  onEdit: (p: CloudProject) => void,
  onDelete: (p: CloudProject) => void,
  onRecover: (p: CloudProject) => void,
  deviceOnly: PendingRecord[] = [],
  onPickDevice?: (rec: PendingRecord) => void,
  archived: PendingRecord[] = [],
  onPickArchived?: (rec: PendingRecord) => void,
  /** True when the cloud list could not be fetched and we are showing the
   *  last one we saw. Those rows can be read but not opened. */
  offlineListing = false,
  onDeleteLocal?: (rec: PendingRecord) => void,
  /** Copies deleted within the last 24 hours — shown greyed in Edit mode with
   *  a Recover option, exactly as a deleted project is. */
  deletedCopies: PendingRecord[] = [],
  onRecoverLocal?: (rec: PendingRecord) => void,
): void {
  const content = el('projectListContent');
  content.innerHTML = '';
  document.getElementById('projectListOfflineNote')?.classList.toggle('hidden', !offlineListing);

  // One list, most recent first, so the project you are working on is at the
  // top and everything else falls into place behind it by when it was last
  // touched — cloud projects and offline copies together.
  type Row = { at: number; render: () => HTMLElement };
  const rows: Row[] = [];
  const openId = getCurrentProject().projectId;

  const localRow = (rec: PendingRecord, archivedCopy: boolean): HTMLElement => {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'project-list-row';
    const name = document.createElement('span');
    name.className = 'project-list-name';
    name.textContent = rec.name || 'Unnamed project';
    if (archivedCopy) name.style.cssText = 'font-style:italic;color:#888;';
    row.appendChild(name);
    const tag = document.createElement('span');
    tag.textContent = archivedCopy
      ? `offline copy from ${formatClockTime(rec.savedAt)} — already uploaded`
      : `saved offline at ${formatClockTime(rec.savedAt)} — open to upload`;
    tag.style.cssText = archivedCopy
      ? 'font-style:italic;color:#888;font-size:11px;margin-left:8px;'
      : 'color:#d52632;font-size:11px;margin-left:8px;';
    row.appendChild(tag);
    if (editMode && onDeleteLocal) {
      const del = document.createElement('span');
      del.textContent = 'Delete';
      del.style.cssText = 'color:#ff6b6b;font-size:12px;margin-left:auto;cursor:pointer;';
      del.onclick = (e) => { e.stopPropagation(); onDeleteLocal(rec); };
      row.appendChild(del);
    } else {
      row.onclick = () => (archivedCopy ? onPickArchived?.(rec) : onPickDevice?.(rec));
    }
    return row;
  };

  for (const rec of archived) rows.push({ at: rec.savedAt, render: () => localRow(rec, true) });
  if (editMode) {
    for (const rec of deletedCopies) rows.push({
      at: rec.savedAt,
      render: () => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'project-list-row';
        row.style.opacity = '0.35';
        const name = document.createElement('span');
        name.className = 'project-list-name';
        name.textContent = rec.name || 'Unnamed project';
        name.style.fontStyle = 'italic';
        row.appendChild(name);
        const tag = document.createElement('span');
        tag.textContent = `deleted copy from ${formatClockTime(rec.savedAt)}`;
        tag.style.cssText = 'color:#888;font-size:11px;margin-left:8px;';
        row.appendChild(tag);
        const rec2 = document.createElement('span');
        rec2.textContent = 'Recover';
        rec2.style.cssText = 'color:#6b9aff;font-size:12px;margin-left:auto;cursor:pointer;';
        rec2.onclick = (e) => { e.stopPropagation(); onRecoverLocal?.(rec); };
        row.appendChild(rec2);
        return row;
      },
    });
  }
  for (const rec of deviceOnly) rows.push({ at: rec.savedAt, render: () => localRow(rec, false) });

  if (projects.length === 0 && deviceOnly.length === 0 && archived.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'project-list-empty';
    empty.textContent = 'No saved projects yet. Click "New project" to start.';
    content.appendChild(empty);
    return;
  }
  for (const p of projects) rows.push({
    at: p.id === openId ? Number.MAX_SAFE_INTEGER : (p.updated_at || 0),
    render: () => cloudRow(p),
  });

  // Most recent first; the project currently open is pinned to the top.
  rows.sort((a, b) => b.at - a.at);
  for (const r of rows) content.appendChild(r.render());

  function cloudRow(p: CloudProject): HTMLElement {
    const isDeleted = p.deleted_at != null;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'project-list-row';
    if (isDeleted) row.style.opacity = '0.35';
    if (offlineListing) row.style.opacity = '0.45';
    const name = document.createElement('span');
    name.className = 'project-list-name';
    name.textContent = p.name;
    row.appendChild(name);

    if (p.id === openId) {
      const nowTag = document.createElement('span');
      nowTag.textContent = 'just now — open';
      nowTag.style.cssText = 'color:#888;font-size:11px;margin-left:8px;';
      row.appendChild(nowTag);
    }

    // Work on this device that the server has not confirmed yet. Opening the
    // project here uploads it; opening it elsewhere would not show it.
    if (offlineListing) {
      const off = document.createElement('span');
      off.textContent = 'needs a connection to open';
      off.style.cssText = 'color:#888;font-size:11px;margin-left:8px;';
      row.appendChild(off);
    }

    const waiting = pendingOnDevice().find((w) => w.projectId === p.id);
    if (waiting) {
      const tag = document.createElement('span');
      tag.textContent = `offline changes from ${formatClockTime(waiting.savedAt)} — open here to upload`;
      tag.style.cssText = 'color:#d52632;font-size:11px;margin-left:8px;';
      row.appendChild(tag);
    }

    if (editMode) {
      const actions = document.createElement('span');
      actions.className = 'project-list-meta';
      actions.style.display = 'flex';
      actions.style.gap = '12px';
      if (isDeleted) {
        const recoverBtn = document.createElement('span');
        recoverBtn.textContent = 'Recover';
        recoverBtn.style.cursor = 'pointer';
        recoverBtn.style.color = '#6b9aff';
        recoverBtn.onclick = (e) => { e.stopPropagation(); void onRecover(p); };
        actions.appendChild(recoverBtn);
      } else {
        const editBtn = document.createElement('span');
        editBtn.textContent = 'Edit';
        editBtn.style.cursor = 'pointer';
        editBtn.style.color = '#6b9aff';
        editBtn.onclick = (e) => { e.stopPropagation(); void onEdit(p); };
        const delBtn = document.createElement('span');
        delBtn.textContent = 'Delete';
        delBtn.style.cursor = 'pointer';
        delBtn.style.color = '#ff6b6b';
        delBtn.onclick = (e) => { e.stopPropagation(); void onDelete(p); };
        actions.append(editBtn, delBtn);
      }
      row.appendChild(actions);
    } else {
      if (!isDeleted) {
        const meta = document.createElement('span');
        meta.className = 'project-list-meta';
        meta.textContent = formatRelative(p.updated_at);
        row.appendChild(meta);
      }
    }
    if (!editMode) {
      row.onclick = isDeleted
        ? null
        : offlineListing
          ? () => showToast('This project is in the cloud — you need a connection to open it.')
          : () => onPick(p);
      if (isDeleted) row.style.cursor = 'default';
    }
    return row;
  }
}

// ── Confirmation dialogs ────────────────────────────────────────────────────

function promptDeleteConfirm(): Promise<boolean> {
  return new Promise((resolve) => {
    show('deleteConfirmModal');
    el<HTMLButtonElement>('deleteConfirmCancel').onclick = () => { hide('deleteConfirmModal'); resolve(false); };
    el<HTMLButtonElement>('deleteConfirmYes').onclick = () => { hide('deleteConfirmModal'); resolve(true); };
  });
}

function promptDeleteNotice(): Promise<boolean> {
  return new Promise((resolve) => {
    show('deleteNoticeModal');
    el<HTMLButtonElement>('deleteNoticeCancel').onclick = () => { hide('deleteNoticeModal'); resolve(false); };
    el<HTMLButtonElement>('deleteNoticeOk').onclick = () => { hide('deleteNoticeModal'); resolve(true); };
  });
}

function promptRecoverConfirm(): Promise<boolean> {
  return new Promise((resolve) => {
    show('recoverConfirmModal');
    el<HTMLButtonElement>('recoverConfirmNo').onclick = () => { hide('recoverConfirmModal'); resolve(false); };
    el<HTMLButtonElement>('recoverConfirmYes').onclick = () => { hide('recoverConfirmModal'); resolve(true); };
  });
}

function promptRenameProject(currentName: string): Promise<string | null> {
  return new Promise((resolve) => {
    const input = el<HTMLInputElement>('renameProjectInput');
    const errorDiv = el('renameProjectError');
    input.value = currentName;
    errorDiv.textContent = '';
    show('renameProjectModal');
    setTimeout(() => { input.focus(); input.select(); }, 50);
    el<HTMLButtonElement>('renameProjectCancel').onclick = () => { hide('renameProjectModal'); resolve(null); };
    el<HTMLButtonElement>('renameProjectSave').onclick = () => {
      const name = input.value.trim();
      if (!name) { errorDiv.textContent = 'Name cannot be empty.'; return; }
      hide('renameProjectModal');
      resolve(name);
    };
  });
}

function formatRelative(ts: number): string {
  const now = Date.now();
  const ago = Math.max(0, now - ts);
  const min = 60_000, hour = 60 * min, day = 24 * hour;
  if (ago < min) return 'just now';
  if (ago < hour) return `${Math.round(ago / min)} min ago`;
  if (ago < day) return `${Math.round(ago / hour)} hr ago`;
  return new Date(ts).toLocaleDateString();
}

/** Open a project the server holds, by its id — the same path the project list
 *  takes when you tap one. Used by the browser tests, which have no list to tap
 *  (#309). */
export async function openCloudProjectById(id: string): Promise<void> {
  const list = await api.get<{ projects: CloudProject[] }>('/projects', getToken());
  const p = (list.projects ?? []).find((x) => x.id === id);
  if (!p) throw new Error(`no project ${id} on the server`);
  await loadCloudProject(p);
}

async function loadCloudProject(p: CloudProject): Promise<void> {
  const cp = getCurrentProject();
  // Spec: "Only One Unsaved Project" — if there's local unsaved work, warn.
  if (cp.dirty && cp.projectId !== p.id) {
    const ok = await confirmReplaceUnsaved();
    if (!ok) return;
  }

  // Show loading progress overlay
  const progressEl = document.getElementById('progressOverlay');
  const progressBar = document.getElementById('progressBar') as HTMLElement | null;
  const progressLabel = document.getElementById('progressLabel') as HTMLElement | null;
  if (progressEl) { progressEl.classList.remove('hidden'); }
  if (progressLabel) progressLabel.textContent = 'Loading project…';
  if (progressBar) progressBar.style.width = '10%';

  try {
    // 1. Flush-save current project before switching (blocking)
    await flushSyncNow();
    if (progressBar) progressBar.style.width = '20%';
    // 2. Pause auto-sync to prevent cross-contamination during load
    setProjectSwitchInFlight(true);
    // 3. Load new project from cloud
    if (progressLabel) progressLabel.textContent = 'Downloading…';
    const tree = await api.get<CloudProjectTree>(`/projects/${encodeURIComponent(p.id)}/sync`, getToken());
    if (progressBar) progressBar.style.width = '50%';
    if (progressLabel) progressLabel.textContent = 'Applying…';
    // Close sort-edit view if open so new project renders into visible columns
    if (state().sortEditingId) closeSortMode();
    // System action: prevent setState calls from being treated as user changes
    beginSystemAction();
    try {
      await applyCloudTreeToStore(tree, undefined, (loaded, total) => {
        if (total === 0) return;
        // Map image progress from 50% → 85%
        const pct = 50 + Math.round((loaded / total) * 35);
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressLabel) progressLabel.textContent = `Loading image ${loaded} of ${total}…`;
      });
    } finally {
      endSystemAction();
    }
    if (progressBar) progressBar.style.width = '85%';
    updateLastKnownTimestamp(tree.project.updated_at);
    takenFromServerAt = tree.project.updated_at;   // opening a project IS taking (#299)
    setCurrentProject({ projectId: p.id, name: p.name, lastSavedAt: tree.project.updated_at });
    clearDirtyState(); // Fresh project load — nothing dirty
    fhTrack('project_opened', { name: p.name });
    (window as any).__fh_renderAll?.();
    autoPhoneMainView();
    if (progressBar) progressBar.style.width = '100%';
    setTimeout(() => {
      if (progressEl) progressEl.classList.add('hidden');
      // Show incomplete overlay AFTER progress bar is gone
      if (isPullIncomplete()) showIncompleteLoadOverlay();
      else hideIncompleteLoadOverlay();
    }, 300);
  } catch (e) {
    if (progressEl) progressEl.classList.add('hidden');
    showToast(asMessage(e, 'Could not load project.'));
  } finally {
    // 5. Resume auto-sync
    setProjectSwitchInFlight(false);
  }
}

async function confirmReplaceUnsaved(): Promise<boolean> {
  // Returns true if the caller should proceed with the load (and discard the
  // local unsaved work). Returns false if the user wants to keep their work.
  return await showConfirm(
    'You have unsaved work that will be discarded. Continue loading this project?',
  );
}

// ---------------------------------------------------------------------------
// Account settings + change password
// ---------------------------------------------------------------------------

export async function openAccountSettings(): Promise<void> {
  if (!isLoggedIn()) {
    await openLoginThenContinue();
    if (!isLoggedIn()) return;
  }
  const me = getUser()!;
  const nameInput = el<HTMLInputElement>('settingsName');
  const profSelect = el<HTMLSelectElement>('settingsProfession');
  const emailEl = el('settingsEmail');
  const errorEl = el('settingsError');
  const successEl = el('settingsSuccess');

  nameInput.value = me.name;
  profSelect.value = me.profession ?? '';
  emailEl.textContent = me.email + (me.email_verified ? '' : '  (unverified)');
  errorEl.textContent = '';
  successEl.textContent = '';
  show('accountSettingsModal');
  focusFirstInput('accountSettingsModal');

  return new Promise((resolve) => {
    const closeBtn = el<HTMLButtonElement>('settingsClose');
    const saveBtn = el<HTMLButtonElement>('settingsSave');
    const cpBtn = el<HTMLButtonElement>('settingsChangePassword');
    const logoutBtn = el<HTMLButtonElement>('settingsLogout');
    const deleteBtn = el<HTMLButtonElement>('settingsDeleteAccount');
    function cleanup(): void {
      closeBtn.onclick = null;
      saveBtn.onclick = null;
      cpBtn.onclick = null;
      logoutBtn.onclick = null;
      deleteBtn.onclick = null;
      hide('accountSettingsModal');
      resolve();
    }
    closeBtn.onclick = cleanup;
    saveBtn.onclick = async () => {
      const name = nameInput.value.trim();
      const profession = profSelect.value || null;
      if (name.length === 0) { errorEl.textContent = 'Name is required.'; return; }
      saveBtn.disabled = true;
      try {
        const res = await api.put<{ user: SessionUser }>('/user/me', { name, profession }, getToken());
        setUser(res.user);
        successEl.textContent = 'Saved.';
        errorEl.textContent = '';
        setTimeout(() => { successEl.textContent = ''; }, 2000);
      } catch (e) {
        errorEl.textContent = asMessage(e, 'Could not save changes.');
      } finally {
        saveBtn.disabled = false;
      }
    };
    cpBtn.onclick = async () => {
      const okPw = await openChangePasswordModal();
      if (okPw) showToast('Password updated.');
    };
    logoutBtn.onclick = async () => {
      cleanup();
      await serverLogout();
      if (state().sortEditingId) closeSortMode();
      resetStoryboardState();
      clearCurrentProject();
      clearPushedFingerprints();
      (window as any).__fh_renderAll?.();
      showToast('Logged out.');
    };
    deleteBtn.onclick = async () => {
      const okDelete = await showConfirm(
        'Are you sure you want to delete your account? All your data on Framehow will be permanently deleted. This cannot be undone.',
      );
      if (!okDelete) return;
      try {
        await api.delete('/user/me', getToken());
        clearSession();
        if (state().sortEditingId) closeSortMode();
        resetStoryboardState();
        clearCurrentProject();
        clearPushedFingerprints();
        (window as any).__fh_renderAll?.();
        cleanup();
        showToast('Account deleted.');
      } catch (e) {
        errorEl.textContent = asMessage(e, 'Could not delete account.');
      }
    };
  });
}

function openChangePasswordModal(): Promise<boolean> {
  const cur = el<HTMLInputElement>('cpCurrent');
  const next = el<HTMLInputElement>('cpNew');
  const errorEl = el('cpError');
  cur.value = '';
  next.value = '';
  errorEl.textContent = '';
  show('changePasswordModal');
  focusFirstInput('changePasswordModal');

  return new Promise((resolve) => {
    const submit = el<HTMLButtonElement>('cpSubmit');
    const cancel = el<HTMLButtonElement>('cpCancel');
    function cleanup(result: boolean): void {
      submit.onclick = null;
      cancel.onclick = null;
      hide('changePasswordModal');
      resolve(result);
    }
    submit.onclick = async () => {
      if (cur.value.length === 0) { errorEl.textContent = 'Current password is required.'; return; }
      if (next.value.length < 8) { errorEl.textContent = 'New password must be at least 8 characters.'; return; }
      submit.disabled = true;
      try {
        await api.put('/user/password', { current_password: cur.value, new_password: next.value }, getToken());
        cleanup(true);
      } catch (e) {
        errorEl.textContent = asMessage(e, 'Could not update password.');
      } finally {
        submit.disabled = false;
      }
    };
    cancel.onclick = () => cleanup(false);
  });
}

// ---------------------------------------------------------------------------
// Save toaster
// ---------------------------------------------------------------------------

let toasterDismissCount = 0;
let toasterShowing = false;
let toasterRescheduleId: number | null = null;

const TOASTER_RESHOW_AFTER_LATER_MS = 15 * 60 * 1000;

export function isToasterShowing(): boolean { return toasterShowing; }

export function showSaveToaster(): void {
  // Don't double-fire; don't show if user is logged in & this project is saved.
  if (toasterShowing) return;
  if (toasterDismissCount >= 2) return;
  if (isLoggedIn() && getCurrentProject().projectId !== null && !getCurrentProject().dirty) return;

  const msg = isOnIOS()
    ? "To edit this project on your desktop, you'll need to save it first."
    : "To edit this project on your iPad or iPhone, you'll need to save it first.";

  setText('saveToasterMsg', msg);
  show('saveToaster');
  toasterShowing = true;

  const saveBtn = el<HTMLButtonElement>('saveToasterSave');
  const laterBtn = el<HTMLButtonElement>('saveToasterLater');
  function dismiss(savedNow: boolean): void {
    saveBtn.onclick = null;
    laterBtn.onclick = null;
    hide('saveToaster');
    toasterShowing = false;
    if (savedNow) return;
    toasterDismissCount += 1;
    if (toasterDismissCount === 1) {
      if (toasterRescheduleId !== null) clearTimeout(toasterRescheduleId);
      toasterRescheduleId = window.setTimeout(() => {
        toasterRescheduleId = null;
        showSaveToaster();
      }, TOASTER_RESHOW_AFTER_LATER_MS);
    }
    // After dismissCount === 2 we leave it alone for the rest of the session.
  }
  saveBtn.onclick = async () => {
    dismiss(true);
    await saveNow();
  };
  laterBtn.onclick = () => dismiss(false);
}

// ---------------------------------------------------------------------------
// High-level flows
// ---------------------------------------------------------------------------

export async function saveNow(): Promise<void> {
  // 0. Block save if project is still loading (pull or project switch in progress).
  //    Saving incomplete state would overwrite good data on the server.
  if (isLoadInFlight()) {
    showToast('Project still loading…');
    return;
  }

  // 1. Ensure project name.
  let cp = getCurrentProject();
  if (!cp.name) {
    const name = await openProjectNameModal();
    if (!name) return;
    setProjectName(name);
    cp = getCurrentProject();
  }

  // 2. Ensure logged in.
  if (!isLoggedIn()) {
    const result = await openAccountModal('signup');
    if (!result) return;
  }

  // 3. Create project on server if we don't have an id yet.
  let projectId = cp.projectId;
  if (!projectId) {
    try {
      const res = await api.post<{ project: { id: string; name: string; updated_at: number } }>(
        '/projects',
        { name: cp.name },
        getToken(),
      );
      projectId = res.project.id;
      markSaved(projectId);
      fhTrack('project_created', { name: cp.name });
    } catch (e) {
      // A named project the user asked to save, which cannot reach the server:
      // this is exactly the moment to explain what happens next.
      if (!navigator.onLine || e instanceof TypeError) {
        const { showImportantNote } = await import('./modals');
        await showImportantNote(
          'IMPORTANT NOTE',
          'Your device seems to be working offline. Once THIS DEVICE is online again, ' +
          'open FRAMEHOW on THIS DEVICE and the project will upload to the cloud. ' +
          'Until then, your changes are not available on other devices.',
        );
        return;
      }
      showToast(asMessage(e, 'Could not create project.'));
      return;
    }
  }

  // 4. Wait for any background sync (flushSyncNow) to finish first.
  //    On iOS, opening the menu fires flushSyncNow() which can still be
  //    in flight when the user taps Save. If we sync concurrently the
  //    server rejects the second request as a conflict.
  if (isPushInFlight()) {
    showToast('WAIT…');
    const MAX_WAIT = 15_000;
    const start = Date.now();
    while (isPushInFlight() && Date.now() - start < MAX_WAIT) {
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // 5. Sync the current state to /sync.
  //    Set cloudSyncInFlight so the debounced push doesn't
  //    fire a concurrent sync while we're uploading images / POSTing.
  setCloudSyncInFlight(true);
  try {
    await syncCurrentToServer(projectId);
    markSaved(projectId);
    clearDirtyState();
    updateLastKnownTimestamp(Date.now());

    // If this project was carrying work made offline, put a restore point in
    // the cloud stamped with when that work was actually made — so it is
    // recoverable from any device, not just this one. Then hand the device
    // copy over to its 24-hour safety window.
    for (const key of [localProjectId(), projectId]) {
      const rec = await getPending(key);
      if (!rec) continue;
      try {
        await api.post(
          `/projects/${encodeURIComponent(projectId)}/snapshots`,
          { reason: 'offline', madeAt: rec.savedAt },
          getToken(),
        );
      } catch { /* the copy stays on the device either way */ }
      await markPendingUploaded(key);
    }

    fhTrack('project_saved');
    showToast('SAVED.');
  } catch (e) {
    showToast(asMessage(e, 'Could not save project.'));
  } finally {
    setCloudSyncInFlight(false);
  }
}

async function startNewProject(): Promise<void> {
  // Spec: only one unsaved project at a time.
  const cp = getCurrentProject();
  if (cp.dirty) {
    const ok = await showConfirm(
      'Start a new project?\n\n' +
      'Your current work is kept on this device and stays in the project list ' +
      'until it has reached the cloud.',
    );
    if (!ok) return;
  }
  if (state().sortEditingId) closeSortMode();

  // File the outgoing project BEFORE the store is wiped. Online this uploads
  // it; offline it is written to the device under its own key. Opening another
  // project already did this — creating a new one did not, and relied on the
  // last failed push having happened to catch everything.
  await flushSyncNow();

  resetStoryboardState();
  resetProjectSyncGuards();
  useStore.setState({ portraitMode: false, projectType: 'landscape' });
  clearCurrentProject();
  clearPushedFingerprints();
  // Clear stale timestamp from previous project so the first sync for the new
  // project doesn't carry an old base_updated_at that could trigger a 409.
  lastKnownUpdatedAt = null;
  takenFromServerAt = null;        // a different project — nothing taken yet (#299)
  // Refresh DOM
  (window as any).__fh_renderAll?.();
  // Show Signpost modal so the user can pick what to do next
  window.dispatchEvent(new CustomEvent('fh:open-signpost'));
}

async function openLoginThenContinue(): Promise<void> {
  await openAccountModal('login');
}

// ---------------------------------------------------------------------------
// R2 image helpers
// ---------------------------------------------------------------------------

function isLocalImage(src: string): boolean {
  return src.startsWith('data:') || src.startsWith('blob:');
}

async function localImageToBlob(src: string): Promise<{ blob: Blob; contentType: string }> {
  if (src.startsWith('data:')) {
    const match = src.match(/^data:([^;]+);base64,(.+)$/s);
    if (!match) throw new Error('Invalid data URL');
    const contentType = match[1];
    const base64 = match[2];
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { blob: new Blob([bytes], { type: contentType }), contentType };
  }
  if (src.startsWith('blob:')) {
    const res = await fetch(src);
    const blob = await res.blob();
    return { blob, contentType: blob.type || 'image/png' };
  }
  throw new Error('Not a local image');
}

async function uploadImageToR2(
  src: string,
  token: string,
): Promise<{ r2_key: string; size_bytes: number; content_type: string }> {
  const { blob, contentType } = await localImageToBlob(src);
  const res = await fetch(`${API_BASE_URL}/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': contentType,
      'Authorization': `Bearer ${token}`,
    },
    body: blob,
  });
  if (!res.ok) {
    const text = await res.text();
    let body: any = {};
    try { body = JSON.parse(text); } catch { /* ignore */ }
    throw {
      status: res.status,
      code: body?.error?.code ?? 'upload_failed',
      message: body?.error?.message ?? 'Image upload failed.',
    } as ApiError;
  }
  return res.json();
}

// R2 image cache: avoids re-downloading the same image when pulling updates
// that didn't actually change the images. Keyed by r2_key → data URL.
const r2ImageCache = new Map<string, string>();

async function fetchImageFromR2(r2Key: string, token: string): Promise<string> {
  const cached = r2ImageCache.get(r2Key);
  if (cached) return cached;

  const res = await fetch(`${API_BASE_URL}/images/${r2Key}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      r2ImageCache.set(r2Key, dataUrl);
      resolve(dataUrl);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------------------
// Sync mapping (local store ↔ backend tree)
// ---------------------------------------------------------------------------

interface CloudProjectTree {
  project: { id: string; name: string; created_at: number; updated_at: number; last_device_id: string | null; last_device_name: string | null; metadata: string | null };
  strips: Array<{ id: string; project_id: string; label: string | null; sort_order: number; updated_at: number }>;
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: number; note: string | null; scribbles: string | null; updated_at: number;
    /** Owned by the frame. Older rows have none — the metadata list covers those. */
    needs?: string | null; notes?: string | null; setup_id?: string | null;
    /** When the change was MADE, not when it was sent. Absent on older rows. */
    content_changed_at?: number | null }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: number; starred: number; note: string | null; updated_at: number; tags?: string | null; content_changed_at?: number | null }>;
  images: Array<{ id: string; version_id: string; r2_key: string; width: number | null; height: number | null; size_bytes: number | null; content_type: string | null; updated_at: number }>;
  drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }>;
  deletions?: Array<{ id: string; entity_type: string; entity_id: string; deleted_at: number; device_id: string | null }>;
  /** Project settings, one entry per item. Absent from an older server. */
  settings?: SettingItem[];
  /** The server's clock when it answered. Sent back as `since` next time — the
   *  device's own clock is never used for this (#280). */
  server_now?: number;
  /** false = only what changed since `since`. Absent or true = the whole thing. */
  full?: boolean;
}

function uuid(): string {
  return crypto.randomUUID();
}

/** Count non-null images across all frames and strip versions in the current state. */
function countCurrentImages(): number {
  const s = state();
  let count = 0;
  for (const f of s.frames) {
    if (f.src) count++;
  }
  for (const stripId of Object.keys(s.stripVersions)) {
    const map = s.stripVersions[stripId];
    if (!map) continue;
    for (const fid of Object.keys(map)) {
      const vers = map[+fid];
      if (!vers) continue;
      for (const v of vers) {
        if (v.bgImage) count++;
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Conflicts held by the server
//
// A disagreement about a frame is the project's business, not one device's.
// The server keeps the version it would not take, so the question can be asked
// and answered from any device — and the losing work is never stranded on a
// machine that happens to be closed.
// ---------------------------------------------------------------------------

interface OpenConflict {
  id: string;
  frame_id: string;
  losing_json: string;
  device_name: string | null;
  made_at: number | null;
  winner_device: string | null;
  winner_made_at: number | null;
  made_offline: number;
  created_at: number;
}

/** Name a side the way the user would: by device and when it was made. */
/** Say what the frame actually holds after a decision — names, not just a
 *  count, so "it is not in the layout" can be told apart from "it is not in
 *  the data". */
function traceFrameVersions(serverFrameId: string): void {
  const st = state();
  const f = st.frames.find((x) => x.serverFrameId === serverFrameId);
  if (!f) { trace('  that frame is not in the store'); return; }
  // After KEEP BOTH there should be a PAIR of frames in the main strip, so
  // report the neighbours by name, not a version count.
  const base = (f.label || '').replace(/#\d+$/, '');
  const pair = st.frames
    .filter((x) => (x.label || '').replace(/#\d+$/, '') === base)
    .map((x) => `${x.label || '·'}:${(st.versions[x.id] ?? []).length}v${x.src ? '' : '(no image)'}`);
  trace(`  ${st.frames.length} frames · matching "${base}": [${pair.join(', ')}]`);
}

function sideWho(frameLabel: string, device: string | null, isThisDevice: boolean,
                 fallback = 'another device'): string {
  const who = device || fallback;
  return `${frameLabel} · ${who}${isThisDevice ? ' (this one)' : ''}`;
}

function sideWhen(madeAt: number | null): string {
  return madeAt ? `changed ${formatClockTime(madeAt)}` : '';
}

/**
 * Ask about every frame the server is holding a decision on.
 *
 * Runs one question at a time. While a question is on screen the device checks
 * every few seconds whether someone answered it elsewhere — if so it closes
 * itself rather than leaving live buttons on a settled question.
 */
interface OpenSettingConflict {
  id: string;
  kind: string;
  item_id: string;
  losing_json: string;
  device_name: string | null;
  made_at: number | null;
  winner_device: string | null;
  winner_made_at: number | null;
}

/** Ask about every sort order the server is holding a decision on. */
let askingAboutSettings = false;

async function askAboutOpenSettingConflicts(projectId: string): Promise<void> {
  if (askingAboutSettings) return;
  askingAboutSettings = true;
  try {
    let list: OpenSettingConflict[];
    try {
      const res = await api.get<{ conflicts: OpenSettingConflict[] }>(
        `/projects/${encodeURIComponent(projectId)}/setting-conflicts`, getToken());
      list = res.conflicts ?? [];
    } catch {
      return;   // ask again next time; nothing is lost by not asking now
    }
    if (list.length === 0) return;
    trace(`  ${list.length} sort order decision(s) waiting`);

    const { showSortOrderConflict } = await import('./modals');

    for (const c of list) {
      const here = getDeviceName();
      let name = '?';
      try {
        const parsed = JSON.parse(c.losing_json) as { data?: { name?: string } };
        name = parsed.data?.name || '?';
      } catch { /* fall back to '?' */ }
      const mine = state().sortOrders.find((o) => o.id === c.item_id);
      if (mine?.name) name = mine.name;

      const choice = await showSortOrderConflict({
        orderName: name,
        keepLabel:  sideWho(name, c.winner_device, c.winner_device === here, 'the cloud')
                    + (c.winner_made_at ? ` · ${sideWhen(c.winner_made_at)}` : ''),
        otherLabel: sideWho(name, c.device_name, c.device_name === here, 'this device')
                    + (c.made_at ? ` · ${sideWhen(c.made_at)}` : ''),
        keepDevice: c.winner_device,
        otherDevice: c.device_name,
        stillOpen: async () => {
          try {
            const r = await api.get<{ conflicts: OpenSettingConflict[] }>(
              `/projects/${encodeURIComponent(projectId)}/setting-conflicts`, getToken());
            return (r.conflicts ?? []).some((x) => x.id === c.id);
          } catch { return true; }   // can't tell — leave it up
        },
      });

      const take = async () => {
        // Just pull. Do NOT wipe what we believe the server holds: that made
        // every setting look unsent, so ordinary pulls were held back and the
        // next push claimed base 0 on every order — which reads as "I changed
        // this blind" and had the server file a fresh conflict for each one.
        // Answering those produced the same state again, for ever.
        // The forced pull already bypasses the unsent guards, and applying the
        // server's settings sets every base correctly.
        lastKnownUpdatedAt = 0;
        await tryPullFromCloud(true);
      };

      if (!choice) {
        trace('  sort order decision was answered on another device — taking that result');
        await take();
        continue;
      }

      try {
        const res = await api.post<{ already_resolved?: boolean; resolution?: string } & CloudProjectTree>(
          `/projects/${encodeURIComponent(projectId)}/setting-conflicts/${encodeURIComponent(c.id)}`,
          { choice, device_id: getDeviceId(), device_name: getDeviceName() }, getToken());
        if (res.already_resolved) {
          trace(`  already decided elsewhere: ${res.resolution} — taking that result`);
          await take();
          continue;
        }
        trace(`  sort order decided: ${choice}`);
        applySettingsToStore(res.settings);
        adoptSettingsFromServer(res.settings, projectId);
        (window as any).__fh_renderAll?.();
      } catch {
        trace('  could not send the sort order decision — will ask again');
      }
    }
  } finally {
    askingAboutSettings = false;
  }
}

/** One asker at a time. The question is raised from two places — the tail of a
 *  push and the heartbeat — and both can fire within a second of each other.
 *  Without this the same conflict got two pickers, and answering one left the
 *  device taking the same result twice. */
let askingAboutConflicts = false;

async function askAboutOpenConflicts(projectId: string): Promise<void> {
  if (askingAboutConflicts) return;
  askingAboutConflicts = true;
  try {
    await askAboutOpenConflictsInner(projectId);
  } finally {
    askingAboutConflicts = false;
  }
}

async function askAboutOpenConflictsInner(projectId: string): Promise<void> {
  let list: OpenConflict[];
  try {
    const res = await api.get<{ conflicts: OpenConflict[] }>(
      `/projects/${encodeURIComponent(projectId)}/conflicts`, getToken());
    list = res.conflicts ?? [];
  } catch {
    return;   // ask again next time; nothing is lost by not asking now
  }
  if (list.length === 0) return;
  trace(`  ${list.length} frame decision(s) waiting`);

  for (const c of list) {
    const losing = JSON.parse(c.losing_json) as {
      frame: { label?: string | null };
      versions: Array<{ id: string; type: string }>;
      images: Array<{ version_id: string; r2_key: string }>;
    };
    const mainV = losing.versions.find((v) => v.type === 'main');
    const key = mainV ? losing.images.find((i) => i.version_id === mainV.id)?.r2_key : undefined;
    let losingSrc = '';
    if (key) { try { losingSrc = await fetchImageFromR2(key, getToken()!); } catch { /* blank */ } }

    const localFrame = state().frames.find((f) => f.serverFrameId === c.frame_id);
    const here = getDeviceName();

    const label = localFrame?.label || losing.frame.label || '?';
    const choice = await showThreeWayConflict({
      frameLabel: label,
      keepWho:  sideWho(label, c.winner_device, c.winner_device === here, 'the cloud'),
      keepWhen: sideWhen(c.winner_made_at),
      otherWho:  sideWho(label, c.device_name, c.device_name === here, 'this device'),
      otherWhen: sideWhen(c.made_at),
      keepDevice:  c.winner_device,
      otherDevice: c.device_name,
      keepSrc: localFrame?.src || '',
      otherSrc: losingSrc,
      madeOffline: !!c.made_offline,
      stillOpen: async () => {
        try {
          const r = await api.get<{ conflicts: OpenConflict[] }>(
            `/projects/${encodeURIComponent(projectId)}/conflicts`, getToken());
          return (r.conflicts ?? []).some((x) => x.id === c.id);
        } catch { return true; }   // can't tell — leave it up
      },
    });

    if (!choice) {
      // The picker closed itself because the question was settled elsewhere.
      // Closing the window is not enough: this device is now out of date and
      // must take the decided result, or the two devices sit there each
      // showing its own version. This was the real cause of "keep both did
      // nothing" — the answering device was fine, this one never looked.
      trace('  decision was answered on another device — taking that result');
      markFrameAsMatchingServer(c.frame_id);
      lastKnownUpdatedAt = 0;         // force the pull to apply
      await tryPullFromCloud(true);
      traceFrameVersions(c.frame_id);
      continue;
    }

    try {
      const res = await api.post<{ already_resolved?: boolean; resolution?: string } & CloudProjectTree>(
        `/projects/${encodeURIComponent(projectId)}/conflicts/${encodeURIComponent(c.id)}`,
        {
          choice,
          device_id: getDeviceId(),
          device_name: getDeviceName(),
        }, getToken());
      if (res.already_resolved) {
        // Someone answered first — so this device is now out of date and must
        // take what was decided. Doing nothing here left the two devices
        // showing different things, each convinced it was right.
        trace(`  already decided elsewhere: ${res.resolution} — taking that result`);
        showToast(`Already decided on another device — kept ${res.resolution === 'both' ? 'both' : res.resolution}.`);
        markFrameAsMatchingServer(c.frame_id);
        lastKnownUpdatedAt = 0;         // force the pull to apply
        await tryPullFromCloud(true);
        continue;
      }
      trace(`  decided: ${choice}`);

      // Applying the result rebuilds the project from the server, which resets
      // the view to the default. Answering a question should not move you: if
      // you were in 3x2, you stay in 3x2.
      const before = state();
      const viewBefore = {
        currentViewMode: before.currentViewMode,
        activeStrips: [...before.activeStrips],
        notesStripVisible: before.notesStripVisible,
        needsStripVisible: before.needsStripVisible,
        activeGroupId: before.activeGroupId,
        centerFid: before.centerFid,
      };

      beginSystemAction();
      try {
        await applyCloudTreeToStore(res as CloudProjectTree);
      } finally {
        endSystemAction();
      }
      adoptFingerprintsFromStore();

      traceFrameVersions(c.frame_id);

      const after = state();
      const groupStillThere =
        viewBefore.activeGroupId !== null &&
        after.groups.some((g) => g.id === viewBefore.activeGroupId);
      useStore.setState({
        currentViewMode: viewBefore.currentViewMode,
        activeStrips: viewBefore.activeStrips,
        notesStripVisible: viewBefore.notesStripVisible,
        needsStripVisible: viewBefore.needsStripVisible,
        activeGroupId: groupStillThere ? viewBefore.activeGroupId : null,
      });

      (window as any).__fh_renderAll?.();
      // After the rebuild, not before — otherwise the rebuild has the last word.
      setViewMode(viewBefore.currentViewMode);

      const frameStillThere =
        viewBefore.centerFid != null &&
        state().frames.some((f) => String(f.id) === String(viewBefore.centerFid));
      if (frameStillThere) requestAnimationFrame(() => scrollAnchorTo(viewBefore.centerFid));
    } catch {
      showToast('Could not save that choice — it will be asked again.');
    }
  }
}

async function syncCurrentToServer(projectId: string): Promise<void> {
  // Safety net: refuse to push zero frames — prevents wiping a project on the server
  if (state().frames.length === 0) {
    console.warn('[sync] Aborted: state has 0 frames — refusing to overwrite server data');
    return;
  }
  // Safety net: refuse to push if all images disappeared but the project previously had them.
  // This catches the race where a pull loaded structure but R2 images haven't arrived yet.
  const currentImageCount = countCurrentImages();
  if (currentImageCount === 0 && _lastKnownImageCount > 0) {
    console.warn(`[sync] Aborted: state has 0 images but last known count was ${_lastKnownImageCount} — refusing to overwrite server data`);
    throw new Error('Save cancelled: the project looks empty. Nothing was uploaded, your work is safe.');
  }
  // Safety net: frame count should never decrease unless tombstones account for it.
  // Catches corrupt state, partial data, or races that would wipe frames on the server.
  const currentFrameCount = state().frames.length;
  const tombstonedFrameCount = _pendingTombstones.filter((t) => t.entity_type === 'frame').length;
  if (_lastKnownFrameCount > 0 && currentFrameCount < _lastKnownFrameCount - tombstonedFrameCount) {
    console.warn(`[sync] Aborted: ${currentFrameCount} frames locally but expected at least ${_lastKnownFrameCount - tombstonedFrameCount} (last known: ${_lastKnownFrameCount}, tombstones: ${tombstonedFrameCount})`);
    throw new Error('Save cancelled: fewer frames than expected. Nothing was uploaded, your work is safe.');
  }
  // Flush in-progress text/table edits from DOM to frame objects before snapshotting
  saveOpenTextEdits();
  saveOpenTableEdits();
  const s = state();
  const cp = getCurrentProject();
  const now = Date.now();
  const token = getToken()!;

  // ---------------------------------------------------------------------------
  // DELTA PUSH: compute fingerprints for all frames and only include those
  // that changed since the last push. If no stored fingerprints exist (first
  // push, project switch, after pull), all frames are included.
  // ---------------------------------------------------------------------------
  const currentFingerprints = new Map<string, string>();
  const dirtyLocalIds = new Set<number>();

  s.frames.forEach((f, i) => {
    const fp = frameFingerprint(f, i, s);
    const serverId = f.serverFrameId || `new_${f.id}`;
    currentFingerprints.set(serverId, fp);
    // Frame is dirty if: no stored fingerprint (new/first push) OR fingerprint changed
    if (_lastPushedFingerprints.get(serverId) !== fp) {
      dirtyLocalIds.add(f.id);
    }
  });

  // Check for deleted frames (in fingerprint store but not in current state).
  // These are handled by tombstones — no need to include them as dirty frames.

  // Partial means "the server already has this project, send it changes".
  // It used to also require that SOME frame was unchanged — so a device that
  // had been offline long enough to touch every frame sent a FULL push, and
  // full mode DELETES the whole project on the server and writes only what
  // that device holds. One device coming back from a day away erased the
  // other's work entirely. How many frames changed says nothing about whether
  // the server's copy should be thrown away.
  // A full replace is for ONE case only: a project the server has never seen.
  // Not for "this device has forgotten what the server holds", which is what a
  // pull that keeps every local frame leaves behind (#268).
  const isPartial = shouldSendOnlyChanges({
    hasCloudId: Boolean(cp.projectId),
    confirmedFrames: _lastPushedFingerprints.size,
    framesTheServerHas: _serverFrameTimes.size,
  });
  const hasDirtyFrames = dirtyLocalIds.size > 0;

  // NOTE: we do NOT skip when hasDirtyFrames is false. Metadata changes
  // (groups, setups, strip renames) don't alter frame fingerprints, so we
  // must still push to update the project metadata on the server. A partial
  // push with 0 dirty frames is cheap — it just updates the project row.

  if (!isPartial) {
    trace('  FULL REPLACE — this device believes the server has never seen this project');
  }
  console.log(`[sync] Delta push: ${dirtyLocalIds.size}/${s.frames.length} frames dirty, partial=${isPartial}`);
  trace(`  delta: ${dirtyLocalIds.size}/${s.frames.length} frames changed · partial=${isPartial}`);

  // A partial push with nothing in it still moves the project's timestamp on
  // the server, which makes every other device think there is something new
  // and pull. Each side's empty push provokes the other. If there is nothing
  // to say, say nothing.
  // Project settings are not on any frame, so they need their own answer to
  // "is there anything to say". Without this they only ever travelled when a
  // frame happened to change at the same time.
  // Stamp first, so a change made a moment ago counts. Then ask the settings
  // themselves — they know what the server has confirmed, which the
  // whole-project fingerprint could not answer until after a first push.
  stampChangedSettings(cp.projectId);
  // Also stamp frames and versions here, before the payload is built: a change
  // made a second ago pushes immediately, so waiting for the next autosave
  // would send it with no change time at all.
  stampChangedContent(cp.projectId);
  const metaChanged =
    settingsNeedPush() ||
    (_lastPushedMeta !== '' && projectMetaFingerprint(s) !== _lastPushedMeta);
  if (metaChanged) trace('  project settings changed — sending');

  if (isPartial && dirtyLocalIds.size === 0 && _pendingTombstones.length === 0 && !metaChanged) {
    trace('  nothing changed — not sending');
    return;
  }

  // Debug: trace scribble data in push
  for (const f of s.frames) {
    if (f.scribbles && f.scribbles.length > 0) {
      const isDirty = dirtyLocalIds.has(f.id);
      console.log(`[sync][scribble] frame ${f.id} has ${f.scribbles.length} scribbles, dirty=${isDirty}, serverFrameId=${f.serverFrameId || 'NONE'}`);
    }
  }

  // One strip per project — all frames live here. Strip versions use type prefixes.
  const stripId = uuid();
  const strips = [{ id: stripId, label: 'Main', sort_order: 0, updated_at: now }];

  const frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: boolean; note: string | null; scribbles: string | null; updated_at: number; base_updated_at?: number;
    needs: string | null; notes: string | null; setup_id: string | null;
    content_changed_at?: number }> = [];
  const versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: boolean; starred: boolean; note: string | null; updated_at: number; tags?: string | null; content_changed_at?: number }> = [];
  const drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }> = [];
  const imageUploads: Array<{
    versionId: string; src: string;
    // Tracking fields so we can write r2Key back to the store after upload
    _localFrameId?: number; _isMain?: boolean;
    _stripType?: string; _versionIdx?: number;
  }> = [];
  const images: Array<{
    id: string; version_id: string; r2_key: string;
    width: number | null; height: number | null;
    size_bytes: number | null; content_type: string | null;
    updated_at: number;
  }> = [];

  // Map local frame id → server frame UUID (needed for group remapping)
  const localToServerFrame = new Map<number, string>();
  // Map version UUID → setupTagged value (stored in metadata to avoid D1 schema change)
  const versionTags: Record<string, 'origin' | 'copy'> = {};

  // Track which local frames/versions got which server UUIDs so we can
  // persist them back to the store after a successful push.
  const frameIdUpdates: Array<{ localId: number; serverFrameId: string; serverMainVersionId: string }> = [];
  const versionIdUpdates: Array<{ stripType: string; localFrameId: number; versionIdx: number; serverVersionId: string }> = [];

  // Build localToServerFrame for ALL frames (needed for group remapping in metadata).
  // Pre-assign server UUIDs for new frames so they're consistent.
  const preAssignedMainVersionIds = new Map<number, string>();
  s.frames.forEach((f) => {
    const frameId = f.serverFrameId || uuid();
    localToServerFrame.set(f.id, frameId);
    if (!f.serverFrameId) {
      const mainVersionId = uuid();
      preAssignedMainVersionIds.set(f.id, mainVersionId);
    }
  });

  // Now iterate only dirty frames for the payload
  s.frames.forEach((f, i) => {
    if (isPartial && !dirtyLocalIds.has(f.id)) return; // Skip clean frames

    const frameId = localToServerFrame.get(f.id)!;

    frames.push({
      id: frameId, strip_id: stripId, label: f.label || null, sort_order: i,
      crop_w: f.cropW || null, crop_h: f.cropH || null,
      text_content: f.textContent || null,
      table_data: f.tableData ? JSON.stringify(f.tableData) : null,
      version_label: f.stripLabels?.ver || null,
      strip_labels: f.stripLabels ? JSON.stringify(f.stripLabels) : null,
      hidden: !!f.hidden,
      note: f.note || null,
      scribbles: f.scribbles && f.scribbles.length > 0 ? JSON.stringify(f.scribbles) : null,
      updated_at: now,
      // What we believe this frame's server timestamp is. The server refuses
      // only frames that have moved since — not the whole push.
      base_updated_at: f.serverFrameId ? _serverFrameTimes.get(f.serverFrameId) : undefined,
      // Needs, notes and setup belong to the frame. They used to ride in the
      // project's metadata, which every push replaced whole — so the last
      // device to push owned every frame's needs, and a different push owned
      // every frame's notes. They still go in the metadata as well for now, so
      // nothing is lost while both are in use.
      needs: s.frameNeeds[f.id] ? JSON.stringify(s.frameNeeds[f.id]) : null,
      notes: s.frameNotes[f.id] ? JSON.stringify(s.frameNotes[f.id]) : null,
      setup_id: f.setupId ?? null,
      // WHEN it was changed, so the server can prefer the newer edit instead of
      // the later push. `updated_at` above is the push time.
      content_changed_at: frameChangedAt(f.serverFrameId),
    });
    if (f.scribbles && f.scribbles.length > 0) {
      console.log(`[sync][scribble] INCLUDED frame ${f.id} in push payload with ${f.scribbles.length} scribbles (${JSON.stringify(f.scribbles).length} bytes)`);
    }

    // Frame-level strokes → "main" version
    const mainVersionId = f.serverMainVersionId || preAssignedMainVersionIds.get(f.id) || uuid();
    frameIdUpdates.push({ localId: f.id, serverFrameId: frameId, serverMainVersionId: mainVersionId });

    versions.push({ id: mainVersionId, frame_id: frameId, label: 'main', type: 'main', hidden: false, starred: false, note: null, updated_at: now });
    if (f.strokes && f.strokes.length > 0) {
      drawings.push({ id: uuid(), version_id: mainVersionId, drawing_data: JSON.stringify(f.strokes), updated_at: now });
    }
    if (f.src && isLocalImage(f.src) && !f.r2Key) {
      // New image — needs uploading to R2
      imageUploads.push({ versionId: mainVersionId, src: f.src, _localFrameId: f.id, _isMain: true });
    } else if (f.r2Key) {
      // Already in R2 — reuse the existing key (no upload needed)
      images.push({
        id: uuid(), version_id: mainVersionId, r2_key: f.r2Key,
        width: null, height: null, size_bytes: null, content_type: null,
        updated_at: now,
      });
    }

    // Helper: push versions for a strip type with optional type prefix
    const pushStripVersions = (stripVersions: Version[] | undefined, prefix: string, stripType: string) => {
      if (!stripVersions) return;
      stripVersions.forEach((lv, vi) => {
        const vid = lv.serverVersionId || uuid();
        versionIdUpdates.push({ stripType, localFrameId: f.id, versionIdx: vi, serverVersionId: vid });
        const fullType = prefix ? `${prefix}:${lv.type}` : lv.type;
        versions.push({
          id: vid, frame_id: frameId, label: lv.label || null, type: fullType,
          hidden: !!lv.hidden, starred: versionStars(lv) as unknown as boolean, note: lv.note || null, updated_at: now,
          // The tag belongs to the version, same reasoning as needs and notes.
          tags: lv.setupTagged ?? null,
          content_changed_at: versionChangedAt(lv.serverVersionId),
        });
        if (lv.strokes && lv.strokes.length > 0) {
          drawings.push({ id: uuid(), version_id: vid, drawing_data: JSON.stringify(lv.strokes), updated_at: now });
        }
        if (lv.bgImage && isLocalImage(lv.bgImage) && !lv.r2Key) {
          // New version image — needs uploading
          imageUploads.push({ versionId: vid, src: lv.bgImage, _localFrameId: f.id, _stripType: stripType, _versionIdx: vi });
        } else if (lv.r2Key) {
          // Already in R2 — reuse the existing key
          images.push({
            id: uuid(), version_id: vid, r2_key: lv.r2Key,
            width: null, height: null, size_bytes: null, content_type: null,
            updated_at: now,
          });
        }
        // Track strip-tag state for metadata (avoids D1 schema change)
        if (lv.setupTagged) {
          versionTags[vid] = lv.setupTagged;
        }
      });
    };

    // Ver strip versions (no prefix for backward compat with existing synced data)
    pushStripVersions(s.stripVersions.ver?.[f.id], '', 'ver');
    // Floor and refs strip versions (prefixed types)
    pushStripVersions(s.stripVersions.floor?.[f.id], 'floor', 'floor');
    pushStripVersions(s.stripVersions.refs?.[f.id], 'refs', 'refs');
  });

  // Collect versionTags from ALL frames (not just dirty ones) for metadata.
  // Metadata is project-wide and overwrites on every push, so we must include
  // tags from clean frames too — otherwise partial pushes wipe them.
  for (const f of s.frames) {
    // Skip frames already processed in the dirty loop above
    if (!isPartial || dirtyLocalIds.has(f.id)) continue;
    for (const stripType of ['ver', 'floor', 'refs']) {
      const vers = s.stripVersions[stripType]?.[f.id];
      if (!vers) continue;
      for (const lv of vers) {
        if (lv.setupTagged && lv.serverVersionId) {
          versionTags[lv.serverVersionId] = lv.setupTagged;
        }
      }
    }
  }

  // Build metadata JSON: stripDefs, groups (with remapped frame IDs), portraitMode, pdfAdjustRects
  const metaGroups = s.groups.map((g) => ({
    id: g.id,
    name: g.name,
    frameIds: g.frameIds.map((fid) => localToServerFrame.get(fid) || '').filter(Boolean),
    hiddenFrameIds: g.hiddenFrameIds.map((fid) => localToServerFrame.get(fid) || '').filter(Boolean),
  }));

  // Migrate PDF-adjust localStorage entries from 'local' → real project ID.
  // When a user first imports a PDF into a new (unsaved) project, rects and
  // the filename hint are stored under the key prefix "…_local_…". Once the
  // project is saved to cloud and gets a server UUID, we need to re-key those
  // entries so the sync can find them.
  const localRectsPrefix = 'pdfAdjustRects_local_';
  const keysToMigrate: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(localRectsPrefix)) keysToMigrate.push(k);
  }
  for (const oldKey of keysToMigrate) {
    const fileName = oldKey.slice(localRectsPrefix.length);
    const newKey = `pdfAdjustRects_${projectId}_${fileName}`;
    if (!localStorage.getItem(newKey)) {
      try { localStorage.setItem(newKey, localStorage.getItem(oldKey)!); } catch { /* quota */ }
    }
    localStorage.removeItem(oldKey);
  }
  const localLastPdf = localStorage.getItem('pdfAdjustLastFile_local');
  if (localLastPdf) {
    const newLastKey = `pdfAdjustLastFile_${projectId}`;
    if (!localStorage.getItem(newLastKey)) {
      try { localStorage.setItem(newLastKey, localLastPdf); } catch { /* quota */ }
    }
    localStorage.removeItem('pdfAdjustLastFile_local');
  }

  // Collect all PDF adjust rect entries for this project from localStorage
  const pdfAdjustRects: Record<string, any> = {};
  const rectsPrefix = `pdfAdjustRects_${projectId}_`;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(rectsPrefix)) {
      const fileName = k.slice(rectsPrefix.length);
      try { pdfAdjustRects[fileName] = JSON.parse(localStorage.getItem(k)!); } catch { /* skip */ }
    }
  }

  // Last imported PDF filename for Adjust tool hint
  const lastPdfName = localStorage.getItem(`pdfAdjustLastFile_${projectId}`) || undefined;

  // Build frame→setup mapping for sync (stored in metadata to avoid D1 schema change).
  // Uses SERVER frame UUIDs as keys so the mapping works across devices.
  const frameSetups: Record<string, string> = {};
  for (const f of s.frames) {
    const serverFid = localToServerFrame.get(f.id);
    if (f.setupId && serverFid) frameSetups[serverFid] = f.setupId;
  }

  // Build per-frame needs state for sync (keyed by server frame UUID)
  const syncFrameNeeds: Record<string, FrameNeedState> = {};
  for (const f of s.frames) {
    const serverFid = localToServerFrame.get(f.id);
    const fn = s.frameNeeds[f.id];
    if (serverFid && fn) syncFrameNeeds[serverFid] = fn;
  }

  // Build per-frame notes state for sync (keyed by server frame UUID)
  const syncFrameNotes: Record<string, FrameNoteState> = {};
  for (const f of s.frames) {
    const serverFid = localToServerFrame.get(f.id);
    const fnote = s.frameNotes[f.id];
    if (serverFid && fnote) syncFrameNotes[serverFid] = fnote;
  }

  // Remap sort order frameOrder arrays from local IDs → server IDs
  const metaSortOrders = s.sortOrders.map((o) => {
    const mapped: any = {
      id: o.id,
      name: o.name,
      description: o.description,
      frameOrder: o.frameOrder.map((fid) => localToServerFrame.get(fid) || '').filter(Boolean),
      breaks: o.breaks,
    };
    if (o.bracketTree) mapped.bracketTree = remapBracketIds(o.bracketTree, localToServerFrame);
    if (o.sortedSnapshot) mapped.sortedSnapshot = o.sortedSnapshot.map((fid) => localToServerFrame.get(fid) || '').filter(Boolean);
    return mapped;
  });

  const metadata = JSON.stringify({
    stripDefs: s.stripDefs,
    groups: metaGroups,
    nextGroupId: s.nextGroupId,
    portraitMode: s.portraitMode,
    projectType: s.projectType,
    pdfAdjustRects: Object.keys(pdfAdjustRects).length > 0 ? pdfAdjustRects : undefined,
    pdfAdjustLastFile: lastPdfName,
    setups: s.setups.length > 0 ? s.setups : undefined,
    nextSetupId: s.nextSetupId > 1 ? s.nextSetupId : undefined,
    frameSetups: Object.keys(frameSetups).length > 0 ? frameSetups : undefined,
    versionTags: Object.keys(versionTags).length > 0 ? versionTags : undefined,
    stripTagInfoDismissed: s.stripTagInfoDismissed || undefined,
    needDefinitions: s.needDefinitions,
    frameNeeds: Object.keys(syncFrameNeeds).length > 0 ? syncFrameNeeds : undefined,
    frameNotes: Object.keys(syncFrameNotes).length > 0 ? syncFrameNotes : undefined,
    sortOrders: metaSortOrders.length > 0 ? metaSortOrders : undefined,
    nextSortOrderId: s.nextSortOrderId > 1 ? s.nextSortOrderId : undefined,
    activeSortOrderId: s.activeSortOrderId ?? undefined,
    storyFlowBreaks: s.storyFlowBreaks?.length > 0 ? s.storyFlowBreaks : undefined,
    camAspectRatio: s.camAspectRatio !== 'canvas' ? s.camAspectRatio : undefined,
    exportMeta: s.exportMeta && Object.values(s.exportMeta).some((v) => v) ? s.exportMeta : undefined,
  });

  // Upload NEW images to R2 in parallel (images with existing r2Key were already added above)

  // Map versionId → r2_key for writing back to the store after push
  const uploadedR2Keys = new Map<string, { r2Key: string; task: typeof imageUploads[0] }>();

  if (imageUploads.length > 0) {
    const results = await Promise.all(
      imageUploads.map(async (task) => {
        try {
          const r = await uploadImageToR2(task.src, token);
          return { task, versionId: task.versionId, ...r };
        } catch (e) {
          console.warn('[sync] image upload failed for version', task.versionId, e);
          return null; // Skip failed uploads — structure still syncs
        }
      }),
    );
    for (const r of results) {
      if (!r) continue;
      images.push({
        id: uuid(),
        version_id: r.versionId,
        r2_key: r.r2_key,
        width: null,
        height: null,
        size_bytes: r.size_bytes,
        content_type: r.content_type,
        updated_at: now,
      });
      uploadedR2Keys.set(r.versionId, { r2Key: r.r2_key, task: r.task });
    }
  }
  trace(`  sending frames: ${frames.map((f) => f.id.slice(0, 6)).join(',') || '(none)'}`);

  // Say exactly what is going up, so "the sort order did not sync" can be told
  // apart from "the app never had one to send".
  stampChangedSettings(cp.projectId);
  const settingsOut = settingsForPush();
  // Say which frames carry a change time, so "newer wins did nothing" can be
  // told apart from "nobody knew when they changed".
  const stampBits = frames.map((f) =>
    `${f.id.slice(0, 6)}${f.content_changed_at ? '@' + f.content_changed_at : '@none'}`);
  if (frames.length > 0) trace(`  change times: ${stampBits.join(' ')}`);

  const orderBits = settingsOut
    .filter((i) => i.kind === 'sortOrder')
    .map((i) => `${i.item_id.slice(0, 8)} at ${i.changed_at} base ${i.base_changed_at ?? 0}`);
  trace(`  settings: ${settingsOut.length} item(s) · shooting orders [${orderBits.join(' | ') || 'none'}]`);

  // THE ARRANGEMENT, said out loud (#296).
  //
  // The line above lists SHOOTING orders only, so the story flow — the one item
  // that now carries the whole arrangement — did not appear in the log at all.
  // A re-order that travelled and a re-order that never left looked identical.
  const arrangement = settingsOut.find((i) => i.kind === 'frameOrder');
  if (arrangement) {
    let howMany = '?';
    try {
      const parsed = JSON.parse(arrangement.value ?? '{}') as { data?: string[] };
      howMany = String(parsed.data?.length ?? '?');
    } catch { /* leave it unknown */ }
    trace(`  story flow: ${howMany} frames · changed ${arrangement.changed_at}` +
          ` · server has ${arrangement.base_changed_at ?? 0}` +
          `${(arrangement.base_changed_at ?? 0) === arrangement.changed_at ? ' (already up there)' : ' — SENDING'}`);
  } else {
    trace('  story flow: not being sent');
  }
  const res = await api.post<CloudProjectTree & {
    conflict?: boolean;
    /** Frames the server would not take because they changed elsewhere.
     *  Everything else in this push WAS applied. */
    rejected_frames?: Array<{ id: string; server_updated_at: number; server_offline: boolean }>;
    /** Sent, but not written: the server's copy was changed more recently. */
    stale_frames?: string[];
    stale_versions?: string[];
  }>(
    `/projects/${encodeURIComponent(projectId)}/sync`,
    {
      partial: isPartial,
      project: {
        name: cp.name,
        updated_at: now,
        base_updated_at: lastKnownUpdatedAt ?? cp.lastSavedAt ?? 0,
        device_id: getDeviceId(),
        device_name: getDeviceName(),
        metadata,
      },
      strips,
      frames,
      versions,
      images,
      drawings,
      deletions: _pendingTombstones.map((t) => ({
        id: t.id,
        entity_type: t.entity_type,
        entity_id: t.entity_id,
        deleted_at: t.deleted_at,
        device_id: t.device_id,
      })),
      // Each settings item with the time IT changed. The server keeps the newer
      // per item, so it stops mattering who pushed last.
      //
      // Stamped again HERE because a push can beat the autosave: renaming a
      // NEEDS category sends straight away, so the item went up unstamped, the
      // server refused it as not newer, and the reply put the old name back —
      // the edit snapping back in front of the user. This is not "stamping at
      // push time": anything made offline was already stamped by an autosave
      // long before, so only a change the autosave has not seen yet is caught.
      settings: settingsOut,
    },
    getToken(),
  );
  // Update lastKnownUpdatedAt so that the pull-on-focus mechanism doesn't
  // see our own push as a "newer remote version" and try to apply it.
  lastKnownUpdatedAt = now;

  // Some of what we just sent was older than the server's copy, so it was not
  // written. Take the server's version — otherwise this device keeps its own
  // and, worse, records itself as matching the server, so it never asks again.
  const staleCount = (res.stale_frames?.length ?? 0) + (res.stale_versions?.length ?? 0);
  if (staleCount > 0) {
    trace(`  ${staleCount} sent item(s) were older than the server — taking its copy`);
    // AND MEAN IT (#307). A frame that lost must stop counting as unsent work,
    // or the pull that follows protects it and the server's newer copy never
    // lands: both devices keep their own drawing and neither ever finds out.
    for (const id of res.stale_frames ?? []) {
      dropDirtyFrame(id);
      forgetPushedFingerprint(id);   // ours does NOT match the server
    }
    // ...and go and get it, past the "is there anything newer" test — the
    // server's copy is newer than ours whatever its clock says about the push
    // we just made.
    lastKnownUpdatedAt = 0;
    takenFromServerAt = 0;
  }

  // Learn the server's new timestamps, so the next push is judged correctly.
  for (const sf of res.frames ?? []) _serverFrameTimes.set(sf.id, sf.updated_at);
  // The reply is the whole project as the server now holds it. Standing on it
  // means the next pull can ask only for what changed after this moment (#280).
  // Good ground, but NOT proof of having heard — the frames in this reply are
  // not applied to the store, so the mark must not move (#320).
  if (cp.projectId && res.frames) holdTree(cp.projectId, res as CloudProjectTree, false);
  // The reply carries the MERGED settings — ours where ours were newer, the
  // server's where they were not. Take both the values and their stamps, or
  // this device would keep pushing its older copy for ever.
  if (res.settings) {
    applySettingsToStore(res.settings);
    adoptSettingsFromServer(res.settings, cp.projectId);
  }
  const staleFrameIds = new Set(res.stale_frames ?? []);
  const acceptedIds = frames
    .map((f) => f.id)
    .filter((id) => !(res.rejected_frames ?? []).some((r) => r.id === id))
    .filter((id) => !staleFrameIds.has(id));   // sent, but the server's was newer
  trace(`  server accepted: ${acceptedIds.map((i) => i.slice(0, 6)).join(',') || '(none)'}`);
  const rejected = res.rejected_frames ?? [];
  if (rejected.length > 0) {
    trace(`  server refused: ${rejected.map((r) => r.id.slice(0, 6)).join(',')}`);
  }
  // Record counts after a successful push so the next guard comparisons are accurate.
  _lastKnownImageCount = countCurrentImages();
  _lastKnownFrameCount = state().frames.length;
  // Clear pending tombstones after successful push
  _pendingTombstones = [];

  // Store fingerprints for all frames (including clean ones) so the next
  // push can detect what changed. We store ALL frames, not just dirty ones,
  // so that the full snapshot is available for comparison.
  // Record what the server now has — but NOT the frames it refused. Recording
  // those marked them as sent, which quietly undid the refusal: the frame was
  // never pushed again and the other device never saw it.
  const refusedIds = new Set(rejected.map((r) => r.id));
  _lastPushedFingerprints.clear();
  for (const [k, v] of currentFingerprints) {
    if (refusedIds.has(k)) continue;
    // A frame the server would not take because ours was older is NOT what the
    // server holds, so recording it as such would make this device believe it
    // is in sync while showing something else.
    if (staleFrameIds.has(k)) continue;
    _lastPushedFingerprints.set(k, v);
  }
  // The project's settings went up with it.
  _lastPushedMeta = projectMetaFingerprint(state());

  // ---------------------------------------------------------------------------
  // Persist server IDs + r2Keys back to the Zustand store so the next push
  // reuses them and the diff-based pull can match frames by UUID.
  // ---------------------------------------------------------------------------
  useStore.setState((prev) => {
    const updatedFrames = prev.frames.map((f) => {
      const upd = frameIdUpdates.find((u) => u.localId === f.id);
      if (!upd) return f;
      const patched = { ...f, serverFrameId: upd.serverFrameId, serverMainVersionId: upd.serverMainVersionId };
      // Check if this frame's main image was uploaded — store r2Key
      const mainUpload = uploadedR2Keys.get(upd.serverMainVersionId);
      if (mainUpload?.task._isMain) patched.r2Key = mainUpload.r2Key;
      return patched;
    });

    const updatedStripVersions = { ...prev.stripVersions };
    for (const vu of versionIdUpdates) {
      const stripMap = updatedStripVersions[vu.stripType];
      if (!stripMap) continue;
      const vers = stripMap[vu.localFrameId];
      if (!vers || !vers[vu.versionIdx]) continue;
      const v = vers[vu.versionIdx];
      if (v.serverVersionId === vu.serverVersionId) {
        // Check r2Key only
        const r2Info = uploadedR2Keys.get(vu.serverVersionId);
        if (r2Info) {
          const updatedVers = [...vers];
          updatedVers[vu.versionIdx] = { ...v, r2Key: r2Info.r2Key };
          updatedStripVersions[vu.stripType] = { ...stripMap, [vu.localFrameId]: updatedVers };
        }
      } else {
        const updatedVers = [...vers];
        const r2Info = uploadedR2Keys.get(vu.serverVersionId);
        updatedVers[vu.versionIdx] = { ...v, serverVersionId: vu.serverVersionId, ...(r2Info ? { r2Key: r2Info.r2Key } : {}) };
        updatedStripVersions[vu.stripType] = { ...stripMap, [vu.localFrameId]: updatedVers };
      }
    }

    return {
      frames: updatedFrames,
      stripVersions: updatedStripVersions,
      // Legacy aliases point to same objects
      versions: updatedStripVersions.ver || prev.versions,
      floorVersions: updatedStripVersions.floor || prev.floorVersions,
      refsVersions: updatedStripVersions.refs || prev.refsVersions,
    };
  });

  // LAST: ask about anything the server is holding a decision on. The server
  // kept the refused version, so this asks from its list rather than from this
  // one response — which means any device can answer, not only this one.
  // Anything the server would not take because ours was older: fetch its copy
  // now. Without this the device sits on a stale frame with nothing to trigger
  // a pull — its own push moved the project's timestamp, so it believes it is
  // up to date, and even reloading restores the same stale copy.
  if (staleCount > 0) {
    lastKnownUpdatedAt = 0;
    await tryPullFromCloud(true);
  }

  if (rejected.length > 0) await askAboutOpenConflicts(projectId);
}

/**
 * Apply cloud project tree to the local store.
 * @param tree - The cloud project tree to apply.
 * @param keepLocalFrameIds - Optional set of server frame UUIDs to keep locally.
 *   When provided, frames whose server ID is in this set will preserve their
 *   local version (image, strokes, versions) instead of taking the cloud version.
 *   This enables per-frame merge: dirty frames stay local, clean frames take cloud.
 */
async function applyCloudTreeToStore(
  tree: CloudProjectTree,
  keepLocalFrameIds?: ReadonlySet<string>,
  onImageProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  // What this device is holding BEFORE any of this runs. The rebuild below
  // takes groups, setups, needs, shooting orders and the arrangement straight
  // from the project's metadata blob — the old whole-project layer — and the
  // per-item merge that follows can then only decline to overwrite what has
  // already been overwritten. This is what makes putting it back possible (#323).
  const mySettingsBefore = captureMySettings();

  // WHICH VERSION EACH CARD WAS SHOWING (#341).
  //
  // A pull rebuilt these from nothing: every card went back to its first tab and
  // stopped showing the version inline. So taking a photograph in 3x2 — which
  // deliberately switches the card to show what you just took — looked fine for
  // a second and then flicked back to the main frame the moment it synced. The
  // photograph was never in danger; the view simply changed under the user.
  //
  // Which version you are looking at is not the project. It belongs to this
  // screen, this minute, and a sync has no business touching it.
  /** The screen as the user has it, so a pull cannot rearrange it (#347). */
  const prevView = (() => {
    const st = state();
    return {
      currentViewMode: st.currentViewMode,
      fsOverlayActive: st.fsOverlayActive,
      ovExpandedFid: st.ovExpandedFid,
      showText: st.showText,
      activeStrips: st.activeStrips,
    };
  })();

  const viewedBefore = (() => {
    const st = state();
    const byServerId = new Map<string, { tab: Record<string, number>; cc: Record<string, number> }>();
    for (const f of st.frames) {
      if (!f.serverFrameId) continue;
      byServerId.set(f.serverFrameId, {
        tab: {
          ver: st.stripActiveTab.ver?.[f.id] ?? 0,
          floor: st.stripActiveTab.floor?.[f.id] ?? 0,
          refs: st.stripActiveTab.refs?.[f.id] ?? 0,
        },
        cc: {
          ver: st.stripCrossCompare.ver?.[f.id] ?? -1,
          floor: st.stripCrossCompare.floor?.[f.id] ?? -1,
          refs: st.stripCrossCompare.refs?.[f.id] ?? -1,
        },
      });
    }
    return byServerId;
  })();
  /** Which version each card should go back to showing, once the new lists
   *  exist to measure against (#341). */
  const wantedCC: Record<'ver' | 'floor' | 'refs', Record<number, number | undefined>> =
    { ver: {}, floor: {}, refs: {} };

  // After pulling cloud data, clear fingerprints so the next push
  // recomputes from scratch (the state changed underneath us).
  clearPushedFingerprints();

  // Map server tree back into the local Frame[] / versions[] shape.
  // We assign new local numeric ids that don't clash with the existing autoincrement.
  let nextId = 1;
  const newFrames: Frame[] = [];

  // ---------------------------------------------------------------------------
  // DIFF-AND-PATCH: Build lookups from current local state so we can carry
  // forward images that haven't changed (same r2Key). This avoids wiping
  // images to null and re-fetching them, eliminating the dangerous empty window.
  // ---------------------------------------------------------------------------
  const prev = useStore.getState();
  const existingFrameByServerId = new Map<string, Frame>();
  for (const f of prev.frames) {
    if (f.serverFrameId) existingFrameByServerId.set(f.serverFrameId, f);
  }
  const existingVersionByServerId = new Map<string, Version>();
  for (const stripId of Object.keys(prev.stripVersions)) {
    const map = prev.stripVersions[stripId];
    if (!map) continue;
    for (const fid of Object.keys(map)) {
      const vers = map[+fid];
      if (!vers) continue;
      for (const v of vers) {
        if (v.serverVersionId) existingVersionByServerId.set(v.serverVersionId, v);
      }
    }
  }

  // Per-strip version/tab maps
  const verVersions: Record<number, Version[]> = {};
  const floorVersions: Record<number, Version[]> = {};
  const refsVersions: Record<number, Version[]> = {};
  const verActiveTab: Record<number, number> = {};
  const floorActiveTab: Record<number, number> = {};
  const refsActiveTab: Record<number, number> = {};

  const stripsSorted = [...tree.strips].sort((a, b) => a.sort_order - b.sort_order);
  // Learn what the server's timestamp is for every frame it just gave us.
  for (const f of tree.frames) _serverFrameTimes.set(f.id, f.updated_at);

  const framesByStrip = new Map<string, typeof tree.frames>();
  for (const f of tree.frames) {
    if (!framesByStrip.has(f.strip_id)) framesByStrip.set(f.strip_id, []);
    framesByStrip.get(f.strip_id)!.push(f);
  }
  const versionsByFrame = new Map<string, typeof tree.versions>();
  for (const v of tree.versions) {
    if (!versionsByFrame.has(v.frame_id)) versionsByFrame.set(v.frame_id, []);
    versionsByFrame.get(v.frame_id)!.push(v);
  }
  const drawingByVersion = new Map<string, string>();
  for (const d of tree.drawings) drawingByVersion.set(d.version_id, d.drawing_data);

  // Build image lookup: version_id → r2_key
  const imageByVersion = new Map<string, string>();
  for (const img of tree.images) imageByVersion.set(img.version_id, img.r2_key);

  // ---------------------------------------------------------------------------
  // TOMBSTONES: Build a set of entity IDs that were explicitly deleted.
  // Combines server-side tombstones (from other devices) and local pending
  // tombstones (deletions on this device not yet pushed). Any frame or version
  // whose server ID is in this set gets filtered out during structure build.
  // ---------------------------------------------------------------------------
  const tombstonedIds = new Set<string>();
  if (tree.deletions) {
    for (const d of tree.deletions) tombstonedIds.add(d.entity_id);
  }
  for (const t of _pendingTombstones) tombstonedIds.add(t.entity_id);

  // Track which local frame/version needs an image fetched from R2.
  // We'll apply structure first, then fill images in asynchronously.
  const mainImageTasks: Array<{ localId: number; r2Key: string }> = [];
  // strip → localId → versionIdx → r2Key
  type VersionImageTask = { strip: string; localId: number; versionIdx: number; r2Key: string };
  const versionImageTasks: VersionImageTask[] = [];

  // Map server frame UUID → local numeric id (for group remapping on download)
  const serverToLocalFrame = new Map<string, number>();
  // Map server version UUID → local Version object (for restoring setupTagged from metadata)
  const serverVidToLocalVer = new Map<string, import('../store/state').Version>();

  for (const strip of stripsSorted) {
    const stripFrames = (framesByStrip.get(strip.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    for (const sf of stripFrames) {
      // TOMBSTONE: skip frames that were explicitly deleted
      if (tombstonedIds.has(sf.id)) continue;

      const localId = nextId++;
      serverToLocalFrame.set(sf.id, localId);

      // PER-FRAME MERGE: if this frame was modified locally (dirty), keep the
      // local version entirely — image, strokes, versions. Skip cloud data.
      if (keepLocalFrameIds?.has(sf.id)) {
        const existingFrame = existingFrameByServerId.get(sf.id);
        trace(`    keep-local ${sf.id.slice(0, 6)}: local frame ${existingFrame ? 'FOUND' : 'MISSING — falling through to cloud'}`);
        if (existingFrame) {
          newFrames.push({ ...existingFrame, id: localId });
          // Preserve local versions for all strips
          for (const stripId of Object.keys(prev.stripVersions)) {
            const map = prev.stripVersions[stripId];
            if (map && map[existingFrame.id]) {
              const target = stripId === 'ver' ? verVersions
                : stripId === 'floor' ? floorVersions
                : stripId === 'refs' ? refsVersions : null;
              if (target) {
                target[localId] = map[existingFrame.id].map((v, i) => ({ ...v, id: i + 1 }));
              }
              const tabTarget = stripId === 'ver' ? verActiveTab
                : stripId === 'floor' ? floorActiveTab
                : stripId === 'refs' ? refsActiveTab : null;
              if (tabTarget) tabTarget[localId] = 0;
            }
          }

          // ...but ADD versions the cloud has and this device does not.
          //
          // Keeping the local frame used to mean ignoring the cloud copy of it
          // entirely, so a LOOK made on the other device never arrived: the
          // frame came back with only this device's own versions. Keeping our
          // own work does not mean refusing theirs — a version we have never
          // seen is not in competition with anything.
          {
            const cloudVs = (versionsByFrame.get(sf.id) ?? [])
              .filter((v) => v.type !== 'main' && !tombstonedIds.has(v.id));
            for (const sv of cloudVs) {
              const stripId = sv.type.startsWith('floor:') ? 'floor'
                : sv.type.startsWith('refs:') ? 'refs' : 'ver';
              const target = stripId === 'ver' ? verVersions
                : stripId === 'floor' ? floorVersions : refsVersions;
              const list = target[localId] ?? (target[localId] = []);
              if (list.some((v) => v.serverVersionId === sv.id)) continue;   // already here

              const colonIdx = sv.type.indexOf(':');
              const rawType = colonIdx === -1 ? sv.type : sv.type.slice(colonIdx + 1);
              const r2Key = imageByVersion.get(sv.id);
              const localVer: import('../store/state').Version = {
                id: list.length + 1,
                label: sv.label ?? '',
                type: (rawType === 'drawing' || rawType === 'upload' || rawType === 'empty')
                  ? rawType as 'drawing' | 'upload' | 'empty' : 'empty' as const,
                strokes: parseStrokes(drawingByVersion.get(sv.id)),
                bgImage: null,
                hidden: !!sv.hidden,
                starred: !!sv.starred,
                stars: Number(sv.starred) || 0,
                note: sv.note ?? '',
                serverVersionId: sv.id,
                r2Key: r2Key || undefined,
              };
              list.push(localVer);
              serverVidToLocalVer.set(sv.id, localVer);
              if (r2Key) versionImageTasks.push({ strip: stripId, localId, versionIdx: list.length - 1, r2Key });
            }
            // Renumber so the tabs read 1,2,3 after the additions.
            for (const target of [verVersions, floorVersions, refsVersions]) {
              if (target[localId]) target[localId] = target[localId].map((v, i) => ({ ...v, id: i + 1 }));
            }
          }
          continue; // the frame itself stays local — its picture and strokes are ours
        }
        // If no existing local frame (shouldn't happen), fall through to cloud
      }

      const allVersions = (versionsByFrame.get(sf.id) ?? []).sort((a, b) => a.updated_at - b.updated_at);

      // Treat the first "main"-typed version as frame-level strokes
      const mainV = allVersions.find((v) => v.type === 'main');
      const sideVs = allVersions.filter((v) => v !== mainV);
      const mainStrokes = mainV ? parseStrokes(drawingByVersion.get(mainV.id)) : [];

      // Check if main version has an image in R2
      const mainR2Key = mainV ? imageByVersion.get(mainV.id) : undefined;
      // DIFF: check if we already have this exact image locally
      const existingFrame = existingFrameByServerId.get(sf.id);
      const mainImageUnchanged = mainR2Key && existingFrame?.r2Key === mainR2Key && existingFrame.src;
      if (mainR2Key && !mainImageUnchanged) mainImageTasks.push({ localId, r2Key: mainR2Key });

      // Parse strip_labels: prefer strip_labels JSON, fall back to version_label
      let stripLabels: Record<string, string> | undefined;
      if (sf.strip_labels) {
        try { stripLabels = JSON.parse(sf.strip_labels); } catch { /* ignore */ }
      }
      if (!stripLabels && sf.version_label) {
        stripLabels = { ver: sf.version_label };
      }

      newFrames.push({
        id: localId,
        // DIFF: carry forward existing image if r2Key matches, otherwise empty (fetched async)
        src: mainImageUnchanged ? existingFrame!.src : '',
        label: sf.label ?? '',
        stripLabels,
        hidden: !!sf.hidden,
        cropW: sf.crop_w || 16,
        cropH: sf.crop_h || 9,
        strokes: mainStrokes,
        drawMode: mainStrokes.length > 0,
        textContent: sf.text_content ?? '',
        tableData: sf.table_data ? parseTableData(sf.table_data) : null,
        note: sf.note ?? '',
        scribbles: sf.scribbles ? parseScribbles(sf.scribbles) : [],
        // Persist server IDs + r2Key so the diff-based pull can match frames
        serverFrameId: sf.id,
        serverMainVersionId: mainV?.id,
        r2Key: mainR2Key || undefined,
      });

      // Sort side versions into strips by parsing the type prefix.
      // No prefix → ver strip (backward compat). "floor:xxx" → floor. "refs:xxx" → refs.
      const verVers: typeof sideVs = [];
      const floorVers: typeof sideVs = [];
      const refsVers: typeof sideVs = [];
      for (const sv of sideVs) {
        if (sv.type.startsWith('floor:')) floorVers.push(sv);
        else if (sv.type.startsWith('refs:')) refsVers.push(sv);
        else verVers.push(sv);
      }

      // Helper: map server versions to local Version[] for a specific strip
      const mapVersions = (svList: typeof sideVs, stripName: string) => {
        // TOMBSTONE: filter out versions that were explicitly deleted
        const filtered = svList.filter((sv) => !tombstonedIds.has(sv.id));
        return filtered.map((sv, j) => {
          const r2Key = imageByVersion.get(sv.id);
          // DIFF: check if we already have this exact image locally
          const existingVer = existingVersionByServerId.get(sv.id);
          const imageUnchanged = r2Key && existingVer?.r2Key === r2Key && existingVer.bgImage;
          if (r2Key && !imageUnchanged) versionImageTasks.push({ strip: stripName, localId, versionIdx: j, r2Key });
          // Strip the prefix from the type to get the raw type
          let rawType = sv.type;
          const colonIdx = rawType.indexOf(':');
          if (colonIdx !== -1) rawType = rawType.slice(colonIdx + 1);
          const localVer: import('../store/state').Version = {
            id: j + 1,
            label: sv.label ?? '',
            type: (rawType === 'drawing' || rawType === 'upload' || rawType === 'empty') ? rawType as 'drawing' | 'upload' | 'empty' : 'empty' as const,
            strokes: parseStrokes(drawingByVersion.get(sv.id)),
            // DIFF: carry forward existing image if r2Key matches
            bgImage: imageUnchanged ? existingVer!.bgImage : null as string | null,
            hidden: !!sv.hidden,
            starred: !!sv.starred,
            stars: Number(sv.starred) || 0,
            note: sv.note ?? '',
            // Persist server ID + r2Key for diff-based sync
            serverVersionId: sv.id,
            r2Key: r2Key || undefined,
          };
          serverVidToLocalVer.set(sv.id, localVer);
          return localVer;
        });
      };

      verVersions[localId] = mapVersions(verVers, 'ver');
      floorVersions[localId] = mapVersions(floorVers, 'floor');
      refsVersions[localId] = mapVersions(refsVers, 'refs');
      // Put back what this card was showing, if it is still there (#341).
      const wasViewing = sf.id ? viewedBefore.get(sf.id) : undefined;
      const clamp = (want: number, have: number) =>
        (want > 0 && want < have ? want : 0);
      verActiveTab[localId] = clamp(wasViewing?.tab.ver ?? 0, verVersions[localId].length);
      floorActiveTab[localId] = clamp(wasViewing?.tab.floor ?? 0, floorVersions[localId].length);
      refsActiveTab[localId] = clamp(wasViewing?.tab.refs ?? 0, refsVersions[localId].length);
      const keepCC = (want: number, have: number) => (want >= 0 && want < have ? want : undefined);
      wantedCC.ver[localId] = keepCC(wasViewing?.cc.ver ?? -1, verVersions[localId].length);
      wantedCC.floor[localId] = keepCC(wasViewing?.cc.floor ?? -1, floorVersions[localId].length);
      wantedCC.refs[localId] = keepCC(wasViewing?.cc.refs ?? -1, refsVersions[localId].length);
    }
  }

  // Parse project metadata to restore stripDefs, groups, portraitMode, nextGroupId
  let restoredStripDefs: import('../store/state').StripDef[] | undefined;
  let restoredGroups: import('../store/state').FrameGroup[] = [];
  let restoredNextGroupId = 1;
  let restoredSetups: import('../store/state').Setup[] = [];
  let restoredNextSetupId = 1;
  let restoredFrameSetups: Record<string | number, string> = {};
  let restoredStripTagInfoDismissed = false;
  let restoredNeedDefinitions: any = null;
  let restoredFrameNeeds: Record<string, FrameNeedState> = {};
  let restoredFrameNotes: Record<string, FrameNoteState> = {};
  let restoredSortOrders: any[] = [];
  let restoredNextSortOrderId = 1;
  let restoredActiveSortOrderId: string | null = null;
  let restoredStoryFlowBreaks: import('../store/state').SortBreak[] = [];
  let restoredCamAspectRatio: import('../store/state').CamRatioKey = 'canvas';
  let restoredExportMeta: import('../store/state').ExportMeta | null = null;
  let isPortrait = newFrames.length > 0 && newFrames[0].cropH > newFrames[0].cropW;
  // Project kind: falls back to the shape inference above for legacy projects
  let restoredProjectType: ProjectType = isPortrait ? 'portrait' : 'landscape';

  if (tree.project.metadata) {
    try {
      const meta = JSON.parse(tree.project.metadata);
      if (meta.stripDefs && Array.isArray(meta.stripDefs)) {
        restoredStripDefs = meta.stripDefs;
        // Migrate old default names → new defaults (preserve user customizations)
        const OLD_LABELS: Record<string, { btn: string; frame: string }> = {
          ver: { btn: 'VERSN', frame: 'vers' },
        };
        for (const def of restoredStripDefs!) {
          const old = OLD_LABELS[def.id];
          const current = DEFAULT_STRIP_DEFS.find((d) => d.id === def.id);
          if (old && current) {
            if (def.buttonLabel === old.btn) def.buttonLabel = current.buttonLabel;
            if (def.defaultFrameLabel === old.frame) def.defaultFrameLabel = current.defaultFrameLabel;
          }
        }
      }
      if (meta.portraitMode != null) {
        isPortrait = !!meta.portraitMode;
        restoredProjectType = isPortrait ? 'portrait' : 'landscape';
      }
      if (meta.projectType === 'landscape' || meta.projectType === 'portrait' || meta.projectType === 'fitting') {
        restoredProjectType = meta.projectType;
        isPortrait = restoredProjectType !== 'landscape';
      }
      if (meta.nextGroupId != null) {
        restoredNextGroupId = meta.nextGroupId;
      }
      // Remap group frameIds from server UUIDs back to local numeric IDs
      if (meta.groups && Array.isArray(meta.groups)) {
        restoredGroups = meta.groups.map((g: any) => ({
          id: g.id,
          name: g.name ?? '',
          frameIds: (g.frameIds || []).map((uuid: string) => serverToLocalFrame.get(uuid)).filter((id: number | undefined) => id != null) as number[],
          hiddenFrameIds: (g.hiddenFrameIds || []).map((uuid: string) => serverToLocalFrame.get(uuid)).filter((id: number | undefined) => id != null) as number[],
        }));
      }
      // Restore PDF adjust rects to localStorage (cross-device sync)
      if (meta.pdfAdjustRects && typeof meta.pdfAdjustRects === 'object') {
        const pid = tree.project.id;
        for (const [fileName, data] of Object.entries(meta.pdfAdjustRects)) {
          try {
            localStorage.setItem(`pdfAdjustRects_${pid}_${fileName}`, JSON.stringify(data));
          } catch { /* quota — skip */ }
        }
      }
      // Restore last PDF filename for Adjust tool hint
      if (meta.pdfAdjustLastFile && typeof meta.pdfAdjustLastFile === 'string') {
        try { localStorage.setItem(`pdfAdjustLastFile_${tree.project.id}`, meta.pdfAdjustLastFile); } catch { /* skip */ }
      }
      // Restore setups
      if (meta.setups && Array.isArray(meta.setups)) {
        restoredSetups = meta.setups;
      }
      if (meta.nextSetupId != null) {
        restoredNextSetupId = meta.nextSetupId;
      }
      // Restore frame→setup mapping (keyed by server frame UUID)
      if (meta.frameSetups && typeof meta.frameSetups === 'object') {
        restoredFrameSetups = meta.frameSetups;
      }
      // Restore strip-tag state (origin/copy) from version UUID map
      if (meta.versionTags && typeof meta.versionTags === 'object') {
        for (const [vid, tag] of Object.entries(meta.versionTags)) {
          const localVer = serverVidToLocalVer.get(vid);
          if (localVer && (tag === 'origin' || tag === 'copy')) {
            localVer.setupTagged = tag;
          }
        }
      }
      // Restore stripTagInfoDismissed
      if (meta.stripTagInfoDismissed) {
        restoredStripTagInfoDismissed = true;
      }
      // Restore NEEDS definitions and per-frame state
      if (meta.needDefinitions) {
        restoredNeedDefinitions = meta.needDefinitions;
      }
      if (meta.frameNeeds && typeof meta.frameNeeds === 'object') {
        restoredFrameNeeds = meta.frameNeeds;
      }
      if (meta.frameNotes && typeof meta.frameNotes === 'object') {
        restoredFrameNotes = meta.frameNotes;
      }
      // Restore sort orders (remap server UUIDs → local IDs below)
      if (meta.sortOrders && Array.isArray(meta.sortOrders)) {
        restoredSortOrders = meta.sortOrders;
      }
      if (meta.nextSortOrderId != null) {
        restoredNextSortOrderId = meta.nextSortOrderId;
      }
      if (meta.activeSortOrderId != null) {
        restoredActiveSortOrderId = meta.activeSortOrderId;
      }
      if (meta.storyFlowBreaks && Array.isArray(meta.storyFlowBreaks)) {
        restoredStoryFlowBreaks = meta.storyFlowBreaks;
      }
      if (meta.camAspectRatio != null) {
        restoredCamAspectRatio = meta.camAspectRatio;
      }
      if (meta.exportMeta && typeof meta.exportMeta === 'object') {
        restoredExportMeta = meta.exportMeta;
      }
    } catch {
      // Ignore malformed metadata — use defaults
    }
  }

  // Apply frame→setup mapping from metadata (keyed by server frame UUID)
  if (Object.keys(restoredFrameSetups).length > 0) {
    for (const f of newFrames) {
      // Try server UUID key first (new format), fall back to local ID (legacy)
      const sid = (f.serverFrameId && restoredFrameSetups[f.serverFrameId])
        || restoredFrameSetups[f.id];
      if (sid) f.setupId = sid;
    }
  }

  // Remap per-frame needs from server UUIDs back to local IDs
  const localFrameNeeds: Record<number, FrameNeedState> = {};
  if (Object.keys(restoredFrameNeeds).length > 0) {
    for (const [uuid, needState] of Object.entries(restoredFrameNeeds)) {
      const localId = serverToLocalFrame.get(uuid);
      if (localId != null) localFrameNeeds[localId] = needState;
    }
  }
  const localFrameNotes: Record<number, FrameNoteState> = {};
  if (Object.keys(restoredFrameNotes).length > 0) {
    for (const [uuid, noteState] of Object.entries(restoredFrameNotes)) {
      const localId = serverToLocalFrame.get(uuid);
      if (localId != null) localFrameNotes[localId] = noteState;
    }
  }

  // The frame's OWN needs, notes and setup win over the project-wide list.
  // The list is still read first so nothing written by an older build is lost;
  // whatever is on the frame then overrides it. Once every device has pushed
  // once, the list is dead weight and comes out.
  // Same for tags: the version's own tag wins over the project-wide list.
  for (const cv of tree.versions) {
    if (!cv.tags) continue;
    const localVer = serverVidToLocalVer.get(cv.id);
    if (localVer && (cv.tags === 'origin' || cv.tags === 'copy')) localVer.setupTagged = cv.tags;
  }

  for (const cf of tree.frames) {
    const localId = serverToLocalFrame.get(cf.id);
    if (localId == null) continue;
    if (cf.needs) {
      try { localFrameNeeds[localId] = JSON.parse(cf.needs) as FrameNeedState; } catch { /* keep the list's copy */ }
    }
    if (cf.notes) {
      try { localFrameNotes[localId] = JSON.parse(cf.notes) as FrameNoteState; } catch { /* keep the list's copy */ }
    }
    if (cf.setup_id) {
      const nf = newFrames.find((x) => x.serverFrameId === cf.id);
      if (nf) nf.setupId = cf.setup_id;
    }
  }

  // Remap sort order frameOrder arrays from server UUIDs → local IDs
  const localSortOrders: import('../store/state').SortOrder[] = restoredSortOrders.map((o: any) => {
    const mapped: import('../store/state').SortOrder = {
      id: o.id,
      name: o.name ?? '',
      description: o.description ?? '',
      frameOrder: (o.frameOrder || []).map((uuid: string) => serverToLocalFrame.get(uuid)).filter((id: number | undefined) => id != null) as number[],
      breaks: o.breaks ?? [],
    };
    if (o.bracketTree) mapped.bracketTree = remapBracketIds(o.bracketTree, serverToLocalFrame) as BracketNodeData | undefined;
    if (o.sortedSnapshot) mapped.sortedSnapshot = (o.sortedSnapshot as string[]).map((uuid) => serverToLocalFrame.get(uuid)).filter((id: number | undefined) => id != null) as number[];
    return mapped;
  });

  // Apply structure immediately so the user sees the project right away.
  // Do a FULL reset of all per-frame maps to avoid stale data from the previous project.
  // IMPORTANT: Legacy aliases must reference the SAME objects as stripXxx maps.
  const verCC: Record<number, number> = {};
  const floorCC: Record<number, number> = {};
  const refsCC: Record<number, number> = {};
  // ...and what each card was showing before the pull, where it still exists.
  for (const [k, v] of Object.entries(wantedCC.ver)) if (v !== undefined) verCC[+k] = v;
  for (const [k, v] of Object.entries(wantedCC.floor)) if (v !== undefined) floorCC[+k] = v;
  for (const [k, v] of Object.entries(wantedCC.refs)) if (v !== undefined) refsCC[+k] = v;
  const verPFS: Record<number, any> = {};
  const floorPFS: Record<number, any> = {};
  const refsPFS: Record<number, any> = {};
  useStore.setState((prev) => ({
    frames: newFrames,
    // Generic maps
    stripVersions: { ver: verVersions, floor: floorVersions, refs: refsVersions },
    stripActiveTab: { ver: verActiveTab, floor: floorActiveTab, refs: refsActiveTab },
    stripCrossCompare: { ver: verCC, floor: floorCC, refs: refsCC },
    stripPrevFrameState: { ver: verPFS, floor: floorPFS, refs: refsPFS },
    // Legacy aliases (SAME objects as above)
    versions: verVersions,
    activeTab: verActiveTab,
    floorVersions,
    floorActiveTab,
    floorCrossCompare: floorCC,
    floorPrevFrameState: floorPFS,
    refsVersions,
    refsActiveTab,
    refsCrossCompare: refsCC,
    refsPrevFrameState: refsPFS,
    // StripDefs & groups from metadata (or defaults)
    ...(restoredStripDefs ? { stripDefs: restoredStripDefs } : {}),
    groups: restoredGroups,
    activeGroupId: null,
    nextGroupId: restoredNextGroupId,
    setups: restoredSetups,
    activeSetupId: null,
    setupMode: false,
    nextSetupId: restoredNextSetupId,
    // The per-frame list is rebuilt, but the PEN keeps its colour — a sync
    // arriving in the background used to put everything back to white in the
    // middle of working (#336).
    drawColor: {},
    drawWidth: {},
    drawEraser: {},
    drawActive: {},
    showText: prevView.showText,
    crossCompare: verCC,
    prevFrameState: verPFS,
    nextId,
    reorderFid: null,
    verReorderFid: null,
    verReorderStrip: null,
    verSlideDir: null,
    swipeHighlightFid: null,
    stripClipboard: null,
    imgTarget: null,
    mainImgTarget: null,
    // WHAT YOU ARE LOOKING AT IS NOT THE PROJECT (#347).
    //
    // These four were being reset on EVERY pull. The view went back to a
    // default, an expanded card collapsed, open text panels shut, and the app
    // forgot fullscreen was open — so a sync landing while you worked threw you
    // out of whatever you had in front of you. Until #342, the default was then
    // turned into 3x2 by the "which view does this project open in" rule, which
    // is why it always looked like a march back to the grid.
    //
    // A sync brings work from the other device. It has no business deciding
    // what is on screen. These stay exactly as the user left them.
    ovExpandedFid: prevView.ovExpandedFid,
    drawingInProgress: false,
    drawSuppressClick: false,
    overviewAction: false,
    fsOverlayActive: prevView.fsOverlayActive,
    currentViewMode: prevView.currentViewMode,
    portraitMode: isPortrait,
    projectType: restoredProjectType,
    stripTagInfoDismissed: restoredStripTagInfoDismissed,
    needDefinitions: migrateNeedDefinitions(restoredNeedDefinitions ?? freshNeedDefinitions()),
    frameNeeds: localFrameNeeds,
    frameNotes: localFrameNotes,
    sortOrders: localSortOrders,
    nextSortOrderId: restoredNextSortOrderId,
    activeSortOrderId: restoredActiveSortOrderId,
    storyFlowBreaks: restoredStoryFlowBreaks,
    camAspectRatio: restoredCamAspectRatio,
    exportMeta: restoredExportMeta ?? createDefaultExportMeta(),
    sortMode: false,
    sortEditingId: null,
    renderTick: prev.renderTick + 1,
  }));

  // The settings the server holds per item override what came out of the
  // metadata blob above. Items the server has never heard of are left alone,
  // so a project whose settings only exist in metadata is untouched.
  applySettingsToStore(tree.settings);
  // ...and then put back anything this device changed and has not sent, which
  // the metadata blob above overwrote before the per-item merge ever ran (#323).
  keepMyUnsentSettings(mySettingsBefore, tree.settings);
  adoptSettingsFromServer(tree.settings, tree.project.id);
  // A project the server holds no settings for has nothing to adopt, so take
  // the first look now with the project's creation time (#263, #264). Without
  // it the next change would be swallowed into a first look and never travel.
  if (!tree.settings || tree.settings.length === 0) {
    seedSettings(tree.project.id, tree.project.created_at);
  }

  // What arrived is not what this device changed (#265): record every frame and
  // version taken from the cloud with the time the OTHER device changed it, so
  // this device does not claim the newest edit of work it was merely handed.
  {
    // A row whose content_changed_at is null carries no honest answer to "when
    // was this changed" — nobody ever recorded one. Falling back to updated_at
    // invented one, and the invented time was the moment the row reached the
    // SERVER, which is always recent. This device would then believe it held
    // the newest edit of work it had merely been handed, and would beat a
    // genuine older edit coming from the other side. Same mistake as #310 and
    // #311; here it is simply left unknown, because it is (#313).
    const receivedTimes = new Map<string, number>();
    for (const sf of tree.frames) {
      if (keepLocalFrameIds?.has(sf.id)) continue;      // kept ours — our own stamp stands
      if (sf.content_changed_at == null) continue;      // not known — do not invent it
      receivedTimes.set(`f/${sf.id}`, sf.content_changed_at);
    }
    for (const sv of tree.versions) {
      if (sv.content_changed_at == null) continue;
      receivedTimes.set(`v/${sv.id}`, sv.content_changed_at);
    }
    stampChangedContent(undefined, receivedTimes);
  }

  (window as any).__fh_renderAll?.();

  // Now fetch images from R2 in parallel and patch them into the store.
  const token = getToken();
  if (!token) return;

  const expectedImageCount = mainImageTasks.length + versionImageTasks.length;
  let fetchedImageCount = 0;

  // Helper: fetch with up to 3 retries (exponential backoff: 2s, 4s, 8s)
  async function fetchWithRetry(r2Key: string, retries = 3): Promise<string> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fetchImageFromR2(r2Key, token!);
      } catch (e) {
        if (attempt === retries) throw e;
        await new Promise((r) => setTimeout(r, 2000 * Math.pow(2, attempt)));
      }
    }
    throw new Error('unreachable');
  }

  const failedTasks: string[] = [];  // descriptions of what failed
  const allFetches: Promise<void>[] = [];

  for (const task of mainImageTasks) {
    allFetches.push(
      fetchWithRetry(task.r2Key)
        .then((dataUrl) => {
          const s = useStore.getState();
          const idx = s.frames.findIndex((f) => f.id === task.localId);
          if (idx === -1) return;
          const updated = [...s.frames];
          updated[idx] = { ...updated[idx], src: dataUrl };
          useStore.setState((prev) => ({ frames: updated, renderTick: prev.renderTick + 1 }));
          (window as any).__fh_renderAll?.();
          fetchedImageCount++;
          onImageProgress?.(fetchedImageCount, expectedImageCount);
        })
        .catch((e) => {
          console.warn('[sync] failed to fetch main image after retries', task.r2Key, e);
          const frame = useStore.getState().frames.find((f) => f.id === task.localId);
          failedTasks.push(`Frame "${frame?.label || task.localId}" main image`);
          fetchedImageCount++;
          onImageProgress?.(fetchedImageCount, expectedImageCount);
        }),
    );
  }

  for (const task of versionImageTasks) {
    allFetches.push(
      fetchWithRetry(task.r2Key)
        .then((dataUrl) => {
          const s = useStore.getState();
          // Use the generic stripVersions map — works for any strip, present or future
          const versMap = s.stripVersions[task.strip];
          if (!versMap) return;
          const vers = versMap[task.localId];
          if (!vers || !vers[task.versionIdx]) return;
          const updatedVers = [...vers];
          updatedVers[task.versionIdx] = { ...updatedVers[task.versionIdx], bgImage: dataUrl };
          // Legacy alias keys for the three built-in strips (they point to the same
          // objects at init, but setState merges shallowly so we update both)
          const legacyKey = task.strip === 'ver' ? 'versions'
            : task.strip === 'floor' ? 'floorVersions'
            : task.strip === 'refs' ? 'refsVersions'
            : null;
          const legacyUpdate = legacyKey
            ? { [legacyKey]: { ...(s[legacyKey] as Record<number, Version[]>), [task.localId]: updatedVers } }
            : {};
          useStore.setState((prev) => ({
            ...legacyUpdate,
            stripVersions: {
              ...prev.stripVersions,
              [task.strip]: { ...prev.stripVersions[task.strip], [task.localId]: updatedVers },
            },
            renderTick: prev.renderTick + 1,
          }));
          (window as any).__fh_renderAll?.();
          fetchedImageCount++;
          onImageProgress?.(fetchedImageCount, expectedImageCount);
        })
        .catch((e) => {
          console.warn('[sync] failed to fetch version image after retries', task.strip, task.r2Key, e);
          const frame = useStore.getState().frames.find((f) => f.id === task.localId);
          failedTasks.push(`Frame "${frame?.label || task.localId}" ${task.strip} v${task.versionIdx + 1}`);
          fetchedImageCount++;
          onImageProgress?.(fetchedImageCount, expectedImageCount);
        }),
    );
  }

  // Wait for all images to load before returning (caller can show a toast).
  await Promise.all(allFetches);

  // Always update count baselines — pushes preserve r2Keys for any
  // images we didn't download, so server data is never lost.
  _lastKnownImageCount = countCurrentImages();
  _lastKnownFrameCount = state().frames.length;
  setPullIncomplete(failedTasks.length > 0);

  if (failedTasks.length > 0) {
    console.error('[sync] Failed image loads:', failedTasks);
  }
}

function parseStrokes(json: string | undefined): Stroke[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function parseScribbles(json: string | undefined): Stroke[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function parseTableData(json: string): { headers: string[]; rows: string[][] } | null {
  try {
    const v = JSON.parse(json);
    if (v && Array.isArray(v.headers) && Array.isArray(v.rows)) return v;
    return null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Public flow entry points (wired to menu buttons in init.ts)
// ---------------------------------------------------------------------------

export async function flowSaveProject(): Promise<void> {
  await saveNow();
}

export async function flowLoadProject(): Promise<void> {
  await openProjectList();
}

export async function flowRestoreProject(): Promise<void> {
  if (!isLoggedIn()) {
    showToast('Sign in to restore a project.');
    return;
  }
  const cp = getCurrentProject();
  if (!cp.projectId) {
    showToast('Save the project first before restoring.');
    return;
  }
  await openRestoreModal(cp.projectId);
}

// ---------------------------------------------------------------------------
// Restore Project modal — shows available snapshots grouped by time buckets
// ---------------------------------------------------------------------------

async function openRestoreModal(projectId: string): Promise<void> {
  // Fetch available snapshots from the server
  let snapshots: Array<{ id: string; created_at: number; reason?: string; continued_at?: number | null }>;
  let currentSnapshotId: string | null = null;
  // Capture where the user is right now, so it is in the list as "you are here"
  // and they can always come back to it after experimenting.
  try {
    await api.post(`/projects/${encodeURIComponent(projectId)}/snapshots`, undefined, getToken());
  } catch { /* listing still works without it */ }
  try {
    const res = await api.get<{
      snapshots: Array<{ id: string; created_at: number; reason?: string; continued_at?: number | null }>;
      currentSnapshotId?: string | null;
    }>(
      `/projects/${encodeURIComponent(projectId)}/snapshots`,
      getToken(),
    );
    snapshots = res.snapshots;
    currentSnapshotId = res.currentSnapshotId ?? null;
  } catch {
    showToast('Could not load restore points.');
    return;
  }

  if (snapshots.length === 0) {
    showToast('No restore points available yet — they are created automatically every 10 minutes.');
    return;
  }

  const now = Date.now();

  // Offline copies of THIS project sitting on the device.
  const localCopies = (await listPending())
    .filter((r) => isArchived(r) && r.projectId === projectId)
    .sort((a, b) => b.savedAt - a.savedAt);   // most recent first

  // One plain list of the actual restore points, oldest at the top, each with
  // the time it was taken. No fuzzy slots: every point stays reachable, which
  // is what makes experimenting with restores safe.
  // The newest point is the one just taken — that is where the user stands.
  const newestId = snapshots.length
    ? [...snapshots].sort((a, b) => b.created_at - a.created_at)[0].id
    : null;

  // Several restores in a row leave several "left off" points. Keep the three
  // most recent so the list stays readable; older ones are still on the server.
  const keepLeftOff = new Set(
    snapshots
      .filter((sn) => sn.reason === 'pre_restore')
      .sort((a, b) => b.created_at - a.created_at)
      .slice(0, 3)
      .map((sn) => sn.id),
  );

  // Where the user actually stands: the point they restored to, or — if they
  // have not restored, or have edited since — the most recent point.
  const hereId = currentSnapshotId && snapshots.some((sn) => sn.id === currentSnapshotId)
    ? currentSnapshotId
    : newestId;

  const matched = [...snapshots]
    .filter((sn) => sn.reason !== 'pre_restore' || sn.id === hereId || keepLeftOff.has(sn.id))
    .sort((a, b) => b.created_at - a.created_at)   // most recent first
    .map((sn) => ({
      snapshot: sn,
      clockTime: formatClockTime(sn.created_at),
      timeAgo: formatTimeAgo(now - sn.created_at),
      isLeftOff: sn.reason === 'pre_restore' && sn.id !== hereId,
      isCurrent: sn.id === hereId,
      continuedAt: sn.continued_at ? formatClockTime(sn.continued_at) : null,
    }));

  if (matched.length === 0) {
    showToast('No restore points available yet — they are created automatically every 10 minutes.');
    return;
  }

  // Build and show the modal
  return new Promise<void>((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999998;background:rgba(0,0,0,0.7);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

    const modal = document.createElement('div');
    modal.style.cssText =
      'background:#1a1a1a;border-radius:12px;padding:24px;max-width:360px;width:90%;' +
      'color:#fff;text-align:center;max-height:80vh;overflow-y:auto;';

    const title = document.createElement('div');
    title.textContent = 'Restore Project';
    title.style.cssText = 'font-size:18px;font-weight:600;margin-bottom:16px;';
    modal.appendChild(title);

    const subtitle = document.createElement('div');
    subtitle.textContent = 'Choose a restore point:';
    subtitle.style.cssText = 'font-size:13px;color:#aaa;margin-bottom:16px;';
    modal.appendChild(subtitle);

    for (const m of matched) {
      const btn = document.createElement('button');
      btn.style.cssText =
        'display:block;width:100%;padding:12px 16px;margin-bottom:8px;' +
        `background:${m.isCurrent ? '#3a2a2b' : '#2a2a2a'};` +
        `border:1px solid ${m.isCurrent ? '#d52632' : '#444'};border-radius:8px;` +
        'color:#fff;font-size:14px;cursor:pointer;text-align:left;' +
        'transition:background 0.15s;';
      const tag = m.isCurrent
        ? '<span style="color:#d52632;margin-left:8px;font-size:11px;">you are here</span>'
        : m.continuedAt
          ? `<span style="color:#888;margin-left:8px;font-size:11px;">continued at ${m.continuedAt}</span>`
          : m.isLeftOff
            ? `<span style="color:#d52632;margin-left:8px;font-size:11px;">left off at ${m.clockTime}</span>`
            : '';
      btn.innerHTML = `<span style="color:#fff;">${m.clockTime}</span>${tag}` +
        `<span style="float:right;color:#888;font-size:12px;">${m.timeAgo}</span>`;
      btn.addEventListener('mouseenter', () => { btn.style.background = m.isCurrent ? '#4a3233' : '#333'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = m.isCurrent ? '#3a2a2b' : '#2a2a2a'; });
      btn.addEventListener('click', async () => {
        overlay.style.display = 'none';
        const ok = await showConfirm(
          `Restore project to ${m.clockTime}?\n\nWhere you are now will be saved as a restore point first.`,
        );
        if (!ok) { overlay.style.display = 'flex'; return; }
        overlay.remove();
        await performRestore(projectId, m.snapshot.id);
        resolve();
      });
      modal.appendChild(btn);
    }

    // Offline copies held on this device for this project. Italic and grey —
    // they come from the device, not the cloud, and are kept 24 hours.
    for (const rec of localCopies) {
      const btn = document.createElement('button');
      btn.style.cssText =
        'display:block;width:100%;padding:12px 16px;margin-bottom:8px;' +
        'background:#232323;border:1px solid #3a3a3a;border-radius:8px;' +
        'color:#888;font-size:14px;font-style:italic;cursor:pointer;text-align:left;';
      btn.innerHTML = `<span>${formatClockTime(rec.savedAt)}</span>` +
        `<span style="margin-left:8px;font-size:11px;">offline copy on this device</span>`;
      btn.addEventListener('click', async () => {
        overlay.style.display = 'none';
        const ok = await showConfirm(
          `Open the offline copy from ${formatClockTime(rec.savedAt)}?\n\n` +
          `It replaces what is currently open. The cloud version is updated ` +
          `only when this is saved.`,
        );
        if (!ok) { overlay.style.display = 'flex'; return; }
        overlay.remove();
        if (!rec.snapshot || !rec.snapshot.frames || rec.snapshot.frames.length === 0) {
          showToast('That copy is empty — nothing to open.');
          resolve();
          return;
        }
        beginSystemAction();
        try {
          applySnapshotToStore(rec.snapshot);
          setCurrentProject({ projectId: rec.projectId, name: rec.name });
        } finally {
          endSystemAction();
        }
        claimStoreAsLocalWork();
        (window as any).__fh_renderAll?.();
        // Same as after a cloud restore: the view has to be re-applied AFTER
        // the rebuild, or the columns come back empty and the page looks dead.
        setViewMode(state().currentViewMode);
        resolve();
      });
      modal.appendChild(btn);
    }

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText =
      'display:block;width:100%;padding:12px 16px;margin-top:8px;' +
      'background:transparent;border:1px solid #555;border-radius:8px;' +
      'color:#aaa;font-size:14px;cursor:pointer;';
    cancelBtn.addEventListener('click', () => {
      overlay.remove();
      resolve();
    });
    modal.appendChild(cancelBtn);

    overlay.appendChild(modal);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(); }
    });
    document.body.appendChild(overlay);
  });
}

function formatTimeAgo(ms: number): string {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(ms / 3600000);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  if (hours < 48) return 'yesterday';
  const days = Math.round(ms / 86400000);
  return `${days} days ago`;
}

function formatClockTime(timestamp: number): string {
  const d = new Date(timestamp);
  const h = d.getHours().toString().padStart(2, '0');
  const m = d.getMinutes().toString().padStart(2, '0');
  return `${h}:${m}`;
}

async function performRestore(projectId: string, snapshotId: string): Promise<void> {
  const progressEl = document.getElementById('progressOverlay');
  const progressBar = document.getElementById('progressBar') as HTMLElement | null;
  const progressLabel = document.getElementById('progressLabel') as HTMLElement | null;
  if (progressEl) progressEl.classList.remove('hidden');
  if (progressBar) progressBar.style.width = '10%';
  if (progressLabel) progressLabel.textContent = 'Restoring…';

  // Restoring reloads the whole project, which would drop the user back into
  // the default view. Remember where they were so they land back on it.
  const before = state();
  const viewBefore = {
    currentViewMode: before.currentViewMode,
    activeStrips: [...before.activeStrips],
    notesStripVisible: before.notesStripVisible,
    needsStripVisible: before.needsStripVisible,
    activeGroupId: before.activeGroupId,
    centerFid: before.centerFid,
  };

  try {
    if (progressBar) progressBar.style.width = '30%';
    const tree = await api.post<CloudProjectTree>(
      `/projects/${encodeURIComponent(projectId)}/restore/${encodeURIComponent(snapshotId)}`,
      undefined,
      getToken(),
    );
    if (progressBar) progressBar.style.width = '60%';
    if (progressLabel) progressLabel.textContent = 'Loading images…';

    if (state().sortEditingId) closeSortMode();
    beginSystemAction();
    try {
      await applyCloudTreeToStore(tree, undefined, (loaded, total) => {
        if (total === 0) return;
        const pct = 60 + Math.round((loaded / total) * 35);
        if (progressBar) progressBar.style.width = pct + '%';
        if (progressLabel) progressLabel.textContent = `Loading image ${loaded} of ${total}…`;
      });
    } finally {
      endSystemAction();
    }

    // Put the view back the way the user left it. A group or frame that the
    // older snapshot does not contain is simply skipped.
    const after = state();
    const groupStillExists =
      viewBefore.activeGroupId !== null &&
      after.groups.some((g) => g.id === viewBefore.activeGroupId);
    useStore.setState({
      currentViewMode: viewBefore.currentViewMode,
      activeStrips: viewBefore.activeStrips,
      notesStripVisible: viewBefore.notesStripVisible,
      needsStripVisible: viewBefore.needsStripVisible,
      activeGroupId: groupStillExists ? viewBefore.activeGroupId : null,
    });

    if (progressBar) progressBar.style.width = '100%';
    clearDirtyState();
    (window as any).__fh_renderAll?.();
    // After the rebuild, not before — otherwise renderAll has the last word
    // and drops the user back into the default view.
    setViewMode(viewBefore.currentViewMode);

    const frameStillExists =
      viewBefore.centerFid != null &&
      state().frames.some((f) => String(f.id) === String(viewBefore.centerFid));
    if (frameStillExists) requestAnimationFrame(() => scrollAnchorTo(viewBefore.centerFid));
    showToast('Project restored successfully.');
    setTimeout(() => {
      if (progressEl) progressEl.classList.add('hidden');
      if (isPullIncomplete()) showIncompleteLoadOverlay();
    }, 300);
  } catch (e) {
    if (progressEl) progressEl.classList.add('hidden');
    showToast(asMessage(e, 'Could not restore project.'));
  }
}

export async function flowAccountOrSignIn(): Promise<void> {
  if (isLoggedIn()) {
    await openAccountSettings();
  } else {
    await openAccountModal('login');
    // After login, if there's an unsaved project with frames, save it now.
    if (isLoggedIn()) {
      const cp = getCurrentProject();
      if (!cp.projectId && state().frames.length > 0) {
        await saveNow();
      }
      // If a cloud project is already loaded, pull latest changes from server.
      // This covers the case where the user was browsing a project while signed
      // out and another device pushed updates in the meantime.
      if (cp.projectId) {
        setTimeout(() => void tryPullFromCloud(), 500);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Device heartbeat: server-side "I'm working" signal.
// All timestamps are SERVER-side — no client clock dependency.
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_STALE_MS = 10_000; // heartbeat older than this = device stopped
let _lastUserActivity = 0;
let _deviceLockOverlay: HTMLElement | null = null;

/**
 * Signal that the user is actively working — keeps the heartbeat sender alive.
 * Call this from any UI that captures input (note modals, draw canvas, etc.)
 * so other devices still see the "10 sec wait" overlay.
 */
export function signalActivity(): void {
  _lastUserActivity = Date.now();
}

/** Send a heartbeat to the server — "this device is actively working". */
/** Guards against a second heartbeat opening the question again while the
 *  first one is still on screen. */
let _askingAboutConflicts = false;

async function sendHeartbeat(): Promise<void> {
  const cp = getCurrentProject();
  if (!cp.projectId || !isLoggedIn()) return;
  try {
    const beat = await api.post<{
      ok: boolean;
      open_conflicts?: number;
      open_setting_conflicts?: number;
      project_updated_at?: number | null;
      project_last_device_id?: string | null;
    }>(
      `/projects/${encodeURIComponent(cp.projectId)}/heartbeat`,
      { device_id: getDeviceId(), device_name: getDeviceName() },
      getToken(),
    );

    // Pulls used to happen only on focus, visibility or boot. Sit in front of
    // an open window and scroll, and the other device's work never arrived —
    // the app had no way of hearing about it. The heartbeat already runs every
    // few seconds while someone is working and already talks to the server, so
    // it says when the project last changed. Newer than what we hold, and by
    // someone else, means fetch it — no new timer and no polling loop.
    // BEING THE LAST TO SPEAK IS NOT THE SAME AS HAVING HEARD (#319).
    //
    // This used to skip the pull whenever the last device to write was this one
    // — the exact shortcut #299 removed from the pull path, still living here.
    //
    // It is wrong for the same reason: whoever wrote last says nothing about
    // what the server was holding BEFORE that write. A device that pushes after
    // someone else's work has landed becomes the last writer and then stops
    // asking — for ever, because only another device writing can lift the
    // condition. In the test the tablet reconnected, pushed, and went deaf to a
    // sentence the desktop had put up three seconds earlier.
    //
    // Nothing is lost by removing it. serverHasSomethingNew already compares
    // against what this device has actually TAKEN, so a device that really is
    // up to date still does not pull.
    const remoteAt = beat?.project_updated_at ?? null;
    if (remoteAt !== null) {
      if (serverHasSomethingNew({ takenFromServerAt: takenFromServerAt ?? 0 } as DeviceMemory, remoteAt)) {
        trace(`heartbeat: the project changed elsewhere — pulling`);
        await tryPullFromCloud();
      }
    }

    // The heartbeat is the only thing that runs while someone is simply
    // working — scrolling, presenting, not switching windows. So it is where a
    // waiting decision gets noticed, on whichever device the user is at.
    if ((beat?.open_setting_conflicts ?? 0) > 0) {
      await askAboutOpenSettingConflicts(cp.projectId);
    }

    if ((beat?.open_conflicts ?? 0) > 0 && !_askingAboutConflicts) {
      _askingAboutConflicts = true;
      try {
        await askAboutOpenConflicts(cp.projectId);
      } finally {
        _askingAboutConflicts = false;
      }
    }
  } catch { /* silent */ }
}

// ---------------------------------------------------------------------------
// THE MOMENT THE CONNECTION COMES BACK (#298)
//
// Every other way of hearing about the other device needs something from you:
// the heartbeat needs the window in front AND a finger on it within the last
// ten seconds; the push retry needs unsent work and waits forty seconds.
//
// Put the wifi back on and sit still, and nothing asks the server. That is the
// one moment where none of the rules fit — the device knows something changed
// (its own connection), and it is the cheapest possible question to ask.
//
// The browser's `online` event is not trusted on its own: after an airplane
// mode toggle it often never arrives at all. So the connection is watched, and
// either the event or the watch triggers ONE check.
// ---------------------------------------------------------------------------
let _wasOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
let _lastReconnectCheck = 0;

async function checkServerAfterReconnect(): Promise<void> {
  const cp = getCurrentProject();
  // NOT gated on being signed in — that is one of the things this repairs (#304).
  if (!cp.projectId || !navigator.onLine || !getToken()) return;
  if (Date.now() - _lastReconnectCheck < 3000) return;   // event AND watch fired
  _lastReconnectCheck = Date.now();

  trace('back online — asking the server what it has');
  // A device that STARTED offline never learned who it was, and everything that
  // syncs asks that first. Ask again now, or it stays a stranger to its own
  // account until somebody reloads it (#304).
  if (!isLoggedIn()) {
    await loadCurrentUser();
    trace(`  who am I: ${isLoggedIn() ? 'signed in now' : 'still unknown'}`);
  }
  if (!isLoggedIn()) return;
  // Send first. Anything made offline goes up now rather than in forty seconds,
  // and the pull that follows is not held back by our own unsent work.
  try { await flushSyncNow(); } catch { /* still unreachable */ }
  try {
    const status = await api.get<ProjectStatus>(
      `/projects/${encodeURIComponent(cp.projectId)}/status`, getToken());
    const remoteAt = status.updated_at ?? 0;
    if (serverHasSomethingNew({ takenFromServerAt: takenFromServerAt ?? 0 } as DeviceMemory, remoteAt)) {
      trace(`  the project changed elsewhere (${status.last_device_name || 'another device'}) — pulling`);
      await tryPullFromCloud();
    } else {
      trace('  the server has nothing newer');
    }
  } catch {
    trace('  could not reach the server — will try again');
  }
}

/**
 * The watch, for when the `online` event never comes. It only runs WHILE THE
 * DEVICE IS OFF — there is nothing to watch for otherwise — and stops itself
 * the moment the connection returns. So the normal, connected case carries no
 * timer at all, and the watching case reads one boolean every three seconds and
 * makes no request until the answer changes.
 */
let _offlineWatch: number | null = null;

export function watchForTheConnectionComingBack(): void {
  if (_offlineWatch !== null) return;
  _offlineWatch = window.setInterval(() => {
    if (!navigator.onLine) return;              // still off — keep watching
    window.clearInterval(_offlineWatch!);
    _offlineWatch = null;
    _wasOnline = true;
    void checkServerAfterReconnect();
  }, 3000);
}

function watchTheConnection(): void {
  window.addEventListener('online', () => { void checkServerAfterReconnect(); });
  // Three ways of learning we are off, because no single one is reliable: the
  // browser's event, the state at startup, and — the only one that never lies —
  // a push that came back with no answer at all.
  window.addEventListener('offline', () => { _wasOnline = false; watchForTheConnectionComingBack(); });
  if (!navigator.onLine) { _wasOnline = false; watchForTheConnectionComingBack(); }
}

/** Start sending heartbeats while the user is active. */
function startHeartbeatSender(): void {
  // Track user activity — ANY interaction keeps the heartbeat alive so other
  // devices see the "10 sec wait" overlay. Includes scroll/wheel/mousemove
  // because scrolling through a storyboard without clicking is still "working".
  const onActivity = () => { _lastUserActivity = Date.now(); };
  document.addEventListener('mousedown', onActivity, true);
  document.addEventListener('touchstart', onActivity, true);
  document.addEventListener('keydown', onActivity, true);
  document.addEventListener('scroll', onActivity, { passive: true, capture: true });
  document.addEventListener('wheel', onActivity, { passive: true, capture: true });
  document.addEventListener('mousemove', onActivity, true);
  document.addEventListener('touchmove', onActivity, { passive: true, capture: true });

  // Send heartbeat every 5 seconds, but ONLY if the user was active in the last 10 seconds
  setInterval(() => {
    if (!document.hasFocus()) return;
    if (isDeviceLocked()) return;
    if (Date.now() - _lastUserActivity < HEARTBEAT_STALE_MS) {
      void sendHeartbeat();
    }
  }, HEARTBEAT_INTERVAL_MS);
}

type ProjectStatus = {
  updated_at: number;
  last_device_id: string | null;
  last_device_name: string | null;
  heartbeat_at: number | null;
  heartbeat_device_id: string | null;
  heartbeat_device_name: string | null;
  server_now: number;
};

/** Check if another device's heartbeat is alive. Returns the device name if locked, null if clear. */
async function checkHeartbeat(): Promise<string | null> {
  const cp = getCurrentProject();
  if (!cp.projectId || !isLoggedIn()) return null;
  try {
    const status = await api.get<ProjectStatus>(
      `/projects/${encodeURIComponent(cp.projectId)}/status`,
      getToken(),
    );
    if (!status.heartbeat_at || !status.heartbeat_device_id) return null;
    if (status.heartbeat_device_id === getDeviceId()) return null; // our own heartbeat
    const age = status.server_now - status.heartbeat_at;
    if (age < HEARTBEAT_STALE_MS) {
      return status.heartbeat_device_name || 'another device';
    }
    return null;
  } catch {
    return null;
  }
}

function showDeviceLockOverlay(deviceName: string): void {
  if (!_deviceLockOverlay) {
    const el = document.createElement('div');
    el.id = 'deviceLockOverlay';
    el.style.cssText =
      'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.82);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;text-align:center;' +
      'touch-action:none;overscroll-behavior:none;';
    el.innerHTML = `
      <div style="max-width:340px;padding:24px;">
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;" id="deviceLockMsg"></div>
        <div style="font-size:13px;color:#aaa;">Changes will sync automatically.</div>
      </div>`;
    // Block ALL interaction behind the overlay — scroll, touch, wheel.
    // Without this, scrolling the page behind the overlay triggers Zustand
    // subscriber → marks dirty → can interfere with the pull.
    const stopEvent = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('wheel', stopEvent, { passive: false });
    el.addEventListener('touchmove', stopEvent, { passive: false });
    el.addEventListener('scroll', stopEvent, { passive: false });
    document.body.appendChild(el);
    _deviceLockOverlay = el;
  }
  _deviceLockOverlay.style.display = 'flex';
  // Prevent body scrolling while overlay is visible
  document.body.style.overflow = 'hidden';
  const msgEl = document.getElementById('deviceLockMsg');
  if (msgEl) msgEl.textContent = `Your ${deviceName} is working on this project — please wait 10sec for sync to start working here.`;
}

// ---------------------------------------------------------------------------
// Incomplete-load overlay: shown when a pull failed to fetch all content.
// Blocks interaction (like device lock), offers Retry / Dismiss.
// ---------------------------------------------------------------------------
let _incompleteLoadOverlay: HTMLElement | null = null;

function showIncompleteLoadOverlay(): void {
  if (!_incompleteLoadOverlay) {
    const el = document.createElement('div');
    el.id = 'incompleteLoadOverlay';
    el.style.cssText =
      'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.82);' +
      'display:flex;align-items:center;justify-content:center;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#fff;text-align:center;' +
      'touch-action:none;overscroll-behavior:none;';
    el.innerHTML = `
      <div style="max-width:340px;padding:24px;">
        <div style="font-size:16px;font-weight:600;margin-bottom:8px;">
          Couldn’t load all content
        </div>
        <div style="font-size:13px;color:#aaa;margin-bottom:20px;">
          Check your internet connection and try again.
        </div>
        <div style="display:flex;gap:12px;justify-content:center;">
          <button id="incompleteRetryBtn" style="
            padding:10px 24px;border-radius:8px;border:none;
            background:#fff;color:#000;font-size:14px;font-weight:600;
            cursor:pointer;">Retry</button>
          <button id="incompleteDismissBtn" style="
            padding:10px 24px;border-radius:8px;border:1px solid #555;
            background:transparent;color:#aaa;font-size:14px;font-weight:500;
            cursor:pointer;">Dismiss</button>
        </div>
      </div>`;
    const stopEvent = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    el.addEventListener('wheel', stopEvent, { passive: false });
    el.addEventListener('touchmove', stopEvent, { passive: false });
    el.addEventListener('scroll', stopEvent, { passive: false });
    document.body.appendChild(el);
    _incompleteLoadOverlay = el;

    // Retry: pull again from cloud
    el.querySelector('#incompleteRetryBtn')!.addEventListener('click', () => {
      hideIncompleteLoadOverlay();
      void tryPullFromCloud();
    });
    // Dismiss: let user work, but _pullIncomplete stays true (no push/save)
    el.querySelector('#incompleteDismissBtn')!.addEventListener('click', () => {
      hideIncompleteLoadOverlay();
    });
  }
  _incompleteLoadOverlay.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function hideIncompleteLoadOverlay(): void {
  if (_incompleteLoadOverlay) {
    _incompleteLoadOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function hideDeviceLockOverlay(): void {
  if (_deviceLockOverlay) {
    _deviceLockOverlay.style.display = 'none';
    document.body.style.overflow = '';
  }
}

function isDeviceLocked(): boolean {
  return _deviceLockOverlay !== null && _deviceLockOverlay.style.display !== 'none';
}

/**
 * Gate function: check heartbeat, show overlay if another device is active,
 * wait until it stops, then pull and unlock. Returns when safe to proceed.
 */
async function waitForDeviceLock(): Promise<void> {
  const lockedBy = await checkHeartbeat();
  if (!lockedBy) return; // no other device active — proceed

  showDeviceLockOverlay(lockedBy);
  // Poll every 5 seconds until the heartbeat goes stale
  while (true) {
    await new Promise(r => setTimeout(r, HEARTBEAT_INTERVAL_MS));
    const stillLocked = await checkHeartbeat();
    if (!stillLocked) {
      // Other device stopped — pull latest and unlock
      await tryPullFromCloud();
      hideDeviceLockOverlay();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Pull-on-focus: when the tab becomes visible, check heartbeat FIRST,
// then pull if safe.
// ---------------------------------------------------------------------------

let pullOnFocusActive = false;
let lastKnownUpdatedAt: number | null = null;

/**
 * WHEN THIS DEVICE LAST *TOOK* SOMETHING FROM THE SERVER (#299).
 *
 * "Is there anything new for me?" used to be answered against the last time
 * this device SPOKE to the server — and a push counts as speaking. So a device
 * could push, mark itself current, and never have fetched what the server was
 * already holding.
 *
 * That is exactly how an iPad lost two drawings: its pull was held back by an
 * unsent setting, the desktop's work landed, the iPad then pushed, declared
 * itself up to date, and from that moment the newest change on the server was
 * its own — so it never asked again.
 *
 * Speaking is not listening. Only a pull moves this. `lastKnownUpdatedAt` keeps
 * its own, different job: it is the "what I had seen when I made this change"
 * mark that a push sends up, and the server uses it to tell a change made on
 * top of someone else's from two made blind.
 */
let takenFromServerAt: number | null = null;
let pullInFlight = false;
let lastPullAt = 0;
const PULL_COOLDOWN_MS = 3_000; // Don't check more often than every 3s

// ---------------------------------------------------------------------------
// ASK ONLY FOR WHAT CHANGED (#280)
//
// A pull used to fetch the whole project — every frame, version, image and
// drawing — to answer "has anything happened?". On a 45-frame project that is
// 500+ rows read, on every pull, for a one-word edit somewhere.
//
// Now the device says when it last heard, and the server sends only what has
// arrived since. The delta is folded into the copy held here, which produces a
// whole project again, and everything downstream — the conflict check, the
// keep-local merge, the rebuild — runs on that, unchanged.
//
// Held in memory only, on purpose. After a restart there is nothing to fold
// into, so the first pull asks for everything, once. That is the safe way to be
// wrong: a full pull always works.
// ---------------------------------------------------------------------------

/** Turn deltas off in one line if a device ever misbehaves. */
const DELTA_PULL = true;

let _heldTree: CloudProjectTree | null = null;
let _heldTreeProjectId: string | null = null;
/** The SERVER's clock as of its last answer. Never this device's. */
let _heardAt = 0;

/**
 * Remember a whole project as the ground this device stands on.
 *
 * PUSHING IS NOT HEARING (#320).
 *
 * The reply to a push is the whole project as the server now holds it, so it is
 * good ground to stand on and is kept. But it was also moving `_heardAt` — the
 * mark that says "I have been told everything up to here" — and that is a lie,
 * because the push path keeps the reply's SETTINGS and throws its FRAMES away.
 *
 * So a device would push, quietly record itself as current as of that moment,
 * and never ask for the frames it had just been handed and discarded. In the
 * test the tablet reconnected, pushed, and never saw a sentence the desktop had
 * written seconds earlier — not slowly, never.
 *
 * The same rule as #299 and #319, in the last place it was still broken: only a
 * PULL may move the mark. Standing on the tree is fine; claiming to have heard
 * it is not.
 */
function holdTree(projectId: string, tree: CloudProjectTree, heard: boolean): void {
  _heldTree = tree;
  _heldTreeProjectId = projectId;
  if (heard && tree.server_now) _heardAt = tree.server_now;
}

/** The server's clock at our last answer — saved with the project (#284). */
export function getHeardAt(): number { return _heardAt; }
export function adoptHeardAt(at: number | undefined): void {
  if (typeof at === 'number' && at > 0) _heardAt = at;
}

export function forgetHeldTree(): void {
  _heldTree = null;
  _heldTreeProjectId = null;
  _heardAt = 0;
}

/**
 * Can this pull ask for changes only?
 *
 * Two ways to have ground to stand on: the copy held since the last answer, or
 * — after a restart, when that copy is gone but the project is still on the
 * device — the frames themselves (#285). Either way the one thing that cannot
 * be guessed is WHEN we last heard, which is why it is saved (#284).
 */
function deltaIsSafe(projectId: string): boolean {
  if (!DELTA_PULL || _heardAt <= 0) return false;
  // ONE WAY ONLY: the copy held since the last answer (#306).
  //
  // There used to be a second — after a restart, when that copy is gone, a
  // SKELETON built from the frames on the device (#285). It cost two days. A
  // skeleton has names and places but not content, and the fold keeps its rows
  // for everything the delta does not mention, so whatever the skeleton leaves
  // out becomes the truth:
  //
  //   #302  it left out the server's times, and every push then claimed to have
  //         seen nothing, so the server raised a picker against the same device
  //   #306  it left out each version's TYPE, so the apply crashed on
  //         `type.startsWith` — every pull, on every reload, on both devices
  //
  // Both are the same mistake: a partial copy standing in for a real one. The
  // next missing field would be the third. So after a restart the first pull
  // asks for the whole project — one honest answer — and delta pulls resume
  // from there, folded onto something real.
  return _heldTree !== null && _heldTreeProjectId === projectId;
}


// Image-count safeguard: tracks how many images the project had after the last
// successful sync or pull. If the count drops to 0 unexpectedly, we refuse to
// push — this prevents a corrupt (imageless) state from overwriting good cloud data.
let _lastKnownImageCount = 0;
// Frame count guard: tracks how many frames the project had after the last
// successful sync or pull. If the count drops unexpectedly (without matching
// tombstones), we refuse to push — prevents partial/corrupt pushes from
// wiping good cloud data.
let _lastKnownFrameCount = 0;
// _pullIncomplete flag lives in currentProject.ts (avoids circular import).
// Set via setPullIncomplete() after a pull — blocks IDB autosave + sync push.

// ---------------------------------------------------------------------------
// Frame fingerprinting — used for delta push to detect which frames changed.
// After each successful push, we store a fingerprint (simple string hash) for
// every frame. At push time, we recompute fingerprints and only include frames
// whose fingerprint differs from the stored one (or that are new).
// ---------------------------------------------------------------------------
const _lastPushedFingerprints = new Map<string, string>();

/**
 * What the server's timestamp is for each frame, as far as we know.
 *
 * Deliberately NOT stored on the frames themselves: every push would then
 * rewrite thirty frame objects, the change-tracker would read that as the user
 * editing everything, and the app would push again — a loop. Keeping it beside
 * the fingerprints touches no application state at all.
 */
const _serverFrameTimes = new Map<string, number>();

/** Clear fingerprints (on project switch, new pull, etc.). Next push sends all. */
/**
 * Record the current store as "what the server has".
 *
 * After a pull the store IS the server's state. Clearing the record instead
 * made every frame look changed, so the device immediately pushed the entire
 * project back — which made the other device pull, and re-push in turn. Two
 * devices bouncing the same frames between them, visible in the log as a pull
 * followed seconds later by a 30/30 push.
 *
 * Frames the user changed while the pull was being applied are NOT covered by
 * this: those are kept local by the merge and stay different from the server's
 * version, so they still show as changed on the next push.
 */
/**
 * Server ids of frames that differ from what the server last received.
 *
 * This is the honest answer to "what have I changed". The reference-based
 * tracker misses almost everything, because drawing, notes and photos modify a
 * frame in place and its identity never changes — so a merge asking that
 * tracker sees nothing to protect and lets the cloud overwrite real work.
 */
export function framesNeedingPush(): Set<string> {
  const s = state();
  const out = new Set<string>();
  s.frames.forEach((f, i) => {
    if (!f.serverFrameId) return;                       // new frames are handled separately
    if (_lastPushedFingerprints.size === 0) return;     // nothing to compare against yet
    if (_lastPushedFingerprints.get(f.serverFrameId) !== frameFingerprint(f, i, s)) {
      out.add(f.serverFrameId);
    }
  });
  return out;
}

/** The project's own settings — need definitions, setups, groups, sort orders
 *  and so on. None of them belong to a frame, so no frame fingerprint moves
 *  when they change, and the "nothing changed" check threw the push away.
 *  Renaming a needs category on the iPad never reached the desktop because of
 *  it. */
function projectMetaFingerprint(s: ReturnType<typeof state>): string {
  return JSON.stringify([
    s.needDefinitions, s.setups, s.nextSetupId, s.groups,
    s.sortOrders, s.nextSortOrderId, s.activeSortOrderId,
    s.storyFlowBreaks, s.camAspectRatio, s.exportMeta,
    s.portraitMode, s.projectType, s.stripTagInfoDismissed,
  ]);
}

let _lastPushedMeta = '';

/** True when the project's settings have changed since the last successful
 *  push. Empty means "we do not know yet", which must not count as unsent. */
export function projectSettingsUnsent(): boolean {
  if (settingsNeedPush()) return true;
  if (_lastPushedMeta === '') return false;
  return projectMetaFingerprint(state()) !== _lastPushedMeta;
}

export function adoptFingerprintsFromStore(): void {
  const s = state();
  _lastPushedMeta = projectMetaFingerprint(s);
  // Forget timestamps for frames that are gone, so the counts stay honest.
  const alive = new Set(s.frames.map((f) => f.serverFrameId).filter(Boolean) as string[]);
  for (const id of [..._serverFrameTimes.keys()]) if (!alive.has(id)) _serverFrameTimes.delete(id);
  _lastPushedFingerprints.clear();
  s.frames.forEach((f, i) => {
    if (!f.serverFrameId) return;      // never sent — must still go up
    _lastPushedFingerprints.set(f.serverFrameId, frameFingerprint(f, i, s));
  });
  trace(`  recorded ${_lastPushedFingerprints.size} frames as matching the server`);
}

/** Hand the last-sent record to the local snapshot, and take it back on boot. */
export function exportPushedFingerprints(): Record<string, string> {
  const out: Record<string, string> = Object.fromEntries(_lastPushedFingerprints);
  // The server timestamps ride along under a reserved key, so a restart does
  // not lose them and fall back to whole-project conflict checking.
  out['__serverTimes'] = JSON.stringify(Object.fromEntries(_serverFrameTimes));
  return out;
}
export function importPushedFingerprints(m: Record<string, string>): void {
  _lastPushedFingerprints.clear();
  _serverFrameTimes.clear();
  for (const [k, v] of Object.entries(m)) {
    if (k === '__serverTimes') {
      try {
        for (const [id, t] of Object.entries(JSON.parse(v) as Record<string, number>)) {
          _serverFrameTimes.set(id, t);
        }
      } catch { /* start without them; the next pull refills */ }
      continue;
    }
    _lastPushedFingerprints.set(k, v);
  }
  // Drop anything for frames that no longer exist, so the counts are honest and
  // two devices with the same project report the same numbers.
  const known = new Set(Object.keys(m).filter((k) => k !== '__serverTimes'));
  for (const id of [..._serverFrameTimes.keys()]) if (!known.has(id)) _serverFrameTimes.delete(id);
  trace(`  restored ${_lastPushedFingerprints.size} frames known to be on the server` +
        ` · ${_serverFrameTimes.size} with a timestamp`);
}

/** Mark one frame as no longer known to match the server. */
export function forgetPushedFingerprint(serverFrameId: string): void {
  _lastPushedFingerprints.delete(serverFrameId);
}

/** Stop treating one frame as having unsent local work.
 *
 *  Used after a conflict is decided: the server now holds the answer for that
 *  frame, so the local copy must not be defended as "mine". Left dirty, the
 *  pull keeps the local version instead of the decided one and then pushes it
 *  back up, which is how a settled conflict came undone. */
export function markFrameAsMatchingServer(serverFrameId: string): void {
  const s = state();
  const i = s.frames.findIndex((f) => f.serverFrameId === serverFrameId);
  if (i < 0) return;
  _lastPushedFingerprints.set(serverFrameId, frameFingerprint(s.frames[i], i, s));
}

export function clearPushedFingerprints(): void {
  _lastPushedFingerprints.clear();
  _lastPushedMeta = '';
}

/**
 * Forget everything we remember about the PREVIOUS project.
 *
 * The frame/image guards below refuse to push when the current project looks
 * emptier than the last one. Those counters used to survive a project switch,
 * so creating a fresh project (1 frame, no images) right after working on a
 * full one made the guard cancel the very first upload — silently, while the
 * app still reported a successful save. Every switch must reset them.
 */
export function resetProjectSyncGuards(): void {
  _lastKnownImageCount = 0;
  _lastKnownFrameCount = 0;
  _lastPushedFingerprints.clear();
  // ...including the copy the delta pull folds into. Keeping it would let one
  // project's frames be merged into another's (#280).
  forgetHeldTree();
  // Deletions belong to the project they were made in (#327). Carried over,
  // they were sent up under the NEXT project's id — telling the server to
  // delete frames it had never heard of, and weakening the guard that refuses
  // a push which loses frames.
  if (_pendingTombstones.length > 0) {
    trace(`  ${_pendingTombstones.length} unsent deletion(s) belonged to the last project — dropped`);
    _pendingTombstones = [];
  }
}

/**
 * Compute a lightweight fingerprint for a frame and all its strip versions.
 * Captures: label, sort_order, crop, hidden, text, strokes count, r2Key,
 * setupId, stripLabels, and per-version data (label, type, hidden, starred,
 * setupTagged, r2Key/bgImage, strokes count).
 *
 * Intentionally cheap — string concat, no crypto hash. A false positive
 * (fingerprint same but data changed) is extremely unlikely. A false negative
 * (fingerprint changed but data identical) just means we send an extra frame.
 */
/**
 * What is IN a frame — deliberately not WHERE it is (#294).
 *
 * With the position in here, dragging one frame made all forty-five look
 * changed: forty-five rows written, and every one of them able to overwrite a
 * newer note from the other device. The arrangement travels as its own item now.
 */
function frameFingerprint(f: Frame, _sortOrder: number, s: { stripVersions: Record<string, Record<number, Version[]>>; frameNeeds: Record<number, FrameNeedState>; frameNotes: Record<number, FrameNoteState> }): string {
  const parts: string[] = [
    f.label,
    String(f.cropW),
    String(f.cropH),
    f.hidden ? '1' : '0',
    f.textContent || '',
    f.tableData ? JSON.stringify(f.tableData) : '',
    strokesFp(f.strokes),
    pictureFp(f.r2Key, f.src),
    f.setupId || '',
    f.stripLabels ? JSON.stringify(f.stripLabels) : '',
    f.note || '',
    String(f.scribbles?.length || 0),
  ];
  // Include versions for each strip
  for (const stripType of ['ver', 'floor', 'refs']) {
    const vers = s.stripVersions[stripType]?.[f.id];
    if (vers) {
      for (const v of vers) {
        parts.push(
          `${stripType}:${v.label}|${v.type}|${v.hidden ? 1 : 0}|${versionStars(v)}|${v.setupTagged || ''}|${pictureFp(v.r2Key, v.bgImage)}|${strokesFp(v.strokes)}|${v.note || ''}`,
        );
      }
    }
  }
  // Include per-frame needs state
  const fn = s.frameNeeds[f.id];
  if (fn) parts.push('needs:' + JSON.stringify(fn));
  // Include per-frame notes state
  const fnote = s.frameNotes[f.id];
  if (fnote) parts.push('notes:' + JSON.stringify(fnote));
  return parts.join('\x00');
}

// ---------------------------------------------------------------------------
// Tombstones — track explicit user deletions so other devices remove them too.
// Pending tombstones are accumulated locally and flushed in the next push.
// ---------------------------------------------------------------------------
interface Tombstone {
  id: string;
  entity_type: 'frame' | 'version';
  entity_id: string;   // serverFrameId or serverVersionId
  deleted_at: number;
  device_id: string;
}

let _pendingTombstones: Tombstone[] = [];

/** Deletions this device has made that the server has not taken yet, so the
 *  local save can hold on to them across a restart (#327). */
export function exportPendingTombstones(): Tombstone[] {
  return [..._pendingTombstones];
}

/**
 * Take them back on boot. Anything already here is kept — this only adds — and
 * the same deletion arriving twice is harmless, because the server ignores a
 * tombstone it already holds.
 */
export function adoptPendingTombstones(list: Tombstone[] | undefined): void {
  if (!list || list.length === 0) return;
  const known = new Set(_pendingTombstones.map((t) => t.id));
  let added = 0;
  for (const t of list) {
    if (known.has(t.id)) continue;
    _pendingTombstones.push(t);
    added++;
  }
  if (added > 0) {
    trace(`  ${added} deletion(s) still to send, remembered from before`);
    markSomethingToSend();
  }
}

/**
 * Record a tombstone for an explicit user deletion.
 * Only records if the entity has a server ID (i.e. it was synced to cloud).
 * Called from frame/version delete handlers in actions.ts and overview.ts.
 */
export function recordTombstone(entityType: 'frame' | 'version', serverEntityId: string | undefined): void {
  if (!serverEntityId) return; // Never synced — no tombstone needed
  _pendingTombstones.push({
    id: crypto.randomUUID(),
    entity_type: entityType,
    entity_id: serverEntityId,
    deleted_at: Date.now(),
    device_id: getDeviceId(),
  });
  // Say out loud that there is something to send (#317). Without this the
  // tombstone sat in memory waiting for some unrelated change to carry it, and
  // a deletion made offline never travelled at all.
  markSomethingToSend();
}


function startPullOnFocus(): void {
  if (pullOnFocusActive) return;
  pullOnFocusActive = true;

  // Start the heartbeat sender
  startHeartbeatSender();
  watchTheConnection();          // and the one check when the wifi returns (#298)

  const safePull = async () => {
    // CRITICAL: cancel any pending push and block new pushes FIRST.
    // Without this, a stale debounce timer could push old local data to the
    // server, overwriting newer changes from another device.
    cancelPendingPush();
    setPullInFlight(true);

    // Check heartbeat — if another device is active, show overlay & wait.
    // Start pull in parallel so data is ready the instant the lock clears.
    const pullP = tryPullFromCloud().catch(() => {});
    await Promise.all([waitForDeviceLock(), pullP]);
    // One final pull after lock clears to catch last-second pushes
    if (!isDeviceLocked()) {
      try { await tryPullFromCloud(); } catch {}
    }

    setPullInFlight(false);
  };

  // visibilitychange fires on tab switches; focus fires on app switches.
  // Both also flush-push when LEAVING (hidden/blur) to get data to server ASAP.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void safePull();
    } else if (document.visibilityState === 'hidden') {
      // Redundant with currentProject.ts listener, but ensures coverage
      // when switching apps (not just tabs).
      void flushSyncNow();
    }
  });
  window.addEventListener('focus', () => void safePull());
  window.addEventListener('blur', () => void flushSyncNow());

  // No periodic poll — pull-on-focus + wake-from-idle cover all cases.
  // This keeps server requests to a minimum.

  // Wake-from-idle: if idle 10+ seconds and user interacts (mouse, scroll,
  // keyboard), treat it like a focus event — cancel pushes, check heartbeat,
  // pull from server.  This covers the case where the Desktop browser window
  // stayed visible & focused the whole time (no blur/focus events fire) but
  // the user was working on iPad.  safePull() handles everything:
  //   cancel pending push → block new pushes → heartbeat check → pull → unblock.
  let _lastInteraction = Date.now();
  let _idleWakeCooldown = false;   // prevent rapid-fire safePull calls
  function onWakeFromIdle(): void {
    const now = Date.now();
    if ((now - _lastInteraction) > HEARTBEAT_STALE_MS && !_idleWakeCooldown) {
      _idleWakeCooldown = true;
      // Debounce: only one safePull per wake-up, cool down for 5 seconds
      setTimeout(() => { _idleWakeCooldown = false; }, 5_000);
      console.log('[sync] wake-from-idle detected, pulling from server');
      void safePull();
    }
    _lastInteraction = now;
  }
  document.addEventListener('mousedown', onWakeFromIdle, true);                       // Desktop
  document.addEventListener('touchstart', onWakeFromIdle, { passive: true, capture: true }); // iPad/iPhone
  document.addEventListener('mousemove', onWakeFromIdle, true);                        // Desktop
  document.addEventListener('scroll', onWakeFromIdle, { passive: true, capture: true });     // all
  document.addEventListener('wheel', onWakeFromIdle, { passive: true, capture: true });      // Desktop
  document.addEventListener('keydown', onWakeFromIdle, true);                          // Desktop (+ iPad ext keyboard)
}

/**
 * Compare a local frame + its versions to a cloud frame + its versions.
 * Returns true if they're effectively the same content (no merge needed).
 */
function framesMatch(
  localFrame: Frame,
  localVersions: Version[],
  cloudFrame: Frame,
  cloudVersions: Version[],
): boolean {
  // Compare basic frame properties
  if (localFrame.label !== cloudFrame.label) return false;
  if (localFrame.textContent !== cloudFrame.textContent) return false;
  if (JSON.stringify(localFrame.tableData) !== JSON.stringify(cloudFrame.tableData)) return false;
  if (JSON.stringify(localFrame.strokes) !== JSON.stringify(cloudFrame.strokes)) return false;
  if (JSON.stringify(localFrame.scribbles || []) !== JSON.stringify(cloudFrame.scribbles || [])) return false;
  // Compare version count
  if (localVersions.length !== cloudVersions.length) return false;
  // Compare each version
  for (let i = 0; i < localVersions.length; i++) {
    const lv = localVersions[i], cv = cloudVersions[i];
    if (lv.type !== cv.type) return false;
    if (lv.label !== cv.label) return false;
    if (JSON.stringify(lv.strokes) !== JSON.stringify(cv.strokes)) return false;
    // Images: both might be data URLs or both empty — if either has content and the other doesn't, they differ
    if (!!lv.bgImage !== !!cv.bgImage) return false;
  }
  return true;
}

/**
 * Merge cloud and local frames. Cloud frames form the base.
 * Local frames that differ from their cloud counterpart (by position)
 * are inserted as duplicates right after the cloud frame, with "?" appended.
 * Extra local frames (beyond cloud count) are appended at the end.
 */
function mergeFrames(
  cloudFrames: Frame[],
  cloudVersions: Record<number, Version[]>,
  localFrames: Frame[],
  localVersions: Record<number, Version[]>,
): { frames: Frame[]; versions: Record<number, Version[]> } {
  const merged: Frame[] = [];
  const mergedVersions: Record<number, Version[]> = {};
  let nextId = Math.max(
    ...cloudFrames.map((f) => f.id),
    ...localFrames.map((f) => f.id),
    0,
  ) + 1;

  const maxLen = Math.max(cloudFrames.length, localFrames.length);

  for (let i = 0; i < maxLen; i++) {
    const cf = cloudFrames[i];
    const lf = localFrames[i];

    if (cf && !lf) {
      // Only in cloud — keep as is
      merged.push(cf);
      mergedVersions[cf.id] = cloudVersions[cf.id] || [];
    } else if (!cf && lf) {
      // Only in local (extra frames) — add with "?" marker
      const dupId = nextId++;
      merged.push({ ...lf, id: dupId, label: (lf.label || String(i + 1)) + '?' });
      mergedVersions[dupId] = (localVersions[lf.id] || []).map((v, vi) => ({ ...v, id: vi + 1 }));
    } else if (cf && lf) {
      // Both exist at this position — always keep cloud frame
      merged.push(cf);
      mergedVersions[cf.id] = cloudVersions[cf.id] || [];

      // If local differs, insert duplicate right after
      const cv = cloudVersions[cf.id] || [];
      const lv = localVersions[lf.id] || [];
      if (!framesMatch(lf, lv, cf, cv)) {
        const dupId = nextId++;
        merged.push({ ...lf, id: dupId, label: (lf.label || String(i + 1)) + '?' });
        mergedVersions[dupId] = lv.map((v, vi) => ({ ...v, id: vi + 1 }));
      }
    }
  }

  return { frames: merged, versions: mergedVersions };
}

let _lastHeldBackTrace = 0;

async function tryPullFromCloud(force = false): Promise<void> {
  // Did the rebuild actually begin? A pull that dies on the way to the server
  // has touched nothing, and must not be tidied up as though it had (#325).
  let storeWasRebuilt = false;
  // `force` is for taking the result of a decided conflict. That call happens
  // at the TAIL of a push, so the ordinary "never pull during a push" guard
  // turned it into a silent no-op — the device asked the question, heard the
  // answer, and then skipped the one pull that would have applied it. Every
  // early exit is traced here, so a pull can never again vanish unseen.
  if (pullInFlight) { if (force) trace('  pull skipped: another pull is running'); return; }
  if (!force && isPushInFlight()) return;
  if (!force && Date.now() - lastPullAt < PULL_COOLDOWN_MS) return;
  if (!isLoggedIn()) { if (force) trace('  pull skipped: not signed in'); return; }
  const cp = getCurrentProject();
  if (!cp.projectId) { if (force) trace('  pull skipped: no project open'); return; }

  // Never pull on top of work the server has not taken yet. Try to send it
  // first; if that cannot get through, skip the pull entirely rather than
  // letting the older cloud copy replace it.
  // Not on the forced path: the push just ran, and the frame being decided is
  // exactly the one the server refused — waiting for it to send is a deadlock.
  //
  // This used to ask about FRAMES only. A change to the project's settings —
  // a group, a sort order, a needs category, the setup palette — touches no
  // frame, so the answer was "nothing pending" and the pull went ahead and
  // replaced those settings with the server's. Unsent work, wiped without a
  // word. Settings now count as pending work too.
  // Unsent FRAMES hold a pull back. Unsent settings do not (#305) — see
  // pullIsHeldBack in sessionRules for why holding them back protected nothing
  // and deadlocked a reloaded device.
  if (!force && getDirtyFrameIds().size > 0) {
    await flushSyncNow();
    if (getDirtyFrameIds().size > 0) {
      // Say it once, not once per attempt. A stuck push retries hard enough to
      // write this line hundreds of times a second and bury everything else.
      if (Date.now() - _lastHeldBackTrace > 5000) {
        _lastHeldBackTrace = Date.now();
        trace('  pull held back: local work is not on the server yet');
      }
      return;
    }
  }

  pullInFlight = true;
  setPullInFlight(true);
  lastPullAt = Date.now();
  try {
    // Ask for everything, or only for what has changed since we last heard —
    // and fold the answer into what we already hold, so the rest of this
    // function always works on a whole project (#280).
    const asDelta = deltaIsSafe(cp.projectId);
    const raw = await api.get<CloudProjectTree>(
      `/projects/${encodeURIComponent(cp.projectId)}/sync${asDelta ? `?since=${_heardAt}` : ''}`,
      getToken(),
    );
    let tree = raw;
    // Frames the answer did not mention. Their copy on this device is kept
    // exactly as it is — nothing about them is re-read or re-mapped (#285).
    let untouched: ReadonlySet<string> | undefined;
    if (asDelta && raw.full === false) {
      // deltaIsSafe guarantees the held copy is here; a delta is never asked for
      // without it (#306).
      const held = _heldTree as unknown as MergeableTree;
      const folded = mergeDelta(held, raw as unknown as MergeableTree);
      const refusal = lastMergeRefusal();
      if (refusal) {
        // The fold would have lost something. Do not show it; ask for the whole
        // project next time instead of folding onto ground we do not trust.
        trace(`  REFUSED a delta: ${refusal}`);
        forgetHeldTree();
        return;
      }
      untouched = untouchedByDelta(folded, raw as unknown as MergeableTree);
      tree = folded as unknown as CloudProjectTree;
    }
    if (asDelta && raw.full === false) {
      const changed = raw.frames.length + raw.versions.length + (raw.settings?.length ?? 0) + (raw.deletions?.length ?? 0);
      if (changed > 0) trace(`  asked for changes only: ${changed} row(s) instead of the whole project`);
    }
    holdTree(cp.projectId, tree, true);      // a real pull — the mark may move
    const remoteUpdatedAt = tree.project.updated_at;
    // What I last TOOK, not what I last said (#299).
    const localUpdatedAt = takenFromServerAt ?? 0;

    if (force && remoteUpdatedAt <= localUpdatedAt) {
      trace(`  pull found nothing newer (remote ${remoteUpdatedAt} vs local ${localUpdatedAt})`);
    }
    if (remoteUpdatedAt > localUpdatedAt) {
      const remoteDeviceId = tree.project.last_device_id;
      const remoteDeviceName = tree.project.last_device_name || 'another device';
      const localDeviceId = getDeviceId();

      // The "it was my own push, nothing to fetch" shortcut used to live here
      // and is gone (#299). Being the last device to write says nothing about
      // what the server was holding BEFORE that write — which is precisely the
      // work this device had not taken yet.
      void remoteDeviceId; void localDeviceId;

      trace(`pull: remote is newer (${remoteDeviceName})`);
      // Different device has newer data — smart per-frame merge:
      //  - Frames only edited locally → keep local
      //  - Frames only edited on cloud → take cloud
      //  - Same frame edited on BOTH → show side-by-side picker
      // Ask the fingerprints, not the reference tracker — see framesNeedingPush.
      const dirtyIds: ReadonlySet<string> = framesNeedingPush();
      const hasDirtyFrames = dirtyIds.size > 0;
      trace(`  local frames not yet on the server: ${dirtyIds.size}`);

      // THE BAR ONLY WHEN THERE IS SOMETHING TO WAIT FOR (#290).
      //
      // It used to appear the moment a pull began — before anything was known
      // about how much work it was. Since a pull now brings a handful of rows
      // and finishes instantly, and a device pulls its own change back after
      // every photo, that was a white panel flashing over the work all day.
      //
      // So: nothing is shown until something actually takes time — pictures to
      // fetch, or a question to ask. `showBar` is called at those points; a pull
      // that has neither passes silently.
      const progressEl = document.getElementById('progressOverlay');
      const progressBar = document.getElementById('progressBar') as HTMLElement | null;
      const progressLabel = document.getElementById('progressLabel') as HTMLElement | null;
      let barShown = false;
      const showBar = (label: string) => {
        if (!barShown) {
          barShown = true;
          if (progressEl) progressEl.classList.remove('hidden');
        }
        if (progressLabel) progressLabel.textContent = label;
      };
      const syncingLabel = hasDirtyFrames
        ? `Merging changes from ${remoteDeviceName}…`
        : `Syncing from ${remoteDeviceName}…`;
      if (progressBar) progressBar.style.width = '10%';

      // ---------------------------------------------------------------
      // Which unsent frames are protected from this pull, and which are out
      // of date and should take the server's copy (#307)
      // ---------------------------------------------------------------
      let keepLocalIds: ReadonlySet<string> | undefined;
      /** Frames this device has decided to take from the other side. Nothing
       *  further down may protect them again (#310). */
      const givenUp = new Set<string>();
      // Frames the answer left out are kept exactly as they are here (#283).

      if (hasDirtyFrames) {
        if (progressBar) progressBar.style.width = '20%';

        // WHICH OF MY UNSENT FRAMES DO I KEEP? (#307)
        //
        // A pull rebuilds the storyboard from the answer, so a frame with unsent
        // work here has to be protected from being overwritten — unless the
        // other device changed it LATER, in which case ours is simply out of
        // date and theirs is the one to show.
        //
        // This used to ask the user: any dirty frame whose cloud picture
        // differed put up a picker with two thumbnails. That was a second picker
        // living in the app, on top of the one the server used to raise, and it
        // outlived it — the server stopped asking in #303 and this one carried
        // on. A main frame settles by TIME now, and this is the same rule
        // applied here: compare when each side was changed and take the later.
        //
        // No modal, no choosing in the dark, and the two devices end up showing
        // the same thing — which is the whole point.
        // WHEN THEY CHANGED IT — never when it ARRIVED (#310).
        //
        // `updated_at` is the moment the server wrote the row, which is the time
        // of the CONNECTION, not of the edit. Comparing my edit time against
        // their arrival time makes every frame on the server look freshly
        // changed, so a device coming back from offline gives up work on frames
        // nobody else ever touched. A note made on a plane, discarded by a
        // desktop that had merely pushed something else.
        //
        // No content time means we do not know when they changed it — and a copy
        // that knows beats one that does not, exactly as the server decides it.
        const cloudChangedAt = new Map<string, number>();
        for (const cf of tree.frames) {
          if (cf.content_changed_at != null) cloudChangedAt.set(cf.id, cf.content_changed_at);
        }

        const keepMine = new Set<string>();
        const takeTheirs: string[] = [];
        for (const sfId of dirtyIds) {
          const mine = myWorkChangedAt(sfId);           // undefined = age unknown
          const theirs = cloudChangedAt.get(sfId);
          // Nothing on the server for it, or we cannot tell when theirs changed:
          // keep ours. Unsent work is never dropped on a guess.
          if (whoseFrameWins(mine, theirs) === 'mine') keepMine.add(sfId);
          else takeTheirs.push(sfId);
        }
        if (takeTheirs.length > 0) {
          trace(`  ${takeTheirs.length} frame(s) changed later elsewhere — taking theirs`);
          for (const id of takeTheirs) { dropDirtyFrame(id); givenUp.add(id); }
        }
        keepLocalIds = keepMine;
      }

      // ---------------------------------------------------------------
      // NOTHING VANISHES (#283)
      //
      // The rebuild below takes this answer as the truth, so a frame missing
      // from it comes off the screen — and off the device at the next save.
      //
      // A frame may only disappear because something deleted it and SAID SO.
      // If the answer is missing a frame nothing deleted, that frame is put
      // back into the answer and marked keep-local, so this device's copy of it
      // survives untouched. Everything else in the answer still applies: new
      // frames from the other device still arrive, changes still land. Refusing
      // the whole answer would have thrown away good work to protect the rest.
      //
      // This is checked on EVERY pull, whole or delta. The wipes that cost days
      // came through whole pulls.
      // ---------------------------------------------------------------
      let rescued = new Set<string>();
      {
        const here = state().frames;
        const onScreen = here.map((f) => f.serverFrameId).filter(Boolean) as string[];
        const verdict = answerIsSafeToApply(
          onScreen,
          tree.frames.map((f) => f.id),
          (tree.deletions ?? []).filter((d) => d.entity_type === 'frame').map((d) => d.entity_id),
        );
        if (!verdict.safe) {
          trace(`  KEEPING ${verdict.missing.length} frame(s) the answer left out and nothing deleted`);
          trace(`  kept: ${verdict.missing.slice(0, 6).join(', ')}`);
          console.warn('[sync] answer was missing frames nothing deleted — keeping them', verdict.missing);
          rescued = new Set(verdict.missing);
          const stripId = tree.strips[0]?.id ?? '';
          for (const id of verdict.missing) {
            const local = here.find((f) => f.serverFrameId === id);
            if (!local) continue;
            // A place-holder row, just enough for the rebuild to walk past it.
            // Its content is never read: keep-local means this device's own copy
            // of the frame is the one that is kept.
            tree.frames.push({
              id, strip_id: stripId, label: local.label ?? '', sort_order: here.indexOf(local),
              crop_w: local.cropW ?? null, crop_h: local.cropH ?? null,
              text_content: null, table_data: null, version_label: null, strip_labels: null,
              hidden: 0, note: null, scribbles: null, updated_at: 0, content_changed_at: null,
            } as unknown as CloudProjectTree['frames'][number]);
          }
          // Whatever we were standing on was wrong. Ask for the whole project
          // next time rather than folding onto bad ground.
          forgetHeldTree();
        }
      }

      // Frames to keep exactly as this device has them:
      //   - rescued: the answer left them out and nothing deleted them (#283).
      //     They are not on the server, so they still need sending.
      //   - untouched: the delta simply did not mention them (#285). They match
      //     the server already — sending them again would undo the whole point.
      // ...EXCEPT ANYTHING ALREADY GIVEN UP (#310).
      //
      // A frame this device decided to take from the other side must not be put
      // back into the protected set two lines later. "The answer did not mention
      // it" means "it matches the server" — which is exactly what is NOT true of
      // a frame we have just lost, and the reason the two devices could sit
      // there for ever showing different storyboards, both convinced they were
      // finished. The decision made above is final; nothing below may quietly
      // reverse it.
      const keepAsIs = new Set(
        [...(untouched ?? []), ...rescued].filter((id) => !givenUp.has(id)));
      if (keepAsIs.size > 0) {
        keepLocalIds = new Set([...(keepLocalIds ?? []), ...keepAsIs]);
      }
      // WHY EACH FRAME IS BEING KEPT (#310).
      //
      // Three different pieces of code add to this set, and the last one wins by
      // accident rather than by decision. That is how a device can say "taking
      // theirs" and then protect its own copy in the next breath — and the two
      // devices end up showing different storyboards, both convinced they are
      // finished. Say which set each frame came from, or this is unarguable.
      if ((keepLocalIds?.size ?? 0) > 0) {
        trace(`  keeping ${keepLocalIds!.size} frame(s) local — `
          + `mine(newer): ${[...(keepLocalIds ?? [])].filter((id) => !keepAsIs.has(id)).length}, `
          + `untouched by the answer: ${untouched?.size ?? 0}, `
          + `rescued (answer left them out): ${rescued.size}`);
      }

      // WHERE THE USER IS STANDING (#288).
      //
      // Applying a project rebuilds the screen and drops the view back to the
      // default. That is right when a project is opened and wrong every other
      // time: take a photo in a strip, the device pushes, pulls its own change
      // back a second later, and throws you into 3x2. The restore path has
      // remembered this for a while; the pull never did.
      const viewBefore = {
        currentViewMode: state().currentViewMode,
        activeStrips: [...state().activeStrips],
        notesStripVisible: state().notesStripVisible,
        needsStripVisible: state().needsStripVisible,
        activeGroupId: state().activeGroupId,
        centerFid: state().centerFid,
      };

      // Close sort-edit view before applying cloud tree
      if (state().sortEditingId) closeSortMode();
      // System action: all setState calls inside are NOT user changes
      beginSystemAction();
      try {
        // The first picture that needs fetching is what makes a pull worth
        // showing a bar for (#290).
        const syncImageProgress = (loaded: number, total: number) => {
          if (total === 0) return;
          showBar(`Loading image ${loaded} of ${total}…`);
        };
        if (keepLocalIds && keepLocalIds.size > 0) {
          // Per-frame merge: keep selected local frames, take cloud for the rest
          if (progressBar) progressBar.style.width = '70%';
          storeWasRebuilt = true;
          await applyCloudTreeToStore(tree, keepLocalIds, (loaded, total) => {
            syncImageProgress(loaded, total);
            if (total === 0) return;
            const pct = 70 + Math.round((loaded / total) * 20);
            if (progressBar) progressBar.style.width = pct + '%';
          });
          if (progressBar) progressBar.style.width = '90%';
          // Only worth telling the user about frames kept because they had work
          // of their own. Frames kept merely because the answer did not mention
          // them are the normal case now — saying "kept 44 local frames" after
          // every pull would be noise, and untrue in spirit (#290).
          const keptWithWork = [...keepLocalIds].filter((id) => !untouched?.has(id)).length;
          if (keptWithWork > 0) {
            showToast(`Synced — kept ${keptWithWork} local frame${keptWithWork > 1 ? 's' : ''}`);
          }
        } else {
          // No local changes (or user chose cloud for everything) — take cloud fully
          if (progressBar) progressBar.style.width = '40%';
          storeWasRebuilt = true;
          await applyCloudTreeToStore(tree, undefined, (loaded, total) => {
            syncImageProgress(loaded, total);
            if (total === 0) return;
            const pct = 40 + Math.round((loaded / total) * 50);
            if (progressBar) progressBar.style.width = pct + '%';
          });
          if (progressBar) progressBar.style.width = '90%';
        }
        // renderAll calls setState — keep it inside the system action so it
        // does not mark dirty and trigger a push of stale data.
        //
        // A SYNC DOES NOT CHOOSE YOUR VIEW (#342).
        //
        // autoPhoneMainView used to run here too. It is the "what should this
        // project open in" rule — iPhone portrait goes to MAIN, a fitting goes
        // to LOOKS, and a landscape project goes to 3x2 — and it is right when
        // you OPEN a project. Running it on every pull meant a sync marched you
        // back to 3x2 no matter where you were or what you had open.
        //
        // It was always wrong; it was merely rare, because a pull used to
        // happen seldom. #320 made a pull follow every push, and then it was
        // constant. Opening a project still sets the view — that call is
        // elsewhere and stays.
        (window as any).__fh_renderAll?.();
      } finally {
        endSystemAction();
      }

      // Put the user back where they were (#288). A group or frame the answer
      // no longer contains is simply skipped.
      //
      // Wrapped, because this is decoration and what follows is not: marking
      // frames as synced, recording what the server holds, sending what is
      // still outstanding. If restoring a view ever threw, all of that would be
      // skipped and the device would go quiet — the worst possible trade for a
      // cosmetic feature.
      try {
        const after = state();
        const groupStillThere = viewBefore.activeGroupId !== null
          && after.groups.some((g) => g.id === viewBefore.activeGroupId);
        useStore.setState({
          currentViewMode: viewBefore.currentViewMode,
          activeStrips: viewBefore.activeStrips,
          notesStripVisible: viewBefore.notesStripVisible,
          needsStripVisible: viewBefore.needsStripVisible,
          activeGroupId: groupStillThere ? viewBefore.activeGroupId : null,
        } as never);
        (window as any).__fh_renderAll?.();
        // After the rebuild, not before — otherwise the render has the last
        // word and drops the user into the default view anyway.
        //
        // ONLY IF IT ACTUALLY MOVED (#347). setViewMode does more than set a
        // mode: it collapses an expanded card and tears down the scribble
        // layer, because those belong to the view being left. Calling it on
        // every pull with the SAME mode therefore closed whatever the user had
        // open — expand a card in 3x2, wait for a sync, and you were back at
        // the plain grid. Which is exactly what Roman kept describing.
        if (state().currentViewMode !== viewBefore.currentViewMode) {
          setViewMode(viewBefore.currentViewMode);
        }
        const frameStillThere = viewBefore.centerFid != null
          && state().frames.some((f) => String(f.id) === String(viewBefore.centerFid));
        if (frameStillThere) requestAnimationFrame(() => scrollAnchorTo(viewBefore.centerFid));
      } catch (e) {
        console.warn('[sync] could not restore the view after a pull', e);
        trace('  could not put the view back — carrying on');
      }

      lastKnownUpdatedAt = remoteUpdatedAt;
      takenFromServerAt = remoteUpdatedAt;      // TAKEN — the only thing that counts (#299)
      markSaved(cp.projectId!);

      // The store now matches the server for every frame EXCEPT the ones the
      // merge deliberately kept local — those are still unsent. Recording them
      // as matching told the app its own work was already in the cloud, so it
      // never pushed them: no conflict, no picker, and the two devices quietly
      // diverged. Keep them marked as outstanding.
      adoptFingerprintsFromStore();
      // Only the frames that really are unsent get marked as outstanding. A
      // frame kept because the delta did not mention it MATCHES the server —
      // marking it would push the whole project back up on every pull and undo
      // the saving entirely (#285).
      const stillToSend = [...(keepLocalIds ?? [])].filter((id) => !untouched?.has(id));
      if (stillToSend.length > 0) {
        for (const id of stillToSend) forgetPushedFingerprint(id);
        trace(`  ${stillToSend.length} kept-local frame(s) still to send`);
        setTimeout(() => void flushSyncNow(), 400);
      }

      clearDirtyState(); // Pull is not a user change — prevent stale push
      // ...but a SETTINGS change this device is still holding is a user change,
      // and clearing the flag above was leaving it with nothing to carry it
      // (#324). A frame keeps its own record of being unsent; a shooting order,
      // a group, a renamed category has none — so the break rescued a moment
      // ago by #323 survived the pull and then sat on screen for ever, on this
      // device only, waiting for some unrelated edit to take it along.
      if (settingsNeedPush()) {
        trace('  settings still unsent — will send them');
        markSomethingToSend();
      }
      if (progressBar) progressBar.style.width = '100%';
      setTimeout(() => {
        if (progressEl) progressEl.classList.add('hidden');
        // Show incomplete overlay AFTER progress bar is gone
        if (isPullIncomplete()) showIncompleteLoadOverlay();
        else hideIncompleteLoadOverlay();
      }, 300);
    }
  } catch (e) {
    // NEVER SILENT AGAIN (#306).
    //
    // This used to swallow everything. A pull that threw half way through left
    // the device having cleared what it knew about the server and never
    // recorded it again — so its next push sent every frame with no change
    // times, and the server refused most of them. From the outside it looked
    // like a rule misbehaving. From in here it was invisible.
    // WHAT KIND OF FAILURE, IN WORDS (#308).
    //
    // The first version of this only knew how to describe a real Error, so
    // everything the api throws — a plain object with a status and a code —
    // printed as "[object Object]". Two of those in a log, and we are back to
    // guessing.
    //
    // And most of them are not failures at all: a pull that runs as the wifi
    // drops has nothing wrong with it. Say so quietly, and keep FAILED for
    // things that deserve the word.
    const api_err = e as { status?: number; code?: string; message?: string };
    const offline = api_err?.status === 0 || api_err?.code === 'network' || !navigator.onLine;
    const msg = e instanceof Error
      ? `${e.name}: ${e.message}`
      : api_err?.code || api_err?.message
        ? `${api_err.code ?? 'error'} ${api_err.status ?? ''} — ${api_err.message ?? ''}`.trim()
        : JSON.stringify(e)?.slice(0, 200) ?? String(e);
    if (offline) {
      trace('  pull stopped — no connection. Nothing lost, it will ask again.');
    } else {
      console.error('[sync] pull failed', e);
      trace(`  PULL FAILED — ${msg}`);
    }
    // What the device knows about the server was cleared on the way in. Put it
    // back from what is on screen, or the next push resends the whole project.
    //
    // ONLY IF THE STORE WAS ACTUALLY REBUILT (#325). This ran for ANY failure,
    // including one that happened before the store was touched at all — a
    // timeout, a dropped connection. It then recorded every frame on screen as
    // already matching the server, INCLUDING ones holding work that had never
    // been sent. The next push found nothing to do and called itself a success,
    // the unsent list was cleared, and a drawing made just before the signal
    // went was never uploaded — and was written over by the next pull.
    //
    // Nothing was cleared on the way in unless the rebuild began, so there is
    // nothing to put back unless it did.
    if (storeWasRebuilt) {
      try { adoptFingerprintsFromStore(); } catch { /* nothing more to be done */ }
    }
    const pEl = document.getElementById('progressOverlay');
    if (pEl) pEl.classList.add('hidden');
  } finally {
    pullInFlight = false;
    setPullInFlight(false);
  }
}

/**
 * WHEN DID MY WORK ON THIS FRAME CHANGE — the frame AND its versions (#326).
 *
 * The app has two ideas of "this frame changed", and they are both right for
 * their own job. The unsent list counts a frame as changed if any of its
 * versions changed — a new LOOK, a drawing, a note on a version. The change
 * stamp deliberately does not: it is the frame's OWN content, because versions
 * carry stamps of their own.
 *
 * The pull was using the first to decide WHICH frames to judge and the second to
 * judge them. A frame dirty only because of a new version therefore had no time
 * at all, lost to anything the server could put a time on, and was handed over —
 * and the rebuild then made its versions afresh from the cloud, where the unsent
 * one by definition was not. The drawing went, silently.
 *
 * The answer is not to keep every frame whose age is unknown: an unstamped frame
 * kept here is pushed and, being unstamped on both sides, WINS — which quietly
 * overwrote the other device's writing. That was the first attempt and the suite
 * caught it.
 *
 * The answer is to ask the right question. My work on this frame is as new as
 * the newest thing I have done to it, whether that is the frame or one of its
 * looks.
 */
function myWorkChangedAt(serverFrameId: string): number | undefined {
  let latest = frameChangedAt(serverFrameId);
  const s = state();
  const frame = s.frames.find((f) => f.serverFrameId === serverFrameId);
  if (!frame) return latest;
  for (const stripId of Object.keys(s.stripVersions)) {
    for (const v of s.stripVersions[stripId]?.[frame.id] ?? []) {
      const at = versionChangedAt(v.serverVersionId);
      if (at !== undefined && (latest === undefined || at > latest)) latest = at;
    }
  }
  return latest;
}

/** Called after a successful save/load so we know what "current" means. */
function updateLastKnownTimestamp(ts: number): void {
  lastKnownUpdatedAt = ts;
}

// ---------------------------------------------------------------------------
// Bootstrap: load token, restore IDB, handle ?reset=token URL
// ---------------------------------------------------------------------------

export async function bootstrapAccountSystem(): Promise<void> {
  // 0. Register cloud sync and pull-on-focus.
  registerCloudSync(syncCurrentToServer);
  registerFingerprintBridge(exportPushedFingerprints, importPushedFingerprints);
  registerTombstoneBridge(exportPendingTombstones);   // deleting is final (#327)
  registerHeardAtBridge(getHeardAt);
  // Ask iOS not to clear our storage after a week of not opening the app —
  // that would take offline projects with it.
  void requestDurableStorage();
  // Make sure the PDF engine is on the device before it is ever needed — but
  // only once the app is up and the device is idle. Loading the module is
  // itself heavy, so the WAIT has to happen before the import, not inside it.
  const warmPdfWhenIdle = () => {
    if (!navigator.onLine) return;
    const go = () => { void import('./pdf').then((m) => m.warmPdfEngine()); };
    const ric = (window as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void })
      .requestIdleCallback;
    if (ric) ric(go, { timeout: 10_000 });
    else window.setTimeout(go, 5_000);
  };
  if (document.readyState === 'complete') warmPdfWhenIdle();
  else window.addEventListener('load', warmPdfWhenIdle, { once: true });
  window.addEventListener('online', warmPdfWhenIdle);
  // A project made offline has no cloud id, so it cannot be pushed — it has to
  // be created first. saveNow() does exactly that, then uploads.
  registerCreateAndSync(saveNow);
  registerPullFn(tryPullFromCloud);
  registerConnectionWatch(watchForTheConnectionComingBack);   // #298
  startPullOnFocus();

  // 1. Validate any saved session.
  await loadCurrentUser();

  // 2. Restore unsaved local project from IndexedDB if present.
  try {
    const snap = await loadSnapshot();
    if (snap && snap.frames.length > 0) {
      dismissNewProjectModal();
      beginSystemAction();
      try {
        adoptLocalProjectId(snap.localId);   // keep the same key across restarts
        adoptDirtyFrameIds(snap.dirtyFrameIds);  // protect them from the first pull
        adoptPushedFingerprints(snap.pushedFingerprints);  // no needless full push
        importSettingStamps(snap.settingStamps);   // remember when settings changed
        importChangeStamps(snap.contentStamps);    // ...and when frames/versions did
        adoptHeardAt(snap.heardAt);                // ...and when we last heard (#284)
        adoptPendingTombstones(snap.pendingTombstones);  // deleting is final (#327)
        applySnapshotToStore(snap);
        // An older snapshot has no settings stamps. Take the first look right
        // here (#264) rather than let the first save do it, or whatever the user
        // changes in the meantime is recorded as having always been that way and
        // can never travel.
        if (!snap.settingStamps || snap.settingStamps.length === 0) {
          seedSettings(snap.projectId ?? null, snap.lastModified);
          // Seeded fresh means the device has NO memory of when its settings
          // changed, so the first save stamps them all "now" and they fight the
          // other device for no reason. Say which of the two happened, or we
          // are reading tea leaves again.
          trace('  settings memory: SEEDED FRESH (the save carried none)');
        } else {
          trace(`  settings memory: restored, ${snap.settingStamps.length} item(s)`);
        }
        // ...and the same for the frames' own memory (#289). With stamps in the
        // snapshot there is nothing to seed — they say when each frame changed,
        // including changes made offline before the app was closed.
        if (!snap.contentStamps || Object.keys(snap.contentStamps).length === 0) {
          seedContentStamps(snap.projectId ?? null);
        }
        // MEMORY WRITTEN BY AN OLDER APP (#297). Anything this build knows about
        // that the saved memory has never heard of is written down as age
        // unknown — here, with the project in the store, and before the first
        // autosave can call it a change made just now.
        const unknownToMemory = reconcileRestoredSettings();
        if (unknownToMemory > 0) {
          trace(`  ${unknownToMemory} setting(s) unknown to the saved memory — recorded as age unknown, not as changed now`);
        }
        // renderAll + autoPhoneMainView call setState — keep them inside
        // the system action so their setState calls don't mark dirty.
        (window as any).__fh_renderAll?.();
        autoPhoneMainView();
      } finally {
        endSystemAction();
      }
      setCurrentProject({
        projectId: snap.projectId,
        name: snap.name,
        lastSavedAt: snap.projectId ? snap.lastModified : null,
      });
      // SAY WHICH PROJECT THIS IS (#291).
      //
      // Without a cloud id the app cannot push or pull anything — every attempt
      // skips silently, and the only visible sign is the "you'll need to save it
      // first" note, which reads like a nag rather than a diagnosis. Now it is
      // stated at every start, next to the frame count.
      trace(snap.projectId
        ? `project: ${snap.name ?? 'unnamed'} · cloud id ${snap.projectId.slice(0, 8)} · signed in: ${isLoggedIn() ? 'yes' : 'NO'}`
        : `project: ${snap.name ?? 'unnamed'} · NOT ON THE SERVER — nothing can sync until it is saved`);
      clearDirtyState(); // IDB restore is not a user change

      // Kick off a cloud pull now that projectId is set.
      // The focus/visibility events fired before bootstrap set the projectId,
      // so the initial pull attempt bailed. Delay slightly so the UI settles
      // before we start network requests + image loading.
      if (snap.projectId && isLoggedIn()) {
        setTimeout(() => void tryPullFromCloud(), 1_500);
      }
    }
  } catch (e) {
    console.warn('[accountFlow] IDB restore failed', e);
  }

  // 3. Handle ?reset=token URLs (from the password reset email).
  const url = new URL(window.location.href);
  const resetToken = url.searchParams.get('reset');
  if (resetToken) {
    url.searchParams.delete('reset');
    window.history.replaceState({}, '', url.toString());
    const ok = await openResetModal(resetToken);
    if (ok) showToast('Password updated. Please log in.');
  }

  // 4. If logged in and no current project, surface the project list.
  if (isLoggedIn() && state().frames.length === 0) {
    dismissNewProjectModal();
    // Hide startup loading line before opening the (potentially long-lived) modal
    document.getElementById('startupLoadingLine')?.classList.add('hidden');
    await openProjectList();
  }
}

// Keep a convenient reference to the snapshot helper for places that need it
// without pulling persistence directly.
export { snapshotFromStore };

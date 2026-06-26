// All UI flows for the account/sync system. Each "open*" function returns a
// Promise that resolves when the modal closes — same pattern as lib/modals.ts.
// Higher-level flows (saveNow, project list selection, etc.) compose these.
//
// Network calls go through ./api with the bearer token from ./session.

import { autoPhoneMainView } from './view';
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
  clearDirtyState,
  markSaved,
  isLoadInFlight,
  isPullIncomplete,
  isPushInFlight,
  setCloudSyncInFlight,
  registerCloudSync,
  registerPullFn,
  setCurrentProject,
  setProjectName,
  setPullInFlight,
  setPullIncomplete,
  setProjectSwitchInFlight,
  flushSyncNow,
  cancelPendingPush,
  beginSystemAction,
  endSystemAction,
} from './currentProject';
import { applySnapshotToStore, loadSnapshot, snapshotFromStore } from './persistence';
import { showConfirm, showToast, showFrameConflictPicker } from './modals';
import type { FrameConflict } from './modals';
import { saveOpenTextEdits, saveOpenTableEdits } from './helpers';
import { resetStoryboardState, state, useStore } from '../store/state';
import type { Frame, Stroke, Version } from '../store/state';
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
        renderProjectList(projects, editMode, onPick, onEdit, onDelete, onRecover);
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
      renderProjectList(projects, editMode, onPick, onEdit, onDelete, onRecover);
    };

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
      renderProjectList(projects, editMode, onPick, onEdit, onDelete, onRecover);
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
      renderProjectList(projects, editMode, onPick, onEdit, onDelete, onRecover);
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
      renderProjectList(projects, editMode, onPick, onEdit, onDelete, onRecover);
    }

    void (async () => {
      try {
        const res = await api.get<{ projects: CloudProject[] }>('/projects', getToken());
        projects = res.projects;
        renderProjectList(projects, editMode, onPick, onEdit, onDelete, onRecover);
      } catch (e) {
        content.textContent = asMessage(e, 'Could not load your projects.');
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
): void {
  const content = el('projectListContent');
  content.innerHTML = '';
  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'project-list-empty';
    empty.textContent = 'No saved projects yet. Click "New project" to start.';
    content.appendChild(empty);
    return;
  }
  for (const p of projects) {
    const isDeleted = p.deleted_at != null;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'project-list-row';
    if (isDeleted) row.style.opacity = '0.35';
    const name = document.createElement('span');
    name.className = 'project-list-name';
    name.textContent = p.name;
    row.appendChild(name);

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
      row.onclick = isDeleted ? null : () => onPick(p);
      if (isDeleted) row.style.cursor = 'default';
    }
    content.appendChild(row);
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
    // System action: prevent setState calls from being treated as user changes
    beginSystemAction();
    try {
      await applyCloudTreeToStore(tree);
    } finally {
      endSystemAction();
    }
    if (progressBar) progressBar.style.width = '85%';
    updateLastKnownTimestamp(tree.project.updated_at);
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
    const ok = await showConfirm('Start a new project? Your current unsaved work will be replaced.');
    if (!ok) return;
  }
  resetStoryboardState();
  useStore.setState({ portraitMode: false });
  clearCurrentProject();
  clearPushedFingerprints();
  // Clear stale timestamp from previous project so the first sync for the new
  // project doesn't carry an old base_updated_at that could trigger a 409.
  lastKnownUpdatedAt = null;
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
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: number; updated_at: number }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: number; starred: number; updated_at: number }>;
  images: Array<{ id: string; version_id: string; r2_key: string; width: number | null; height: number | null; size_bytes: number | null; content_type: string | null; updated_at: number }>;
  drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }>;
  deletions?: Array<{ id: string; entity_type: string; entity_id: string; deleted_at: number; device_id: string | null }>;
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
    return;
  }
  // Safety net: frame count should never decrease unless tombstones account for it.
  // Catches corrupt state, partial data, or races that would wipe frames on the server.
  const currentFrameCount = state().frames.length;
  const tombstonedFrameCount = _pendingTombstones.filter((t) => t.entity_type === 'frame').length;
  if (_lastKnownFrameCount > 0 && currentFrameCount < _lastKnownFrameCount - tombstonedFrameCount) {
    console.warn(`[sync] Aborted: ${currentFrameCount} frames locally but expected at least ${_lastKnownFrameCount - tombstonedFrameCount} (last known: ${_lastKnownFrameCount}, tombstones: ${tombstonedFrameCount})`);
    return;
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

  const isPartial = _lastPushedFingerprints.size > 0 && dirtyLocalIds.size < s.frames.length;
  const hasDirtyFrames = dirtyLocalIds.size > 0;

  // NOTE: we do NOT skip when hasDirtyFrames is false. Metadata changes
  // (groups, setups, strip renames) don't alter frame fingerprints, so we
  // must still push to update the project metadata on the server. A partial
  // push with 0 dirty frames is cheap — it just updates the project row.

  console.log(`[sync] Delta push: ${dirtyLocalIds.size}/${s.frames.length} frames dirty, partial=${isPartial}`);

  // One strip per project — all frames live here. Strip versions use type prefixes.
  const stripId = uuid();
  const strips = [{ id: stripId, label: 'Main', sort_order: 0, updated_at: now }];

  const frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: boolean; updated_at: number }> = [];
  const versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: boolean; starred: boolean; updated_at: number }> = [];
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
      updated_at: now,
    });

    // Frame-level strokes → "main" version
    const mainVersionId = f.serverMainVersionId || preAssignedMainVersionIds.get(f.id) || uuid();
    frameIdUpdates.push({ localId: f.id, serverFrameId: frameId, serverMainVersionId: mainVersionId });

    versions.push({ id: mainVersionId, frame_id: frameId, label: 'main', type: 'main', hidden: false, starred: false, updated_at: now });
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
          hidden: !!lv.hidden, starred: !!lv.starred, updated_at: now,
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

  const metadata = JSON.stringify({
    stripDefs: s.stripDefs,
    groups: metaGroups,
    nextGroupId: s.nextGroupId,
    portraitMode: s.portraitMode,
    pdfAdjustRects: Object.keys(pdfAdjustRects).length > 0 ? pdfAdjustRects : undefined,
    pdfAdjustLastFile: lastPdfName,
    setups: s.setups.length > 0 ? s.setups : undefined,
    nextSetupId: s.nextSetupId > 1 ? s.nextSetupId : undefined,
    frameSetups: Object.keys(frameSetups).length > 0 ? frameSetups : undefined,
    versionTags: Object.keys(versionTags).length > 0 ? versionTags : undefined,
    stripTagInfoDismissed: s.stripTagInfoDismissed || undefined,
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
  const res = await api.post<CloudProjectTree & { conflict?: boolean }>(
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
    },
    getToken(),
  );
  // Update lastKnownUpdatedAt so that the pull-on-focus mechanism doesn't
  // see our own push as a "newer remote version" and try to apply it.
  lastKnownUpdatedAt = now;
  // Record counts after a successful push so the next guard comparisons are accurate.
  _lastKnownImageCount = countCurrentImages();
  _lastKnownFrameCount = state().frames.length;
  // Clear pending tombstones after successful push
  _pendingTombstones = [];

  // Store fingerprints for all frames (including clean ones) so the next
  // push can detect what changed. We store ALL frames, not just dirty ones,
  // so that the full snapshot is available for comparison.
  _lastPushedFingerprints.clear();
  for (const [k, v] of currentFingerprints) {
    _lastPushedFingerprints.set(k, v);
  }

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
}

/**
 * Apply cloud project tree to the local store.
 * @param tree - The cloud project tree to apply.
 * @param keepLocalFrameIds - Optional set of server frame UUIDs to keep locally.
 *   When provided, frames whose server ID is in this set will preserve their
 *   local version (image, strokes, versions) instead of taking the cloud version.
 *   This enables per-frame merge: dirty frames stay local, clean frames take cloud.
 */
async function applyCloudTreeToStore(tree: CloudProjectTree, keepLocalFrameIds?: ReadonlySet<string>): Promise<void> {
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
          continue; // Skip cloud processing for this frame
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
      verActiveTab[localId] = 0;
      floorActiveTab[localId] = 0;
      refsActiveTab[localId] = 0;
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
  let isPortrait = newFrames.length > 0 && newFrames[0].cropH > newFrames[0].cropW;

  if (tree.project.metadata) {
    try {
      const meta = JSON.parse(tree.project.metadata);
      if (meta.stripDefs && Array.isArray(meta.stripDefs)) {
        restoredStripDefs = meta.stripDefs;
      }
      if (meta.portraitMode != null) {
        isPortrait = !!meta.portraitMode;
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

  // Apply structure immediately so the user sees the project right away.
  // Do a FULL reset of all per-frame maps to avoid stale data from the previous project.
  // IMPORTANT: Legacy aliases must reference the SAME objects as stripXxx maps.
  const verCC: Record<number, number> = {};
  const floorCC: Record<number, number> = {};
  const refsCC: Record<number, number> = {};
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
    drawColor: {},
    drawWidth: {},
    drawEraser: {},
    drawActive: {},
    showText: {},
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
    ovExpandedFid: null,
    drawingInProgress: false,
    drawSuppressClick: false,
    overviewAction: false,
    fsOverlayActive: null,
    currentViewMode: 'both',
    portraitMode: isPortrait,
    stripTagInfoDismissed: restoredStripTagInfoDismissed,
    renderTick: prev.renderTick + 1,
  }));
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
        })
        .catch((e) => {
          console.warn('[sync] failed to fetch main image after retries', task.r2Key, e);
          const frame = useStore.getState().frames.find((f) => f.id === task.localId);
          failedTasks.push(`Frame "${frame?.label || task.localId}" main image`);
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
        })
        .catch((e) => {
          console.warn('[sync] failed to fetch version image after retries', task.strip, task.r2Key, e);
          const frame = useStore.getState().frames.find((f) => f.id === task.localId);
          failedTasks.push(`Frame "${frame?.label || task.localId}" ${task.strip} v${task.versionIdx + 1}`);
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

export async function flowAccountOrSignIn(): Promise<void> {
  if (isLoggedIn()) await openAccountSettings();
  else await openAccountModal('login');
}

// ---------------------------------------------------------------------------
// Device heartbeat: server-side "I'm working" signal.
// All timestamps are SERVER-side — no client clock dependency.
// ---------------------------------------------------------------------------

const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_STALE_MS = 10_000; // heartbeat older than this = device stopped
let _lastUserActivity = 0;
let _deviceLockOverlay: HTMLElement | null = null;

/** Send a heartbeat to the server — "this device is actively working". */
async function sendHeartbeat(): Promise<void> {
  const cp = getCurrentProject();
  if (!cp.projectId || !isLoggedIn()) return;
  try {
    await api.post(
      `/projects/${encodeURIComponent(cp.projectId)}/heartbeat`,
      { device_id: getDeviceId(), device_name: getDeviceName() },
      getToken(),
    );
  } catch { /* silent */ }
}

/** Start sending heartbeats while the user is active. */
function startHeartbeatSender(): void {
  // Track user activity
  const onActivity = () => { _lastUserActivity = Date.now(); };
  document.addEventListener('mousedown', onActivity, true);
  document.addEventListener('touchstart', onActivity, true);
  document.addEventListener('keydown', onActivity, true);

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
let pullInFlight = false;
let lastPullAt = 0;
const PULL_COOLDOWN_MS = 3_000; // Don't check more often than every 3s

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

/** Clear fingerprints (on project switch, new pull, etc.). Next push sends all. */
export function clearPushedFingerprints(): void {
  _lastPushedFingerprints.clear();
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
function frameFingerprint(f: Frame, sortOrder: number, s: { stripVersions: Record<string, Record<number, Version[]>> }): string {
  const parts: string[] = [
    f.label,
    String(sortOrder),
    String(f.cropW),
    String(f.cropH),
    f.hidden ? '1' : '0',
    f.textContent || '',
    f.tableData ? JSON.stringify(f.tableData) : '',
    String(f.strokes?.length || 0),
    f.r2Key || (f.src ? f.src.substring(0, 40) : ''),
    f.setupId || '',
    f.stripLabels ? JSON.stringify(f.stripLabels) : '',
  ];
  // Include versions for each strip
  for (const stripType of ['ver', 'floor', 'refs']) {
    const vers = s.stripVersions[stripType]?.[f.id];
    if (vers) {
      for (const v of vers) {
        parts.push(
          `${stripType}:${v.label}|${v.type}|${v.hidden ? 1 : 0}|${v.starred ? 1 : 0}|${v.setupTagged || ''}|${v.r2Key || (v.bgImage ? v.bgImage.substring(0, 40) : '')}|${v.strokes?.length || 0}`,
        );
      }
    }
  }
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
}


function startPullOnFocus(): void {
  if (pullOnFocusActive) return;
  pullOnFocusActive = true;

  // Start the heartbeat sender
  startHeartbeatSender();

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

async function tryPullFromCloud(): Promise<void> {
  if (pullInFlight) return;
  if (isPushInFlight()) return;
  if (Date.now() - lastPullAt < PULL_COOLDOWN_MS) return;
  if (!isLoggedIn()) return;
  const cp = getCurrentProject();
  if (!cp.projectId) return;

  pullInFlight = true;
  setPullInFlight(true);
  lastPullAt = Date.now();
  try {
    const tree = await api.get<CloudProjectTree>(
      `/projects/${encodeURIComponent(cp.projectId)}/sync`,
      getToken(),
    );
    const remoteUpdatedAt = tree.project.updated_at;
    const localUpdatedAt = lastKnownUpdatedAt ?? cp.lastSavedAt ?? 0;

    if (remoteUpdatedAt > localUpdatedAt) {
      const remoteDeviceId = tree.project.last_device_id;
      const remoteDeviceName = tree.project.last_device_name || 'another device';
      const localDeviceId = getDeviceId();

      // Same device pushed — our own data reflecting back. Just update timestamp.
      if (remoteDeviceId === localDeviceId) {
        lastKnownUpdatedAt = remoteUpdatedAt;
        return;
      }

      // Different device has newer data — smart per-frame merge:
      //  - Frames only edited locally → keep local
      //  - Frames only edited on cloud → take cloud
      //  - Same frame edited on BOTH → show side-by-side picker
      const dirtyIds = getDirtyFrameIds();
      const hasDirtyFrames = isDirty() && dirtyIds.size > 0;

      // Show loading bar
      const progressEl = document.getElementById('progressOverlay');
      const progressBar = document.getElementById('progressBar') as HTMLElement | null;
      const progressLabel = document.getElementById('progressLabel') as HTMLElement | null;
      if (progressEl) progressEl.classList.remove('hidden');
      if (progressBar) progressBar.style.width = '10%';
      if (progressLabel) progressLabel.textContent = hasDirtyFrames
        ? `Merging changes from ${remoteDeviceName}…`
        : `Syncing from ${remoteDeviceName}…`;

      // ---------------------------------------------------------------
      // Detect same-frame conflicts: dirty locally AND changed in cloud
      // ---------------------------------------------------------------
      let keepLocalIds: ReadonlySet<string> | undefined;

      if (hasDirtyFrames) {
        if (progressBar) progressBar.style.width = '20%';

        // Build cloud r2Key map: serverFrameId → mainR2Key
        const cloudR2Keys = new Map<string, string | undefined>();
        const versionsByFrame = new Map<string, typeof tree.versions>();
        for (const v of tree.versions) {
          if (!versionsByFrame.has(v.frame_id)) versionsByFrame.set(v.frame_id, []);
          versionsByFrame.get(v.frame_id)!.push(v);
        }
        const imageByVersion = new Map<string, string>();
        for (const img of tree.images) imageByVersion.set(img.version_id, img.r2_key);

        for (const cf of tree.frames) {
          const mainV = (versionsByFrame.get(cf.id) ?? []).find((v) => v.type === 'main');
          cloudR2Keys.set(cf.id, mainV ? imageByVersion.get(mainV.id) : undefined);
        }

        // Build cloud label map for conflict picker
        const cloudLabelMap = new Map<string, string>();
        for (const cf of tree.frames) cloudLabelMap.set(cf.id, cf.label ?? '');

        // Separate dirty frames into conflicting vs. safe-local
        const prev = useStore.getState();
        const conflictingIds: string[] = [];
        const safeLocalIds = new Set<string>();

        for (const sfId of dirtyIds) {
          const cloudR2 = cloudR2Keys.get(sfId);
          const localFrame = prev.frames.find((f) => f.serverFrameId === sfId);
          const localR2 = localFrame?.r2Key;

          // Conflict: cloud has a DIFFERENT image than what we last synced
          if (cloudR2 && cloudR2 !== localR2) {
            conflictingIds.push(sfId);
          } else {
            // Only modified locally — safe to keep
            safeLocalIds.add(sfId);
          }
        }

        if (conflictingIds.length > 0) {
          // Fetch cloud thumbnails for the conflict picker
          if (progressBar) progressBar.style.width = '30%';
          if (progressLabel) progressLabel.textContent = 'Loading previews for conflict…';

          const token = getToken();
          const conflicts: FrameConflict[] = [];

          for (const sfId of conflictingIds) {
            const localFrame = prev.frames.find((f) => f.serverFrameId === sfId);
            const cloudR2 = cloudR2Keys.get(sfId);
            let cloudSrc = '';
            if (cloudR2 && token) {
              try { cloudSrc = await fetchImageFromR2(cloudR2, token); } catch { /* empty */ }
            }
            conflicts.push({
              serverFrameId: sfId,
              label: localFrame?.label || cloudLabelMap.get(sfId) || '?',
              localSrc: localFrame?.src || '',
              cloudSrc,
              localDeviceName: getDeviceName(),
              cloudDeviceName: remoteDeviceName,
            });
          }

          // Hide progress while picker is shown
          if (progressEl) progressEl.classList.add('hidden');

          // Show picker — user taps one thumbnail per conflict
          const choices = await showFrameConflictPicker(conflicts);

          // Re-show progress
          if (progressEl) progressEl.classList.remove('hidden');
          if (progressBar) progressBar.style.width = '50%';

          // Build final keep-local set: safe locals + user-chose-local conflicts
          const finalKeep = new Set(safeLocalIds);
          for (const [sfId, choice] of choices) {
            if (choice === 'local') finalKeep.add(sfId);
            // 'cloud' → not in keepLocal → applyCloudTreeToStore takes cloud version
          }
          keepLocalIds = finalKeep;
        } else {
          // All dirty frames are safe (no cloud changes to them)
          keepLocalIds = dirtyIds;
        }
      }

      // System action: all setState calls inside are NOT user changes
      beginSystemAction();
      try {
        if (keepLocalIds && keepLocalIds.size > 0) {
          // Per-frame merge: keep selected local frames, take cloud for the rest
          if (progressBar) progressBar.style.width = '70%';
          await applyCloudTreeToStore(tree, keepLocalIds);
          if (progressBar) progressBar.style.width = '90%';
          showToast(`Synced — kept ${keepLocalIds.size} local frame${keepLocalIds.size > 1 ? 's' : ''}`);
        } else {
          // No local changes (or user chose cloud for everything) — take cloud fully
          if (progressBar) progressBar.style.width = '40%';
          await applyCloudTreeToStore(tree);
          if (progressBar) progressBar.style.width = '90%';
        }
        // renderAll + autoPhoneMainView call setState — keep them inside
        // the system action so their setState calls don't mark dirty
        // and trigger a push of stale data.
        (window as any).__fh_renderAll?.();
        autoPhoneMainView();
      } finally {
        endSystemAction();
      }

      lastKnownUpdatedAt = remoteUpdatedAt;
      markSaved(cp.projectId!);
      clearDirtyState(); // Pull is not a user change — prevent stale push
      if (progressBar) progressBar.style.width = '100%';
      setTimeout(() => {
        if (progressEl) progressEl.classList.add('hidden');
        // Show incomplete overlay AFTER progress bar is gone
        if (isPullIncomplete()) showIncompleteLoadOverlay();
        else hideIncompleteLoadOverlay();
      }, 300);
    }
  } catch {
    const pEl = document.getElementById('progressOverlay');
    if (pEl) pEl.classList.add('hidden');
  } finally {
    pullInFlight = false;
    setPullInFlight(false);
  }
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
  registerPullFn(tryPullFromCloud);
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
        applySnapshotToStore(snap);
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

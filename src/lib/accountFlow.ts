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
  hasLocalChanges,
  markSaved,
  isPushInFlight,
  registerCloudSync,
  registerPullFn,
  setCurrentProject,
  setProjectName,
  setPullInFlight,
  setProjectSwitchInFlight,
  flushSyncNow,
  updateSyncHash,
} from './currentProject';
import { applySnapshotToStore, loadSnapshot, snapshotFromStore } from './persistence';
import { showConfirm, showConflictDialog, showToast } from './modals';
import type { ConflictChoice } from './modals';
import { saveOpenTextEdits, saveOpenTableEdits } from './helpers';
import { resetStoryboardState, state, useStore } from '../store/state';
import type { Frame, Stroke, Version } from '../store/state';

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
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/Android.*Mobile/i.test(ua)) return 'Android Phone';
  if (/Android/i.test(ua)) return 'Android Tablet';
  if (/Macintosh|Mac OS/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'Unknown Device';
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
  try {
    // 1. Flush-save current project before switching (blocking)
    await flushSyncNow();
    // 2. Pause auto-sync to prevent cross-contamination during load
    setProjectSwitchInFlight(true);
    // 3. Load new project from cloud
    const tree = await api.get<CloudProjectTree>(`/projects/${encodeURIComponent(p.id)}/sync`, getToken());
    await applyCloudTreeToStore(tree);
    updateLastKnownTimestamp(tree.project.updated_at);
    setCurrentProject({ projectId: p.id, name: p.name, lastSavedAt: tree.project.updated_at });
    fhTrack('project_opened', { name: p.name });
    (window as any).__fh_renderAll?.();
    autoPhoneMainView();
    // 4. Update sync hash BEFORE resuming — so sync sees the new project as baseline
    updateSyncHash();
    showToast('Project loaded');
  } catch (e) {
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

  // 4. Sync the current state to /sync.
  try {
    await syncCurrentToServer(projectId);
    markSaved(projectId);
    updateSyncHash();
    updateLastKnownTimestamp(Date.now());
    fhTrack('project_saved');
    showToast('Saved.');
  } catch (e) {
    showToast(asMessage(e, 'Could not save project.'));
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
}

function uuid(): string {
  return crypto.randomUUID();
}

async function syncCurrentToServer(projectId: string): Promise<void> {
  // Flush in-progress text/table edits from DOM to frame objects before snapshotting
  saveOpenTextEdits();
  saveOpenTableEdits();
  const s = state();
  const cp = getCurrentProject();
  const now = Date.now();
  const token = getToken()!;

  // One strip per project — all frames live here. Strip versions use type prefixes.
  const stripId = uuid();
  const strips = [{ id: stripId, label: 'Main', sort_order: 0, updated_at: now }];

  const frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; crop_w: number | null; crop_h: number | null; text_content: string | null; table_data: string | null; version_label: string | null; strip_labels: string | null; hidden: boolean; updated_at: number }> = [];
  const versions: Array<{ id: string; frame_id: string; label: string | null; type: string; hidden: boolean; starred: boolean; updated_at: number }> = [];
  const drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }> = [];
  const imageUploads: Array<{ versionId: string; src: string }> = [];

  // Map local frame id → server frame UUID (needed for group remapping)
  const localToServerFrame = new Map<number, string>();

  s.frames.forEach((f, i) => {
    const frameId = uuid();
    localToServerFrame.set(f.id, frameId);

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
    const mainVersionId = uuid();
    versions.push({ id: mainVersionId, frame_id: frameId, label: 'main', type: 'main', hidden: false, starred: false, updated_at: now });
    if (f.strokes && f.strokes.length > 0) {
      drawings.push({ id: uuid(), version_id: mainVersionId, drawing_data: JSON.stringify(f.strokes), updated_at: now });
    }
    if (f.src && isLocalImage(f.src)) {
      imageUploads.push({ versionId: mainVersionId, src: f.src });
    }

    // Helper: push versions for a strip type with optional type prefix
    const pushStripVersions = (stripVersions: Version[] | undefined, prefix: string) => {
      if (!stripVersions) return;
      for (const lv of stripVersions) {
        const vid = uuid();
        const fullType = prefix ? `${prefix}:${lv.type}` : lv.type;
        versions.push({
          id: vid, frame_id: frameId, label: lv.label || null, type: fullType,
          hidden: !!lv.hidden, starred: !!lv.starred, updated_at: now,
        });
        if (lv.strokes && lv.strokes.length > 0) {
          drawings.push({ id: uuid(), version_id: vid, drawing_data: JSON.stringify(lv.strokes), updated_at: now });
        }
        if (lv.bgImage && isLocalImage(lv.bgImage)) {
          imageUploads.push({ versionId: vid, src: lv.bgImage });
        }
      }
    };

    // Ver strip versions (no prefix for backward compat with existing synced data)
    pushStripVersions(s.stripVersions.ver?.[f.id], '');
    // Floor and refs strip versions (prefixed types)
    pushStripVersions(s.stripVersions.floor?.[f.id], 'floor');
    pushStripVersions(s.stripVersions.refs?.[f.id], 'refs');
  });

  // Build metadata JSON: stripDefs, groups (with remapped frame IDs), portraitMode
  const metaGroups = s.groups.map((g) => ({
    id: g.id,
    name: g.name,
    frameIds: g.frameIds.map((fid) => localToServerFrame.get(fid) || '').filter(Boolean),
    hiddenFrameIds: g.hiddenFrameIds.map((fid) => localToServerFrame.get(fid) || '').filter(Boolean),
  }));
  const metadata = JSON.stringify({
    stripDefs: s.stripDefs,
    groups: metaGroups,
    nextGroupId: s.nextGroupId,
    portraitMode: s.portraitMode,
  });

  // Upload all images to R2 in parallel
  const images: Array<{
    id: string; version_id: string; r2_key: string;
    width: number | null; height: number | null;
    size_bytes: number | null; content_type: string | null;
    updated_at: number;
  }> = [];

  if (imageUploads.length > 0) {
    const results = await Promise.all(
      imageUploads.map(async (task) => {
        try {
          const r = await uploadImageToR2(task.src, token);
          return { versionId: task.versionId, ...r };
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
    }
  }
  const res = await api.post<CloudProjectTree & { conflict?: boolean }>(
    `/projects/${encodeURIComponent(projectId)}/sync`,
    {
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
    },
    getToken(),
  );
  // Update lastKnownUpdatedAt so that the pull-on-focus mechanism doesn't
  // see our own push as a "newer remote version" and try to apply it.
  lastKnownUpdatedAt = now;
}

async function applyCloudTreeToStore(tree: CloudProjectTree): Promise<void> {
  // Map server tree back into the local Frame[] / versions[] shape.
  // We assign new local numeric ids that don't clash with the existing autoincrement.
  let nextId = 1;
  const newFrames: Frame[] = [];

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

  // Track which local frame/version needs an image fetched from R2.
  // We'll apply structure first, then fill images in asynchronously.
  const mainImageTasks: Array<{ localId: number; r2Key: string }> = [];
  // strip → localId → versionIdx → r2Key
  type VersionImageTask = { strip: 'ver' | 'floor' | 'refs'; localId: number; versionIdx: number; r2Key: string };
  const versionImageTasks: VersionImageTask[] = [];

  // Map server frame UUID → local numeric id (for group remapping on download)
  const serverToLocalFrame = new Map<string, number>();

  for (const strip of stripsSorted) {
    const stripFrames = (framesByStrip.get(strip.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    for (const sf of stripFrames) {
      const localId = nextId++;
      serverToLocalFrame.set(sf.id, localId);
      const allVersions = (versionsByFrame.get(sf.id) ?? []).sort((a, b) => a.updated_at - b.updated_at);

      // Treat the first "main"-typed version as frame-level strokes
      const mainV = allVersions.find((v) => v.type === 'main');
      const sideVs = allVersions.filter((v) => v !== mainV);
      const mainStrokes = mainV ? parseStrokes(drawingByVersion.get(mainV.id)) : [];

      // Check if main version has an image in R2
      const mainR2Key = mainV ? imageByVersion.get(mainV.id) : undefined;
      if (mainR2Key) mainImageTasks.push({ localId, r2Key: mainR2Key });

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
        src: '',  // filled async below
        label: sf.label ?? '',
        stripLabels,
        hidden: !!sf.hidden,
        cropW: sf.crop_w || 16,
        cropH: sf.crop_h || 9,
        strokes: mainStrokes,
        drawMode: mainStrokes.length > 0,
        textContent: sf.text_content ?? '',
        tableData: sf.table_data ? parseTableData(sf.table_data) : null,
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
      const mapVersions = (svList: typeof sideVs, stripName: 'ver' | 'floor' | 'refs') => {
        return svList.map((sv, j) => {
          const r2Key = imageByVersion.get(sv.id);
          if (r2Key) versionImageTasks.push({ strip: stripName, localId, versionIdx: j, r2Key });
          // Strip the prefix from the type to get the raw type
          let rawType = sv.type;
          const colonIdx = rawType.indexOf(':');
          if (colonIdx !== -1) rawType = rawType.slice(colonIdx + 1);
          return {
            id: j + 1,
            label: sv.label ?? '',
            type: (rawType === 'drawing' || rawType === 'upload' || rawType === 'empty') ? rawType as 'drawing' | 'upload' | 'empty' : 'empty' as const,
            strokes: parseStrokes(drawingByVersion.get(sv.id)),
            bgImage: null as string | null,  // filled async below
            hidden: !!sv.hidden,
            starred: !!sv.starred,
          };
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
    } catch {
      // Ignore malformed metadata — use defaults
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
    renderTick: prev.renderTick + 1,
  }));
  (window as any).__fh_renderAll?.();

  // Now fetch images from R2 in parallel and patch them into the store.
  const token = getToken();
  if (!token) return;

  const allFetches: Promise<void>[] = [];

  for (const task of mainImageTasks) {
    allFetches.push(
      fetchImageFromR2(task.r2Key, token)
        .then((dataUrl) => {
          const s = useStore.getState();
          const idx = s.frames.findIndex((f) => f.id === task.localId);
          if (idx === -1) return;
          const updated = [...s.frames];
          updated[idx] = { ...updated[idx], src: dataUrl };
          useStore.setState((prev) => ({ frames: updated, renderTick: prev.renderTick + 1 }));
          (window as any).__fh_renderAll?.();
        })
        .catch((e) => console.warn('[sync] failed to fetch main image', task.r2Key, e)),
    );
  }

  for (const task of versionImageTasks) {
    allFetches.push(
      fetchImageFromR2(task.r2Key, token)
        .then((dataUrl) => {
          const s = useStore.getState();
          // Pick the right strip map based on the task's strip
          const stripKey = task.strip === 'ver' ? 'versions'
            : task.strip === 'floor' ? 'floorVersions'
            : 'refsVersions';
          const versMap = s[stripKey] as Record<number, Version[]>;
          const vers = versMap[task.localId];
          if (!vers || !vers[task.versionIdx]) return;
          const updatedVers = [...vers];
          updatedVers[task.versionIdx] = { ...updatedVers[task.versionIdx], bgImage: dataUrl };
          useStore.setState((prev) => ({
            [stripKey]: { ...(prev[stripKey] as Record<number, Version[]>), [task.localId]: updatedVers },
            // Also update the generic map
            stripVersions: {
              ...prev.stripVersions,
              [task.strip]: { ...prev.stripVersions[task.strip], [task.localId]: updatedVers },
            },
            renderTick: prev.renderTick + 1,
          }));
          (window as any).__fh_renderAll?.();
        })
        .catch((e) => console.warn('[sync] failed to fetch version image', task.strip, task.r2Key, e)),
    );
  }

  // Wait for all images to load before returning (caller can show a toast).
  await Promise.all(allFetches);
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
// Pull-on-focus: when the tab becomes visible, check if the cloud version is
// newer and silently refresh the project if so.
// ---------------------------------------------------------------------------

let pullOnFocusActive = false;
let lastKnownUpdatedAt: number | null = null;
let pullInFlight = false;
let lastPullAt = 0;
const PULL_COOLDOWN_MS = 3_000; // Don't check more often than every 3s


function startPullOnFocus(): void {
  if (pullOnFocusActive) return;
  pullOnFocusActive = true;

  const doPull = () => void tryPullFromCloud();

  // visibilitychange fires on tab switches; focus fires on app switches
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') doPull();
  });
  window.addEventListener('focus', doPull);

  // Periodic pull every 30s — catches changes from other devices even when
  // this window stays focused the whole time (no tab/app switch).
  // Only polls when the page is actually focused (not behind another app).
  // document.hasFocus() is false when another app is in front, unlike
  // visibilityState which stays 'visible' even when Chrome is behind.
  setInterval(() => {
    if (document.hasFocus()) doPull();
  }, 30_000);
}

function formatTimeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
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
  if (isPushInFlight()) return;    // Don't pull while a push is uploading — let the push finish first
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
      const localHasChanges = hasLocalChanges();

      // Same device pushed — this is our own data reflecting back. Just update timestamp.
      if (remoteDeviceId === localDeviceId) {
        lastKnownUpdatedAt = remoteUpdatedAt;
        return;
      }

      // Different device but we have local changes — conflict
      if (remoteDeviceId && localHasChanges) {
        const choice: ConflictChoice = await showConflictDialog(
          remoteDeviceName,
          formatTimeAgo(remoteUpdatedAt),
        );

        if (choice === 'local') {
          // User chose to keep local — the next interval sync will push local to cloud.
          lastKnownUpdatedAt = remoteUpdatedAt;
          return;
        }

        if (choice === 'merge') {
          // Save current local state before applying cloud
          const localState = useStore.getState();
          const localFramesCopy = localState.frames.map((f) => ({ ...f }));
          const localVersionsCopy: Record<number, Version[]> = {};
          for (const fid in localState.versions) {
            localVersionsCopy[+fid] = localState.versions[+fid].map((v) => ({ ...v }));
          }

          // Apply cloud tree to build cloud frames in local format
          await applyCloudTreeToStore(tree);
          const cloudState = useStore.getState();
          const cloudFrames = cloudState.frames.map((f) => ({ ...f }));
          const cloudVersionsCopy: Record<number, Version[]> = {};
          for (const fid in cloudState.versions) {
            cloudVersionsCopy[+fid] = cloudState.versions[+fid].map((v) => ({ ...v }));
          }

          // Merge: cloud as base, local differences as duplicates
          const { frames: mergedFrames, versions: mergedVersions } = mergeFrames(
            cloudFrames, cloudVersionsCopy,
            localFramesCopy, localVersionsCopy,
          );

          // Build activeTab for merged frames
          const mergedActiveTab: Record<number, number> = {};
          for (const f of mergedFrames) mergedActiveTab[f.id] = 0;

          const mergedIsPortrait = mergedFrames.length > 0 && mergedFrames[0].cropH > mergedFrames[0].cropW;
          const mFloor: Record<number, Version[]> = {};
          const mRefs: Record<number, Version[]> = {};
          const mFloorTab: Record<number, number> = {};
          const mRefsTab: Record<number, number> = {};
          const mVerCC: Record<number, number> = {};
          const mFloorCC: Record<number, number> = {};
          const mRefsCC: Record<number, number> = {};
          const mVerPFS: Record<number, any> = {};
          const mFloorPFS: Record<number, any> = {};
          const mRefsPFS: Record<number, any> = {};
          useStore.setState((prev) => ({
            frames: mergedFrames,
            stripVersions: { ver: mergedVersions, floor: mFloor, refs: mRefs },
            stripActiveTab: { ver: mergedActiveTab, floor: mFloorTab, refs: mRefsTab },
            stripCrossCompare: { ver: mVerCC, floor: mFloorCC, refs: mRefsCC },
            stripPrevFrameState: { ver: mVerPFS, floor: mFloorPFS, refs: mRefsPFS },
            versions: mergedVersions,
            activeTab: mergedActiveTab,
            floorVersions: mFloor,
            floorActiveTab: mFloorTab,
            floorCrossCompare: mFloorCC,
            floorPrevFrameState: mFloorPFS,
            refsVersions: mRefs,
            refsActiveTab: mRefsTab,
            refsCrossCompare: mRefsCC,
            refsPrevFrameState: mRefsPFS,
            drawColor: {},
            drawWidth: {},
            drawEraser: {},
            drawActive: {},
            showText: {},
            crossCompare: mVerCC,
            prevFrameState: mVerPFS,
            nextId: Math.max(...mergedFrames.map((f) => f.id), 0) + 1,
            reorderFid: null,
            verReorderFid: null,
            verReorderStrip: null,
            stripClipboard: null,
            imgTarget: null,
            mainImgTarget: null,
            ovExpandedFid: null,
            drawingInProgress: false,
            drawSuppressClick: false,
            overviewAction: false,
            fsOverlayActive: null,
            currentViewMode: 'both',
            portraitMode: mergedIsPortrait,
            renderTick: prev.renderTick + 1,
          }));

          lastKnownUpdatedAt = remoteUpdatedAt;
          markSaved(cp.projectId!);
          (window as any).__fh_renderAll?.();
          autoPhoneMainView();
          updateSyncHash();
          showToast('Merged — duplicate frames marked with "?"');
          return;
        }

        // choice === 'cloud' — fall through to apply cloud version
      }

      lastKnownUpdatedAt = remoteUpdatedAt;
      await applyCloudTreeToStore(tree);
      markSaved(cp.projectId!);
      (window as any).__fh_renderAll?.();
      autoPhoneMainView();
      // updateSyncHash AFTER renderAll — renderAll calls saveOpenTextEdits/saveOpenTableEdits
      // which can modify the store. If we hash before that, the push interval sees a stale hash
      // and re-pushes, causing a ping-pong loop between devices.
      updateSyncHash();
    }
  } catch {
    // Silent — don't disturb the user if the check fails.
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
      applySnapshotToStore(snap);
      setCurrentProject({
        projectId: snap.projectId,
        name: snap.name,
        lastSavedAt: snap.projectId ? snap.lastModified : null,
      });
      (window as any).__fh_renderAll?.();
      autoPhoneMainView();
      // Set baseline hash so pull-on-focus doesn't silently override the
      // restored state (which includes activeGroupId, local edits, etc.).
      updateSyncHash();
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

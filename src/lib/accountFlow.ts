// All UI flows for the account/sync system. Each "open*" function returns a
// Promise that resolves when the modal closes — same pattern as lib/modals.ts.
// Higher-level flows (saveNow, project list selection, etc.) compose these.
//
// Network calls go through ./api with the bearer token from ./session.

import { api } from './api';
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
  markSaved,
  setCurrentProject,
  setProjectName,
} from './currentProject';
import { applySnapshotToStore, loadSnapshot, snapshotFromStore } from './persistence';
import { showConfirm, showToast } from './modals';
import { resetStoryboardState, state, useStore } from '../store/state';
import type { Frame, Stroke, Version } from '../store/state';

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
  const forgot = el<HTMLButtonElement>('accountForgot');
  const cancel = el<HTMLButtonElement>('accountCancel');
  const errorEl = el('accountError');
  const nameInput = el<HTMLInputElement>('accountName');
  const emailInput = el<HTMLInputElement>('accountEmail');
  const passInput = el<HTMLInputElement>('accountPassword');
  const profSelect = el<HTMLSelectElement>('accountProfession');

  function applyMode(): void {
    if (mode === 'signup') {
      titleEl.textContent = 'Create your account';
      hintEl.textContent = 'A free account lets you save and edit on any device.';
      submit.textContent = 'Create account';
      passInput.autocomplete = 'new-password';
      toggle.textContent = 'Already have an account? Log in';
      setVisible('accountRowName', true);
      setVisible('accountRowProfession', true);
    } else {
      titleEl.textContent = 'Welcome back';
      hintEl.textContent = 'Log in to access your projects on any device.';
      submit.textContent = 'Log in';
      passInput.autocomplete = 'current-password';
      toggle.textContent = 'New here? Create an account';
      setVisible('accountRowName', false);
      setVisible('accountRowProfession', false);
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
          finish({ user: res.user, token: res.session.token });
        }
      } catch (e) {
        errorEl.textContent = asMessage(e, 'Something went wrong. Please try again.');
      } finally {
        submit.disabled = false;
      }
    };

    toggle.onclick = () => {
      mode = mode === 'signup' ? 'login' : 'signup';
      applyMode();
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
}

export async function openProjectList(): Promise<void> {
  if (!isLoggedIn()) {
    await openLoginThenContinue();
    if (!isLoggedIn()) return;
  }
  const content = el('projectListContent');
  content.textContent = 'Loading…';
  show('projectListModal');

  return new Promise((resolve) => {
    const closeBtn = el<HTMLButtonElement>('projectListClose');
    const newBtn = el<HTMLButtonElement>('projectListNew');
    function cleanup(): void {
      closeBtn.onclick = null;
      newBtn.onclick = null;
      hide('projectListModal');
      resolve();
    }
    closeBtn.onclick = cleanup;
    newBtn.onclick = async () => {
      cleanup();
      await startNewProject();
    };

    void (async () => {
      try {
        const res = await api.get<{ projects: CloudProject[] }>('/projects', getToken());
        renderProjectList(res.projects, async (project) => {
          cleanup();
          await loadCloudProject(project);
        });
      } catch (e) {
        content.textContent = asMessage(e, 'Could not load your projects.');
      }
    })();
  });
}

function renderProjectList(projects: CloudProject[], onPick: (p: CloudProject) => void): void {
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
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'project-list-row';
    const name = document.createElement('span');
    name.className = 'project-list-name';
    name.textContent = p.name;
    const meta = document.createElement('span');
    meta.className = 'project-list-meta';
    meta.textContent = formatRelative(p.updated_at);
    row.append(name, meta);
    row.onclick = () => onPick(p);
    content.appendChild(row);
  }
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
    const tree = await api.get<CloudProjectTree>(`/projects/${encodeURIComponent(p.id)}/sync`, getToken());
    applyCloudTreeToStore(tree);
    setCurrentProject({ projectId: p.id, name: p.name, lastSavedAt: tree.project.updated_at });
    showToast(`Loaded "${p.name}"`);
  } catch (e) {
    showToast(asMessage(e, 'Could not load project.'));
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
      clearCurrentProject();
      showToast('Logged out.');
    };
    deleteBtn.onclick = async () => {
      const okDelete = await showConfirm(
        'Delete your account? Your projects will be marked for deletion and removed permanently after 10 days.',
      );
      if (!okDelete) return;
      try {
        await api.delete('/user/me', getToken());
        clearSession();
        clearCurrentProject();
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
    } catch (e) {
      showToast(asMessage(e, 'Could not create project.'));
      return;
    }
  }

  // 4. Sync the current state to /sync.
  try {
    await syncCurrentToServer(projectId);
    markSaved(projectId);
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
  clearCurrentProject();
  // Refresh DOM
  (window as any).__fh_renderAll?.();
  showToast('Started a new project.');
}

async function openLoginThenContinue(): Promise<void> {
  await openAccountModal('login');
}

// ---------------------------------------------------------------------------
// Sync mapping (local store ↔ backend tree)
//
// v1.6 limitation: image bytes (frame `src`) stay local in IndexedDB until R2
// is activated. Cloud sync uploads structure + drawing strokes only. Loading
// a project on a different device will show frame structure but blank images.
// This is documented in the README and surfaced in copy where relevant.
// ---------------------------------------------------------------------------

interface CloudProjectTree {
  project: { id: string; name: string; created_at: number; updated_at: number };
  strips: Array<{ id: string; project_id: string; label: string | null; sort_order: number; updated_at: number }>;
  frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; updated_at: number }>;
  versions: Array<{ id: string; frame_id: string; label: string | null; type: string; updated_at: number }>;
  images: Array<{ id: string; version_id: string; r2_key: string; width: number | null; height: number | null; updated_at: number }>;
  drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }>;
}

function uuid(): string {
  return crypto.randomUUID();
}

async function syncCurrentToServer(projectId: string): Promise<void> {
  const s = state();
  const cp = getCurrentProject();
  const now = Date.now();

  // One strip per project (the existing app has a single main strip column).
  const stripId = uuid();
  const strips = [{ id: stripId, label: 'Main', sort_order: 0, updated_at: now }];

  const frames: Array<{ id: string; strip_id: string; label: string | null; sort_order: number; updated_at: number }> = [];
  const versions: Array<{ id: string; frame_id: string; label: string | null; type: string; updated_at: number }> = [];
  const drawings: Array<{ id: string; version_id: string; drawing_data: string; updated_at: number }> = [];

  s.frames.forEach((f, i) => {
    const frameId = uuid();
    frames.push({ id: frameId, strip_id: stripId, label: f.label || null, sort_order: i, updated_at: now });

    // Frame-level strokes are treated as a "main" version of the frame.
    const mainVersionId = uuid();
    versions.push({ id: mainVersionId, frame_id: frameId, label: 'main', type: 'main', updated_at: now });
    if (f.strokes && f.strokes.length > 0) {
      drawings.push({ id: uuid(), version_id: mainVersionId, drawing_data: JSON.stringify(f.strokes), updated_at: now });
    }

    const localVersions = s.versions[f.id] ?? [];
    for (const lv of localVersions) {
      const vid = uuid();
      versions.push({
        id: vid,
        frame_id: frameId,
        label: lv.label || null,
        type: lv.type,
        updated_at: now,
      });
      if (lv.strokes && lv.strokes.length > 0) {
        drawings.push({ id: uuid(), version_id: vid, drawing_data: JSON.stringify(lv.strokes), updated_at: now });
      }
    }
  });

  await api.post(
    `/projects/${encodeURIComponent(projectId)}/sync`,
    {
      project: { name: cp.name, updated_at: now },
      strips,
      frames,
      versions,
      images: [], // R2 not yet active — see comment above
      drawings,
    },
    getToken(),
  );
}

function applyCloudTreeToStore(tree: CloudProjectTree): void {
  // Map server tree back into the local Frame[] / versions[] shape. Image src
  // is empty (R2 deferred). We assign new local numeric ids that don't clash
  // with the existing autoincrement.
  let nextId = 1;
  const newFrames: Frame[] = [];
  const newVersions: Record<number, Version[]> = {};
  const activeTab: Record<number, number> = {};

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

  for (const strip of stripsSorted) {
    const stripFrames = (framesByStrip.get(strip.id) ?? []).sort((a, b) => a.sort_order - b.sort_order);
    for (const sf of stripFrames) {
      const localId = nextId++;
      const allVersions = (versionsByFrame.get(sf.id) ?? []).sort((a, b) => a.updated_at - b.updated_at);
      // Treat the first "main"-typed version as frame-level strokes; everything
      // else becomes an entry in the versions strip.
      const mainV = allVersions.find((v) => v.type === 'main');
      const sideVs = allVersions.filter((v) => v !== mainV);
      const mainStrokes = mainV ? parseStrokes(drawingByVersion.get(mainV.id)) : [];
      newFrames.push({
        id: localId,
        src: '',
        label: sf.label ?? '',
        cropW: 0,
        cropH: 0,
        strokes: mainStrokes,
        drawMode: false,
        textContent: '',
        tableData: null,
      });
      newVersions[localId] = sideVs.map((sv, j) => ({
        id: j + 1,
        label: sv.label ?? '',
        type: (sv.type === 'drawing' || sv.type === 'upload' || sv.type === 'empty') ? sv.type : 'empty',
        strokes: parseStrokes(drawingByVersion.get(sv.id)),
        bgImage: null,
      }));
      activeTab[localId] = 0;
    }
  }

  useStore.setState((prev) => ({
    frames: newFrames,
    versions: newVersions,
    activeTab,
    nextId,
    renderTick: prev.renderTick + 1,
  }));
  (window as any).__fh_renderAll?.();
}

function parseStrokes(json: string | undefined): Stroke[] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch { return []; }
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
// Bootstrap: load token, restore IDB, handle ?reset=token URL
// ---------------------------------------------------------------------------

export async function bootstrapAccountSystem(): Promise<void> {
  // 1. Validate any saved session.
  await loadCurrentUser();

  // 2. Restore unsaved local project from IndexedDB if present.
  try {
    const snap = await loadSnapshot();
    if (snap && snap.frames.length > 0) {
      applySnapshotToStore(snap);
      setCurrentProject({
        projectId: snap.projectId,
        name: snap.name,
        lastSavedAt: snap.projectId ? snap.lastModified : null,
      });
      (window as any).__fh_renderAll?.();
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
    await openProjectList();
  }
}

// Keep a convenient reference to the snapshot helper for places that need it
// without pulling persistence directly.
export { snapshotFromStore };

// Imperative modal helpers — they operate on the React-rendered modal markup
// (matching IDs preserved from the original).

import { COLORS } from '../store/state';

export type NewProjectChoice = 'pdf' | 'images' | 'scratch' | 'portrait' | 'fitting' | 'open' | 'cancel';

let _newProjectModalOpen = false;

/**
 * Shows the New Project modal. `onChoice` is called synchronously inside
 * the button's click handler so that file-input .click() stays within the
 * user-gesture callstack (required by Safari / iOS).
 */
export function showNewProjectModal(onChoice: (choice: NewProjectChoice) => void): void {
  if (_newProjectModalOpen) return;
  _newProjectModalOpen = true;

  const overlay = document.createElement('div');
  overlay.className = 'new-project-overlay';
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.7);' +
    'display:flex;align-items:center;justify-content:center;padding:16px;';

  const box = document.createElement('div');
  box.className = 'new-project-modal';
  box.style.cssText =
    'background:#1e1e1e;border:1px solid #444;border-radius:14px;' +
    'padding:20px 24px;max-width:300px;width:100%;color:#fff;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

  const accentBg = 'background:#d52632;';
  const btnBase =
    'width:100%;padding:14px 16px;border-radius:8px;border:none;' +
    'color:#fff;font-size:15px;font-weight:600;cursor:pointer;text-align:center;' +
    'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

  const tallBtn =
    'width:48px;padding:0;border-radius:8px;border:none;' +
    accentBg + 'color:#fff;font-weight:600;cursor:pointer;' +
    'aspect-ratio:9/16;display:flex;align-items:center;justify-content:center;';

  box.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px;align-items:center;">
      <button data-choice="pdf" class="np-btn" style="${btnBase}${accentBg}">Load Storyboard from PDF</button>
      <button data-choice="images" class="np-btn" style="${btnBase}${accentBg}">Load Images from Folder</button>
      <button data-choice="scratch" class="np-btn" style="${btnBase}${accentBg}">16×9 Start from Scratch</button>
      <div style="display:flex;flex-direction:row;gap:12px;align-items:center;justify-content:center;">
        <button data-choice="portrait" class="np-btn" style="${tallBtn}font-size:15px;">9x16</button>
        <button data-choice="fitting" class="np-btn" style="${tallBtn}font-size:11px;letter-spacing:0.2px;">FITTING</button>
      </div>
      <button data-choice="open" class="np-btn" style="${btnBase}${accentBg}">Open Project</button>
      <button data-choice="cancel" class="np-btn" style="
        ${btnBase}background:#2a2a2a;border:1px solid #555;color:#ccc;font-weight:500;
      ">Cancel</button>
    </div>
  `;

  const cleanup = () => {
    _newProjectModalOpen = false;
    overlay.remove();
  };

  box.querySelectorAll('[data-choice]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const choice = (btn as HTMLElement).dataset.choice as NewProjectChoice;
      cleanup();
      onChoice(choice);
    });
  });

  // Close on overlay click (outside the box)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      cleanup();
      onChoice('cancel');
    }
  });

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

export function isNewProjectModalOpen(): boolean {
  return _newProjectModalOpen;
}

/** Dismiss the modal programmatically (e.g. when bootstrap restores a project). */
export function dismissNewProjectModal(): void {
  if (!_newProjectModalOpen) return;
  const overlay = document.querySelector('.new-project-overlay');
  if (overlay) overlay.remove();
  _newProjectModalOpen = false;
}

export function showToast(msg: string): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.classList.add('show');
  const dismiss = () => t.classList.remove('show');
  t.addEventListener('click', dismiss, { once: true });
  setTimeout(dismiss, 2800);
}

export function showCamBlockedMsg(): void {
  const m = document.getElementById('camBlockedMsg')!;
  m.classList.add('show');
  m.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); m.classList.remove('show'); }, { once: true });
  setTimeout(() => m.classList.remove('show'), 8000);
}

export function setProgress(pct: number, label: string): void {
  (document.getElementById('progressBar') as HTMLElement).style.width = pct + '%';
  document.getElementById('progressLabel')!.textContent = label;
}

/**
 * Two-option label choice dialog. Returns whichever label string the user picks.
 */
export function showLabelChoice(optA: string, optB: string): Promise<string> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;';
    const box = document.createElement('div');
    box.style.cssText =
      'background:#1e1e1e;border:1px solid #444;border-radius:12px;' +
      'padding:20px 24px;max-width:300px;width:100%;color:#fff;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    box.innerHTML = `
      <p style="margin:0 0 16px;font-size:15px;text-align:center;color:#ccc;">
        Label for new frame?
      </p>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button id="lc_a" style="
          flex:1;padding:12px 14px;border-radius:8px;border:1px solid #555;
          background:#2a2a2a;color:#fff;font-size:16px;font-weight:600;cursor:pointer;
        ">${optA}</button>
        <button id="lc_b" style="
          flex:1;padding:12px 14px;border-radius:8px;border:1px solid #555;
          background:#2a2a2a;color:#fff;font-size:16px;font-weight:600;cursor:pointer;
        ">${optB}</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    function cleanup(val: string) {
      overlay.remove();
      resolve(val);
    }
    document.getElementById('lc_a')!.onclick = () => cleanup(optA);
    document.getElementById('lc_b')!.onclick = () => cleanup(optB);
    overlay.onclick = (e) => { if (e.target === overlay) cleanup(optB); };
  });
}

export function showConfirm(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal')!;
    document.getElementById('confirmMsg')!.textContent = msg;
    modal.classList.remove('hidden');
    const yes = document.getElementById('confirmYes') as HTMLButtonElement;
    const no = document.getElementById('confirmNo') as HTMLButtonElement;
    function cleanup(result: boolean) {
      modal.classList.add('hidden');
      yes.onclick = null;
      no.onclick = null;
      resolve(result);
    }
    yes.onclick = () => cleanup(true);
    no.onclick = () => cleanup(false);
  });
}

export type ConflictChoice = 'cloud' | 'local' | 'merge';

/**
 * Three-option conflict dialog for cross-device sync conflicts.
 * Returns 'cloud' (load cloud version), 'local' (keep this device), or 'merge' (keep both).
 */
export function showConflictDialog(deviceName: string, timeAgo: string): Promise<ConflictChoice> {
  return new Promise((resolve) => {
    // Create a dynamically-generated modal
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.6);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;';
    const box = document.createElement('div');
    box.style.cssText =
      'background:#1e1e1e;border:1px solid #444;border-radius:12px;' +
      'padding:20px 24px;max-width:360px;width:100%;color:#fff;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';
    box.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:16px;font-weight:600;">Sync Conflict</h3>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#ccc;">
        This project was last edited on <strong>${deviceName}</strong> (${timeAgo}).
        You also have unsaved changes on this device.
      </p>
      <div style="display:flex;flex-direction:column;gap:8px;">
        <button id="conflictCloud" style="
          padding:10px 14px;border-radius:8px;border:1px solid #555;
          background:#2a2a2a;color:#fff;font-size:14px;text-align:left;cursor:pointer;
        ">Load the <strong>${deviceName}</strong> version (${timeAgo})</button>
        <button id="conflictLocal" style="
          padding:10px 14px;border-radius:8px;border:1px solid #555;
          background:#2a2a2a;color:#fff;font-size:14px;text-align:left;cursor:pointer;
        ">Keep this device's version</button>
        <button id="conflictMerge" style="
          padding:10px 14px;border-radius:8px;border:1px solid #4caf50;
          background:#1b3a1b;color:#fff;font-size:14px;text-align:left;cursor:pointer;
        ">Keep both — add changes as duplicate frames</button>
      </div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function cleanup(choice: ConflictChoice) {
      overlay.remove();
      resolve(choice);
    }
    box.querySelector('#conflictCloud')!.addEventListener('click', () => cleanup('cloud'));
    box.querySelector('#conflictLocal')!.addEventListener('click', () => cleanup('local'));
    box.querySelector('#conflictMerge')!.addEventListener('click', () => cleanup('merge'));
  });
}

// ---------------------------------------------------------------------------
// Per-frame conflict picker: shows thumbnails side by side for each
// frame that was edited on both devices. User taps one to keep it.
// Returns a Map of serverFrameId → 'local' | 'cloud'.
// ---------------------------------------------------------------------------

export interface FrameConflict {
  serverFrameId: string;
  label: string;        // Frame label (e.g. "1" or user label)
  localSrc: string;     // Local frame image (data URL or empty)
  cloudSrc: string;     // Cloud frame image (data URL or empty)
  localDeviceName: string;
  cloudDeviceName: string;
}

export function showFrameConflictPicker(
  conflicts: FrameConflict[],
): Promise<Map<string, 'local' | 'cloud'>> {
  return new Promise((resolve) => {
    const results = new Map<string, 'local' | 'cloud'>();
    let currentIdx = 0;

    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.7);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;';

    function renderConflict(idx: number) {
      const c = conflicts[idx];
      const total = conflicts.length;
      const counter = total > 1 ? ` (${idx + 1}/${total})` : '';
      overlay.innerHTML = '';

      const box = document.createElement('div');
      box.style.cssText =
        'background:#1e1e1e;border:1px solid #444;border-radius:12px;' +
        'padding:20px 24px;max-width:420px;width:100%;color:#fff;' +
        'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

      // Placeholder for empty images
      const localImg = c.localSrc
        ? `<img src="${c.localSrc}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#333;" />`
        : `<div style="width:100%;aspect-ratio:16/9;background:#333;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px;">No image</div>`;
      const cloudImg = c.cloudSrc
        ? `<img src="${c.cloudSrc}" style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#333;" />`
        : `<div style="width:100%;aspect-ratio:16/9;background:#333;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#666;font-size:12px;">No image</div>`;

      box.innerHTML = `
        <h3 style="margin:0 0 6px;font-size:15px;font-weight:600;">
          Frame "${c.label}" edited on both devices${counter}
        </h3>
        <p style="margin:0 0 14px;font-size:13px;color:#999;">Tap the version you want to keep</p>
        <div style="display:flex;gap:10px;">
          <div class="conflict-pick" data-choice="local" style="
            flex:1;cursor:pointer;border:2px solid transparent;border-radius:8px;
            padding:6px;transition:border-color 0.15s;
          ">
            ${localImg}
            <div style="text-align:center;margin-top:6px;font-size:12px;font-weight:500;color:#aaa;">
              ${c.localDeviceName}
            </div>
          </div>
          <div class="conflict-pick" data-choice="cloud" style="
            flex:1;cursor:pointer;border:2px solid transparent;border-radius:8px;
            padding:6px;transition:border-color 0.15s;
          ">
            ${cloudImg}
            <div style="text-align:center;margin-top:6px;font-size:12px;font-weight:500;color:#aaa;">
              ${c.cloudDeviceName}
            </div>
          </div>
        </div>
      `;
      overlay.appendChild(box);

      // Hover/active styles
      const picks = box.querySelectorAll('.conflict-pick');
      picks.forEach((el) => {
        (el as HTMLElement).addEventListener('mouseenter', () => {
          (el as HTMLElement).style.borderColor = '#4caf50';
        });
        (el as HTMLElement).addEventListener('mouseleave', () => {
          (el as HTMLElement).style.borderColor = 'transparent';
        });
        (el as HTMLElement).addEventListener('click', () => {
          const choice = (el as HTMLElement).dataset.choice as 'local' | 'cloud';
          results.set(c.serverFrameId, choice);
          currentIdx++;
          if (currentIdx < conflicts.length) {
            renderConflict(currentIdx);
          } else {
            overlay.remove();
            resolve(results);
          }
        });
      });
    }

    document.body.appendChild(overlay);
    renderConflict(0);
  });
}

export function showLabelEdit(currentLabel: string): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = document.getElementById('labelModal')!;
    const input = document.getElementById('labelModalInput') as HTMLInputElement;
    const ok = document.getElementById('labelOk') as HTMLButtonElement;
    const cancel = document.getElementById('labelCancel') as HTMLButtonElement;
    input.value = currentLabel || '';
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 50);
    function cleanup(result: string | null) {
      modal.classList.add('hidden');
      ok.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
      resolve(result);
    }
    ok.onclick = () => cleanup(input.value.trim());
    cancel.onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') cleanup(input.value.trim());
      if (e.key === 'Escape') cleanup(null);
    };
  });
}

export function showVersionChoice(): Promise<'hide' | 'delete' | null> {
  return new Promise((resolve) => {
    const modal = document.getElementById('choiceModal')!;
    const content = document.getElementById('choiceContent')!;
    let selected: 'hide' | 'delete' = 'hide';
    function renderOptions() {
      content.innerHTML = `
        <div class="choice-modal-options">
          <div class="choice-option${selected === 'hide' ? ' selected' : ''}" data-choice="hide">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">HIDE this version</span>
          </div>
          <div class="choice-option${selected === 'delete' ? ' selected' : ''}" data-choice="delete">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">DELETE this version</span>
          </div>
        </div>
        <div class="confirm-modal-btns">
          <button class="btn" id="choiceCancel3">Cancel</button>
          <button class="btn" id="choiceOk3">OK</button>
        </div>`;
      content.querySelectorAll('.choice-option').forEach((opt) => {
        opt.addEventListener('click', () => {
          selected = (opt as HTMLElement).dataset.choice as 'hide' | 'delete';
          renderOptions();
        });
      });
      document.getElementById('choiceCancel3')!.addEventListener('click', () => cleanup(null));
      document.getElementById('choiceOk3')!.addEventListener('click', async () => {
        if (selected === 'delete') {
          modal.classList.add('hidden');
          const confirmed = await showConfirmDefaultNo('Are you sure you want to delete this version?');
          if (confirmed) {
            cleanup('delete');
          } else {
            modal.classList.remove('hidden');
            renderOptions();
          }
        } else {
          cleanup(selected);
        }
      });
    }
    modal.classList.remove('hidden');
    renderOptions();
    function cleanup(result: 'hide' | 'delete' | null) {
      modal.classList.add('hidden');
      resolve(result);
    }
  });
}

export function showConfirmDefaultNo(msg: string): Promise<boolean> {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirmModal')!;
    document.getElementById('confirmMsg')!.textContent = msg;
    modal.classList.remove('hidden');
    const yes = document.getElementById('confirmYes') as HTMLButtonElement;
    const no = document.getElementById('confirmNo') as HTMLButtonElement;
    no.style.background = '#d52632';
    no.style.borderColor = '#d52632';
    no.style.color = '#fff';
    yes.style.background = '';
    yes.style.borderColor = '';
    yes.style.color = '';
    function cleanup(result: boolean) {
      modal.classList.add('hidden');
      yes.onclick = null;
      no.onclick = null;
      no.style.background = '';
      no.style.borderColor = '';
      no.style.color = '';
      yes.style.background = '#d52632';
      yes.style.borderColor = '#d52632';
      yes.style.color = '#fff';
      resolve(result);
    }
    yes.onclick = () => cleanup(true);
    no.onclick = () => cleanup(false);
  });
}

export function showDeleteChoice(): Promise<'hide' | 'delete' | null> {
  return new Promise((resolve) => {
    const modal = document.getElementById('choiceModal')!;
    const content = document.getElementById('choiceContent')!;
    let selected: 'hide' | 'delete' = 'hide';
    function renderOptions() {
      content.innerHTML = `
        <div class="choice-modal-options">
          <div class="choice-option${selected === 'hide' ? ' selected' : ''}" data-choice="hide">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">HIDE this frame and all its versions</span>
          </div>
          <div class="choice-option danger${selected === 'delete' ? ' selected' : ''}" data-choice="delete">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">DELETE this frame and all its versions</span>
          </div>
        </div>
        <div class="confirm-modal-btns">
          <button class="btn" id="choiceCancel2">Cancel</button>
          <button class="btn" id="choiceOk">OK</button>
        </div>`;
      content.querySelectorAll('.choice-option').forEach((opt) => {
        opt.addEventListener('click', () => {
          selected = (opt as HTMLElement).dataset.choice as 'hide' | 'delete';
          renderOptions();
        });
      });
      document.getElementById('choiceCancel2')!.addEventListener('click', () => cleanup(null));
      document.getElementById('choiceOk')!.addEventListener('click', async () => {
        if (selected === 'delete') {
          modal.classList.add('hidden');
          const confirmed = await showConfirm('Are you sure you want to delete this frame and all its versions?');
          if (confirmed) {
            cleanup('delete');
          } else {
            modal.classList.remove('hidden');
            renderOptions();
          }
        } else {
          cleanup(selected);
        }
      });
    }
    modal.classList.remove('hidden');
    renderOptions();
    function cleanup(result: 'hide' | 'delete' | null) {
      modal.classList.add('hidden');
      resolve(result);
    }
  });
}

export function showOrphanChoice(): Promise<'keep' | 'hide' | 'delete' | null> {
  return new Promise((resolve) => {
    const modal = document.getElementById('choiceModal')!;
    const content = document.getElementById('choiceContent')!;
    let selected: 'keep' | 'hide' | 'delete' = 'keep';
    function renderOptions() {
      content.innerHTML = `
        <div style="margin-bottom:12px;font-size:13px;color:#ccc;line-height:1.5;">This frame was not found in the latest PDF import.</div>
        <div class="choice-modal-options">
          <div class="choice-option${selected === 'keep' ? ' selected' : ''}" data-choice="keep">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">KEEP this frame</span>
          </div>
          <div class="choice-option${selected === 'hide' ? ' selected' : ''}" data-choice="hide">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">HIDE this frame</span>
          </div>
          <div class="choice-option danger${selected === 'delete' ? ' selected' : ''}" data-choice="delete">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">DELETE this frame and all its versions</span>
          </div>
        </div>
        <div class="confirm-modal-btns">
          <button class="btn" id="orphanCancel">Cancel</button>
          <button class="btn" id="orphanOk">OK</button>
        </div>`;
      content.querySelectorAll('.choice-option').forEach((opt) => {
        opt.addEventListener('click', () => {
          selected = (opt as HTMLElement).dataset.choice as 'keep' | 'hide' | 'delete';
          renderOptions();
        });
      });
      document.getElementById('orphanCancel')!.addEventListener('click', () => cleanup(null));
      document.getElementById('orphanOk')!.addEventListener('click', async () => {
        if (selected === 'delete') {
          modal.classList.add('hidden');
          const confirmed = await showConfirm('Are you sure you want to delete this frame and all its versions?');
          if (confirmed) {
            cleanup('delete');
          } else {
            modal.classList.remove('hidden');
            renderOptions();
          }
        } else {
          cleanup(selected);
        }
      });
    }
    modal.classList.remove('hidden');
    renderOptions();
    function cleanup(result: 'keep' | 'hide' | 'delete' | null) {
      modal.classList.add('hidden');
      resolve(result);
    }
  });
}

export function showGroupDeleteChoice(): Promise<'hide' | 'remove' | null> {
  return new Promise((resolve) => {
    const modal = document.getElementById('choiceModal')!;
    const content = document.getElementById('choiceContent')!;
    content.style.minWidth = '320px';
    let selected: 'hide' | 'remove' = 'hide';
    function renderOptions() {
      content.innerHTML = `
        <div class="choice-modal-options">
          <div class="choice-option${selected === 'hide' ? ' selected' : ''}" data-choice="hide">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">HIDE this frame and all its versions<br>inside this group</span>
          </div>
          <div class="choice-option danger${selected === 'remove' ? ' selected' : ''}" data-choice="remove">
            <div class="choice-radio"><div class="choice-radio-dot"></div></div>
            <span class="choice-label">REMOVE this frame and all its versions<br>from this group</span>
          </div>
        </div>
        <div class="confirm-modal-btns">
          <button class="btn" id="choiceCancel2">Cancel</button>
          <button class="btn" id="choiceOk">OK</button>
        </div>`;
      content.querySelectorAll('.choice-option').forEach((opt) => {
        opt.addEventListener('click', () => {
          selected = (opt as HTMLElement).dataset.choice as 'hide' | 'remove';
          renderOptions();
        });
      });
      document.getElementById('choiceCancel2')!.addEventListener('click', () => cleanup(null));
      document.getElementById('choiceOk')!.addEventListener('click', () => cleanup(selected));
    }
    modal.classList.remove('hidden');
    renderOptions();
    function cleanup(result: 'hide' | 'remove' | null) {
      modal.classList.add('hidden');
      content.style.minWidth = '';
      resolve(result);
    }
  });
}

export function showVerLabelEdit(frameLabel: string, currentVerLabel: string): Promise<string | null> {
  return new Promise((resolve) => {
    const modal = document.getElementById('verLabelModal')!;
    const prefix = document.getElementById('verLabelPrefix')!;
    const input = document.getElementById('verLabelInput') as HTMLInputElement;
    const ok = document.getElementById('verLabelOk') as HTMLButtonElement;
    const cancel = document.getElementById('verLabelCancel') as HTMLButtonElement;
    prefix.textContent = frameLabel + ' / ';
    input.value = currentVerLabel || 'version';
    modal.classList.remove('hidden');
    setTimeout(() => { input.focus(); input.select(); }, 50);
    function cleanup(result: string | null) {
      modal.classList.add('hidden');
      ok.onclick = null;
      cancel.onclick = null;
      input.onkeydown = null;
      resolve(result);
    }
    ok.onclick = () => cleanup(input.value.trim() || 'version');
    cancel.onclick = () => cleanup(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') cleanup(input.value.trim() || 'version');
      if (e.key === 'Escape') cleanup(null);
    };
  });
}

export function showOverwriteConfirm(): Promise<'yes' | 'cancel' | 'new_project'> {
  return new Promise((resolve) => {
    const modal = document.getElementById('overwriteModal')!;
    const yesBtn = document.getElementById('overwriteYes') as HTMLButtonElement;
    const cancelBtn = document.getElementById('overwriteCancel') as HTMLButtonElement;
    const newBtn = document.getElementById('overwriteNewProject') as HTMLButtonElement;
    modal.classList.remove('hidden');
    function cleanup(result: 'yes' | 'cancel' | 'new_project') {
      modal.classList.add('hidden');
      yesBtn.onclick = null;
      cancelBtn.onclick = null;
      newBtn.onclick = null;
      resolve(result);
    }
    yesBtn.onclick = () => cleanup('yes');
    cancelBtn.onclick = () => cleanup('cancel');
    newBtn.onclick = () => cleanup('new_project');
  });
}

export function openTextModal(
  existing: string,
  initialColor: string
): Promise<{ text: string; color: string } | null> {
  return new Promise((resolve) => {
    const modal = document.getElementById('textModal')!;
    const area = document.getElementById('textModalArea') as HTMLTextAreaElement;
    const okBtn = document.getElementById('textModalOk') as HTMLButtonElement;
    const cancelBtn = document.getElementById('textModalCancel') as HTMLButtonElement;
    const colorRow = document.getElementById('textModalColors')!;
    area.value = existing || '';
    let chosenColor = initialColor || '#fff';
    colorRow.innerHTML =
      '<span class="color-label">color</span>' +
      COLORS.map(
        (c) =>
          `<div class="color-dot${chosenColor === c ? ' selected' : ''}" style="background:${c};${
            c === '#ffffff' ? 'border-color:var(--border-strong);' : ''
          }" data-tcolor="${c}"></div>`
      ).join('');
    colorRow.querySelectorAll('[data-tcolor]').forEach((d) =>
      d.addEventListener('click', () => {
        chosenColor = (d as HTMLElement).dataset.tcolor!;
        colorRow
          .querySelectorAll('[data-tcolor]')
          .forEach((x) => x.classList.toggle('selected', (x as HTMLElement).dataset.tcolor === chosenColor));
        // Re-focus the textarea so the user can keep typing after picking a color
        area.focus();
      })
    );
    modal.classList.remove('hidden');
    area.focus();
    function clampTo5Lines() {
      const lines = area.value.split('\n');
      if (lines.length > 5) {
        area.value = lines.slice(0, 5).join('\n');
      }
    }
    function onInput() {
      clampTo5Lines();
    }
    function done(val: { text: string; color: string } | null) {
      modal.classList.add('hidden');
      area.removeEventListener('keydown', onKey);
      area.removeEventListener('input', onInput);
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      resolve(val);
    }
    function onOk() {
      clampTo5Lines();
      done({ text: area.value, color: chosenColor });
    }
    function onCancel() {
      done(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        done(null);
        return;
      }
      if (e.key === 'Enter' && area.value.split('\n').length >= 5) {
        e.preventDefault();
      }
    }
    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    area.addEventListener('keydown', onKey);
    area.addEventListener('input', onInput);
  });
}

/**
 * Single-button notice with a red headline. Used for things the user must
 * read but has no decision to make about — a confirm dialog with OK/Cancel
 * would wrongly imply a choice.
 */
export function showImportantNote(headline: string, body: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,0.75);' +
      'display:flex;align-items:center;justify-content:center;padding:20px;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

    const box = document.createElement('div');
    box.style.cssText =
      'background:#1a1a1a;border-radius:12px;padding:24px;max-width:380px;width:100%;' +
      'color:#fff;text-align:left;';

    const h = document.createElement('div');
    h.textContent = headline;
    h.style.cssText = 'color:#d52632;font-weight:700;font-size:15px;margin-bottom:12px;';
    box.appendChild(h);

    const p = document.createElement('div');
    p.textContent = body;
    p.style.cssText = 'color:#fff;font-size:13px;line-height:1.5;margin-bottom:20px;';
    box.appendChild(p);

    const ok = document.createElement('button');
    ok.textContent = 'GOT IT';
    ok.style.cssText =
      'display:block;width:100%;padding:12px;background:#2a2a2a;border:1px solid #555;' +
      'border-radius:8px;color:#fff;font-size:14px;cursor:pointer;';
    ok.onclick = () => { overlay.remove(); resolve(); };
    box.appendChild(ok);

    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

/**
 * Three-way question about one frame: keep what is on the server, keep the
 * version that was refused, or keep both.
 *
 * Sides are named by device and time — never "mine" and "theirs", which read
 * differently depending on which machine is looking at the question.
 *
 * Resolves with null if `stillOpen` reports the question was answered
 * elsewhere: the dialog closes itself rather than leaving live buttons on a
 * decision that has already been made.
 */
export function showThreeWayConflict(info: {
  frameLabel: string;
  /** Who made this side — frame number + device, shown above the picture. */
  keepWho: string;
  otherWho: string;
  /** When it was changed, shown under the who-line. */
  keepWhen: string;
  otherWhen: string;
  keepSrc: string;
  otherSrc: string;
  madeOffline: boolean;
  stillOpen: () => Promise<boolean>;
}): Promise<'mine' | 'theirs' | 'both' | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.82);' +
      'display:flex;align-items:center;justify-content:center;padding:16px;' +
      'font-family:-apple-system,BlinkMacSystemFont,sans-serif;';

    const card = document.createElement('div');
    card.style.cssText =
      'background:#1a1a1a;border-radius:12px;padding:20px;max-width:640px;width:100%;' +
      'color:#fff;max-height:90vh;overflow-y:auto;';

    const title = document.createElement('div');
    title.textContent = `Frame ${info.frameLabel} was changed in two devices`;
    title.style.cssText = 'font-size:15px;font-weight:600;margin-bottom:4px;';
    card.appendChild(title);

    const sub = document.createElement('div');
    sub.textContent = info.madeOffline
      ? 'One of these was made while offline. Please decide on versions to keep'
      : 'Please decide on versions to keep';
    sub.style.cssText = 'font-size:12px;color:#aaa;margin-bottom:14px;';
    card.appendChild(sub);

    let poll = 0;
    function finish(v: 'mine' | 'theirs' | 'both' | null) {
      window.clearInterval(poll);
      overlay.remove();
      resolve(v);
    }

    // Each choice sits directly UNDER the picture it applies to — a list of
    // buttons below both images makes you work out which is which.
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:12px;margin-bottom:12px;';
    for (const side of [
      { who: info.keepWho, when: info.keepWhen, src: info.keepSrc, value: 'mine' as const },
      { who: info.otherWho, when: info.otherWhen, src: info.otherSrc, value: 'theirs' as const },
    ]) {
      const col = document.createElement('div');
      col.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;';

      // Frame number + device sits ABOVE the picture, with the time under it —
      // you read who made it before you look at what they made.
      const who = document.createElement('div');
      who.textContent = side.who;
      who.style.cssText =
        'font-size:12px;color:#fff;font-weight:600;margin-bottom:2px;' +
        'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      col.appendChild(who);

      const when = document.createElement('div');
      when.textContent = side.when;
      when.style.cssText = 'font-size:11px;color:#aaa;margin-bottom:6px;min-height:14px;';
      col.appendChild(when);

      const img = document.createElement('div');
      img.style.cssText =
        'width:100%;aspect-ratio:16/9;background:#111 center/contain no-repeat;' +
        'border:1px solid #3a3a3a;border-radius:6px;' +
        (side.src ? `background-image:url("${side.src}");` : '');
      col.appendChild(img);

      const pick = document.createElement('button');
      pick.textContent = 'KEEP THIS VERSION';
      pick.style.cssText =
        'width:100%;margin-top:8px;padding:10px;background:#2a2a2a;border:1px solid #555;' +
        'border-radius:8px;color:#fff;font-size:12px;letter-spacing:.04em;cursor:pointer;';
      pick.onmouseenter = () => { pick.style.background = '#3a3a3a'; };
      pick.onmouseleave = () => { pick.style.background = '#2a2a2a'; };
      pick.onclick = () => finish(side.value);
      col.appendChild(pick);

      row.appendChild(col);
    }
    card.appendChild(row);

    const both = document.createElement('button');
    both.textContent = 'KEEP BOTH';
    both.style.cssText =
      'display:block;width:100%;padding:12px;background:#d52632;border:none;' +
      'border-radius:8px;color:#fff;font-size:13px;cursor:pointer;';
    both.onclick = () => finish('both');
    card.appendChild(both);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    // While this is on screen, check whether someone answered it elsewhere.
    poll = window.setInterval(() => {
      void info.stillOpen().then((open) => { if (!open) finish(null); });
    }, 4000);
  });
}

// Imperative modal helpers — they operate on the React-rendered modal markup
// (matching IDs preserved from the original).

import { COLORS } from '../store/state';

export function showToast(msg: string): void {
  const t = document.getElementById('toast')!;
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
}

export function showCamBlockedMsg(): void {
  const m = document.getElementById('camBlockedMsg')!;
  m.classList.add('show');
  m.addEventListener('click', () => m.classList.remove('show'), { once: true });
  setTimeout(() => m.classList.remove('show'), 8000);
}

export function setProgress(pct: number, label: string): void {
  (document.getElementById('progressBar') as HTMLElement).style.width = pct + '%';
  document.getElementById('progressLabel')!.textContent = label;
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
    no.style.background = '#e53935';
    no.style.borderColor = '#e53935';
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
      yes.style.background = '#e53935';
      yes.style.borderColor = '#e53935';
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

// THE ACCOUNT'S STORAGE, AS THE SERVER LAST SAID IT (#533).
//
// Roman, 21 September: the beta has a limit per account (350 MB). The user
// must see it coming — a notice at 80, 90 and 95 % — and see the figure in the
// OPEN modal (grey below 80 %, red from 80 %). When the account is full, the
// app says so ONCE, stops pushing until space is freed, and the project list
// offers "Delete now", which frees a project's space at once.
//
// The figure comes from the server with every push answer and with the
// project list. Nothing here guesses; the number shown is the server's.

import { trace } from './syncTrace';

export interface StorageFigure { used: number; limit: number }

let _figure: StorageFigure | null = null;
let _noticedStep = 0;          // 0, 80, 90 or 95 — the highest step already said
let _full = false;             // the server refused a push: storage full
let _fullSaid = false;         // the full message shown (once per full spell)
let _pendingBytes = 0;         // what the refused push weighs — counted on top of every figure while full
let _onFreed: (() => void) | null = null;

export function storageFigure(): StorageFigure | null { return _figure; }

export function storagePercent(f: StorageFigure = _figure ?? { used: 0, limit: 1 }): number {
  return f.limit > 0 ? Math.round((f.used / f.limit) * 100) : 0;
}

export function mbText(bytes: number): string {
  const mb = bytes / 1048576;
  // One decimal under 10 MB ("1.2"), whole above; never "6.0" — a whole
  // number reads as one ("1", "6", "350").
  return mb < 10 ? mb.toFixed(1).replace(/\.0$/, '') : String(Math.round(mb));
}

/** The line for the OPEN modal: "Storage 280 of 350 MB · 80 %". */
export function storageLineText(f: StorageFigure | null = _figure): string {
  if (!f) return '';
  return `Storage ${mbText(f.used)} of ${mbText(f.limit)} MB · ${storagePercent(f)} %`;
}

/** True from 80 % — the modal draws the line red then. */
export function storageIsHigh(f: StorageFigure | null = _figure): boolean {
  return !!f && storagePercent(f) >= 80;
}

export function isStorageFull(): boolean { return _full; }

/** Called when the retry may go again (after Delete now). */
export function onStorageFreed(fn: () => void): void { _onFreed = fn; }

/**
 * A figure arrived (push answer, list, Delete now). Raises the step notices
 * — once per step, and again only after usage dropped below 80 % and climbed
 * back. Below the limit, a "full" spell is over.
 */
export function noteStorage(f: StorageFigure | undefined | null): void {
  if (!f || typeof f.used !== 'number' || typeof f.limit !== 'number' || f.limit <= 0) return;
  _figure = { used: f.used, limit: f.limit };
  const pct = storagePercent(_figure);
  window.dispatchEvent(new CustomEvent('fh:storage', { detail: _figure }));

  // ROOM AGAIN only when the waiting work fits too (run 308): the server's
  // figure cannot know about the pictures it refused, so a list answer a
  // second after the refusal read 5.9 of 6 MB and was taken for room.
  if (_full && f.used + _pendingBytes < f.limit) {
    _full = false;
    _fullSaid = false;
    trace(`storage: room again — ${mbText(f.used)} of ${mbText(f.limit)} MB (+ ${mbText(_pendingBytes)} MB waiting)`);
    _pendingBytes = 0;
    _onFreed?.();
  } else if (_full) {
    trace(`storage: still full — ${mbText(f.used)} of ${mbText(f.limit)} MB + ${mbText(_pendingBytes)} MB waiting`);
  }

  const step = pct >= 95 ? 95 : pct >= 90 ? 90 : pct >= 80 ? 80 : 0;
  if (step === 0) { _noticedStep = 0; return; }
  if (step <= _noticedStep) return;
  _noticedStep = step;
  const text = `Storage ${pct} % full — ${mbText(f.used)} of ${mbText(f.limit)} MB`;
  trace(`storage: ${text}`);
  void import('./modals').then(({ showToast }) => showToast(text));
}

/**
 * The server refused a push: the account is full. Said once, with the way out
 * (the project list with Delete now); the retry holds until space is freed.
 * The work is safe on the device meanwhile — the caller files the copy.
 */
export function storageFullFromServer(f: (StorageFigure & { pending?: number }) | undefined | null): void {
  if (f) { _figure = { used: f.used, limit: f.limit }; window.dispatchEvent(new CustomEvent('fh:storage', { detail: _figure })); }
  _pendingBytes = Math.max(_pendingBytes, f?.pending ?? 0);
  _full = true;
  _noticedStep = 95;
  if (_fullSaid) return;
  _fullSaid = true;
  trace(`storage FULL — ${_figure ? `${mbText(_figure.used)} of ${mbText(_figure.limit)} MB` : 'no figure'}; pushes wait until a project is deleted`);
  void (async () => {
    const { showImportantNote } = await import('./modals');
    await showImportantNote(
      'STORAGE FULL',
      'The beta version of Framehow has limited storage, and this account is full. ' +
      'Your work stays safe on this device, but it cannot upload until space is freed. ' +
      'Open the project list, press Edit Projects and use DELETE NOW on a project you no longer need — ' +
      'or Delete it first and then DELETE NOW on the greyed row.',
    );
    const { openProjectList } = await import('./accountFlow');
    void openProjectList();
  })();
}

/** For tests and the log: the state in one line. */
export function storageState(): { figure: StorageFigure | null; full: boolean; noticedStep: number } {
  return { figure: _figure, full: _full, noticedStep: _noticedStep };
}

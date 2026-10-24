// FH CAM or PHONE CAM (23 October, Roman, on a fitting).
//
// The in-app camera (FH CAM) shows the frame lines and the exposure live, but
// it gets the browser's plain picture — darker and flatter than people know
// from their phone. PHONE CAM opens the phone's own camera with all its
// picture processing; there are no frame lines while shooting, so the photo
// is either placed in the frame lines afterwards (FRAMELINE LATER, ticked) or
// fills the frame by itself, cut evenly at the edges (unticked).
//
// The choice is remembered on this device. A FITTING starts on PHONE CAM,
// everything else on FH CAM. The same small panel opens from the camera
// screen, from the framing screen after a phone shot, and in Customise — so
// it can always be reached, even when no Framehow screen appears during a
// shot (PHONE CAM with FRAMELINE LATER unticked).

import { state } from '../store/state';
import { trace } from './syncTrace';

export type CamMode = 'fh' | 'phone';

const isFitting = (): boolean => state().projectType === 'fitting';
const modeKey = (): string => (isFitting() ? 'fh_camMode_fitting' : 'fh_camMode');
const LATER_KEY = 'fh_camFramelineLater';

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string): void {
  try { localStorage.setItem(key, v); } catch { /* private mode: not remembered */ }
}

export function getCamMode(): CamMode {
  const v = read(modeKey());
  if (v === 'fh' || v === 'phone') return v;
  return isFitting() ? 'phone' : 'fh';
}
export function setCamMode(m: CamMode): void {
  write(modeKey(), m);
  trace(`camera: ${m === 'phone' ? 'PHONE CAM' : 'FH CAM'} chosen${isFitting() ? ' (fittings)' : ''}`);
}

/** Ticked: after a phone shot the photo comes up in the frame lines to be
 *  placed. Unticked (the default — Roman, 23 Oct: the faster start): it fills
 *  the frame by itself. */
export function getFramelineLater(): boolean {
  // A FITTING never goes through the frame lines (Roman, 23 Oct): the photo
  // always fills the frame by itself.
  if (isFitting()) return false;
  return read(LATER_KEY) === 'yes';
}
export function setFramelineLater(on: boolean): void {
  write(LATER_KEY, on ? 'yes' : 'no');
  trace(`camera: FRAMELINE LATER ${on ? 'on' : 'off'}`);
}

export function camModeLabel(m: CamMode = getCamMode()): string {
  return m === 'phone' ? 'PHONE CAM' : 'FH CAM';
}

/**
 * THE CAMERA MODAL (24 Oct, Roman): FH CAM ◀━━━▶ PHONE CAM, under it
 * FRAMELINE LATER (right), a note while PHONE CAM is chosen, and OK — the
 * only way out. Choosing a side changes nothing but the switch; OK confirms:
 * `onOk` runs with the chosen mode, inside the OK tap (which iOS needs to
 * open its camera).
 */
export function renderCamPanel(host: HTMLElement, onOk: (m: CamMode) => void, onChange?: () => void): void {
  const m = getCamMode();
  const later = getFramelineLater();
  host.innerHTML = `
    <div class="cam-mode-switch${m === 'phone' ? ' is-phone' : ''}" role="radiogroup">
      <span class="cam-mode-knob"></span>
      <button type="button" class="cam-mode-opt${m === 'fh' ? ' active' : ''}" data-cammode="fh">FH CAM</button>
      <button type="button" class="cam-mode-opt${m === 'phone' ? ' active' : ''}" data-cammode="phone">PHONE CAM</button>
    </div>
    <div class="cam-mode-row">
      <label class="cam-mode-later${m === 'phone' ? '' : ' is-off'}"${isFitting() ? ' hidden' : ''}>
        <span>FRAMELINE LATER</span>
        <input type="checkbox" data-camlater${later ? ' checked' : ''}${m === 'phone' ? '' : ' disabled'} />
      </label>
    </div>
    <p class="cam-mode-note"${m === 'phone' ? '' : ' hidden'}>OK opens your phone's camera (4:3, full quality; Framehow cuts the photo to your frame).<br>To change back to the Framehow camera, go to Menu › Cam Set Up.</p>
    <button type="button" class="cam-mode-ok" data-camok>OK</button>`;
  host.querySelectorAll<HTMLButtonElement>('[data-cammode]').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const next = b.dataset.cammode as CamMode;
      if (next === getCamMode()) return;
      setCamMode(next);
      renderCamPanel(host, onOk, onChange);
      onChange?.();
    }));
  const box = host.querySelector<HTMLInputElement>('[data-camlater]');
  box?.addEventListener('click', (e) => e.stopPropagation());
  box?.addEventListener('change', () => { setFramelineLater(!!box.checked); onChange?.(); });
  host.querySelector<HTMLButtonElement>('[data-camok]')!.addEventListener('click', (e) => {
    e.stopPropagation();
    trace(`camera: modal OK — ${camModeLabel()}`);
    onOk(getCamMode());
  });
}

/** Wire a button + its modal (camera screen, framing screen). The button
 *  opens it; only OK closes it. `onMode` runs at OK with the chosen mode. */
export function wireCamModeButton(btn: HTMLElement, panel: HTMLElement, onMode?: (m: CamMode) => void): void {
  const refreshLabel = () => { btn.textContent = camModeLabel(); };
  refreshLabel();
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!panel.classList.contains('hidden')) return;
    renderCamPanel(panel, (m) => { panel.classList.add('hidden'); refreshLabel(); onMode?.(m); }, refreshLabel);
    panel.classList.remove('hidden');
  });
  panel.addEventListener('click', (e) => e.stopPropagation());
  (btn as HTMLElement & { __fhRefresh?: () => void }).__fhRefresh = refreshLabel;
}

/** Shrink a photo for saving: long side at most 2400 px (every pixel of an
 *  iPad screen), high-quality scaling, JPEG at 0.9 (Roman: keep the quality) — under 1 MB
 *  (24 Oct, Roman: "less file size"; was 3000 px, 1–2 MB). `crop` is
 *  the part of the source to keep (in source pixels). */
export function shrinkForSaving(src: CanvasImageSource, sw: number, sh: number,
  crop: { x: number; y: number; w: number; h: number }): string {
  const LONG = 2400;
  const k = Math.min(1, LONG / Math.max(crop.w, crop.h));
  const w = Math.max(1, Math.round(crop.w * k)), h = Math.max(1, Math.round(crop.h * k));
  const cvs = document.createElement('canvas');
  cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  void sw; void sh;
  const url = cvs.toDataURL('image/jpeg', 0.9);
  trace(`camera: photo saved ${w}×${h} · ${(url.length * 0.75 / 1048576).toFixed(1)} MB`);
  return url;
}

/** The part of a w×h photo that fills a frame of ratio `ar`, cut evenly. */
export function fillCrop(w: number, h: number, ar: number): { x: number; y: number; w: number; h: number } {
  if (w / h > ar) { const cw = h * ar; return { x: (w - cw) / 2, y: 0, w: cw, h }; }
  const ch = w / ar; return { x: 0, y: (h - ch) / 2, w, h: ch };
}

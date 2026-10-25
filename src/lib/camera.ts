// Camera (live viewfinder + native fallback) + crop UI.
// All functions match original IDs (#cameraOverlay, #cameraVideo, #cropOverlay, ...)
// rendered by React.

import { state, useStore, CAM_RATIOS, FITTING_RATIOS, PORTRAIT_RATIOS } from '../store/state';
import type { CamRatioKey } from '../store/state';
import { showToast, showCamBlockedMsg } from './modals';
import { fhTrack } from './tracking';
import { trace } from './syncTrace';
import { resetToolbarState, captureFrameAnchor } from './view';
import { flushSyncNow } from './currentProject';
import { getCamMode, getFramelineLater, wireCamModeButton, shrinkForSaving, fillCrop, loadPhoneShot } from './camMode';
import type { PhoneShot } from './camMode';
import { buildToneLUT, applyLUT, satFor } from './camLook';
import { makeGpuViewfinder } from './camGpu';
import type { GpuViewfinder } from './camGpu';

let cameraStream: MediaStream | null = null;
let cameraFacing: 'environment' | 'user' = 'environment';
let cameraTarget: any = null;
let cropState: any = null;
/** This shot goes through the PHONE's own camera (23 Oct). */
let phoneShot = false;

export interface CameraTarget {
  fid: number;
  div: HTMLElement;
  aspectRatio: number;
  fromCompare: boolean;
  fromMain: boolean;
  stripType?: string;
}

// Lazily-bound applyCapturedImage so this module stays free of core-renderer deps.
let onCapturedImage: ((dataURL: string, target: CameraTarget) => void) | null = null;
export function setOnCapturedImage(fn: (dataURL: string, target: CameraTarget) => void): void {
  onCapturedImage = fn;
}

/** Aspect ratio of the frame's own canvas (the 'canvas' preset). */
function canvasAspectRatio(fid: number): number {
  const f = state().frames.find((fr) => fr.id === fid);
  return f && f.cropW && f.cropH ? f.cropW / f.cropH : 16 / 9;
}

/** Effective guide aspect ratio — resolves the saved preset against the frame canvas. */
function effectiveAspectRatio(fid: number): number {
  const key = state().camAspectRatio || 'canvas';
  if (state().projectType === 'fitting') {
    // A fitting knows only its three; anything else means ONE PERSON (the default).
    const f = FITTING_RATIOS.find((r) => r.key === key) || FITTING_RATIOS[0];
    return f.value;   // 0 = the photo's own shape (GROUP PHOTO)
  }
  const list = state().projectType === 'portrait' ? PORTRAIT_RATIOS : CAM_RATIOS;
  const preset = list.find((r) => r.key === key);
  if (preset && preset.value != null) return preset.value;
  return canvasAspectRatio(fid);
}

/** The guide's shape where a concrete number is needed: GROUP PHOTO (0) is
 *  the photo's own shape when there is a photo, else the phone's upright 3:4. */
function guideRatio(ar: number, photoW?: number, photoH?: number): number {
  if (ar > 0) return ar;
  return photoW && photoH ? photoW / photoH : 3 / 4;
}

export async function openCamera(
  fid: number,
  div: HTMLElement,
  fromCompare: boolean,
  fromMain: boolean,
  strip: string = 'ver',
  setup = false,
): Promise<void> {
  fhTrack('camera_opened');
  const ar = effectiveAspectRatio(fid);
  cameraTarget = { fid, div, aspectRatio: ar, fromCompare: !!fromCompare, fromMain: !!fromMain, stripType: strip };

  // PHONE CAM (23 Oct): the phone's own camera, opened INSIDE this tap — iOS
  // opens its camera only from a tap, so nothing may be waited for first.
  // CAM SET UP always shows the Framehow camera, whatever is chosen.
  if (!setup && getCamMode() === 'phone') { openPhoneCamera(); return; }
  phoneShot = false;

  let hasCamera = false;
  let camBlocked = false;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const t0 = Date.now();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      hasCamera = true;
      // What the phone actually gives (24 Oct): we ask for 4K and never for a
      // frame rate; this says what came back.
      try {
        const st = cameraStream.getVideoTracks()[0]?.getSettings();
        if (st) trace(`camera: stream ${st.width}×${st.height} at ${st.frameRate ? Math.round(st.frameRate) : '?'} fps`);
      } catch { /* */ }
    } catch (e: any) {
      hasCamera = false;
      if (e.name === 'NotAllowedError' && Date.now() - t0 < 500) camBlocked = true;
    }
  }

  if (hasCamera) {
    document.getElementById('cameraOverlay')!.classList.remove('hidden');
    (document.getElementById('cameraModeBtn') as (HTMLElement & { __fhRefresh?: () => void }) | null)?.__fhRefresh?.();
    const vid = document.getElementById('cameraVideo') as HTMLVideoElement;
    vid.srcObject = cameraStream;
    setupPinchZoom(vid);
    const posGuide = () => positionCameraGuide(ar);
    // Force layout flush, then position. iPad Safari sometimes reports
    // clientWidth=0 immediately after toggling display:none → flex.
    void document.getElementById('cameraVideoWrap')!.offsetHeight;
    requestAnimationFrame(() => {
      requestAnimationFrame(posGuide);
    });
    vid.addEventListener('playing', posGuide, { once: true });
    vid.addEventListener('loadedmetadata', posGuide, { once: true });
    [50, 150, 300, 600, 1000, 1500].forEach((d) => setTimeout(posGuide, d));
    if (setup) document.getElementById('cameraModeBtn')?.click();   // the panel opens by itself
  } else if (camBlocked) {
    showCamBlockedMsg();
  } else {
    (document.getElementById('camFallbackInput') as HTMLInputElement).click();
  }
}

/** CAM SET UP from the Menu (23 Oct, Roman): the camera exactly as always,
 *  opened on the card in the middle of the screen — the shutter works and the
 *  photo goes onto that card as a new look — with the FH CAM / PHONE CAM
 *  panel already open. The way back from PHONE CAM. */
export async function openCameraSetup(): Promise<void> {
  const s = state();
  if (!s.frames.length) { showToast('Open or make a project first'); return; }
  const anchor = captureFrameAnchor();
  const fid = anchor ? Number(anchor.fid) : s.frames[0].id;
  const div = (document.querySelector(`.frame-card[data-vfid="${fid}"]`)
    || document.querySelector(`.frame-card[data-mfid="${fid}"]`)
    || document.querySelector(`.grid3x2-card-wrap[data-g3fid="${fid}"]`)) as HTMLElement | null;
  if (!div) { showToast('Open or make a project first'); return; }
  trace(`Cam Set Up: opened on shot ${s.frames.findIndex((f) => f.id === fid) + 1}`);
  await openCamera(fid, div, false, false, 'ver', true);
}

/** Open the phone's own camera for the current target. */
function openPhoneCamera(): void {
  phoneShot = true;
  (document.getElementById('camFallbackInput') as HTMLInputElement).click();
}

/** PHONE CAM with FRAMELINE LATER unticked: the photo fills the frame by
 *  itself, cut evenly at the edges, and goes straight onto the card. */
function placePhoneShotByItself(shot: PhoneShot): void {
  const target = cameraTarget;
  if (!target) return;
  const crop = fillCrop(shot.w, shot.h, guideRatio(target.aspectRatio, shot.w, shot.h));
  const url = shrinkForSaving(shot.src, shot.w, shot.h, crop);
  shot.release();
  if (onCapturedImage) onCapturedImage(url, target);
}

export function positionCameraGuide(ar: number): void {
  ar = guideRatio(ar);
  const wrap = document.getElementById('cameraVideoWrap')!;
  const guide = document.getElementById('cameraGuide')!;
  const ww = wrap.clientWidth,
    wh = wrap.clientHeight;
  // If layout hasn't settled yet (iPad Safari can return 0 right after
  // display:none → flex), retry on the next frame.
  if (ww === 0 || wh === 0) {
    requestAnimationFrame(() => positionCameraGuide(ar));
    return;
  }
  let gw, gh;
  if (ar > ww / wh) {
    gw = ww;
    gh = gw / ar;
  } else {
    gh = wh;
    gw = gh * ar;
  }
  guide.style.width = Math.round(gw) + 'px';
  guide.style.height = Math.round(gh) + 'px';
  guide.style.left = Math.round((ww - gw) / 2) + 'px';
  guide.style.top = Math.round((wh - gh) / 2) + 'px';
  positionExpSlider();
}

export function captureFromViewfinder(): void {
  if (!cameraTarget) return;
  // PHONE CAM chosen in this screen: the shutter hands over to the phone's own
  // camera — inside this tap, which iOS needs.
  if (getCamMode() === 'phone') { closeCamera(); openPhoneCamera(); return; }
  if (!cameraStream) return;
  fhTrack('photo_taken');
  const video = document.getElementById('cameraVideo') as HTMLVideoElement;
  const guide = document.getElementById('cameraGuide')!;
  const wrap = document.getElementById('cameraVideoWrap')!;
  const vw = video.videoWidth,
    vh = video.videoHeight;
  const ww = wrap.clientWidth,
    wh = wrap.clientHeight;
  const vidAR = vw / vh,
    wrapAR = ww / wh;
  let sx, sy, sw, sh;
  if (vidAR > wrapAR) {
    sh = vh;
    sw = vh * wrapAR;
    sx = (vw - sw) / 2;
    sy = 0;
  } else {
    sw = vw;
    sh = vw / wrapAR;
    sx = 0;
    sy = (vh - sh) / 2;
  }
  const gl = parseInt(guide.style.left) / ww,
    gt = parseInt(guide.style.top) / wh;
  const gwr = parseInt(guide.style.width) / ww,
    ghr = parseInt(guide.style.height) / wh;
  let cropX = sx + gl * sw,
    cropY = sy + gt * sh,
    cropW = gwr * sw,
    cropH = ghr * sh;
  // DIGITAL ZOOM (#508): the picture on screen is scaled up around its centre,
  // so the snap takes the same smaller, centred part of the frame. When the
  // camera zooms itself the frames arrive zoomed and nothing is done here.
  if (_zoomMode === 'digital' && _zoom > 1) {
    const cx = cropX + cropW / 2, cy = cropY + cropH / 2;
    cropW /= _zoom; cropH /= _zoom;
    cropX = cx - cropW / 2; cropY = cy - cropH / 2;
  }
  const c = document.createElement('canvas');
  c.width = Math.round(cropW); c.height = Math.round(cropH);
  const cctx = c.getContext('2d', { willReadFrequently: true })!;
  cctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, c.width, c.height);
  const expR = document.getElementById('expRange') as HTMLInputElement;
  const ev = expR ? +expR.value / 100 : 0;
  trace(`camera: shot from a ${vw}×${vh} stream, crop ${Math.round(cropW)}×${Math.round(cropH)}`);
  // THE SAME TABLE AS THE VIEWFINDER, in one pass; nothing else is done to
  // the photo (24 Oct, Roman: no post-processing — it must land at once).
  {
    const img = cctx.getImageData(0, 0, c.width, c.height);
    applyLUT(img.data, buildToneLUT(ev), satFor(ev));
    cctx.putImageData(img, 0, 0);
  }
  // SAVED LIKE A PHONE PHOTO: long side 3000 at most (a 4K crop would be
  // 2–4 MB each); the log says the size.
  const url = shrinkForSaving(c, c.width, c.height, { x: 0, y: 0, w: c.width, h: c.height });
  if (onCapturedImage && cameraTarget) onCapturedImage(url, cameraTarget);
  closeCamera();
}

export function closeCamera(): void {
  teardownPinchZoom();
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  useStore.setState({ scrollHideGuard: Date.now() + 1500 });
  // Force all bars visible after capture (resetToolbarState would hide them if scrollY > 10)
  const toolbar = document.getElementById('mainToolbar');
  const viewBar = document.querySelector('.view-bar');
  const detailBar = document.getElementById('detailBar');
  if (toolbar) toolbar.classList.remove('tb-hide');
  if (viewBar) viewBar.classList.remove('tb-hide');
  if (detailBar) detailBar.classList.remove('tb-hide');
  document.getElementById('cameraOverlay')!.classList.add('hidden');
  document.getElementById('cameraRatioMenu')?.classList.add('hidden');
  document.getElementById('cameraModeMenu')?.classList.add('hidden');
  const vid = document.getElementById('cameraVideo') as HTMLVideoElement;
  vid.srcObject = null;
  vid.style.filter = '';
  const expR = document.getElementById('expRange') as HTMLInputElement;
  if (expR) expR.value = '0';
}

export function getCameraTarget(): any {
  return cameraTarget;
}
export function clearCameraTarget(): void {
  cameraTarget = null;
}

export function _camRepos(): void {
  if (cameraTarget && cameraStream) positionCameraGuide(cameraTarget.aspectRatio);
}
function _camReposDelayed(): void {
  _camRepos();
  setTimeout(_camRepos, 100);
  setTimeout(_camRepos, 300);
  setTimeout(_camRepos, 600);
}

export function positionExpSlider(): void {
  const wrap = document.getElementById('cameraVideoWrap');
  const sl = document.getElementById('expWrap');
  const guide = document.getElementById('cameraGuide');
  if (!wrap || !sl || !guide) return;
  const gt = parseInt((guide as HTMLElement).style.top) || 0;
  const gl = parseInt((guide as HTMLElement).style.left) || 0;
  const gh = parseInt((guide as HTMLElement).style.height) || wrap.clientHeight * 0.7;
  const gw = parseInt((guide as HTMLElement).style.width) || wrap.clientWidth * 0.8;
  const sliderLen = Math.round(gh * 0.9);
  (sl as HTMLElement).style.height = sliderLen + 'px';
  (sl as HTMLElement).style.top = Math.round(gt + gh / 2 - sliderLen / 2) + 'px';
  (sl as HTMLElement).style.left = Math.round(gl + gw * 0.95 - 20) + 'px';
  (sl as HTMLElement).style.right = 'auto';
  (sl.querySelector('input[type=range]') as HTMLInputElement).style.width = sliderLen + 'px';
}

/** Render the RATIO dropdown menu with the current selection marked. */
function renderRatioMenu(menuId = 'cameraRatioMenu', onPick?: () => void): void {
  const menu = document.getElementById(menuId);
  if (!menu) return;
  const cur = state().camAspectRatio || 'canvas';
  const kind = state().projectType;
  const list = kind === 'fitting' ? FITTING_RATIOS : kind === 'portrait' ? PORTRAIT_RATIOS : CAM_RATIOS;
  menu.innerHTML = list.map(
    (r) =>
      `<button class="camera-ratio-item${r.key === cur ? ' active' : ''}" data-ratio="${r.key}">${r.label}</button>`
  ).join('');
  menu.querySelectorAll('.camera-ratio-item').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const key = (btn as HTMLElement).dataset.ratio as CamRatioKey;
      useStore.setState({ camAspectRatio: key });
      menu.classList.add('hidden');
      // Recompute guide with the new ratio
      if (cameraTarget) {
        cameraTarget.aspectRatio = effectiveAspectRatio(cameraTarget.fid);
        if (onPick) onPick(); else positionCameraGuide(cameraTarget.aspectRatio);
      }
      void flushSyncNow();
    });
  });
}

// Wire camera button events + viewfinder exposure rendering.
export function wireCameraEvents(): void {
  document.getElementById('cameraSnap')!.addEventListener('click', captureFromViewfinder);

  // RATIO button — toggle the preset menu
  const ratioBtn = document.getElementById('cameraRatioBtn');
  const ratioMenu = document.getElementById('cameraRatioMenu');
  if (ratioBtn && ratioMenu) {
    ratioBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (ratioMenu.classList.contains('hidden')) {
        renderRatioMenu();
        ratioMenu.classList.remove('hidden');
      } else {
        ratioMenu.classList.add('hidden');
      }
    });
    // Close menu when tapping elsewhere in the viewfinder
    document.getElementById('cameraVideoWrap')?.addEventListener('click', () => {
      ratioMenu.classList.add('hidden');
    });
  }
  document.getElementById('cameraCancel')!.addEventListener('click', () => {
    const fid = cameraTarget && cameraTarget.fid;
    closeCamera();
    cameraTarget = null;
    useStore.setState({ overviewAction: false });
    if (fid) {
      useStore.setState({ centerFid: String(fid) });
    }
  });
  document.getElementById('cameraFlip')!.addEventListener('click', async () => {
    cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
    if (cameraStream) {
      cameraStream.getTracks().forEach((t) => t.stop());
    }
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 3840 }, height: { ideal: 2160 } },
        audio: false,
      });
      const vid = document.getElementById('cameraVideo') as HTMLVideoElement;
      vid.srcObject = cameraStream;
      if (cameraTarget) {
        const posGuide = () => positionCameraGuide(cameraTarget.aspectRatio);
        vid.addEventListener('playing', posGuide, { once: true });
        vid.addEventListener('loadedmetadata', posGuide, { once: true });
        setTimeout(posGuide, 300);
        setTimeout(posGuide, 800);
      }
    } catch {}
  });

  window.addEventListener('resize', _camReposDelayed);
  window.addEventListener('orientationchange', _camReposDelayed);
  if (screen.orientation) screen.orientation.addEventListener('change', _camReposDelayed);

  window.addEventListener('resize', positionExpSlider);
  window.addEventListener('orientationchange', () => {
    positionExpSlider();
    setTimeout(positionExpSlider, 100);
    setTimeout(positionExpSlider, 300);
    setTimeout(positionExpSlider, 600);
  });
  if (screen.orientation)
    screen.orientation.addEventListener('change', () => {
      positionExpSlider();
      setTimeout(positionExpSlider, 100);
      setTimeout(positionExpSlider, 300);
    });

  // THE VIEWFINDER (24 Oct): yesterday's curve painted onto a copy of the
  // video at screen size, every frame — and the video itself hidden under it,
  // so nothing can show through at the edges (the 4K flicker of 035).
  (function () {
    const rangeEl = document.getElementById('expRange') as HTMLInputElement;
    const vid = document.getElementById('cameraVideo') as HTMLVideoElement;
    let evNow = 0, lut = buildToneLUT(0), satMul = 1, rafId: number | null = null;
    let canvas: HTMLCanvasElement | null = null, ctx: CanvasRenderingContext2D | null = null, half: HTMLCanvasElement | null = null;
    function ensureCanvas() {
      if (canvas) return;
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;';
      vid.insertAdjacentElement('afterend', canvas);
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (canvas) canvas.style.display = 'none';
      if (gpu) gpu.canvas.style.display = 'none';
      vid.style.visibility = '';
    }
    // THE VIEWFINDER PACES ITSELF (25 Oct, Roman: the iPad stuttered after the
    // two-step shrink of 040). Each frame is timed; when frames take too long
    // the effort drops — first the single-step shrink, then a smaller copy —
    // and the log says the real frames per second, once, after the start.
    let effort = 2;                 // 2 = two steps at 1280, 1 = one step at 1280, 0 = one step at 960
    let slowFrames = 0, frames = 0, firstAt = 0, reported = false, lastAt = 0, longestGap = 0;
    // THE GRAPHICS CHIP FIRST (25 Oct): the same table, drawn by a shader —
    // no 4K frame is copied out. Where that is not available, or it fails,
    // the painter below does it the old way.
    let gpu: GpuViewfinder | null | undefined;   // undefined = not tried yet
    let gpuLutStale = true;
    function ensureGpu(): GpuViewfinder | null {
      if (gpu !== undefined) return gpu;
      gpu = makeGpuViewfinder();
      if (gpu) {
        gpu.canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;';
        vid.insertAdjacentElement('afterend', gpu.canvas);
      } else trace('camera: no graphics-chip viewfinder here — painting the old way');
      return gpu;
    }
    function renderFrame() {
      if (!cameraStream) { stop(); return; }
      const vw = vid.videoWidth, vh = vid.videoHeight;
      if (vw === 0 || vh === 0) { rafId = requestAnimationFrame(renderFrame); return; }
      const g = ensureGpu();
      if (g) {
        const t0 = performance.now();
        if (!firstAt) firstAt = t0;
        if (lastAt && t0 - lastAt > longestGap) longestGap = t0 - lastAt;
        lastAt = t0;
        if (gpuLutStale) { g.setLUT(lut, satMul); gpuLutStale = false; }
        // Drawn at the stream's own size: the chip does not mind 4K.
        if (g.draw(vid, vw, vh)) {
          if (g.canvas.style.transform !== vid.style.transform) g.canvas.style.transform = vid.style.transform;
          if (g.canvas.style.display !== 'block') { g.canvas.style.display = 'block'; vid.style.visibility = 'hidden'; }
          frames++;
          if (!reported && t0 - firstAt > 4000) {
            reported = true;
            trace(`camera: viewfinder ${Math.round(frames / ((t0 - firstAt) / 1000))} fps on the graphics chip, ${vw}×${vh} · longest pause ${Math.round(longestGap)} ms`);
          }
          rafId = requestAnimationFrame(renderFrame);
          return;
        }
        // The chip refused this frame: fall back to the painter for good.
        g.canvas.style.display = 'none'; g.dispose(); gpu = null;
        trace('camera: graphics-chip viewfinder failed — painting the old way');
      }
      ensureCanvas();
      const t0 = performance.now();
      if (!firstAt) firstAt = t0;
      if (lastAt && t0 - lastAt > longestGap) longestGap = t0 - lastAt;   // a pause between frames: something else held the phone
      lastAt = t0;
      // At screen size, not stream size: a 4K frame is 8 million pixels.
      const k = Math.min(1, (effort === 0 ? 960 : 1280) / Math.max(vw, vh));
      const cw = Math.round(vw * k), ch = Math.round(vh * k);
      if (canvas!.width !== cw || canvas!.height !== ch) { canvas!.width = cw; canvas!.height = ch; }
      // Shrunk in two careful steps (halve, then to size), smoothing on:
      // one rough step shimmered on fine patterns (moiré, 24 Oct).
      ctx!.imageSmoothingEnabled = true; ctx!.imageSmoothingQuality = effort === 2 ? 'high' : 'medium';
      if (effort === 2 && k < 0.5) {
        const hw = Math.round(vw / 2), hh = Math.round(vh / 2);
        if (!half) half = document.createElement('canvas');
        if (half.width !== hw || half.height !== hh) { half.width = hw; half.height = hh; }
        const hctx = half.getContext('2d')!;
        hctx.imageSmoothingEnabled = true; hctx.imageSmoothingQuality = 'high';
        hctx.drawImage(vid, 0, 0, hw, hh);
        ctx!.drawImage(half, 0, 0, cw, ch);
      } else {
        ctx!.drawImage(vid, 0, 0, cw, ch);
      }
      const img = ctx!.getImageData(0, 0, cw, ch);
      applyLUT(img.data, lut, satMul);
      ctx!.putImageData(img, 0, 0);
      // The digital zoom scales the video element; the copy follows it.
      if (canvas!.style.transform !== vid.style.transform) canvas!.style.transform = vid.style.transform;
      if (canvas!.style.display !== 'block') { canvas!.style.display = 'block'; vid.style.visibility = 'hidden'; }
      const took = performance.now() - t0;
      frames++;
      // Over 24 ms a frame cannot keep 30 a second; five such in a row and the
      // effort drops a notch (it never climbs back within one camera session).
      if (took > 24) { if (++slowFrames >= 5 && effort > 0) { effort--; slowFrames = 0; trace(`camera: viewfinder effort down to ${effort} (${Math.round(took)} ms a frame)`); } }
      else slowFrames = 0;
      if (!reported && t0 - firstAt > 4000) {
        reported = true;
        trace(`camera: viewfinder ${Math.round(frames / ((t0 - firstAt) / 1000))} fps at effort ${effort}, ${cw}×${ch} · a frame takes ${Math.round(took)} ms · longest pause ${Math.round(longestGap)} ms`);
      }
      rafId = requestAnimationFrame(renderFrame);
    }
    const start = () => { if (!rafId) { frames = 0; firstAt = 0; lastAt = 0; longestGap = 0; reported = false; rafId = requestAnimationFrame(renderFrame); } };
    rangeEl.addEventListener('input', function () {
      evNow = +(this as HTMLInputElement).value / 100;
      lut = buildToneLUT(evNow); satMul = satFor(evNow); gpuLutStale = true;
      start();
    });
    new MutationObserver(() => {
      const hidden = document.getElementById('cameraOverlay')!.classList.contains('hidden');
      if (hidden) {
        evNow = 0; rangeEl.value = '0'; lut = buildToneLUT(0); satMul = 1; gpuLutStale = true;
        stop();
      } else {
        // Overlay just opened — re-position guide + slider once layout settles.
        if (cameraTarget) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => positionCameraGuide(cameraTarget.aspectRatio));
          });
        }
        positionExpSlider();
        setTimeout(positionExpSlider, 300);
        setTimeout(positionExpSlider, 600);
        start();
      }
    }).observe(document.getElementById('cameraOverlay')!, { attributes: true, attributeFilter: ['class'] });
  })();

  // Native-camera fallback → crop UI
  document.getElementById('camFallbackInput')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !cameraTarget) return;
    const byItself = phoneShot && !getFramelineLater();
    phoneShot = false;
    trace(`camera: phone handed over the photo · ${(file.size / 1048576).toFixed(1)} MB`);
    void loadPhoneShot(file).then((shot) => {
      if (!cameraTarget) { shot.release(); return; }
      if (byItself) placePhoneShotByItself(shot); else openCropUI(shot);
    }).catch(() => showToast('Could not read the photo'));
    (e.target as HTMLInputElement).value = '';
  });

  // FH CAM / PHONE CAM (23 Oct): the button next to RATIO, and the same one on
  // the framing screen. Choosing PHONE CAM in the camera screen switches at
  // once, inside the same tap.
  {
    const btn = document.getElementById('cameraModeBtn');
    const panel = document.getElementById('cameraModeMenu');
    // Sliding to PHONE CAM only remembers it (Roman, 23 Oct: "no time to tick
    // frameline later"); the SHUTTER then shoots with the chosen camera.
    // OK with PHONE CAM chosen opens the phone's camera in that tap (24 Oct).
    if (btn && panel) wireCamModeButton(btn, panel, (m) => { if (m === 'phone') { closeCamera(); openPhoneCamera(); } });
    const cbtn = document.getElementById('cropModeBtn');
    const cpanel = document.getElementById('cropModeMenu');
    if (cbtn && cpanel) wireCamModeButton(cbtn, cpanel);
  }

  // RATIO on the framing screen too (25 Oct, Roman): the frame lines change
  // and the photo is laid out again, fitting the new lines.
  {
    const rbtn = document.getElementById('cropRatioBtn');
    const rmenu = document.getElementById('cropRatioMenu');
    if (rbtn && rmenu) {
      rbtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (rmenu.classList.contains('hidden')) {
          renderRatioMenu('cropRatioMenu', () => { if (cropState) layoutCrop(); });
          rmenu.classList.remove('hidden');
        } else rmenu.classList.add('hidden');
      });
      document.getElementById('cropArea')?.addEventListener('click', () => rmenu.classList.add('hidden'));
    }
  }

  document.getElementById('cropConfirm')!.addEventListener('click', () => {
    if (!cropState || !cameraTarget) return;
    const s = cropState;
    const srcX = (s.guideL - s.x) / s.scale;
    const srcY = (s.guideT - s.y) / s.scale;
    const srcW = s.guideW / s.scale;
    const srcH = s.guideH / s.scale;
    const img = document.getElementById('cropImg') as HTMLImageElement;
    // Kept sharp, but not at the phone's full size (23 Oct). The quick-decoded
    // copy is used when there is one (25 Oct): its pixels are already few.
    const src = cropShot?.src ?? img, sw = cropShot?.w ?? img.naturalWidth, sh = cropShot?.h ?? img.naturalHeight;
    const k = sw / img.naturalWidth;
    const url = shrinkForSaving(src, sw, sh, { x: srcX * k, y: srcY * k, w: srcW * k, h: srcH * k });
    if (onCapturedImage) onCapturedImage(url, cameraTarget);
    closeCropUI();
  });

  document.getElementById('cropCancel')!.addEventListener('click', () => {
    closeCropUI();
    cameraTarget = null;
    useStore.setState({ overviewAction: false });
  });
}

let cropShot: PhoneShot | null = null;

/** The frame lines and the photo's starting place on the framing screen
 *  (25 Oct, Roman — it came up zoomed in a fifth); pinch or drag from there.
 *  Also run again when RATIO changes the frame lines. */
function layoutCrop(): void {
  const area = document.getElementById('cropArea')! as HTMLElement;
  const img = document.getElementById('cropImg') as HTMLImageElement;
  const guide = document.getElementById('cropGuide')! as HTMLElement;
  const nw = img.naturalWidth, nh = img.naturalHeight;
  const aw = area.clientWidth, ah = area.clientHeight;
  const ar = guideRatio(cameraTarget.aspectRatio, nw, nh);
  // On a phone the frame lines fill the screen on their long side (25 Oct) —
  // the photo's long side matches them, so a sideways phone shows the photo
  // edge to edge. The iPad keeps its margin.
  const phone = Math.min(window.innerWidth, window.innerHeight) <= 430;
  const fill = phone ? 1 : 0.84;
  let gw, gh;
  if (ar > aw / ah) { gw = aw * fill; gh = gw / ar; }
  else { gh = ah * fill; gw = gh * ar; }
  guide.style.width = Math.round(gw) + 'px';
  guide.style.height = Math.round(gh) + 'px';
  guide.style.left = Math.round((aw - gw) / 2) + 'px';
  guide.style.top = Math.round((ah - gh) / 2) + 'px';
  // THE PHOTO'S LONG SIDE = THE FRAME'S LONG SIDE (25 Oct, Roman): a portrait
  // photo in a landscape frame is as tall as the frame is wide, centred, black
  // at the sides. Pinching out goes as far as the whole photo inside the lines.
  const sc = Math.max(gw, gh) / Math.max(nw, nh);
  const ix = (aw - nw * sc) / 2, iy = (ah - nh * sc) / 2;
  cropState = {
    ...(cropState || {}),
    naturalW: nw, naturalH: nh, x: ix, y: iy, scale: sc, aspectRatio: ar,
    minScale: Math.min(sc, Math.min(gw / nw, gh / nh)), areaW: aw, areaH: ah,
    guideL: (aw - gw) / 2, guideT: (ah - gh) / 2, guideW: gw, guideH: gh,
  };
  applyCropTransform();
}

export function openCropUI(shot: PhoneShot): void {
  const overlay = document.getElementById('cropOverlay')!;
  const area = document.getElementById('cropArea')! as HTMLElement;
  const img = document.getElementById('cropImg') as HTMLImageElement;
  overlay.classList.remove('hidden');
  (document.getElementById('cropModeBtn') as (HTMLElement & { __fhRefresh?: () => void }) | null)?.__fhRefresh?.();
  document.getElementById('cropModeMenu')?.classList.add('hidden');
  document.getElementById('cropRatioMenu')?.classList.add('hidden');
  cropShot?.release();
  cropShot = shot;

  img.onload = () => {
    cropState = null;
    layoutCrop();

    let startTouches: any = null,
      startX = 0,
      startY = 0,
      startScale = 0,
      startDist = 0;

    function pointerDown(e: any) {
      e.preventDefault();
      if (e.touches && e.touches.length === 2) {
        startDist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        startScale = cropState.scale;
        startX = cropState.x;
        startY = cropState.y;
        startTouches = [
          { x: e.touches[0].clientX, y: e.touches[0].clientY },
          { x: e.touches[1].clientX, y: e.touches[1].clientY },
        ];
      } else {
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        startX = cropState.x;
        startY = cropState.y;
        startTouches = [{ x: cx, y: cy }];
      }
    }
    function pointerMove(e: any) {
      if (!startTouches) return;
      e.preventDefault();
      if (e.touches && e.touches.length === 2 && startTouches.length === 2) {
        const dist = Math.hypot(
          e.touches[0].clientX - e.touches[1].clientX,
          e.touches[0].clientY - e.touches[1].clientY
        );
        const newScale = Math.max(cropState.minScale, startScale * (dist / startDist));
        const mcx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        const mcy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        const smcx = (startTouches[0].x + startTouches[1].x) / 2;
        const smcy = (startTouches[0].y + startTouches[1].y) / 2;
        cropState.scale = newScale;
        cropState.x = startX + (mcx - smcx);
        cropState.y = startY + (mcy - smcy);
      } else {
        const cx = e.touches ? e.touches[0].clientX : e.clientX;
        const cy = e.touches ? e.touches[0].clientY : e.clientY;
        cropState.x = startX + (cx - startTouches[0].x);
        cropState.y = startY + (cy - startTouches[0].y);
      }
      clampCrop();
      applyCropTransform();
    }
    function pointerUp() {
      startTouches = null;
    }

    (area as any).onmousedown = pointerDown;
    (area as any).onmousemove = pointerMove;
    (area as any).onmouseup = pointerUp;
    (area as any).onmouseleave = pointerUp;
    (area as any).ontouchstart = pointerDown;
    (area as any).ontouchmove = pointerMove;
    (area as any).ontouchend = pointerUp;
    (area as any).ontouchcancel = pointerUp;
  };
  img.src = shot.url;
  if (img.complete && img.naturalWidth) img.onload!(new Event('load'));
}

function clampCrop(): void {
  if (!cropState) return;
  const s = cropState,
    iw = s.naturalW * s.scale,
    ih = s.naturalH * s.scale;
  if (s.x > s.guideL) s.x = s.guideL;
  if (s.y > s.guideT) s.y = s.guideT;
  if (s.x + iw < s.guideL + s.guideW) s.x = s.guideL + s.guideW - iw;
  if (s.y + ih < s.guideT + s.guideH) s.y = s.guideT + s.guideH - ih;
}

function applyCropTransform(): void {
  if (!cropState) return;
  const img = document.getElementById('cropImg') as HTMLImageElement;
  img.style.left = cropState.x + 'px';
  img.style.top = cropState.y + 'px';
  img.style.width = cropState.naturalW * cropState.scale + 'px';
  img.style.height = cropState.naturalH * cropState.scale + 'px';
}

function closeCropUI(): void {
  document.getElementById('cropOverlay')!.classList.add('hidden');
  const area = document.getElementById('cropArea')! as any;
  area.onmousedown = area.onmousemove = area.onmouseup = area.onmouseleave = null;
  area.ontouchstart = area.ontouchmove = area.ontouchend = area.ontouchcancel = null;
  cropState = null;
  cropShot?.release();
  cropShot = null;
  (document.getElementById('cropImg') as HTMLImageElement).removeAttribute('src');
}


// ---------------------------------------------------------------------------
// TWO-FINGER PINCH TO ZOOM (#508). Roman, 10 September.
//
// 1× to 4×. Where the camera can zoom itself (iPhone and iPad on a recent
// iOS report a `zoom` capability) the real camera zoom is used — better
// picture. Otherwise the video is scaled up on screen around its centre and
// the snap crops the same part (see captureFromViewfinder). Every opening
// starts at 1×; a small badge says the level while zoomed.
// ---------------------------------------------------------------------------
let _zoom = 1;
let _zoomMode: 'camera' | 'digital' = 'digital';
let _zoomRange: { min: number; max: number } = { min: 1, max: 4 };
let _pinchStartDist = 0;
let _pinchStartZoom = 1;
let _pinchWrap: HTMLElement | null = null;
let _pinchHandlers: { start: (e: TouchEvent) => void; move: (e: TouchEvent) => void; end: () => void } | null = null;

function zoomBadge(): HTMLElement {
  let b = document.getElementById('cameraZoomBadge');
  if (!b) {
    b = document.createElement('div');
    b.id = 'cameraZoomBadge';
    b.style.cssText = 'position:absolute;top:10px;left:50%;transform:translateX(-50%);z-index:3;' +
      'background:rgba(0,0,0,.55);color:#fff;font:600 12px -apple-system,sans-serif;' +
      'padding:3px 9px;border-radius:12px;pointer-events:none;display:none;';
    document.getElementById('cameraVideoWrap')?.appendChild(b);
  }
  return b;
}

function applyZoom(z: number, vid: HTMLVideoElement): void {
  _zoom = Math.max(_zoomRange.min, Math.min(_zoomRange.max, z));
  if (_zoomMode === 'camera' && cameraStream) {
    const track = cameraStream.getVideoTracks()[0];
    // The camera's own zoom. Fire and forget; a refusal falls back to digital.
    void (track as MediaStreamTrack & { applyConstraints(c: unknown): Promise<void> })
      .applyConstraints({ advanced: [{ zoom: _zoom }] })
      .catch(() => { _zoomMode = 'digital'; applyZoom(_zoom, vid); });
    vid.style.transform = '';
  } else {
    vid.style.transformOrigin = '50% 50%';
    vid.style.transform = _zoom > 1 ? `scale(${_zoom})` : '';
  }
  const badge = zoomBadge();
  badge.textContent = `${_zoom.toFixed(1)}×`;
  badge.style.display = _zoom > 1.02 ? 'block' : 'none';
}

function setupPinchZoom(vid: HTMLVideoElement): void {
  teardownPinchZoom();
  _zoom = 1;
  _zoomMode = 'digital';
  _zoomRange = { min: 1, max: 4 };
  vid.style.transform = '';
  // Does the camera zoom by itself?
  try {
    const track = cameraStream?.getVideoTracks()[0];
    const caps = (track as MediaStreamTrack & { getCapabilities?(): Record<string, unknown> } | undefined)?.getCapabilities?.();
    const z = caps && (caps as { zoom?: { min?: number; max?: number } }).zoom;
    if (z && typeof z.max === 'number' && z.max > 1) {
      _zoomMode = 'camera';
      _zoomRange = { min: Math.max(1, z.min ?? 1), max: Math.min(4, z.max) };
    }
  } catch { /* no capabilities — digital it is */ }
  const badge = zoomBadge();
  badge.style.display = 'none';

  const wrap = document.getElementById('cameraVideoWrap');
  if (!wrap) return;
  const dist = (e: TouchEvent) => {
    const a = e.touches[0], b = e.touches[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };
  const start = (e: TouchEvent) => {
    if (e.touches.length !== 2) return;
    _pinchStartDist = dist(e);
    _pinchStartZoom = _zoom;
    e.preventDefault();
  };
  const move = (e: TouchEvent) => {
    if (e.touches.length !== 2 || _pinchStartDist === 0) return;
    e.preventDefault();
    applyZoom(_pinchStartZoom * (dist(e) / _pinchStartDist), vid);
  };
  const end = () => { _pinchStartDist = 0; };
  wrap.addEventListener('touchstart', start, { passive: false });
  wrap.addEventListener('touchmove', move, { passive: false });
  wrap.addEventListener('touchend', end);
  wrap.addEventListener('touchcancel', end);
  _pinchWrap = wrap;
  _pinchHandlers = { start, move, end };
}

function teardownPinchZoom(): void {
  if (_pinchWrap && _pinchHandlers) {
    _pinchWrap.removeEventListener('touchstart', _pinchHandlers.start);
    _pinchWrap.removeEventListener('touchmove', _pinchHandlers.move);
    _pinchWrap.removeEventListener('touchend', _pinchHandlers.end);
    _pinchWrap.removeEventListener('touchcancel', _pinchHandlers.end);
  }
  _pinchWrap = null;
  _pinchHandlers = null;
  _pinchStartDist = 0;
  const vid = document.getElementById('cameraVideo') as HTMLVideoElement | null;
  if (vid) vid.style.transform = '';
  const badge = document.getElementById('cameraZoomBadge');
  if (badge) badge.style.display = 'none';
  _zoom = 1;
}

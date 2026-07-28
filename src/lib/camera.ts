// Camera (live viewfinder + native fallback) + crop UI.
// All functions match original IDs (#cameraOverlay, #cameraVideo, #cropOverlay, ...)
// rendered by React.

import { state, useStore, CAM_RATIOS } from '../store/state';
import type { CamRatioKey } from '../store/state';
import { showToast, showCamBlockedMsg } from './modals';
import { fhTrack } from './tracking';
import { resetToolbarState } from './view';
import { flushSyncNow } from './currentProject';

let cameraStream: MediaStream | null = null;
let cameraFacing: 'environment' | 'user' = 'environment';
let cameraTarget: any = null;
let cropState: any = null;

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
  const preset = CAM_RATIOS.find((r) => r.key === key);
  if (preset && preset.value != null) return preset.value;
  return canvasAspectRatio(fid);
}

export async function openCamera(
  fid: number,
  div: HTMLElement,
  fromCompare: boolean,
  fromMain: boolean,
  strip: string = 'ver'
): Promise<void> {
  fhTrack('camera_opened');
  const ar = effectiveAspectRatio(fid);
  cameraTarget = { fid, div, aspectRatio: ar, fromCompare: !!fromCompare, fromMain: !!fromMain, stripType: strip };

  let hasCamera = false;
  let camBlocked = false;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    const t0 = Date.now();
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: cameraFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      hasCamera = true;
    } catch (e: any) {
      hasCamera = false;
      if (e.name === 'NotAllowedError' && Date.now() - t0 < 500) camBlocked = true;
    }
  }

  if (hasCamera) {
    document.getElementById('cameraOverlay')!.classList.remove('hidden');
    const vid = document.getElementById('cameraVideo') as HTMLVideoElement;
    vid.srcObject = cameraStream;
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
  } else if (camBlocked) {
    showCamBlockedMsg();
  } else {
    (document.getElementById('camFallbackInput') as HTMLInputElement).click();
  }
}

export function positionCameraGuide(ar: number): void {
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
  if (!cameraTarget || !cameraStream) return;
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
  const cropX = sx + gl * sw,
    cropY = sy + gt * sh,
    cropW = gwr * sw,
    cropH = ghr * sh;
  const cvs = document.createElement('canvas');
  cvs.width = Math.round(cropW);
  cvs.height = Math.round(cropH);
  const ctx = cvs.getContext('2d')!;
  ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cvs.width, cvs.height);
  const expR = document.getElementById('expRange') as HTMLInputElement;
  const ev = expR ? +expR.value / 100 : 0;
  if (Math.abs(ev) > 0.05) {
    const bright = Math.pow(2, ev * 0.85);
    const contrast = ev > 0 ? 1 - ev * 0.08 : 1 + Math.abs(ev) * 0.55;
    const gamma = Math.pow(2, -ev);
    const pull = ev < 0 ? Math.abs(ev) * 0.075 : 0;
    const sat = ev < 0 ? 1 - Math.abs(ev) * 0.106 : 1;
    const imgData = ctx.getImageData(0, 0, cvs.width, cvs.height),
      d = imgData.data;
    for (let i = 0; i < d.length; i += 4) {
      for (let ch = 0; ch < 3; ch++) {
        const v = d[i + ch],
          n = v / 255;
        let c1 = v * bright;
        c1 = (c1 - 128) * contrast + 128;
        c1 = Math.max(0, Math.min(255, c1));
        let c3 = 255 * Math.pow(n, gamma);
        if (pull > 0) c3 *= 1 - pull * n * n;
        c3 = Math.max(0, Math.min(255, c3));
        d[i + ch] = Math.round(0.3 * c1 + 0.7 * c3);
      }
      if (sat < 1) {
        let r = d[i],
          g = d[i + 1],
          b = d[i + 2];
        const gr = 0.299 * r + 0.587 * g + 0.114 * b;
        d[i] = Math.max(0, Math.min(255, Math.round(gr + (r - gr) * sat)));
        d[i + 1] = Math.max(0, Math.min(255, Math.round(gr + (g - gr) * sat)));
        d[i + 2] = Math.max(0, Math.min(255, Math.round(gr + (b - gr) * sat)));
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }
  if (onCapturedImage) onCapturedImage(cvs.toDataURL('image/jpeg', 0.92), cameraTarget);
  closeCamera();
}

export function closeCamera(): void {
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
function renderRatioMenu(): void {
  const menu = document.getElementById('cameraRatioMenu');
  if (!menu) return;
  const cur = state().camAspectRatio || 'canvas';
  menu.innerHTML = CAM_RATIOS.map(
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
        positionCameraGuide(cameraTarget.aspectRatio);
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
        video: { facingMode: cameraFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
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

  // Exposure slider live overlay
  (function () {
    const rangeEl = document.getElementById('expRange') as HTMLInputElement;
    const vid = document.getElementById('cameraVideo') as HTMLVideoElement;
    let lut: Uint8Array | null = null,
      satMul = 1,
      rafId: number | null = null,
      canvas: HTMLCanvasElement | null = null,
      ctx: CanvasRenderingContext2D | null = null;

    function buildLUT(ev: number): Uint8Array {
      const t = new Uint8Array(256);
      const bright = Math.pow(2, ev * 0.85);
      const contrast = ev > 0 ? 1 - ev * 0.08 : 1 + Math.abs(ev) * 0.55;
      const gamma = Math.pow(2, -ev);
      const pull = ev < 0 ? Math.abs(ev) * 0.075 : 0;
      for (let i = 0; i < 256; i++) {
        let c1 = i * bright;
        c1 = (c1 - 128) * contrast + 128;
        c1 = Math.max(0, Math.min(255, c1));
        const n = i / 255;
        let c3 = 255 * Math.pow(n, gamma);
        if (pull > 0) c3 *= 1 - pull * n * n;
        c3 = Math.max(0, Math.min(255, c3));
        t[i] = Math.max(0, Math.min(255, Math.round(0.3 * c1 + 0.7 * c3)));
      }
      return t;
    }

    function ensureCanvas() {
      if (canvas) return;
      canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;z-index:0;pointer-events:none;';
      vid.insertAdjacentElement('afterend', canvas);
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }

    function renderFrame() {
      if (!cameraStream) {
        rafId = null;
        return;
      }
      ensureCanvas();
      canvas!.style.display = 'block';
      const vw = vid.videoWidth,
        vh = vid.videoHeight;
      if (vw === 0 || vh === 0) {
        rafId = requestAnimationFrame(renderFrame);
        return;
      }
      if (canvas!.width !== vw || canvas!.height !== vh) {
        canvas!.width = vw;
        canvas!.height = vh;
      }
      ctx!.drawImage(vid, 0, 0, vw, vh);
      if (lut) {
        const img = ctx!.getImageData(0, 0, vw, vh);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          let r = lut[d[i]],
            g = lut[d[i + 1]],
            b = lut[d[i + 2]];
          if (satMul < 1) {
            const gr = 0.299 * r + 0.587 * g + 0.114 * b;
            r = gr + (r - gr) * satMul;
            g = gr + (g - gr) * satMul;
            b = gr + (b - gr) * satMul;
          }
          d[i] = r;
          d[i + 1] = g;
          d[i + 2] = b;
        }
        ctx!.putImageData(img, 0, 0);
      }
      rafId = requestAnimationFrame(renderFrame);
    }

    rangeEl.addEventListener('input', function () {
      const ev = +(this as HTMLInputElement).value / 100;
      satMul = ev < 0 ? 1 - Math.abs(ev) * 0.106 : 1;
      if (Math.abs(ev) < 0.05) {
        lut = null;
        satMul = 1;
      } else {
        lut = buildLUT(ev);
      }
      if (!rafId) rafId = requestAnimationFrame(renderFrame);
    });

    new MutationObserver(() => {
      const hidden = document.getElementById('cameraOverlay')!.classList.contains('hidden');
      if (hidden) {
        lut = null;
        satMul = 1;
        rangeEl.value = '0';
        if (rafId) {
          cancelAnimationFrame(rafId);
          rafId = null;
        }
        if (canvas) canvas.style.display = 'none';
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
        if (!rafId) rafId = requestAnimationFrame(renderFrame);
      }
    }).observe(document.getElementById('cameraOverlay')!, { attributes: true, attributeFilter: ['class'] });
  })();

  // Native-camera fallback → crop UI
  document.getElementById('camFallbackInput')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !cameraTarget) return;
    const reader = new FileReader();
    reader.onload = (ev) => openCropUI((ev.target as FileReader).result as string);
    reader.readAsDataURL(file);
    (e.target as HTMLInputElement).value = '';
  });

  document.getElementById('cropConfirm')!.addEventListener('click', () => {
    if (!cropState || !cameraTarget) return;
    const s = cropState;
    const srcX = (s.guideL - s.x) / s.scale;
    const srcY = (s.guideT - s.y) / s.scale;
    const srcW = s.guideW / s.scale;
    const srcH = s.guideH / s.scale;
    const img = document.getElementById('cropImg') as HTMLImageElement;
    const cvs = document.createElement('canvas');
    cvs.width = Math.round(srcW);
    cvs.height = Math.round(srcH);
    cvs.getContext('2d')!.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, cvs.width, cvs.height);
    if (onCapturedImage) onCapturedImage(cvs.toDataURL('image/jpeg', 0.92), cameraTarget);
    closeCropUI();
  });

  document.getElementById('cropCancel')!.addEventListener('click', () => {
    closeCropUI();
    cameraTarget = null;
    useStore.setState({ overviewAction: false });
  });
}

export function openCropUI(imgSrc: string): void {
  const overlay = document.getElementById('cropOverlay')!;
  const area = document.getElementById('cropArea')! as HTMLElement;
  const img = document.getElementById('cropImg') as HTMLImageElement;
  const guide = document.getElementById('cropGuide')! as HTMLElement;
  overlay.classList.remove('hidden');

  img.onload = () => {
    const nw = img.naturalWidth,
      nh = img.naturalHeight;
    const aw = area.clientWidth,
      ah = area.clientHeight;
    const ar = cameraTarget.aspectRatio;
    let gw, gh;
    if (ar > aw / ah) {
      gw = aw * 0.84;
      gh = gw / ar;
    } else {
      gh = ah * 0.84;
      gw = gh * ar;
    }
    guide.style.width = Math.round(gw) + 'px';
    guide.style.height = Math.round(gh) + 'px';
    guide.style.left = Math.round((aw - gw) / 2) + 'px';
    guide.style.top = Math.round((ah - gh) / 2) + 'px';

    const sc = Math.max(gw / nw, gh / nh) * 1.2;
    const ix = (aw - nw * sc) / 2,
      iy = (ah - nh * sc) / 2;

    cropState = {
      naturalW: nw,
      naturalH: nh,
      x: ix,
      y: iy,
      scale: sc,
      aspectRatio: ar,
      minScale: Math.max(gw / nw, gh / nh),
      areaW: aw,
      areaH: ah,
      guideL: (aw - gw) / 2,
      guideT: (ah - gh) / 2,
      guideW: gw,
      guideH: gh,
    };
    applyCropTransform();

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
  img.src = imgSrc;
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
}

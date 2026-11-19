// Camera (live viewfinder + native fallback) + crop UI.
// All functions match original IDs (#cameraOverlay, #cameraVideo, #cropOverlay, ...)
// rendered by React.

import { state, useStore, CAM_RATIOS, FITTING_RATIOS, PORTRAIT_RATIOS } from '../store/state';
import type { CamRatioKey } from '../store/state';
import { showToast, showCamBlockedMsg } from './modals';
import { fhTrack } from './tracking';
import { trace, markLanding } from './syncTrace';
import { resetToolbarState, captureFrameAnchor, handleOrientationFlip, cancelOrientAnchors } from './view';
import { getPictureReady } from './drawing';
import { flushSyncNow, holdSyncFor, photoIsLanding, getCurrentProject, localProjectId } from './currentProject';
import { keepSeriesShot, forgetSeriesNote, markSeriesLanded } from './picStore';
import { maxViewKeepsTheClockAway } from './maxView';
import { isMainEmpty, getStripVersions, getStripActiveTab, stripTabPrefix } from './helpers';
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
  /** Where the shot sat on the native camera screen: the shrink into the card starts there (6 Nov). */
  startRect?: { left: number; top: number; width: number; height: number };
}

// Lazily-bound applyCapturedImage so this module stays free of core-renderer deps.
let onCapturedImage: ((dataURL: string, target: CameraTarget) => void) | null = null;
export function setOnCapturedImage(fn: (dataURL: string, target: CameraTarget) => void): void {
  onCapturedImage = fn;
}
/** The second step of the native camera's landing (actions.ts applyFinalPhoto). */
let onFinalPhoto: ((landing: any, dataURL: string) => void) | null = null;
export function setOnFinalPhoto(fn: (landing: any, dataURL: string) => void): void {
  onFinalPhoto = fn;
}

/** Aspect ratio of the frame's own canvas (the 'canvas' preset). */
/** A shot of a SERIES that lands without the move (17 Nov): put on its card or
 *  into a new version, nothing drawn — the last shot of the series draws. Returns
 *  where it landed, as applyCapturedImage notes it. */
let onSeriesShot: ((dataURL: string, target: CameraTarget) => any) | null = null;
export function setOnSeriesShot(fn: (dataURL: string, target: CameraTarget) => any): void {
  onSeriesShot = fn;
}

/** THE SERIES IS FOUR SHOTS AT MOST (Roman, 17 Nov). */
const SERIES_MAX = 4;

/** THE NAMES THE SHOTS OF A SERIES WILL LAND ON, for the camera's picture box: the
 *  first on an empty main card is the main picture ("SH", in a fitting "TL"); an empty version on
 *  screen takes the next; after that the strip goes on counting from where it is
 *  (v1–v7 are there → v8, v9, v10). The same rule the landing itself follows. */
function seriesNamesFor(fid: number, target: any, max: number): string[] {
  try {
    const strip = target.stripType || 'ver';
    const f = state().frames.find((x: any) => x.id === fid);
    let mainFree = !!target.fromMain && !!f && isMainEmpty(f);
    const vers = getStripVersions(fid, strip);
    const ai = getStripActiveTab(fid, strip);
    const cur = vers[ai];
    let reuse = !!cur && !(cur.bgImage || (cur.strokes && cur.strokes.length > 0));
    const prefix = stripTabPrefix(strip);
    let n = vers.length;
    const out: string[] = [];
    for (let i = 0; i < max; i++) {
      // NOT "M" (Roman, 18 Nov: "no one knows what it is"): the main card is the SHOT in
      // a storyboard and the TALENT in a fitting — SH and TL, in capitals.
      // …AND IT IS A VERSION TOO (19 Nov): with two or more shots from an empty main
      // card they all land as versions and the first is copied onto the main card. So
      // the first one's name stays SH / TL — true for one shot and for many — and it
      // takes a version's place in the count: SH v2 v3 v4.
      if (mainFree) {
        out.push(state().projectType === 'fitting' ? 'TL' : 'SH'); mainFree = false;
        if (reuse) reuse = false; else n += 1;
        continue;
      }
      if (reuse) { out.push(cur.label || `${prefix}${ai + 1}`); reuse = false; continue; }
      n += 1; out.push(`${prefix}${n}`);
    }
    return out;
  } catch { return []; }
}

function canvasAspectRatio(fid: number): number {
  const f = state().frames.find((fr) => fr.id === fid);
  return f && f.cropW && f.cropH ? f.cropW / f.cropH : 16 / 9;
}

/** Effective guide aspect ratio — resolves the saved preset against the frame canvas. */
function effectiveAspectRatio(fid: number, key: string = state().camAspectRatio || 'canvas'): number {
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

/** The shell's camera plugin, when the app runs inside the iPhone app. */
function nativeCamera(): { take(o: any): Promise<any>; close(): Promise<any>; addListener(ev: string, fn: (e: any) => void): Promise<{ remove(): void }> } | null {
  const w = window as any;
  if (!w.Capacitor?.isNativePlatform?.()) return null;
  return w.Capacitor?.Plugins?.FramehowCamera ?? null;
}

/** Opens the native camera for this shot. True = handled here (photo landed or
 *  cancelled); false = no native camera, carry on with the web one.
 *
 *  THE TWO-STEP LANDING (Roman, 6 Nov): at the shutter the plugin sends the
 *  LIVE FRAME ("preview" event) — it goes onto the card at once, the camera
 *  screen is already gone; about a second later the promise answers with the
 *  real photo (Deep Fusion, 2400 px, HDR layer), which replaces the live frame
 *  on the same frame/version. The live frame is never uploaded. */
async function takeNativePhoto(fid: number): Promise<boolean> {
  const cam = nativeCamera();
  if (!cam) {
    const w = window as any;
    if (w.Capacitor?.isNativePlatform?.()) trace(`camera: no native camera plugin — the shell has: ${Object.keys(w.Capacitor?.Plugins ?? {}).join(', ') || 'none'}`);
    return false;
  }
  if (!cameraTarget) return false;
  const target = cameraTarget;
  const kind = state().projectType;
  const list = kind === 'fitting' ? FITTING_RATIOS : kind === 'portrait' ? PORTRAIT_RATIOS : CAM_RATIOS;
  const ratios = list.map((r) => ({ key: r.key, label: r.label, value: r.value == null ? canvasAspectRatio(fid) : r.value }));
  const ratioKey = state().camAspectRatio || 'canvas';
  const t0 = Date.now();
  trace(`camera: native · ratio ${ratioKey} · ${ratios.length} choices`);
  let landing: any = null;
  let previewAt = 0;
  const landPreview = (e: any) => {
    if (!e?.jpegBase64 || landing) return;
    previewAt = Date.now();
    markLanding(); watchForStandstill();
    // FROM THE SHUTTER UNTIL THE PICTURE HAS LANDED, NOTHING ELSE HAPPENS (Roman,
    // 11 Nov: "after you took a shot until it lands … no fetching … When the camera
    // is open, things can still happen in the background"). The flash and the move
    // take about 0.4 s from here; a little is added so the card under the picture
    // is drawn in peace. Saving and fetching go on while the camera is merely open,
    // and again the moment the picture is in its card.
    holdSyncFor(600);
    // A NEW RATIO IS WRITTEN DOWN AFTER THE LANDING, NOT IN IT (Roman, 11 Nov: "when
    // I change the ratio, the first one is still frozen and then it goes. All the
    // others are smooth"). The ratio is a setting of the whole project: writing it
    // down wakes everything that listens to the project and starts a save — right
    // in the half second the picture needs for itself. This landing only needs the
    // number, which it takes from the camera's answer; the setting follows a
    // moment later.
    const newRatio: string | null = e.ratioKey && e.ratioKey !== ratioKey ? e.ratioKey : null;
    if (newRatio) setTimeout(() => { useStore.setState({ camAspectRatio: newRatio as never }); void flushSyncNow(); }, 700);
    target.aspectRatio = effectiveAspectRatio(fid, newRatio ?? undefined);
    // where the frame lay on the camera screen (points = CSS px here): the shrink
    // into the card starts from exactly that rectangle (actions.ts)
    if (e.frame && e.frame.w > 0) target.startRect = { left: e.frame.x, top: e.frame.y, width: e.frame.w, height: e.frame.h };
    fhTrack('photo_taken');
    if (onCapturedImage) onCapturedImage(`data:image/jpeg;base64,${e.jpegBase64}`, target);
    landing = lastLandingOf();
    if (landing) { if (landing.main) { const f = state().frames.find((x: any) => x.id === fid); if (f) f.awaitingPhoto = true; } else if (landing.version) landing.version.awaitingPhoto = true; }
    trace(`camera: live frame ${e.width}×${e.height} on the card · ${Math.round((previewAt - t0) / 100) / 10} s from CAM · real photo on its way`);
    closeCamera();
    // THE HAND-OVER (Roman, 6 Nov): the copy that shrinks into the card is in place
    // now (actions.ts put it there, no frame clock needed). The camera is told so;
    // it answers the moment its fixed frozen time (390 ms from the shutter: 90 flash + 300 frozen) is up and
    // the screen is gone — and the shrink starts on that answer, the same instant.
    const askedAt = Date.now();
    const start = (how: string) => () => {
      const f = (window as any).__fh_startShrink as (() => void) | undefined;
      trace(`camera: shrink starts ${Date.now() - previewAt} ms after the live frame (camera ${how} ${Date.now() - askedAt} ms after being asked)${f ? '' : ' — nothing to start'}`);
      f?.();
    };
    cam.close().then(start('answered')).catch(start('failed'));
  };
  // ── THE SERIES (17 Nov, Roman) ────────────────────────────────────────────
  // The camera stays open for up to four shots. Each shot sends its live frame
  // at the shutter ('preview', with its place in the series) and its real photo
  // about a second later ('seriesPhoto'); nothing lands, nothing is saved, the
  // page behind is not touched. The visit ends with the last shot ('preview'
  // says last), with DONE, or with a tap on the picture box ('seriesDone') —
  // then every shot lands at once: the earlier ones without a move, the last one
  // travels into the card as a single shot always did, and the save that
  // follows carries them all. A shell from before the series knows none of
  // this and answers as it always did; the lines further down serve it.
  type Slot = { preview?: string; real?: string; landing?: any };
  const slots: Slot[] = [];
  // whose series this is, for the note that keeps its shots safe on the device (picStore)
  const seriesOf = () => {
    const f0 = state().frames.find((x: any) => x.id === fid) as any;
    return { project: getCurrentProject().projectId ?? null, localProject: localProjectId() || null,
      fid, frame: (f0?.serverFrameId ?? null) as string | null, strip: (target.stripType || 'ver') as string, fromMain: !!target.fromMain };
  };
  forgetSeriesNote(seriesOf());       // (a new visit for this shot: what an older visit noted for it is on the card by now)
  const names = seriesNamesFor(fid, target, SERIES_MAX);
  let seriesLanded = false;
  const awaitReal = (l: any) => {
    if (!l) return;
    if (l.main) { const f = state().frames.find((x: any) => x.id === fid); if (f) f.awaitingPhoto = true; } else if (l.version) l.version.awaitingPhoto = true;
    // (the copy on the main card waits for the real photo too — its live frame must not go up as a picture, 19 Nov)
    if (l.mainCopy) { const f = state().frames.find((x: any) => x.id === fid); if (f && f.src === l.mainCopy) f.awaitingPhoto = true; }
  };
  const openMaxOnTheLanded = (lastTry = true): boolean => {
    for (const sel of [
      `.frame-card[data-vfid="${fid}"] .canvas-wrap > .max-btn`,
      `.grid3x2-card-wrap[data-g3fid="${fid}"] .canvas-wrap > .max-btn`,
      `.frame-card[data-mfid="${fid}"] .canvas-wrap > .max-btn`,
    ]) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
        if (el.offsetParent) { trace('camera: the picture box was tapped — MAX view on the last shot'); el.click(); return true; }
      }
    }
    if (lastTry) trace('camera: the picture box was tapped — no MAX button on the landed card to open');
    return false;
  };
  const landSeries = (reason: string, e: any) => {
    if (seriesLanded) return;
    const taken = slots.filter((sl) => sl && (sl.real || sl.preview));
    if (!taken.length) { trace(`camera: series ended (${reason}) with no picture to land`); return; }
    seriesLanded = true;
    previewAt = Date.now();
    markLanding(); watchForStandstill();
    holdSyncFor(600);
    const newRatio: string | null = e?.ratioKey && e.ratioKey !== ratioKey ? e.ratioKey : null;
    if (newRatio) setTimeout(() => { useStore.setState({ camAspectRatio: newRatio as never }); void flushSyncNow(); }, 700);
    target.aspectRatio = effectiveAspectRatio(fid, newRatio ?? undefined);
    if (e?.frame && e.frame.w > 0) target.startRect = { left: e.frame.x, top: e.frame.y, width: e.frame.w, height: e.frame.h };
    // A TAP ON THE PICTURE BOX GOES STRAIGHT TO THE MAX VIEW (Roman, 17 Nov: "I've seen the
    // animation first and then landing and then MAX view … we want to go to MAX right away
    // without any disturbance"). No move into the card: the shots are put on their cards
    // behind the camera, the MAX view is opened behind the camera, and only then does
    // the camera's screen go — what comes out from under it is the MAX view.
    const straightToMax = reason === 'box';
    if (straightToMax) (target as any).noMove = true;
    // TWO OR MORE FROM AN EMPTY MAIN CARD: ALL ARE VERSIONS, THE FIRST IS COPIED ONTO
    // THE MAIN CARD (19 Nov, agreed with Roman: "when more than 1 photo in MAIN CARD
    // they land in v1, v2… and the v1's photo is copied into MAIN CARD as well"). One
    // photo lands on the main card alone, as before; a main card that has a picture is
    // left alone, as before. Why: in a fitting the first photo was on the talent card
    // only — missing from LOOKS and from a looks export.
    {
      const f0 = state().frames.find((x: any) => x.id === fid);
      if (target.fromMain && f0 && isMainEmpty(f0) && taken.length >= 2) {
        (target as any).mainGetsCopy = true;
        trace(`camera: ${taken.length} shots from an empty main card — all land as versions, the first is copied onto the main card`);
      }
    }
    let waiting = 0;
    for (let i = 0; i < taken.length - 1; i++) {
      const sl = taken[i];
      fhTrack('photo_taken');
      sl.landing = onSeriesShot ? onSeriesShot((sl.real ?? sl.preview)!, target) : null;
      if (!sl.real) { awaitReal(sl.landing); waiting++; }
    }
    const lastSl = taken[taken.length - 1];
    fhTrack('photo_taken');
    if (onCapturedImage) onCapturedImage((lastSl.real ?? lastSl.preview)!, target);
    lastSl.landing = lastLandingOf();
    if (!lastSl.real) { awaitReal(lastSl.landing); waiting++; }
    landing = lastSl.landing;
    trace(`camera: series of ${taken.length} landed (${reason === 'full' ? 'the last shot' : reason === 'box' ? 'the picture box' : 'DONE'}) on ${names.slice(0, taken.length).join(' ') || '?'} · ${Math.round((previewAt - t0) / 100) / 10} s from CAM · ${waiting ? `${waiting} real photo(s) still on their way` : 'every real photo was there'}`);
    closeCamera();
    // The shots are on their cards now, and the save that follows names them. The note
    // of the open series has done its work — but it is kept half a minute longer, for
    // the case that the app is thrown out before that save is written (a start then
    // finds the note, and puts on the card only what the card has not got).
    const landed = seriesOf();
    markSeriesLanded(landed);
    window.setTimeout(() => forgetSeriesNote(landed), 30_000);
    const askedAt = Date.now();
    if (straightToMax) {
      // the card's MAX button is put there by the painter a moment after the card is
      // drawn: looked for every 30 ms, for 0.9 s at most; then the camera goes either way
      let tries = 0;
      const go = () => {
        const opened = openMaxOnTheLanded(tries >= 30);
        if (!opened && tries++ < 30) { setTimeout(go, 30); return; }
        trace(`camera: the camera's screen goes ${Date.now() - askedAt} ms after the landing — ${opened ? 'the MAX view is under it' : 'no MAX view (no button on the card)'}`);
        // (the camera puts the clock and battery back as it goes — over the MAX view they are taken away again)
        const away = () => maxViewKeepsTheClockAway();
        cam.close().then(away, away);
        window.setTimeout(away, 400); window.setTimeout(away, 1500);
      };
      go();
      return;
    }
    const start = (how: string) => () => {
      const f = (window as any).__fh_startShrink as (() => void) | undefined;
      trace(`camera: shrink starts ${Date.now() - previewAt} ms after the landing (camera ${how} ${Date.now() - askedAt} ms after being asked)${f ? '' : ' — nothing to start'}`);
      f?.();
    };
    cam.close().then(start('answered')).catch(start('failed'));
  };
  const onPreviewEvent = (e: any) => {
    if (!e?.series) { landPreview(e); return; }           // a shell from before the series
    if (!e.jpegBase64) return;
    const i = typeof e.index === 'number' ? e.index : slots.length;
    (slots[i] ??= {}).preview = `data:image/jpeg;base64,${e.jpegBase64}`;
    trace(`camera: series shot ${i + 1}${names[i] ? ` (→ ${names[i]})` : ''} · live frame ${e.width}×${e.height}${e.last ? ' · the last one — the camera closes' : ' · the camera stays open'}`);
    if (e.last) landSeries('full', e);
  };
  const onSeriesPhoto = async (e: any) => {
    if (!e?.jpegBase64) return;
    const i = typeof e.index === 'number' ? e.index : 0;
    const url = `data:image/jpeg;base64,${e.jpegBase64}`;
    const sl = (slots[i] ??= {});
    sl.real = url;
    // ONTO THE DEVICE AT ONCE (18 Nov): the camera is still open, the shot is on no card
    // and in no save yet — filed now, it survives the app being thrown out. Not waited
    // for: the camera and the next shot come first.
    if (!seriesLanded) {
      const t1 = Date.now();
      void keepSeriesShot(seriesOf(), i, url)
        .then(() => trace(`camera: series photo ${i + 1} is on this device (${Date.now() - t1} ms) — safe if the app is closed now`))
        .catch((err) => trace(`camera: series photo ${i + 1} could NOT be put on this device (${(err as Error)?.message ?? err}) — it lives only while the app is open`));
    }
    trace(`camera: series photo ${i + 1} · ${e.width}×${e.height} · ${Math.round(e.jpegBase64.length * 3 / 4 / 1024)} KB · HDR layer ${e.hdrKept ? 'in' : 'not in'} the file · shutter→photo ${e.msCapture ?? '?'} ms · crop+resize ${e.msProcess ?? '?'} ms`);
    if (!seriesLanded) return;                              // it lands with the others
    // the series has landed already, this shot on its live frame: the real photo takes its place
    while (photoIsLanding()) await new Promise((r) => setTimeout(r, 80));
    await getPictureReady(url);
    if (sl.landing && onFinalPhoto) onFinalPhoto(sl.landing, url);
    else if (onSeriesShot) { sl.landing = onSeriesShot(url, target); trace(`camera: series photo ${i + 1} came after the landing and had no live frame — put on the card now`); useStore.setState((p: any) => ({ renderTick: (p.renderTick ?? 0) + 1 })); }
  };
  let sub: any = null, sub2: any = null, sub3: any = null;
  try { sub = await cam.addListener('preview', onPreviewEvent); } catch { sub = null; }
  try { sub2 = await cam.addListener('seriesPhoto', (e: any) => { void onSeriesPhoto(e); }); } catch { sub2 = null; }
  try { sub3 = await cam.addListener('seriesDone', (e: any) => landSeries(e?.reason || 'done', e)); } catch { sub3 = null; }
  const unlisten = () => { for (const x of [sub, sub2, sub3]) { try { x?.remove?.(); } catch { /* gone */ } } };
  let res: any;
  try {
    res = await cam.take({ ratios, ratioKey, maxSide: 2400, series: { max: SERIES_MAX, names } });
  } catch (e: any) {
    unlisten();
    trace(`camera: native failed — ${e?.message || e}; falling back to the web camera`);
    return false;
  }
  unlisten();
  if (res?.series) {
    trace(`camera: the visit is over — ${res.count ?? '?'} photo(s), ended by ${res.reason ?? '?'} · ${Math.round((Date.now() - t0) / 100) / 10} s from CAM`);
    if (!seriesLanded) closeCamera();
    maxViewKeepsTheClockAway();          // (the camera's screen is gone for good now — if the MAX view is up, no clock over it)
    return true;
  }
  if (!res || res.cancelled || !res.jpegBase64) {
    trace(`camera: native closed without a photo (${Math.round((Date.now() - t0) / 100) / 10} s)`);
    if (!landing) closeCamera();
    return true;
  }
  const kb = Math.round(res.jpegBase64.length * 3 / 4 / 1024);
  const url = `data:image/jpeg;base64,${res.jpegBase64}`;
  if (landing && onFinalPhoto) {
    // SHOT AFTER SHOT (Roman, 11 Nov: "the DOP will shoot one picture, whoop, it
    // lands, opens the camera again, doop, another one"). The real photo of a shot
    // arrives about 1.3 s after its shutter — and may arrive just while the NEXT
    // shot is travelling into its card. Swapping it in and saving it then would
    // take that landing's half second away. So it waits until that picture has
    // landed, a few tenths of a second at most, and goes in right after.
    while (photoIsLanding()) await new Promise((r) => setTimeout(r, 80));
    // …and it is unpacked BEFORE it is put on the card (see getPictureReady), so the
    // swap from the live frame to the real photo does not hold the page.
    const unpackFrom = Date.now();
    await getPictureReady(url);
    trace(`camera: real photo unpacked in ${Date.now() - unpackFrom} ms, before the swap`);
    onFinalPhoto(landing, url);
    trace(`camera: real photo ${res.width}×${res.height} · ${kb} KB · HDR layer ${res.hdrKept ? 'in' : 'not in'} the file · ratio ${res.ratioKey} · shutter→photo ${res.msCapture ?? '?'} ms · crop+resize ${res.msProcess ?? '?'} ms · replaced the live frame ${Math.round((Date.now() - previewAt) / 100) / 10} s after it`);
    return true;
  }
  // no live frame came (older shell, or the frame was missed): the photo lands the plain way
  if (res.ratioKey && res.ratioKey !== ratioKey) { useStore.setState({ camAspectRatio: res.ratioKey }); void flushSyncNow(); }
  target.aspectRatio = effectiveAspectRatio(fid);
  fhTrack('photo_taken');
  trace(`camera: native photo ${res.width}×${res.height} · ${kb} KB · HDR layer ${res.hdrKept ? 'in' : 'not in'} the file · ratio ${res.ratioKey} · shutter→photo ${res.msCapture ?? '?'} ms · crop+resize ${res.msProcess ?? '?'} ms · ${Math.round((Date.now() - t0) / 100) / 10} s from CAM to card`);
  if (onCapturedImage) onCapturedImage(url, target);
  closeCamera();
  return true;
}

/** Where the last captured picture landed (actions.ts keeps it; read at call time). */
let lastLandingOf: () => any = () => null;
export function setLastLandingReader(fn: () => any): void { lastLandingOf = fn; }

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
  cameraTarget = { fid, div, aspectRatio: ar, fromCompare: !!fromCompare, fromMain: !!fromMain, stripType: strip,
    openedLandscape: window.innerWidth > window.innerHeight,
    // where the card sat on the screen when CAM was pressed (29 Oct, Roman:
    // "give the photo back to exactly the same position")
    cardTop: (() => { const el = (div && (div.closest('.grid3x2-card-wrap') || div.closest('.frame-card') || div)) as HTMLElement | null;
      return el && el.isConnected ? el.getBoundingClientRect().top : null; })() };
  cameraSessionStart();
  // THE SHOT THE CAMERA IS FOR IS THE ONE TO COME BACK TO (29 Oct, Roman: "if I
  // shoot to shot 7, however I turn the device in between, I want to end up
  // seeing shot 7 mid screen"). A turn while the camera is open re-anchors the
  // page on centerFid — so that is this shot, not whatever sat in the middle.
  useStore.setState({ centerFid: String(fid) });

  // PHONE CAM (23 Oct): the phone's own camera, opened INSIDE this tap — iOS
  // opens its camera only from a tap, so nothing may be waited for first.
  // CAM SET UP always shows the Framehow camera, whatever is chosen.
  if (!setup && getCamMode() === 'phone') { openPhoneCamera(); return; }
  phoneShot = false;

  // THE NATIVE CAMERA (6 Nov, Roman): in the app shell, CAM is the iPhone's own
  // camera (the 3 Nov test app, now the FramehowCamera plugin) — the picture
  // quality the web camera can never get. It gets the same RATIO list as FH CAM
  // (CANVAS resolved to the card's shape, GROUP PHOTO = the chip itself) and the
  // ratio in force; it hands back ONE 2400 px JPEG, which lands on the card at
  // once like any picture. CAM SET UP keeps the web screen (it is a settings page).
  // No swap, no preview, no second picture.
  if (!setup && await takeNativePhoto(fid)) return;

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

/** WHERE THE PAGE STOOD STILL (11 Nov, Roman: "the first photo was frozen"). For
 *  2.5 s from the live frame, every gap between two drawn frames longer than
 *  70 ms is written down with its moment — so the log says what the eye saw. */
function watchForStandstill(): void {
  const start = performance.now(); let last = start; const gaps: string[] = [];
  const tick = () => {
    const n = performance.now();
    if (n - last > 70) gaps.push(`${Math.round(n - last)} ms at +${Math.round(last - start)}`);
    last = n;
    if (n - start < 2500) { requestAnimationFrame(tick); return; }
    trace(gaps.length ? `camera: the page stood still — ${gaps.join(' · ')}` : 'camera: the page never stood still in the 2.5 s after the live frame');
  };
  requestAnimationFrame(tick);
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
// SHOOTING IN PROGRESS (29 Oct, Roman: "if I started in 3x2 view I have to be
// back in 3x2 view; if I started in any other view I have to come back to the
// same view"). While the camera, the phone's camera or the framing screen is
// open, a turn of the device must not change the view underneath.
// A CAMERA SESSION: from pressing CAM on a card until the photo lands in that
// card (or the camera is closed). Nothing is timed (29 Oct, Roman: no 1.5 s,
// no waiting).
// 29 Oct, Roman (2): "the orientation change has to be ignored for the page in
// the background, so when the orientation is back to the same as it was it goes
// to where it was". The page keeps the SHAPE it had at CAM for the whole session.
// When the session ends that shape is what the view belongs to: held the same
// way as at CAM → nothing happens; held the other way → the ordinary turn rule
// runs ONCE now (iPad portrait: MAIN + VERSIONS, iPhone portrait: MAIN), on the
// shot just taken. A turn iOS reports later is a real turn, handled as any turn.
let _camOpenedAt = 0, _camOpen = false, _camW = 0, _camH = 0;
export function cameraSessionStart(): void {
  _camOpenedAt = Date.now(); _camOpen = true;
  _camW = (window as any)._lastWinW || window.innerWidth; _camH = (window as any)._lastWinH || window.innerHeight;
}
/** true when the device is held the other way than when CAM was pressed */
export function cameraTurnedSinceCam(): boolean {
  return (_camW > _camH) !== (window.innerWidth > window.innerHeight);
}
/** Returns true when the view CHANGED because the device is held the other way
 *  (then the turn rule has brought the shot on screen; nothing to put back). */
export function cameraSessionEnd(): boolean {
  if (!_camOpen) return false;
  _camOpen = false;
  (window as any)._lastWinW = _camW; (window as any)._lastWinH = _camH;
  if (!cameraTurnedSinceCam()) return false;
  const before = state().currentViewMode;
  // A camera turn never brings 3x2 back by itself (29 Oct, Roman's iPad: CAM in
  // the single/double strip view in portrait, turned to landscape, the photo
  // landed in 3x2). The "came from 3x2" note left by an EARLIER turn to portrait
  // made the turn rule restore 3x2. You land in the view you pressed CAM in.
  (window as any)._returnTo3x2 = false;
  handleOrientationFlip();
  const after = state().currentViewMode;
  trace(`camera: held the other way than at CAM — view ${before === after ? `stays ${after}` : `${before} → ${after}`}`);
  if (before !== after) {
    // The new view STAYS. Turning back later does not bring 3x2 back by itself
    // (29 Oct, Roman: "only when the user presses 3x2 and decides for himself").
    (window as any)._returnTo3x2 = false;
    return true;
  }
  cancelOrientAnchors();   // same view: the card goes back where it was (actions.ts)
  return false;
}
export function cameraBusy(): boolean {
  return _camOpen && Date.now() - _camOpenedAt < 600_000;   // a missed close cannot freeze turns forever
}
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
  // The FH camera closing ends the session — unless the photo goes on to the
  // framing screen, which keeps it going until that one closes too.
  if (!document.getElementById('cropOverlay') || document.getElementById('cropOverlay')!.classList.contains('hidden')) cameraSessionEnd();
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
  // the phone's camera closed without a photo (iOS 16.4+ says so)
  document.getElementById('camFallbackInput')!.addEventListener('cancel', () => cameraSessionEnd());
  document.getElementById('camFallbackInput')!.addEventListener('change', (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) cameraSessionEnd();
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
  cameraSessionEnd();
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

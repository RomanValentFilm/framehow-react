// LAZY LOADING, HALF 1 (Roman, 13 Nov).
//
// "Someone in the office loads a big project and walks out — he needs to be
// sure that he has all the 200 pictures with him." And: he must be IN the
// project at once, not behind a curtain until picture 251 has arrived.
//
// So a project opens in two moves:
//   1. its shots, names, orders — and the person is in, and can work;
//   2. its pictures, in the background: small previews stand on the cards
//      first (512 px, ~40 KB, from this device or the server), the sharp
//      pictures replace them in the order of the shots; a bar along the bottom
//      edge counts until EVERY picture of the project is on this device.
//
// THE RULES THIS FILE HOLDS TO
//   · a preview is only ever SHOWN. It is never in the project: not saved, not
//     sent, not exported, not counted as the shot's picture.
//   · the bar is there for as long as pictures are still to come, and says
//     how many; with no connection it says how many are on this device.
//   · another project on the screen: the count, the bar and the previews of
//     the one before are gone at once.

/** r2 key → the preview's object URL. */
const _standIns = new Map<string, string>();

export function standInFor(r2Key: string | null | undefined): string {
  return (r2Key && _standIns.get(r2Key)) || '';
}
export function hasStandIn(r2Key: string): boolean { return _standIns.has(r2Key); }
export function setStandIn(r2Key: string, bytes: ArrayBuffer): void {
  if (_standIns.has(r2Key) || !bytes.byteLength) return;
  _standIns.set(r2Key, URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
}
/** The sharp picture is on its card: its preview is not needed any more. */
export function dropStandIn(r2Key: string): void {
  const u = _standIns.get(r2Key);
  if (!u) return;
  // (not revoked at once — a card drawn a moment ago may still be showing it)
  _standIns.delete(r2Key);
  window.setTimeout(() => URL.revokeObjectURL(u), 5_000);
}
export function dropAllStandIns(): void {
  for (const u of _standIns.values()) URL.revokeObjectURL(u);
  _standIns.clear();
}
export function standInCount(): number { return _standIns.size; }

// ---------------------------------------------------------------------------
// THE COUNT AND THE BAR
// ---------------------------------------------------------------------------

interface Arriving { token: string; done: number; total: number }
let _arriving: Arriving | null = null;

/** The pictures of the open project that are still to come — null when none. */
export function picturesArriving(): { done: number; total: number } | null {
  return _arriving ? { done: _arriving.done, total: _arriving.total } : null;
}
export function arrivingFor(token: string): boolean { return _arriving?.token === token; }

/** `total` = every picture of the project; `done` = those already here. */
export function beginArriving(token: string, total: number, done = 0): void {
  _arriving = total > done ? { token, done, total } : null;
  showBar();
}
export function oneArrived(token: string): void {
  if (!_arriving || _arriving.token !== token) return;
  _arriving.done = Math.min(_arriving.total, _arriving.done + 1);
  showBar();
}
export function endArriving(token: string): void {
  if (!_arriving || _arriving.token !== token) return;
  _arriving = null;
  showBar();
}
/** Another project came on the screen (or none): whatever was counting stops. */
export function forgetArriving(): void {
  _arriving = null;
  dropAllStandIns();
  showBar();
}

/** The words on the bar — one place, so the test reads the same ones. */
export function barText(done: number, total: number, online: boolean): string {
  return online ? `Loading pictures ${done} / ${total}` : `Offline — ${done} of ${total} pictures on this device`;
}

let _wired = false;
function showBar(): void {
  if (typeof document === 'undefined') return;
  let bar = document.getElementById('picturesBar');
  if (!_arriving) {
    bar?.remove();
    document.body.classList.remove('pictures-bar-on');
    return;
  }
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'picturesBar';
    bar.innerHTML = '<div class="pictures-bar-fill"></div><span class="pictures-bar-text"></span>';
    document.body.appendChild(bar);
    document.body.classList.add('pictures-bar-on');
  }
  if (!_wired) {
    _wired = true;
    window.addEventListener('online', showBar);
    window.addEventListener('offline', showBar);
  }
  const { done, total } = _arriving;
  (bar.querySelector('.pictures-bar-fill') as HTMLElement).style.width = `${Math.round((done / total) * 100)}%`;
  (bar.querySelector('.pictures-bar-text') as HTMLElement).textContent = barText(done, total, navigator.onLine !== false);
}

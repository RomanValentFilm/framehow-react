// THE LIBRARY'S PREVIEWS ON THIS DEVICE (27 October, Roman).
//
// A database of its own ("framehow-picts"), apart from the projects: making
// room here can only ever remove previews — never a storyboard, a version or
// a picture of a project.
//
// One record per picture:
//   id       "fp:<fingerprint>:preview" for a picture this device has the picture of
//            (made here, or in the open project), "r2:<key>:preview" for one only
//            known from the server
//   fp       the fingerprint: a short code computed from the picture itself —
//            the same picture always gives the same code. It is how a preview
//            made offline is found again when its picture reaches the server.
//   r2Key    the server's name for the picture, once it is there
//   at       when it arrived (the server's time once known, else when this
//            device first saw it)
//   label    "project – shot – version", for offline
//   blob     the preview (512 px on its long side)

export interface PreviewRec {
  id: string;
  fp?: string;
  r2Key?: string | null;
  at: number;
  label: string;
  w: number;
  h: number;
  /** The preview's JPEG bytes. Plain bytes, never a picture object: with the
   *  network off, the test browser would not read a picture object back
   *  (runs 493/494: "The I/O read operation failed"). */
  bytes: ArrayBuffer;
  /** On the server too. false = its picture is there, the preview not yet:
   *  sent with the next sync (27 Oct). */
  sent?: boolean;
}

const DB = 'framehow-picts';
const STORE = 'previews';
let _db: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((ok, bad) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: 'id' });
      s.createIndex('r2Key', 'r2Key', { unique: false });
    };
    req.onsuccess = () => ok(req.result);
    req.onerror = () => { _db = null; bad(req.error); };
  });
  return _db;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return db().then((d) => new Promise<T | undefined>((ok, bad) => {
    const t = d.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => ok(r ? (r as IDBRequest<T>).result : undefined);
    t.onerror = () => bad(t.error);
    t.onabort = () => bad(t.error);
  }));
}

let _failSaid = false;
const failed = (what: string, e: unknown) => {
  if (_failSaid) return;
  _failSaid = true;
  void import('./syncTrace').then(({ trace }) => trace(`PICTS: the device would not ${what} a preview — ${String((e as Error)?.message ?? e)}`));
};

export async function allPreviews(): Promise<PreviewRec[]> {
  try { return ((await tx<PreviewRec[]>('readonly', (s) => s.getAll())) ?? []).filter((r) => r.bytes); }
  catch (e) { failed('read', e); return []; }
}
export async function putPreview(r: PreviewRec): Promise<void> {
  try { await tx('readwrite', (s) => s.put(r)); } catch (e) { failed('keep', e); /* the library still works online */ }
}
export async function getPreview(id: string): Promise<PreviewRec | null> {
  try { const r = await tx<PreviewRec>('readonly', (s) => s.get(id)); return r && r.bytes ? r : null; }
  catch (e) { failed('read', e); return null; }
}
export async function deletePreviews(ids: string[]): Promise<void> {
  if (!ids.length) return;
  try { await tx('readwrite', (s) => { for (const id of ids) s.delete(id); }); } catch { /* next time */ }
}

/** The fingerprint of a picture (as the app holds it: a data URL). */
export async function fingerprint(src: string): Promise<string> {
  try {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
    return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // No secure context (a plain http address): a cheaper code, still stable.
    let h1 = 0x811c9dc5, h2 = 0x1000193;
    for (let i = 0; i < src.length; i += 7) { const c = src.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2246822519); }
    return `x${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}${src.length.toString(16)}`;
  }
}

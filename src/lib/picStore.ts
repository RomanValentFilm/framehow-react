// EVERY PICTURE IS KEPT ON THE DEVICE ONCE, BY ITSELF (12 November 2026).
//
// The device's save of a project used to be ONE record: the project with every
// picture of every version inside it. One new photo meant writing all of them
// again. On Roman's phone, with a 26-shot project holding hundreds of photos:
// a save took 0.6–2.8 s, device storage went from 655 MB to 1941 MB in two
// minutes, iOS's storage process fell over ("An internal error was encountered
// in the Indexed Database server"), and the page itself was thrown out the
// moment the big project was saved — two seconds after it had opened.
//
// Now a picture is filed here under a name made from its content, the moment a
// save first meets it, and the project's save holds that name in its place.
// A save is then the small rest (names, drawings, notes, orders), and a picture
// is written once in its life, about a megabyte at a time.
//
// THE RULES
//   · a save is written only after every picture it names is on the device
//   · reading a save puts the pictures back in — the app sees no difference
//   · a picture nothing names any more is removed only after it has been
//     unnamed at two looks a minute apart (another window may just have filed it)
//   · the copies of unsent work (the "pending" store) name their pictures the
//     same way, so three safety copies of a project share one set of pictures
//
// Its own database, so nothing about the old one changes shape.

import { fingerprint } from './pictsStore';

const DB = 'framehow-pics';
const STORE = 'pics';
/** What stands in a save where a picture was. */
export const PIC_REF = 'fhpic:';
/** Anything shorter stays where it is (icons, tiny marks). In the simulator the
 *  pictures are a few hundred bytes — there the line is drawn lower, so every
 *  test that uses a picture goes this way too. */
const MIN_LENGTH = (() => { try { return localStorage.getItem('fh_test') === '1' ? 64 : 4096; } catch { return 4096; } })();

let _db: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (_db) return _db;
  _db = new Promise((ok, bad) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      req.result.onclose = () => { _db = null; };
      req.result.onversionchange = () => { req.result.close(); _db = null; };
      ok(req.result);
    };
    req.onerror = () => { _db = null; bad(req.error); };
  });
  return _db;
}

const closed = (e: unknown): boolean => {
  const name = (e as { name?: string } | null)?.name ?? '';
  return name === 'InvalidStateError' || /clos|connection.*lost|server lost/i.test(String((e as Error)?.message ?? e ?? ''));
};

/** One step on the pictures; once more on a database iOS closed behind us. */
async function step<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore, done: (v: T) => void) => void): Promise<T> {
  const once = async (): Promise<T> => {
    const d = await db();
    return new Promise<T>((ok, bad) => {
      const t = d.transaction(STORE, mode);
      let out!: T;
      work(t.objectStore(STORE), (v) => { out = v; });
      t.oncomplete = () => ok(out);
      t.onerror = () => bad(t.error);
      t.onabort = () => bad(t.error ?? new Error('closed before it finished'));
    });
  };
  try { return await once(); }
  catch (e) { if (!closed(e)) throw e; _db = null; return once(); }
}

/** FOR THE SIMULATOR: close it the way iOS does behind the app's back. */
export async function closePicsDbAsIosDoes(): Promise<void> { (await db()).close(); }

/** The names of the pictures on the device — names only. */
export async function picNames(): Promise<string[]> {
  return step<string[]>('readonly', (s, done) => {
    const r = s.getAllKeys();
    r.onsuccess = () => done((r.result ?? []).map(String).filter((k) => k !== SENT_AHEAD_KEY));
  });
}

/** One picture, by its name — undefined when it is not on the device. */
export async function getPicture(name: string): Promise<string | undefined> {
  return step<string | undefined>('readonly', (s, done) => {
    const r = s.get(name);
    r.onsuccess = () => done(typeof r.result === 'string' ? r.result : undefined);
  });
}

// PICTURES SENT AHEAD OF THEIR PROJECT (13 Nov, Roman: unsent work goes up "in
// small portions when there is time for it", unseen). The pictures of a project
// that was left go to the server one by one, in the background, before the
// project's shots and versions do. What the server answered for each — the
// file's name there — is noted here under the picture's own name, so the push
// that follows takes it from this note instead of sending the picture again.
//
// The server removes a picture file no project names after 24 hours. So a note
// is good for TWENTY hours; after that the picture is simply sent again.
const SENT_AHEAD_KEY = '__sentAhead';
const SENT_AHEAD_GOOD_MS = 20 * 60 * 60 * 1000;
export interface SentAhead { r2_key: string; size_bytes: number; content_type: string; at: number }
type SentAheadNotes = Record<string, SentAhead>;

async function readSentAhead(): Promise<SentAheadNotes> {
  return step<SentAheadNotes>('readonly', (s, done) => {
    const r = s.get(SENT_AHEAD_KEY);
    r.onsuccess = () => done(r.result && typeof r.result === 'object' ? { ...(r.result as SentAheadNotes) } : {});
  });
}

/** The server's file for this picture, if it was sent ahead and the note is still good. */
export async function sentAheadFor(name: string): Promise<SentAhead | null> {
  try {
    const n = (await readSentAhead())[name];
    return n && Date.now() - n.at < SENT_AHEAD_GOOD_MS ? n : null;
  } catch { return null; }
}

/** Which of these names are sent ahead with a good note. */
export async function namesSentAhead(names: string[]): Promise<Set<string>> {
  try {
    const notes = await readSentAhead();
    return new Set(names.filter((n) => notes[n] && Date.now() - notes[n].at < SENT_AHEAD_GOOD_MS));
  } catch { return new Set(); }
}

/** Note a picture as sent (and drop notes that are no longer good), in one step. */
export async function noteSentAhead(name: string, sent: Omit<SentAhead, 'at'>): Promise<void> {
  await step<void>('readwrite', (s) => {
    const r = s.get(SENT_AHEAD_KEY);
    r.onsuccess = () => {
      const notes: SentAheadNotes = r.result && typeof r.result === 'object' ? { ...(r.result as SentAheadNotes) } : {};
      for (const k of Object.keys(notes)) if (Date.now() - notes[k].at >= SENT_AHEAD_GOOD_MS) delete notes[k];
      notes[name] = { ...sent, at: Date.now() };
      s.put(notes, SENT_AHEAD_KEY);
    };
  });
}

/** The project that names these pictures is on the server: their notes have done their work. */
export async function forgetSentAhead(names: string[]): Promise<void> {
  if (!names.length) return;
  await step<void>('readwrite', (s) => {
    const r = s.get(SENT_AHEAD_KEY);
    r.onsuccess = () => {
      if (!r.result || typeof r.result !== 'object') return;
      const notes = { ...(r.result as SentAheadNotes) };
      for (const n of names) delete notes[n];
      s.put(notes, SENT_AHEAD_KEY);
    };
  }).catch(() => undefined);
}

/** The name a picture is filed under (made from its content; remembered). */
export function nameOfPicture(src: string): Promise<string> { return nameOf(src); }

// The name of a picture is made from its content once and remembered while the
// picture is in use (the text of a picture is its own key here — nothing is copied).
const _nameOf = new Map<string, string>();

async function nameOf(src: string): Promise<string> {
  const known = _nameOf.get(src);
  if (known) return known;
  const name = `${await fingerprint(src)}_${src.length}`;
  _nameOf.set(src, name);
  return name;
}

const isPicture = (v: unknown): v is string => typeof v === 'string' && v.length >= MIN_LENGTH && v.startsWith('data:');
const isRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith(PIC_REF);
const isPlain = (v: unknown): v is Record<string, unknown> | unknown[] => {
  if (v === null || typeof v !== 'object') return false;
  if (Array.isArray(v)) return true;
  const p = Object.getPrototypeOf(v);
  return p === Object.prototype || p === null;
};

function collect(v: unknown, test: (x: unknown) => x is string, into: Set<string>): void {
  if (test(v)) { into.add(v); return; }
  if (!isPlain(v)) return;
  if (Array.isArray(v)) { for (const x of v) collect(x, test, into); return; }
  for (const k in v) collect((v as Record<string, unknown>)[k], test, into);
}

/** A copy with `swap` applied to every text that passes `test`. Only the parts
 *  that hold such a text are copied — the rest is shared with the original,
 *  which is never touched (it is the live project). */
function swapped<T>(v: T, test: (x: unknown) => x is string, swap: (s: string) => string): T {
  if (test(v)) return swap(v) as unknown as T;
  if (!isPlain(v)) return v;
  if (Array.isArray(v)) {
    let out: unknown[] | null = null;
    for (let i = 0; i < v.length; i++) {
      const n = swapped(v[i], test, swap);
      if (n !== v[i]) { if (!out) out = v.slice(); out[i] = n; }
    }
    return (out ?? v) as unknown as T;
  }
  let out: Record<string, unknown> | null = null;
  for (const k in v) {
    const old = (v as Record<string, unknown>)[k];
    const n = swapped(old, test, swap);
    if (n !== old) { if (!out) out = { ...(v as Record<string, unknown>) }; out[k] = n; }
  }
  return (out ?? v) as unknown as T;
}

/** FOR THE SIMULATOR: how many pictures a thing holds inside it, and how many it names. */
export function countPictures(v: unknown): { inside: number; named: number; lengths: number } {
  const inside = new Set<string>(), named = new Set<string>();
  const all: string[] = [];
  const walk = (x: unknown): void => {
    if (isPicture(x)) { inside.add(x); all.push(x); return; }
    if (isRef(x)) { named.add(x); return; }
    if (!isPlain(x)) return;
    if (Array.isArray(x)) { for (const y of x) walk(y); return; }
    for (const k in x) walk((x as Record<string, unknown>)[k]);
  };
  walk(v);
  return { inside: inside.size, named: named.size, lengths: all.reduce((n, p) => n + p.length, 0) };
}

/** The names of the pictures a light save or copy holds. */
export function namesIn(light: unknown): string[] {
  const refs = new Set<string>();
  collect(light, isRef, refs);
  return [...refs].map((r) => r.slice(PIC_REF.length));
}

export interface TakenOut<T> {
  /** the same thing, each picture replaced by its name */
  light: T;
  /** the names it holds */
  names: string[];
  /** how many pictures had to be written now (0 on an ordinary save) */
  written: number;
}

/**
 * Every picture in `whole` is put on the device (those not there yet), and a
 * copy of `whole` comes back with the names in their place. Throws if a
 * picture could not be written — then nothing may be saved that names it.
 */
export async function takePicturesOut<T>(whole: T): Promise<TakenOut<T>> {
  const pictures = new Set<string>();
  collect(whole, isPicture, pictures);
  const already = new Set<string>();
  collect(whole, isRef, already);                        // a copy that is light already keeps its names
  const names: string[] = [...already].map((r) => r.slice(PIC_REF.length));
  if (pictures.size === 0) return { light: whole, names, written: 0 };

  const named = new Map<string, string>();
  for (const src of pictures) named.set(src, await nameOf(src));
  // the remembered names are only a short cut: those of pictures this thing no
  // longer holds are let go, so a replaced photo is not kept in memory by them
  for (const src of _nameOf.keys()) if (!pictures.has(src)) _nameOf.delete(src);
  // What is on the device is ASKED each time, names only — another window, or
  // iOS, may have removed something since the last save.
  const have = new Set(await picNames());
  let written = 0;
  for (const [src, name] of named) {
    if (have.has(name)) continue;
    await step<void>('readwrite', (s) => { s.put(src, name); });   // one picture, one step
    have.add(name);
    written++;
  }
  for (const name of named.values()) if (!names.includes(name)) names.push(name);
  // (a picture that came into the live project while the others were being
  // written is not known here — it stays as it is and is taken out next time)
  return { light: swapped(whole, isPicture, (src) => (named.has(src) ? PIC_REF + named.get(src)! : src)), names, written };
}

/**
 * The pictures are put back where their names stand. `light` itself is changed
 * (it has just been read from the device and belongs to nobody else). Returns
 * how many names had no picture on the device — those places are left empty.
 */
export async function putPicturesBack<T>(light: T): Promise<{ whole: T; missing: number }> {
  const refs = new Set<string>();
  collect(light, isRef, refs);
  if (refs.size === 0) return { whole: light, missing: 0 };
  const got = new Map<string, string>();
  let missing = 0;
  for (const ref of refs) {
    const name = ref.slice(PIC_REF.length);
    const src = await step<string | undefined>('readonly', (s, done) => {
      const r = s.get(name);
      r.onsuccess = () => done(typeof r.result === 'string' ? r.result : undefined);
    });
    if (src) { got.set(ref, src); _nameOf.set(src, name); } else missing++;
  }
  const fill = (v: unknown): unknown => {
    if (isRef(v)) return got.get(v) ?? '';
    if (!isPlain(v)) return v;
    if (Array.isArray(v)) { for (let i = 0; i < v.length; i++) { const x = v[i]; if (typeof x === 'string' || isPlain(x)) v[i] = fill(x); } return v; }
    for (const k in v) { const x = (v as Record<string, unknown>)[k]; if (typeof x === 'string' || isPlain(x)) (v as Record<string, unknown>)[k] = fill(x); }
    return v;
  };
  return { whole: fill(light) as T, missing };
}

// A picture nothing names is removed only at the SECOND look that finds it
// unnamed, at least a minute after the first.
let _unnamedAtLastLook = new Set<string>();
let _lastLook = 0;

/** Is it time for a look? (so the caller reads its lists only then) */
export function dueForALook(): boolean { return Date.now() - _lastLook >= 60_000; }

/** Remove pictures no save and no copy names any more. Returns how many went. */
export async function removeUnnamedPictures(named: Set<string>, now = false): Promise<number> {
  if (!now && Date.now() - _lastLook < 60_000) return 0;
  const unnamed = (await picNames()).filter((n) => !named.has(n));
  const go = now ? unnamed : unnamed.filter((n) => _unnamedAtLastLook.has(n));
  _unnamedAtLastLook = new Set(unnamed);
  _lastLook = Date.now();
  if (go.length) {
    await step<void>('readwrite', (s) => { for (const n of go) s.delete(n); });
    const gone = new Set(go);
    for (const [src, n] of _nameOf) if (gone.has(n)) _nameOf.delete(src);
    _unnamedAtLastLook = new Set(unnamed.filter((n) => !gone.has(n)));
  }
  return go.length;
}

/** Everything gone (the account was deleted on this device). */
export async function clearAllPictures(): Promise<void> {
  await step<void>('readwrite', (s) => { s.clear(); });
  _nameOf.clear();
  _unnamedAtLastLook = new Set();
}

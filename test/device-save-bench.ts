// THE BENCH: the device's save without its pictures inside it (12 Nov 2026).
//
// Run:  npm run bench:save
//
// Rule number one is never to lose work, and this is the code that writes the
// work onto the device. So it is driven here against a small stand-in for the
// browser's database, with every way it could lose a picture tried:
//   · the save holds no picture, the pictures are each there once, and reading
//     the save gives back exactly what was saved
//   · an ordinary second save writes no picture again
//   · a copy of unsent work names its pictures; its safety copy shares them
//   · the list of copies names exactly the copies, and their pictures
//   · a picture nothing names goes only at the second look, a minute later;
//     a named picture never goes
//   · a save or a copy from BEFORE this change (pictures inside) still reads,
//     and nothing is removed while such a one is about
//   · a name without its picture leaves an empty place, not a failed start

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---- a small stand-in for IndexedDB: copies values in and out as the real one does
type Rec = Map<string, unknown>;
const _dbs = new Map<string, { version: number; stores: Map<string, { data: Rec; keyPath: string | null }> }>();
const later = (fn: () => void) => setTimeout(fn, 0);
const clone = <T,>(v: T): T => (v === undefined ? v : structuredClone(v));

function makeRequest<T>(tx: any, run: () => T): any {
  const req: any = { result: undefined, error: null, onsuccess: null, onerror: null };
  tx._pending++;
  later(() => {
    try { req.result = run(); req.onsuccess?.({ target: req }); }
    catch (e) { req.error = e; req.onerror?.({ target: req }); tx._failed = e; }
    tx._pending--;
    tx._settle();
  });
  return req;
}

function makeStore(tx: any, st: { data: Rec; keyPath: string | null }): any {
  return {
    put: (v: any, k?: string) => makeRequest(tx, () => { st.data.set(String(st.keyPath ? v[st.keyPath] : k), clone(v)); return k; }),
    get: (k: string) => makeRequest(tx, () => clone(st.data.get(String(k)))),
    getKey: (k: string) => makeRequest(tx, () => (st.data.has(String(k)) ? k : undefined)),
    delete: (k: string) => makeRequest(tx, () => { st.data.delete(String(k)); }),
    clear: () => makeRequest(tx, () => { st.data.clear(); }),
    getAllKeys: () => makeRequest(tx, () => [...st.data.keys()]),
    getAll: () => makeRequest(tx, () => [...st.data.values()].map(clone)),
    count: () => makeRequest(tx, () => st.data.size),
    createIndex: () => undefined,
  };
}

(globalThis as any).indexedDB = {
  open(name: string, version = 1) {
    const req: any = { result: undefined, onsuccess: null, onerror: null, onupgradeneeded: null };
    later(() => {
      let d = _dbs.get(name);
      const fresh = !d || d.version < version;
      if (!d) { d = { version, stores: new Map() }; _dbs.set(name, d); }
      d.version = Math.max(d.version, version);
      const D = d;
      const db: any = {
        objectStoreNames: { contains: (n: string) => D.stores.has(n) },
        createObjectStore: (n: string, o?: { keyPath?: string }) => { const st = { data: new Map(), keyPath: o?.keyPath ?? null }; D.stores.set(n, st); return makeStore({ _pending: 0, _settle() {} }, st); },
        transaction: (names: string | string[]) => {
          const tx: any = { _pending: 0, _failed: null, oncomplete: null, onerror: null, onabort: null, error: null };
          tx._settle = () => later(() => {
            if (tx._pending > 0 || tx._done) return;
            tx._done = true;
            if (tx._failed) { tx.error = tx._failed; tx.onabort?.(); } else tx.oncomplete?.();
          });
          tx.objectStore = (n: string) => {
            if (![names].flat().includes(n)) throw new Error(`store ${n} is not part of this step`);
            return makeStore(tx, D.stores.get(n)!);
          };
          tx._settle();
          return tx;
        },
        close() {},
      };
      req.result = db;
      if (fresh) req.onupgradeneeded?.();
      req.onsuccess?.();
    });
    return req;
  },
};

// ---- the bench
let failed = 0;
function check(what: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '  ok  ' : '  FAIL'}  ${what}${ok || !detail ? '' : `\n          ${detail}`}`);
  if (!ok) failed++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const raw = (db: string, store: string) => _dbs.get(db)?.stores.get(store)?.data ?? new Map<string, unknown>();
const picture = (seed: string) => `data:image/jpeg;base64,${seed.repeat(Math.ceil(6000 / seed.length))}`;
const holdsAPicture = (v: unknown) => /data:image[^"]{4000,}/.test(JSON.stringify(v));

function project(id: string | null, pics: string[]): any {
  return {
    projectId: id, name: 'BENCH', lastModified: 1, nextId: 10,
    frames: [
      { id: 1, label: '1', src: pics[0] ?? '', r2Key: null, strokes: [{ pts: [1, 2, 3] }] },
      { id: 2, label: '2', src: pics[1] ?? '', tiny: 'data:image/png;base64,AAAA' },
    ],
    stripVersions: { ver: { 1: [{ id: 'v1', bgImage: pics[2] ?? '' }, { id: 'v2', bgImage: pics[0] ?? '' }] }, floor: {}, refs: {} },
    contentStamps: { a: 1 },
  };
}

async function main(): Promise<void> {
  const P = await import('../src/lib/persistence');
  const S = await import('../src/lib/picStore');
  const A = picture('Aa1+'), B = picture('Bb2/'), C = picture('Cc3='), D = picture('Dd4-');

  console.log('\n1. A save holds no picture; each picture is on the device once; reading gives back what was saved');
  const one = project('p1', [A, B, C]);
  const before = JSON.stringify(one);
  await P.saveSnapshot(one);
  check('the live project was not touched by the save', JSON.stringify(one) === before);
  check('the save on the device holds no picture', !holdsAPicture(raw('framehow', 'state').get('currentProject')));
  check('three pictures on the device (A is used twice, kept once)', raw('framehow-pics', 'pics').size === 3, `there are ${raw('framehow-pics', 'pics').size}`);
  check('the tiny mark stayed where it was', JSON.stringify(raw('framehow', 'state').get('currentProject')).includes('data:image/png;base64,AAAA'));
  check('reading the save gives back exactly what was saved', same(await P.loadSnapshot(), one));
  check('whose save it is can be asked without reading it', (await P.savedProjectId()) === 'p1');

  console.log('\n2. An ordinary second save writes no picture again; a new picture is written once');
  let puts = 0;
  const picsData = raw('framehow-pics', 'pics');
  const realSet = picsData.set.bind(picsData);
  picsData.set = ((k: string, v: unknown) => { puts++; return realSet(k, v); }) as never;
  one.frames[0].label = 'renamed';
  await P.saveSnapshot(one);
  check('a rename writes no picture', puts === 0, `${puts} written`);
  one.frames[1].src = D;
  await P.saveSnapshot(one);
  check('a new photo writes one picture', puts === 1, `${puts} written`);
  check('and it comes back', same(await P.loadSnapshot(), one));

  console.log('\n3. A copy of unsent work names its pictures; its safety copy shares them');
  await P.savePending('p1', 'p1', 'BENCH', one);
  check('the copy on the device holds no picture', !holdsAPicture(raw('framehow', 'pending').get('p1')));
  check('reading the copy gives the whole project', same((await P.getPending('p1'))?.snapshot, one));
  const sizeBefore = raw('framehow-pics', 'pics').size;
  await P.markPendingUploaded('p1');
  const list = await P.listPending();
  check('one safety copy, the unsent one gone', list.length === 1 && list[0].key.startsWith('archive:p1:'), list.map((l) => l.key).join(', '));
  check('no picture was written for the safety copy', raw('framehow-pics', 'pics').size === sizeBefore);
  check('the list names its three pictures (A, C and the new one)', (list[0].pics ?? []).length === 3, `${(list[0].pics ?? []).length} named`);
  check('the list says how many shots and that it has its memory', list[0].frames === 2 && list[0].stamped === true);
  check('the safety copy opens whole', same((await P.getPending(list[0].key))?.snapshot, one));
  const both = await P.pendingIndexAndStore();
  check('the list of copies names exactly the copies', same(both.list, both.store), `${both.list} vs ${both.store}`);

  console.log('\n4. A picture nothing names goes only at the second look, a minute later; a named one never');
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  const two = project('p2', [B]);                       // another project is opened: names only B
  await P.saveSnapshot(two);
  await new Promise((r) => setTimeout(r, 30));          // (the tidy after a save runs by itself)
  check('nothing is removed at the first look', raw('framehow-pics', 'pics').size === 4, `${raw('framehow-pics', 'pics').size} left`);
  clock += 61_000;
  await P.saveSnapshot(two);
  await new Promise((r) => setTimeout(r, 30));
  check('…nor a minute later: every one is still named, by the open project or by the safety copy', raw('framehow-pics', 'pics').size === 4, `${raw('framehow-pics', 'pics').size} left`);
  await P.clearPending(list[0].key);                    // the safety copy has had its 72 hours
  clock += 61_000;
  await P.saveSnapshot(two);
  await new Promise((r) => setTimeout(r, 30));
  check('first look after the copy went: still there', raw('framehow-pics', 'pics').size === 4, `${raw('framehow-pics', 'pics').size} left`);
  clock += 61_000;
  await P.saveSnapshot(two);
  await new Promise((r) => setTimeout(r, 30));
  check('second look: the three unnamed pictures are gone, B stays', raw('framehow-pics', 'pics').size === 1, `${raw('framehow-pics', 'pics').size} left`);
  check('the open project still reads whole', same(await P.loadSnapshot(), two));
  check('no copies, no list', raw('framehow', 'pending').size === 0, [...raw('framehow', 'pending').keys()].join(', '));

  console.log('\n5. A save and a copy from BEFORE this change (pictures inside) still read; nothing is removed meanwhile');
  const old = project('p3', [A, C]);
  raw('framehow', 'state').set('currentProject', structuredClone(old));
  raw('framehow', 'state').delete('currentProjectWhose');
  raw('framehow', 'pending').set('p9', { key: 'p9', projectId: 'p9', name: 'OLD COPY', savedAt: 5, snapshot: structuredClone(old) });
  check('the old save reads as it is', same(await P.loadSnapshot(), old));
  check('whose it is: read from the old save itself', (await P.savedProjectId()) === 'p3');
  const oldList = await P.listPending();
  check('the old copy is on the list (noted at the first listing)', oldList.length === 1 && oldList[0].name === 'OLD COPY' && oldList[0].frames === 2);
  check('the old copy opens whole', same((await P.getPending('p9'))?.snapshot, old));
  clock += 61_000; await S.removeUnnamedPictures(new Set(['x']));   // a look happened long ago…
  raw('framehow-pics', 'pics').set('stray', picture('Zz9!'));
  clock += 200_000;
  await P.savePending('p9', 'p9', 'OLD COPY', old);     // the copy is written anew: light now
  check('written anew, the copy is light', !holdsAPicture(raw('framehow', 'pending').get('p9')));
  check('and still opens whole', same((await P.getPending('p9'))?.snapshot, old));
  check('a picture nothing names was not removed while an old-style save was about', raw('framehow-pics', 'pics').has('stray'));

  console.log('\n6. A name without its picture leaves an empty place, not a failed start');
  await P.saveSnapshot(one);
  const names = [...raw('framehow-pics', 'pics').keys()];
  const victim = (raw('framehow', 'state').get('currentProject') as any).frames[0].src.slice(S.PIC_REF.length);
  raw('framehow-pics', 'pics').delete(victim);
  const holed = await P.loadSnapshot();
  check('the project still opens', !!holed && holed.frames.length === 2, `names were ${names.length}`);
  check('the place of the missing picture is empty', (holed as any).frames[0].src === '');
  check('the other pictures are there', (holed as any).frames[1].src === D);

  console.log('\n7. A picture that comes into the live project while the others are being written is not lost');
  const live = project('p5', [A]);
  const saving = P.saveSnapshot(live);
  live.frames[1].src = picture('Ee5#');                 // arrives mid-save
  await saving;
  const midSave = raw('framehow', 'state').get('currentProject') as any;
  check('the save names no picture it did not write', !JSON.stringify(midSave).includes('fhpic:undefined'));
  await P.saveSnapshot(live);
  check('the next save has it, and it reads back', same(await P.loadSnapshot(), live));

  Date.now = realNow;
  console.log(failed ? `\n${failed} FAILED\n` : '\nall good\n');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

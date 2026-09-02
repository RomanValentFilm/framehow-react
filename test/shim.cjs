// The store touches a few browser things when it loads. The bench only needs
// them to exist — it never draws anything.
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = globalThis.navigator ?? { userAgent: 'bench' };
// The sync log reads location.search to decide whether it is switched on. Without
// this the whole settings bench died on `location is not defined` — and had been
// dead for a while, unnoticed, because nothing looks at a bench that never runs.
globalThis.location = globalThis.location ?? { search: '', href: 'http://bench/' };

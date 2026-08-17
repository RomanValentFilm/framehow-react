// The store touches a few browser things when it loads. The bench only needs
// them to exist — it never draws anything.
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.window = globalThis;
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.navigator = globalThis.navigator ?? { userAgent: 'bench' };

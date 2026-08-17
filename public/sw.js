// Offline is not a feature here, it is the point: the app is used on set, where
// there is often no signal at all.
//
// CACHE_VERSION and the asset list are rewritten by scripts/postbuild.mjs, which
// fills in the hashed file names of the build. Do not hand-edit those.
const CACHE_VERSION = 'framehow-v6';
const ASSETS = [
  './',
  './index.html',
  './icons/icon_192.png',
  './icons/icon_512.png',
  './manifest.json'
];

// Install: cache the shell AND the app's own code. Pre-caching the shell alone
// was not enough — the main JavaScript file is renamed on every release, so it
// only reached the cache if the app happened to be opened online first. Open the
// app offline right after an update and there was nothing to run: the iPad said
// it could not open because it was not connected.
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      // addAll fails as a whole if any one file 404s, which would leave NO
      // cache at all. One at a time, so a missing file costs only that file.
      .then(cache => Promise.all(ASSETS.map(a => cache.add(a).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

// Activate: clear old caches
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: network first, fall back to the cache — so an update arrives as soon as
// there is a network, and the app still opens when there is none.
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Only this app's own files. The API is never cached: a stale answer about the
  // project is worse than no answer, and the app already knows what to do when a
  // request fails.
  if (new URL(e.request.url).origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_VERSION).then(cache => cache.put(e.request, clone));
        return response;
      })
      .catch(async () => {
        // ignoreSearch: a home-screen launch can carry a query string, and an
        // exact match then misses a page that is sitting right there.
        const hit = await caches.match(e.request, { ignoreSearch: true });
        if (hit) return hit;
        // Any navigation, however it was addressed, can be answered with the
        // app shell — the app then loads its work from this device.
        if (e.request.mode === 'navigate') {
          const shell = await caches.match('./index.html', { ignoreSearch: true })
            || await caches.match('./', { ignoreSearch: true });
          if (shell) return shell;
        }
        return Response.error();
      })
  );
});

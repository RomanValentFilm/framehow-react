import fs from 'fs';
import path from 'path';

// Ensure dist root exists
fs.mkdirSync('dist', { recursive: true });

// Landing page → dist/index.html
fs.copyFileSync('landing.html', 'dist/index.html');

// Hero image → dist/img/framehow-hero.png
fs.mkdirSync('dist/img', { recursive: true });
fs.copyFileSync('landing-assets/framehow-hero.png', 'dist/img/framehow-hero.png');

// _redirects for Cloudflare Pages SPA routing under /app/
fs.writeFileSync('dist/_redirects', '/app/* /app/index.html 200\n');

// The PDF engine is a separate, hashed file that is normally only fetched the
// first time a PDF is imported — so a device that has never imported one
// cannot import offline, and every release renames the file and undoes any
// caching. Name it in the service worker's install list so each new build
// fetches it up front, automatically.
// The app must open with NO network — it is used on set. That means the service
// worker has to pre-cache the app's own code, not just the page shell: every
// release renames these files, so relying on them being fetched once while
// online meant the first offline launch after an update had nothing to run.
//
// The PDF engine is here for the same reason: it is normally only fetched the
// first time a PDF is imported, so a device that has never imported one could
// not import offline.
const assetsDir = 'dist/app/assets';
const swPath = 'dist/app/sw.js';
if (fs.existsSync(assetsDir) && fs.existsSync(swPath)) {
  const files = fs.readdirSync(assetsDir);
  const needed = files.filter((f) => /\.(js|mjs|css)$/.test(f) && !f.endsWith('.map'));
  const main = needed.find((f) => /^index-.*\.js$/.test(f));
  const worker = needed.find((f) => /^pdf\.worker.*\.mjs$/.test(f));

  let sw = fs.readFileSync(swPath, 'utf8');
  sw = sw.replace(
    "  './manifest.json'",
    ["  './manifest.json'", ...needed.map((f) => `  './assets/${f}'`)].join(',\n'),
  );
  // Name the cache after the main file, so every release installs a fresh one
  // and the old one is deleted. Without this, an update could leave the previous
  // release's files behind as the only offline copy.
  if (main) {
    sw = sw.replace(/const CACHE_VERSION = '([^']+)'/, `const CACHE_VERSION = '$1-${main}'`);
  }
  fs.writeFileSync(swPath, sw);
  console.log(`Post-build: service worker will pre-cache ${needed.length} app file(s)`);
  if (!worker) console.warn('Post-build: PDF engine not found — offline PDF import may not work');
} else {
  console.warn('Post-build: no service worker or assets found — the app may not open offline');
}

console.log('Post-build: landing page, hero image, _redirects written to dist/');

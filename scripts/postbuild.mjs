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
const assetsDir = 'dist/app/assets';
if (fs.existsSync(assetsDir)) {
  const worker = fs.readdirSync(assetsDir).find((f) => /^pdf\.worker.*\.mjs$/.test(f));
  const swPath = 'dist/app/sw.js';
  if (worker && fs.existsSync(swPath)) {
    let sw = fs.readFileSync(swPath, 'utf8');
    sw = sw.replace("  './manifest.json'", `  './manifest.json',\n  './assets/${worker}'`);
    // Version the cache by the worker name so a new build always reinstalls.
    sw = sw.replace(/const CACHE_VERSION = '([^']+)'/, `const CACHE_VERSION = '$1-${worker}'`);
    fs.writeFileSync(swPath, sw);
    console.log('Post-build: service worker will pre-cache', worker);
  } else {
    console.warn('Post-build: PDF engine not found — offline PDF import may not work');
  }
}

console.log('Post-build: landing page, hero image, _redirects written to dist/');

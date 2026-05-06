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

console.log('Post-build: landing page, hero image, _redirects written to dist/');

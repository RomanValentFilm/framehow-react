import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './App';

// THE FRAMEHOW APP: no glass bar (arrows + tick) above the keyboard (Roman, 4 Nov).
if ((window as any).Capacitor?.isNativePlatform?.()) {
  // (the plugin's web side is not bundled: the shell registers it natively)
  (window as any).Capacitor?.Plugins?.Keyboard?.setAccessoryBarVisible?.({ isVisible: false });
}

// NO SUGGESTIONS, NO AUTOCORRECT, ANYWHERE (Roman, 4 Nov): on the iPhone in
// landscape the suggestion strip on top of the keyboard ate the last of the
// screen. Every field, present and future, gets the three attributes.
(() => {
  const quiet = (el: Element) => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement).isContentEditable)) return;
    el.setAttribute('autocomplete', 'off');
    el.setAttribute('autocorrect', 'off');
    el.setAttribute('spellcheck', 'false');
  };
  const sweep = (root: ParentNode) => root.querySelectorAll('input,textarea,[contenteditable]').forEach(quiet);
  sweep(document);
  new MutationObserver((muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n instanceof Element) { quiet(n); sweep(n); }
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
})();

// THE FRAMEHOW APP (4 Nov): belt and braces for the script in index.html — in
// the shell the page runs under the clock and needs the real top inset.
if ((window as any).Capacitor?.isNativePlatform?.()) document.documentElement.classList.remove('fh-opaque-bar');

const TestPage = lazy(() => import('./TestPage'));
const isTestPage = window.location.hash === '#test';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isTestPage ? (
      <Suspense fallback={<div style={{ color: '#fff', padding: 40 }}>Loading test harness…</div>}>
        <TestPage />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>
);

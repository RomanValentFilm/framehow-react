import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './App';

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

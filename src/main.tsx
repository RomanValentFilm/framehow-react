import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './App';

// THE FRAMEHOW APP (Capacitor shell, 4 Nov): the page knows it runs in the
// shell, so the CSS can give the top row the full safe area under the clock.
if ((window as any).Capacitor?.isNativePlatform?.()) document.documentElement.classList.add('fh-shell');

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

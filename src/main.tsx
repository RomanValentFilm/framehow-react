import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/globals.css';
import App from './App';

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

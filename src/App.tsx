import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { ViewBar } from './components/ViewBar';
import { StripColumns } from './components/StripColumns';
import { Modals } from './components/Modals';
import { Overlays } from './components/Overlays';
import { AccountModals } from './components/AccountModals';
import { initFramehow } from './lib/init';

export default function App() {
  useEffect(() => {
    // Init must run after DOM is mounted so getElementById finds all the IDs.
    initFramehow();
  }, []);

  return (
    <>
      <Toolbar />
      <ViewBar />
      <StripColumns />
      <Modals />
      <Overlays />
      <AccountModals />
    </>
  );
}

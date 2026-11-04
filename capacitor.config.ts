import type { CapacitorConfig } from '@capacitor/cli';

// THE FRAMEHOW iPHONE/iPAD SHELL (Capacitor 8, 4 Nov 2026).
// It loads the web app from the server — decided 4 Nov (licence agreement 3.3.1 B
// allows interpreted code as long as the app's purpose stays the same): every dev
// deploy shows up in the app at once, nothing is bundled. Switch `url` to
// https://framehow.com/app/ for the live app. The native camera comes as a plugin.
const config: CapacitorConfig = {
  appId: 'com.framehow.app',
  appName: 'Framehow',
  webDir: 'dist/app',
  server: {
    url: 'https://dev.framehow-react.pages.dev/app/',
    cleartext: false,
  },
  ios: {
    // The page runs under the status bar, as in Safari (viewport-fit=cover); the
    // app's own CSS pads the menu bar with env(safe-area-inset-top). 'automatic'
    // pushed the page down below the status bar as well: black above the menu
    // bar and a double gap (Roman, 4 Nov).
    contentInset: 'never',
    backgroundColor: '#333333',   // the menu bar's grey, for any strip the page does not cover
  },
};

export default config;

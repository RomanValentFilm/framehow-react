import { APP_VERSION } from '../store/state';
import { toggleSyncLog } from '../lib/syncTrace';

export function Toolbar() {
  // Three taps on the version number turn the sync log on or off. The log used
  // to need ?fhsync=1 in the address, which a home-screen app has no way to
  // carry — so the iPad, where the sync trouble lives, could not show one.
  let taps = 0;
  let tapTimer: number | undefined;
  const tapVersion = () => {
    taps += 1;
    window.clearTimeout(tapTimer);
    tapTimer = window.setTimeout(() => { taps = 0; }, 1500);
    if (taps >= 3) {
      taps = 0;
      const on = toggleSyncLog();
      // Debug mode also decides whether the offline cache may run on the dev
      // address, and that is only read when the app starts (#274).
      // Hiding the strip does not leave debug mode — the offline cache keeps
      // working, so the app can be used with the buttons unobstructed (#275).
      if (on) alert('Log on — reload once if you want to test offline');
    }
  };

  return (
    <div className="toolbar" id="mainToolbar">
      <div className="logo">
        Frame<span>how</span>
        <span
          onClick={tapVersion}
          title="tap three times for the sync log"
          style={{fontSize:'9px',color:'#555',marginLeft:'6px',letterSpacing:'0.02em',cursor:'pointer',padding:'4px'}}
        >{APP_VERSION}</span>
      </div>
      <span className="frame-badge" id="frameBadge">no frames</span>
      <span className="toolbar-project-name" id="toolbarProjectName">UNTITLED</span>
      <div className="toolbar-right">
        <div className="load-menu-wrap">
          <button className="btn btn-accent" id="mainMenuBtn">
            Menu ▾
          </button>
          <div className="load-menu" id="mainMenu">
            <button id="menuNewProject">New Project</button>
            <button id="menuLoadProject">Open Project</button>
            <button id="menuSaveProject">Save Project</button>
            <div
              style={{
                height: 20,
                background: '#000',
                margin: 0,
                borderTop: '1px solid var(--border)',
                borderBottom: 'none',
              }}
            />
            <button id="menuRestoreProject">Restore Project</button>
            <div
              style={{
                height: 20,
                background: '#000',
                margin: 0,
                borderTop: '1px solid var(--border)',
                borderBottom: 'none',
              }}
            />
            <button id="menuAdjustPdf">Adjust PDF Import</button>
            <div
              style={{
                height: 20,
                background: '#000',
                margin: 0,
                borderTop: '1px solid var(--border)',
                borderBottom: 'none',
              }}
            />
            <button id="menuCustomise">Customise</button>
            <div
              style={{
                height: 20,
                background: '#000',
                margin: 0,
                borderTop: '1px solid var(--border)',
                borderBottom: 'none',
              }}
            />
            <button id="menuAccount">
              Sign In
            </button>
            <div
              style={{
                height: 20,
                background: '#000',
                margin: 0,
                borderTop: '1px solid var(--border)',
                borderBottom: 'none',
              }}
            />
            <button id="menuExport">Export</button>
          </div>
        </div>
      </div>
    </div>
  );
}

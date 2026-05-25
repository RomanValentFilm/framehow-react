export function Toolbar() {
  return (
    <div className="toolbar" id="mainToolbar">
      <div className="logo">
        Frame<span>how</span>
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

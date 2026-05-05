export function Toolbar() {
  return (
    <div className="toolbar" id="mainToolbar">
      <div className="logo">
        Frame<span>how</span>
      </div>
      <span className="frame-badge" id="frameBadge">no frames</span>
      <div className="toolbar-right">
        <div className="load-menu-wrap">
          <button className="btn btn-accent" id="mainMenuBtn">
            Menu ▾
          </button>
          <div className="load-menu" id="mainMenu">
            <button id="menuLoadPdf">Load Storyboard from PDF</button>
            <button id="menuLoadImages">Load Images from Folder</button>
            <button id="menuScratch">Start from Scratch</button>
            <div
              style={{
                height: 20,
                background: '#000',
                margin: 0,
                borderTop: '1px solid var(--border)',
                borderBottom: 'none',
              }}
            />
            <button id="menuExport" style={{ borderTop: '1px solid var(--border)' }}>
              Export
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

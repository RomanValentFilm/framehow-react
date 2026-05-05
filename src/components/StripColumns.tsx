// The three scroll containers — main strip, versions strip, overview.
// Each is a container the imperative renderers populate via getElementById.

export function StripColumns() {
  return (
    <div className="columns">
      <div className="strip-col">
        <div className="strip-scroll" id="mainScroll">
          <div className="empty-state" id="emptyStateMain">
            <div className="empty-icon">◎</div>
            <p>Start your storyboard</p>
            <div className="start-options">
              <button className="btn btn-accent" id="startLoadPdf">
                Load Story&shy;board from PDF
              </button>
              <button className="btn btn-accent" id="startLoadImages">
                Load Images from Folder
              </button>
              <button className="btn btn-accent" id="startScratch">
                Start from Scratch
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="strip-col">
        <div className="strip-scroll" id="versionsScroll">
          <div className="empty-state">
            <div className="empty-icon" style={{ opacity: 0.4 }}>≡</div>
            <p style={{ opacity: 0.5 }}>
              Versions will appear<br />alongside each frame
            </p>
          </div>
        </div>
      </div>
      <div className="overview-col">
        <div className="overview-scroll" id="overviewScroll"></div>
      </div>
    </div>
  );
}

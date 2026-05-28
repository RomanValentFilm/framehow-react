// Scroll containers — main strip, versions strip, floor strip, refs strip, overview.
// Each is a container the imperative renderers populate via getElementById.

export function StripColumns() {
  return (
    <div className="columns">
      <div className="strip-col" id="mainCol" data-strip="main">
        <div className="strip-scroll" id="mainScroll">
          <div className="empty-state" id="emptyStateMain" />
        </div>
      </div>
      <div className="strip-col" id="verCol" data-strip="ver">
        <div className="strip-scroll" id="versionsScroll">
          <div className="empty-state">
            <div className="empty-icon" style={{ opacity: 0.4 }}>≡</div>
            <p style={{ opacity: 0.5 }}>
              Versions will appear<br />alongside each frame
            </p>
          </div>
        </div>
      </div>
      <div className="strip-col" id="floorCol" data-strip="floor" style={{ display: 'none' }}>
        <div className="strip-scroll" id="floorScroll">
          <div className="empty-state">
            <div className="empty-icon" style={{ opacity: 0.4 }}>⊞</div>
            <p style={{ opacity: 0.5 }}>
              Floor plans will appear<br />alongside each frame
            </p>
          </div>
        </div>
      </div>
      <div className="strip-col" id="refsCol" data-strip="refs" style={{ display: 'none' }}>
        <div className="strip-scroll" id="refsScroll">
          <div className="empty-state">
            <div className="empty-icon" style={{ opacity: 0.4 }}>⊡</div>
            <p style={{ opacity: 0.5 }}>
              References will appear<br />alongside each frame
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

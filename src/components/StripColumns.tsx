// Scroll containers — main strip + dynamic version strips + overview.
// Each is a container the imperative renderers populate via getElementById.
// Strip columns are generated from DEFAULT_STRIP_DEFS — adding a strip there
// automatically creates its column here.

import { DEFAULT_STRIP_DEFS } from '../store/state';

const SCROLL_ID_OVERRIDES: Record<string, string> = { ver: 'versionsScroll' };

export function StripColumns() {
  return (
    <div className="columns">
      {/* Main strip — always present */}
      <div className="strip-col" id="mainCol" data-strip="main">
        <div className="strip-scroll" id="mainScroll">
          <div className="empty-state" id="emptyStateMain" />
        </div>
      </div>
      {/* Dynamic strip columns from stripDefs */}
      {DEFAULT_STRIP_DEFS.map((def, i) => {
        const scrollId = SCROLL_ID_OVERRIDES[def.id] || `${def.id}Scroll`;
        const isFirst = i === 0;
        return (
          <div
            key={def.id}
            className="strip-col"
            id={`${def.id}Col`}
            data-strip={def.id}
            style={isFirst ? undefined : { display: 'none' }}
          >
            <div className="strip-scroll" id={scrollId}>
              <div className="empty-state">
                <div className="empty-icon" style={{ opacity: 0.4 }}>≡</div>
                <p style={{ opacity: 0.5 }}>
                  {def.defaultFrameLabel} tabs will appear<br />alongside each frame
                </p>
              </div>
            </div>
          </div>
        );
      })}
      {/* Overview column */}
      <div className="overview-col">
        <div className="overview-scroll" id="overviewScroll"></div>
      </div>
    </div>
  );
}

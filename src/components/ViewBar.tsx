import { DEFAULT_STRIP_DEFS } from '../store/state';

export function ViewBar() {
  return (
    <>
      <div className="view-bar">
        {/* LEFT GROUP — iPad/Desktop only */}
        <div className="view-btns vb-left">
          <button className="view-btn vb-desktop-only" data-view="group" title="Group">GROUP</button>
          <button className="view-btn vb-desktop-only" data-view="3x2" title="3×2 View">3×2{' '}VIEW</button>
          <button className="view-btn vb-desktop-only" data-view="setups" id="setupsBtn" title="Setups">SETUPS</button>
        </div>

        {/* Flexible spacer */}
        <div className="vb-spacer" />

        {/* MIDDLE GROUP — strip selectors (toggleable), built from stripDefs */}
        <div className="view-btns vb-middle">
          <button className="view-btn strip-toggle active" data-strip="main" title="Main Strip">MAIN</button>
          {DEFAULT_STRIP_DEFS.map((def, i) => (
            <button
              key={def.id}
              className={`view-btn strip-toggle${i === 0 ? ' active' : ''}`}
              data-strip={def.id}
              id={`stripBtn-${def.id}`}
              title={def.defaultFrameLabel}
            >
              {def.buttonLabel}
            </button>
          ))}
        </div>

        {/* Flexible spacer */}
        <div className="vb-spacer" />

        {/* RIGHT GROUP — special layout overrides */}
        <div className="view-btns vb-right">
          <button className="view-btn vb-off-btn" id="vbOffBtn" data-view="off" title="Back to columns" style={{display:'none'}}>OFF<svg width="10" height="10" viewBox="0 0 10 10" style={{flexShrink:0}}><path d="M2 1l6 4-6 4z" fill="#fff"/></svg></button>
          <button className="view-btn" data-view="overview" title="Main + 2 Versions">M+2</button>
          <button className="view-btn" data-view="grid4" title="Main + 3 Versions">M+3</button>
        </div>
      </div>
      {/* Setup bar — hidden by default, shown when SETUPS mode is active */}
      <div className="setup-bar" id="setupBar" style={{display:'none'}}></div>
    </>
  );
}

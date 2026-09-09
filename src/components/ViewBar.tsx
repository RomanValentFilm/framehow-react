import { DEFAULT_STRIP_DEFS } from '../store/state';

export function ViewBar() {
  return (
    <>
      <div className="view-bar">
        {/* LEFT GROUP — GROUP & SETUPS */}
        <div className="view-btns vb-left">
          <button className="view-btn vb-desktop-only" data-view="group" title="Group">GROUP</button>
          <button className="view-btn vb-desktop-only" data-view="setups" id="setupsBtn" title="Setups">SETUPS</button>
        </div>

        {/* MIDDLE GROUP — 3×2VIEW & SORT BY */}
        <div className="view-btns vb-middle">
          <button className="view-btn vb-desktop-only" data-view="3x2" title="3×2 View">3×2VIEW</button>
          <div className="vb-sep-hair" />
          <button className="view-btn vb-desktop-only" data-view="sortby" id="sortByBtn" title="Sort By">SORT BY</button>
        </div>

        {/* RIGHT GROUP — was the DETAIL toggle, gone in #483.
            Roman: "on ipad, we do not need the DETAIL bar anymore as we suppose
            to see the detail bar always on / same on desktop" and then "we also
            do not need the DETAIL button on iPHONE anymore". The detail bar is
            simply always there now, so a button to summon it is one press that
            can only ever go wrong. The empty group is kept so the three-column
            layout of the bar is unchanged. */}
        <div className="view-btns vb-right" />
      </div>

      {/* DETAIL BAR — toggled by DETAIL button */}
      {/* ALWAYS OPEN (#483) — it used to start hidden and wait for DETAIL. */}
      <div className="detail-bar" id="detailBar">
        <div className="db-left" />
        <div className="view-btns db-middle">
          <button className="view-btn strip-toggle" data-strip="main" title="Main Strip">SHOT</button>
          {DEFAULT_STRIP_DEFS.map((def, i) => (
            <button
              key={def.id}
              className="view-btn strip-toggle"
              data-strip={def.id}
              id={`stripBtn-${def.id}`}
              title={def.defaultFrameLabel}
            >
              {def.buttonLabel}
            </button>
          ))}
          <div className="vb-sep" />
          <button className="view-btn" id="needsStripBtn" data-view="needs" title="Needs">NEEDS</button>
          <button className="view-btn" id="notesStripBtn" data-view="notes" title="Notes">NOTES</button>
        </div>
        <div className="view-btns db-right">
          <button className="view-btn vb-off-btn" id="vbOffBtn" data-view="off" title="Back to columns" style={{display:'none'}}>CLOSE<svg width="10" height="10" viewBox="0 0 10 10" style={{flexShrink:0}}><path d="M2 1l6 4-6 4z" fill="#fff"/></svg></button>
          <button className="view-btn" data-view="overview" title="Main + 2 Versions">M+2</button>
          <button className="view-btn" data-view="grid4" title="Main + 3 Versions">M+3</button>
        </div>
      </div>

      {/* Setup bar — hidden by default, shown when SETUPS mode is active */}
      <div className="setup-bar" id="setupBar" style={{display:'none'}}></div>
      {/* Sort order dropdown — hidden by default */}
      <div className="sort-dropdown" id="sortDropdown" style={{display:'none'}}></div>
      {/* Sort order frame-set edit view — hidden by default */}
      <div className="sort-edit-view" id="sortEditView" style={{display:'none'}}></div>
    </>
  );
}

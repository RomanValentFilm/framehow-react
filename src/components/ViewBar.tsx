export function ViewBar() {
  return (
    <div className="view-bar">
      {/* LEFT GROUP — iPad/Desktop only */}
      <div className="view-btns vb-left">
        <button className="view-btn vb-desktop-only" data-view="group" title="Group">GROUP</button>
        <button className="view-btn vb-desktop-only" data-view="3x2" title="3×2">3×2</button>
      </div>

      {/* Flexible spacer */}
      <div className="vb-spacer" />

      {/* MIDDLE GROUP */}
      <div className="view-btns vb-middle">
        <button className="view-btn" data-view="main" title="Main Strip only">MAIN</button>
        <button className="view-btn" data-view="ver" title="Versions Strip only">VRSN</button>
        <button className="view-btn active" data-view="both" title="Both strips">TWIN</button>
      </div>

      {/* Flexible spacer */}
      <div className="vb-spacer" />

      {/* RIGHT GROUP */}
      <div className="view-btns vb-right">
        <button className="view-btn" data-view="overview" title="Full Overview">GRID</button>
        <button className="view-btn" data-view="grid4" title="4-Column Grid">GRID4</button>
      </div>
    </div>
  );
}

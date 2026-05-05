export function ViewBar() {
  return (
    <div className="view-bar">
      <span className="strip-label" id="labelMain">Main strip</span>
      <div className="view-btns">
        <button className="view-btn" data-view="main" title="Main Strip only">◧</button>
        <button className="view-btn" data-view="ver" title="Versions Strip only">◨</button>
        <button className="view-btn active" data-view="both" title="Both strips">◫</button>
        <button className="view-btn" data-view="overview" title="Full Overview">▦</button>
      </div>
      <span className="strip-label" id="labelVer">Versions strip</span>
    </div>
  );
}

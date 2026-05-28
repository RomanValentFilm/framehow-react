// Toast, rotate-msg, swipe-hint, hidden file inputs.

export function Overlays() {
  return (
    <>
      <div className="toast" id="toast"></div>
      <div className="rotate-msg" id="rotateMsg">
        <span>
          ROTATE SCREEN<br />FOR BEST VIEW
        </span>
      </div>
      <div className="rotate-msg" id="overviewPhoneMsg">
        <span>
          Full Overview<br />
          available only on your<br />
          Tablet or Desktop
        </span>
      </div>
      <div className="rotate-msg" id="camBlockedMsg">
        <span>
          Camera was blocked,<br />
          after you denied access 3 times.
          <br />
          <br />
          Close and reopen Framehow<br />
          to allow camera access again.
        </span>
      </div>
      <div className="rotate-msg" id="maxStripsMsg">
        <span>
          You can fit maximum 2 STRIPS VIEW<br />
          on this device's screen.<br />
          <br />
          Please toggle-off a strip's button<br />
          to select another one.
        </span>
      </div>
      <div className="swipe-hint" id="swipeHint">
        <div className="swipe-hint-inner">
          <div className="swipe-label">Swipe over image</div>
          <div className="swipe-dir" style={{ fontSize: 36, fontWeight: 900 }}>
            ←&#8194;→
          </div>
          <div className="swipe-sub">to see versions</div>
        </div>
      </div>
      <input type="file" id="pdfInput" accept="application/pdf" className="hidden" />
      <input type="file" id="folderImgInput" accept="image/*" multiple className="hidden" />
      <input type="file" id="imgInput" accept="image/*" multiple className="hidden" />
      <input type="file" id="mainImgInput" accept="image/*" className="hidden" />
      <input type="file" id="camFallbackInput" accept="image/*" capture="environment" className="hidden" />
    </>
  );
}

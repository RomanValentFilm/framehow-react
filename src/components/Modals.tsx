// All modal markup — confirm/choice/label/text/export/pptx/crop/camera/fullscreen/etc.
// Imperative code in src/lib/modals.ts and src/lib/exports.ts manipulates these
// by ID (preserving the original DOM contract).

export function Modals() {
  return (
    <>
      <div className="startup-loading-line hidden" id="startupLoadingLine">
        <div className="bar"></div>
      </div>
      <div className="progress-overlay hidden" id="progressOverlay">
        <div className="progress-label" id="progressLabel">Loading PDF…</div>
        <div className="progress-bar-wrap">
          <div className="progress-bar" id="progressBar" style={{ width: '0%' }}></div>
        </div>
      </div>

      {/* Crop UI */}
      <div className="crop-overlay hidden" id="cropOverlay">
        <div className="crop-area" id="cropArea">
          <img id="cropImg" />
          <div className="crop-guide" id="cropGuide"></div>
        </div>
        <div className="crop-controls">
          <button className="crop-btn" id="cropCancel">Cancel</button>
          <button className="crop-btn crop-btn-confirm" id="cropConfirm">Use Photo</button>
        </div>
      </div>

      {/* Camera viewfinder */}
      <div className="camera-overlay hidden" id="cameraOverlay">
        <div className="camera-video-wrap" id="cameraVideoWrap">
          <video id="cameraVideo" autoPlay playsInline muted></video>
          <div className="camera-guide" id="cameraGuide"></div>
          <div className="exp-range-wrap" id="expWrap">
            <input type="range" id="expRange" min="-200" max="200" defaultValue="0" step="1" />
          </div>
          <div className="camera-controls">
            <button className="camera-cancel" id="cameraCancel">Cancel</button>
            <button className="camera-snap" id="cameraSnap"></button>
            <button className="camera-flip" id="cameraFlip">⟲</button>
          </div>
        </div>
      </div>

      {/* Overwrite content confirmation */}
      <div className="account-modal hidden" id="overwriteModal">
        <div className="account-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: '14px' }}>Are you sure you want to overwrite the current content?</h2>
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-accent" id="overwriteCancel">Cancel</button>
            <button className="btn" id="overwriteYes">Yes</button>
            <button className="btn" id="overwriteNewProject" style={{ background: '#333', borderColor: '#555' }}>New Project</button>
          </div>
        </div>
      </div>

      <div className="confirm-modal hidden" id="confirmModal">
        <div className="confirm-modal-box">
          <p id="confirmMsg"></p>
          <div className="confirm-modal-btns">
            <button className="btn" id="confirmNo">Cancel</button>
            <button
              className="btn"
              id="confirmYes"
              style={{ background: '#e53935', borderColor: '#e53935', color: '#fff' }}
            >
              Yes
            </button>
          </div>
        </div>
      </div>

      <div className="confirm-modal hidden" id="choiceModal">
        <div className="confirm-modal-box">
          <div id="choiceContent"></div>
        </div>
      </div>

      <div className="label-modal hidden" id="labelModal">
        <div className="label-modal-box">
          <p>You are changing the frame number.</p>
          <input type="text" id="labelModalInput" maxLength={20} placeholder="e.g. 1A, Scene 3..." />
          <div className="label-modal-btns">
            <button className="btn" id="labelCancel">Cancel</button>
            <button
              className="btn"
              id="labelOk"
              style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}
            >
              OK
            </button>
          </div>
        </div>
      </div>

      <div className="label-modal hidden" id="verLabelModal">
        <div className="label-modal-box">
          <p>Edit strip name</p>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0', justifyContent: 'center' }}>
            <span
              id="verLabelPrefix"
              style={{
                fontFamily: 'var(--mono)',
                fontSize: '16px',
                color: 'var(--text-muted)',
                background: 'var(--surface2)',
                border: '1px solid var(--border)',
                borderRight: 'none',
                borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)',
                padding: '8px 8px 8px 10px',
                whiteSpace: 'nowrap',
              }}
            />
            <input
              type="text"
              id="verLabelInput"
              maxLength={6}
              placeholder="version"
              style={{
                borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
                textAlign: 'left',
                width: '110px',
              }}
            />
          </div>
          <div className="label-modal-btns">
            <button className="btn" id="verLabelCancel">Cancel</button>
            <button
              className="btn"
              id="verLabelOk"
              style={{ background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }}
            >
              OK
            </button>
          </div>
        </div>
      </div>

      <div className="text-modal hidden" id="textModal">
        <div className="text-modal-box">
          <textarea id="textModalArea" rows={5} placeholder="Enter text (max 5 lines)"></textarea>
          <div className="text-modal-colors" id="textModalColors"></div>
          <div className="text-modal-btns">
            <button className="btn" id="textModalCancel">Cancel</button>
            <button className="btn btn-accent" id="textModalOk">OK</button>
          </div>
        </div>
      </div>

      <div className="export-chooser hidden" id="exportChooser">
        <div className="export-chooser-box">
          <div className="export-chooser-title">Export as</div>
          <button className="export-fmt-btn" id="exportFmtPDF">
            <span className="export-fmt-icon">
              <svg width="20" height="22" viewBox="0 0 20 22" fill="none">
                <rect x="2" y="0" width="16" height="20" rx="1.5" stroke="#ccc" strokeWidth="1.2" />
                <path d="M13 0L18 5" stroke="#ccc" strokeWidth="1" />
                <path d="M13 0L13 5L18 5" fill="#555" stroke="#ccc" strokeWidth="1" />
                <line x1="5" y1="9" x2="12" y2="9" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="5" y1="12" x2="13" y2="12" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="5" y1="15" x2="10" y2="15" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </span>
            <span>PDF</span>
          </button>
          <button className="export-fmt-btn" id="exportFmtPPTX">
            <span className="export-fmt-icon">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="0" y="0" width="22" height="15" rx="2" stroke="#ccc" strokeWidth="1.2" />
                <rect x="2" y="2" width="18" height="11" rx="0.5" fill="#555" stroke="none" />
                <line x1="5" y1="5" x2="14" y2="5" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
                <rect x="5" y="7" width="5" height="4" rx="0.5" fill="#aaa" opacity="0.5" />
                <rect x="12" y="7" width="5" height="4" rx="0.5" fill="#aaa" opacity="0.5" />
                <path d="M11 15L11 18" stroke="#ccc" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="4" y1="20" x2="18" y2="20" stroke="#ccc" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span>
              Keynote / PowerPoint
              <br />
              <span className="export-fmt-sub">.pptx — opens in both</span>
            </span>
          </button>
          <button className="export-fmt-btn" id="exportFmtImages">
            <span className="export-fmt-icon">
              <svg width="20" height="18" viewBox="0 0 20 18" fill="none">
                <rect x="4" y="0" width="16" height="12" rx="1.5" stroke="#ccc" strokeWidth="1" />
                <rect x="0" y="4" width="16" height="12" rx="1.5" fill="#2a2a2a" stroke="#ccc" strokeWidth="1.2" />
                <circle cx="5" cy="9" r="2" stroke="#aaa" strokeWidth="1" fill="none" />
                <path d="M0 14L5 10L9 13L12 10L16 14" stroke="#aaa" strokeWidth="1" strokeLinejoin="round" fill="none" />
              </svg>
            </span>
            <span>
              Images
              <br />
              <span className="export-fmt-sub">.jpg — individual frames</span>
            </span>
          </button>
          <button
            className="export-fmt-btn"
            id="exportFmtCancel"
            style={{ background: 'transparent', borderColor: 'var(--border)', marginTop: '4px' }}
          >
            <span className="export-fmt-icon">✕</span>
            <span style={{ color: 'var(--text-muted)' }}>Cancel</span>
          </button>
        </div>
      </div>

      <div className="export-modal hidden" id="exportModal">
        <div className="export-modal-box">
          <div className="exp-title">Export as PDF</div>
          <div className="exp-field">
            <label>Project name</label>
            <input type="text" id="exportProjectName" placeholder="Storyboard" />
          </div>
          <div className="exp-field" id="exportGroupPickerWrap" style={{ display: 'none' }}>
            <label>Select group to export</label>
            <div className="exp-group-picker" id="exportGroupPicker"></div>
          </div>
          <div className="exp-field">
            <label>Layout</label>
            <label className="exp-opt">
              <input type="radio" name="exportLayout" value="main" defaultChecked />
              <span className="exp-opt-wrap">
                <svg className="exp-opt-icon" width="76" height="54" viewBox="0 0 76 54">
                  <rect x="0.5" y="0.5" width="75" height="53" rx="2" fill="#222" stroke="#555" strokeWidth="0.8" />
                  <rect x="5" y="5" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="28" y="5" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="51" y="5" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="5" y="33" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="28" y="33" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="51" y="33" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                </svg>
                <span className="exp-opt-text">
                  <strong>Main Frames only</strong>
                </span>
              </span>
            </label>
            <label className="exp-opt">
              <input type="radio" name="exportLayout" value="double" />
              <span className="exp-opt-wrap">
                <svg className="exp-opt-icon" width="44" height="62" viewBox="0 0 44 62">
                  <rect x="0.5" y="0.5" width="43" height="61" rx="2" fill="#222" stroke="#555" strokeWidth="0.8" />
                  <rect x="4" y="4" width="15" height="10" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="22" y="4" width="18" height="10" rx="1" fill="#aaa" stroke="#666" strokeWidth="1.2" />
                  <rect x="4" y="18" width="15" height="10" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="22" y="18" width="18" height="10" rx="1" fill="#aaa" stroke="#666" strokeWidth="1.2" />
                  <rect x="4" y="32" width="15" height="10" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="22" y="32" width="18" height="10" rx="1" fill="#aaa" stroke="#666" strokeWidth="1.2" />
                  <rect x="4" y="46" width="15" height="10" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="22" y="46" width="18" height="10" rx="1" fill="#aaa" stroke="#666" strokeWidth="1.2" />
                </svg>
                <span className="exp-opt-text">
                  <strong>Double Strip</strong>
                  <span className="exp-sub">Main Frame + Selected Frame</span>
                </span>
              </span>
            </label>
            <div className="exp-inline-controls" id="exportDoubleStripWrap" style={{ display: 'none' }}>
              <div className="exp-strip-picker" id="exportDoubleStripPicker"></div>
              <div className="exp-double-mode">
                <label className="exp-strip-opt">
                  <input type="radio" name="exportDoubleMode" value="starred" defaultChecked />
                  <span>Main + Starred Frame</span>
                </label>
                <label className="exp-strip-opt">
                  <input type="radio" name="exportDoubleMode" value="active" />
                  <span>Main + Active Frame</span>
                </label>
              </div>
            </div>
            <label className="exp-opt">
              <input type="radio" name="exportLayout" value="overview" />
              <span className="exp-opt-wrap">
                <svg className="exp-opt-icon" width="76" height="54" viewBox="0 0 76 54">
                  <rect x="0.5" y="0.5" width="75" height="53" rx="2" fill="#222" stroke="#555" strokeWidth="0.8" />
                  <rect x="4" y="4" width="32" height="19" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="40" y="4" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="4" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="40" y="14.5" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="14.5" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="4" y="29" width="32" height="19" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="40" y="29" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="29" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="40" y="39.5" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="39.5" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                </svg>
                <span className="exp-opt-text">
                  <strong>Full Overview</strong>
                  <span className="exp-sub">Main Frame + selected strips with their versions</span>
                </span>
              </span>
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="exportIncludeHidden" /> Include hidden frames
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="exportIncludeText" defaultChecked /> Include text descriptions for storyboard frames
            </label>
          </div>
          <div className="exp-field" id="exportTableToggleWrap" style={{ display: 'none' }}>
            <label className="exp-inline">
              <input type="checkbox" id="exportIncludeTable" defaultChecked /> Include Table
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="exportPaperLetter" /> US Letter paper (default A4)
            </label>
          </div>
          <div className="exp-field" id="exportOverviewStripWrap" style={{ display: 'none' }}>
            <label>SELECT STRIPS TO INCLUDE</label>
            <div className="exp-strip-picker" id="exportOverviewStripPicker"></div>
          </div>
          <div className="exp-field" id="exportVersionPickerWrap" style={{ display: 'none' }}>
            <label>SELECT VERSIONS TO INCLUDE</label>
            <div className="exp-version-picker" id="exportVersionPicker"></div>
          </div>
          <div className="text-modal-btns">
            <button className="btn" id="exportCancel">Cancel</button>
            <button className="btn btn-accent" id="exportGo">Export</button>
          </div>
        </div>
      </div>

      <div className="export-modal hidden" id="pptxModal">
        <div className="export-modal-box">
          <div className="exp-title">Export as Keynote / PowerPoint</div>
          <div className="exp-field">
            <label>Project name</label>
            <input type="text" id="pptxProjectName" placeholder="Storyboard" />
          </div>
          <div className="exp-field" id="pptxGroupPickerWrap" style={{ display: 'none' }}>
            <label>Select group to export</label>
            <div className="exp-group-picker" id="pptxGroupPicker"></div>
          </div>
          <div className="exp-field">
            <label>Layout</label>
            <label className="exp-opt">
              <input type="radio" name="pptxLayout" value="main" defaultChecked />
              <span className="exp-opt-wrap">
                <svg className="exp-opt-icon" width="76" height="54" viewBox="0 0 76 54">
                  <rect x="0.5" y="0.5" width="75" height="53" rx="2" fill="#222" stroke="#555" strokeWidth="0.8" />
                  <rect x="5" y="5" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="28" y="5" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="51" y="5" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="5" y="33" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="28" y="33" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="51" y="33" width="20" height="13" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                </svg>
                <span className="exp-opt-text">
                  <strong>Main Frames only</strong>
                </span>
              </span>
            </label>
            <label className="exp-opt">
              <input type="radio" name="pptxLayout" value="double" />
              <span className="exp-opt-wrap">
                <svg className="exp-opt-icon" width="76" height="54" viewBox="0 0 76 54">
                  <rect x="0.5" y="0.5" width="75" height="53" rx="2" fill="#222" stroke="#555" strokeWidth="0.8" />
                  <rect x="4" y="8" width="15" height="10" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="22" y="8" width="18" height="10" rx="1" fill="#aaa" stroke="#666" strokeWidth="1.2" />
                  <rect x="4" y="28" width="15" height="10" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="22" y="28" width="18" height="10" rx="1" fill="#aaa" stroke="#666" strokeWidth="1.2" />
                  <rect x="44" y="8" width="15" height="10" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="56" y="8" width="18" height="10" rx="1" fill="#aaa" stroke="#666" strokeWidth="1.2" />
                  <rect x="44" y="28" width="15" height="10" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="56" y="28" width="18" height="10" rx="1" fill="#aaa" stroke="#666" strokeWidth="1.2" />
                </svg>
                <span className="exp-opt-text">
                  <strong>Double Strip</strong>
                  <span className="exp-sub">Main Frame + Selected Frame</span>
                </span>
              </span>
            </label>
            <div className="exp-inline-controls" id="pptxDoubleStripWrap" style={{ display: 'none' }}>
              <div className="exp-strip-picker" id="pptxDoubleStripPicker"></div>
              <div className="exp-double-mode">
                <label className="exp-strip-opt">
                  <input type="radio" name="pptxDoubleMode" value="starred" defaultChecked />
                  <span>Main + Starred Frame</span>
                </label>
                <label className="exp-strip-opt">
                  <input type="radio" name="pptxDoubleMode" value="active" />
                  <span>Main + Active Frame</span>
                </label>
              </div>
            </div>
            <label className="exp-opt">
              <input type="radio" name="pptxLayout" value="overview" />
              <span className="exp-opt-wrap">
                <svg className="exp-opt-icon" width="76" height="54" viewBox="0 0 76 54">
                  <rect x="0.5" y="0.5" width="75" height="53" rx="2" fill="#222" stroke="#555" strokeWidth="0.8" />
                  <rect x="4" y="4" width="32" height="19" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="40" y="4" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="4" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="40" y="14.5" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="14.5" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="4" y="29" width="32" height="19" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="40" y="29" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="29" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="40" y="39.5" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="39.5" width="14" height="8.5" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                </svg>
                <span className="exp-opt-text">
                  <strong>Full Overview</strong>
                  <span className="exp-sub">Main Frame + selected strips with their versions</span>
                </span>
              </span>
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="pptxIncludeHidden" /> Include hidden frames
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="pptxIncludeText" defaultChecked /> Include text descriptions
            </label>
          </div>
          <div className="exp-field" id="pptxTableToggleWrap" style={{ display: 'none' }}>
            <label className="exp-inline">
              <input type="checkbox" id="pptxIncludeTable" defaultChecked /> Include Table
            </label>
          </div>
          <div className="exp-field" id="pptxOverviewStripWrap" style={{ display: 'none' }}>
            <label>SELECT STRIPS TO INCLUDE</label>
            <div className="exp-strip-picker" id="pptxOverviewStripPicker"></div>
          </div>
          <div className="exp-field" id="pptxVersionPickerWrap" style={{ display: 'none' }}>
            <label>SELECT VERSIONS TO INCLUDE</label>
            <div className="exp-version-picker" id="pptxVersionPicker"></div>
          </div>
          <div className="text-modal-btns">
            <button className="btn" id="pptxCancel">Cancel</button>
            <button className="btn btn-accent" id="pptxGo">Export</button>
          </div>
        </div>
      </div>

      {/* Image export modal — group picker before export */}
      <div className="export-modal hidden" id="imageExportModal">
        <div className="export-modal-box">
          <div className="exp-title">Export as Images</div>
          <div className="exp-field">
            <label>Project name</label>
            <input type="text" id="imageExportProjectName" placeholder="Storyboard" />
          </div>
          <div className="exp-field" id="imageGroupPickerWrap" style={{ display: 'none' }}>
            <label>Select group to export</label>
            <div className="exp-group-picker" id="imageGroupPicker"></div>
          </div>
          <div className="exp-field">
            <label>SELECT STRIPS TO INCLUDE</label>
            <div className="exp-strip-picker" id="imageStripPicker"></div>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="imageIncludeHiddenMain" /> Include hidden main frames
            </label>
          </div>
          <div className="exp-field">
            <label>SELECT VERSION FRAMES TO INCLUDE</label>
            <div className="exp-strip-picker">
              <label className="exp-strip-opt">
                <input type="radio" name="imageVersionScope" value="starred" defaultChecked />
                <span>Starred frames only</span>
              </label>
              <label className="exp-strip-opt">
                <input type="radio" name="imageVersionScope" value="active" />
                <span>Active frames only</span>
              </label>
              <label className="exp-strip-opt">
                <input type="radio" name="imageVersionScope" value="all" />
                <span>All (including hidden versions)</span>
              </label>
            </div>
          </div>
          <div className="text-modal-btns">
            <button className="btn" id="imageExportCancel">Cancel</button>
            <button className="btn btn-accent" id="imageExportGo">Export</button>
          </div>
        </div>
      </div>

      {/* Portrait (9:16) export chooser */}
      <div className="export-chooser hidden" id="portraitExportChooser">
        <div className="export-chooser-box">
          <div className="export-chooser-title">Export 9:16 Project</div>
          <button className="export-fmt-btn" id="portraitFmtPDF">
            <span className="export-fmt-icon">
              <svg width="20" height="22" viewBox="0 0 20 22" fill="none">
                <rect x="2" y="0" width="16" height="20" rx="1.5" stroke="#ccc" strokeWidth="1.2" />
                <path d="M13 0L18 5" stroke="#ccc" strokeWidth="1" />
                <path d="M13 0L13 5L18 5" fill="#555" stroke="#ccc" strokeWidth="1" />
                <line x1="5" y1="9" x2="12" y2="9" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="5" y1="12" x2="13" y2="12" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="5" y1="15" x2="10" y2="15" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </span>
            <span>PDF</span>
          </button>
          <button className="export-fmt-btn" id="portraitFmtPPTX">
            <span className="export-fmt-icon">
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <rect x="0" y="0" width="22" height="15" rx="2" stroke="#ccc" strokeWidth="1.2" />
                <rect x="2" y="2" width="18" height="11" rx="0.5" fill="#555" stroke="none" />
                <line x1="5" y1="5" x2="14" y2="5" stroke="#aaa" strokeWidth="1.2" strokeLinecap="round" />
                <rect x="5" y="7" width="5" height="4" rx="0.5" fill="#aaa" opacity="0.5" />
                <rect x="12" y="7" width="5" height="4" rx="0.5" fill="#aaa" opacity="0.5" />
                <path d="M11 15L11 18" stroke="#ccc" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="4" y1="20" x2="18" y2="20" stroke="#ccc" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span>
              Keynote / PowerPoint
              <br />
              <span className="export-fmt-sub">.pptx — opens in both</span>
            </span>
          </button>
          <button className="export-fmt-btn" id="portraitFmtImages">
            <span className="export-fmt-icon">
              <svg width="20" height="18" viewBox="0 0 20 18" fill="none">
                <rect x="4" y="0" width="16" height="12" rx="1.5" stroke="#ccc" strokeWidth="1" />
                <rect x="0" y="4" width="16" height="12" rx="1.5" fill="#2a2a2a" stroke="#ccc" strokeWidth="1.2" />
                <circle cx="5" cy="9" r="2" stroke="#aaa" strokeWidth="1" fill="none" />
                <path d="M0 14L5 10L9 13L12 10L16 14" stroke="#aaa" strokeWidth="1" strokeLinejoin="round" fill="none" />
              </svg>
            </span>
            <span>
              Images
              <br />
              <span className="export-fmt-sub">.jpg — individual frames</span>
            </span>
          </button>
          <button
            className="export-fmt-btn"
            id="portraitFmtCancel"
            style={{ background: 'transparent', borderColor: 'var(--border)', marginTop: '4px' }}
          >
            <span className="export-fmt-icon">✕</span>
            <span style={{ color: 'var(--text-muted)' }}>Cancel</span>
          </button>
        </div>
      </div>

      {/* Portrait (9:16) export settings modal — shared by PDF & PPTX */}
      <div className="export-modal hidden" id="portraitExportModal">
        <div className="export-modal-box">
          <div className="exp-title" id="portraitExportTitle">Export 9:16 as PDF</div>
          <div className="exp-field">
            <label>Project name</label>
            <input type="text" id="portraitExportName" placeholder="Storyboard" />
          </div>
          <div className="exp-field" id="portraitGroupPickerWrap" style={{ display: 'none' }}>
            <label>Select group to export</label>
            <div className="exp-group-picker" id="portraitGroupPicker"></div>
          </div>
          <div className="exp-field">
            <label>Layout</label>
            <label className="exp-opt">
              <input type="radio" name="portraitExportLayout" value="portrait5" defaultChecked />
              <span className="exp-opt-wrap">
                <svg className="exp-opt-icon" width="76" height="54" viewBox="0 0 76 54">
                  <rect x="0.5" y="0.5" width="75" height="53" rx="2" fill="#222" stroke="#555" strokeWidth="0.8" />
                  <rect x="9" y="4" width="10" height="18" rx="1" fill="none" stroke="#999" strokeWidth="1.1" />
                  <rect x="21" y="4" width="10" height="18" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="33" y="4" width="10" height="18" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="45" y="4" width="10" height="18" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <rect x="57" y="4" width="10" height="18" rx="1" fill="#aaa" stroke="#666" strokeWidth="0.9" />
                  <line x1="9" y1="26" x2="17" y2="26" stroke="#777" strokeWidth="0.7" strokeLinecap="round" />
                  <line x1="9" y1="29" x2="15" y2="29" stroke="#666" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="9" y1="32" x2="16" y2="32" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="9" y1="35" x2="13" y2="35" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="21" y1="26" x2="29" y2="26" stroke="#777" strokeWidth="0.7" strokeLinecap="round" />
                  <line x1="21" y1="29" x2="27" y2="29" stroke="#666" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="21" y1="32" x2="28" y2="32" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="21" y1="35" x2="25" y2="35" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="33" y1="26" x2="41" y2="26" stroke="#777" strokeWidth="0.7" strokeLinecap="round" />
                  <line x1="33" y1="29" x2="39" y2="29" stroke="#666" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="33" y1="32" x2="40" y2="32" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="33" y1="35" x2="37" y2="35" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="45" y1="26" x2="53" y2="26" stroke="#777" strokeWidth="0.7" strokeLinecap="round" />
                  <line x1="45" y1="29" x2="51" y2="29" stroke="#666" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="45" y1="32" x2="52" y2="32" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="45" y1="35" x2="49" y2="35" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="57" y1="26" x2="65" y2="26" stroke="#777" strokeWidth="0.7" strokeLinecap="round" />
                  <line x1="57" y1="29" x2="63" y2="29" stroke="#666" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="57" y1="32" x2="64" y2="32" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                  <line x1="57" y1="35" x2="61" y2="35" stroke="#555" strokeWidth="0.5" strokeLinecap="round" />
                </svg>
                <span className="exp-opt-text">
                  <strong>Main + 4 Versions</strong>
                  <span className="exp-sub">5 vertical frames per row, text &amp; table below</span>
                </span>
              </span>
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="portraitIncludeHidden" /> Include hidden frames
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="portraitIncludeText" /> Include text descriptions
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="portraitIncludeTable" /> Include table
            </label>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="portraitPaperLetter" /> US Letter paper (default A4)
            </label>
          </div>
          <div className="exp-field">
            <label>SELECT STRIPS TO INCLUDE</label>
            <div className="exp-strip-picker" id="portraitStripPicker"></div>
          </div>
          <div className="exp-field">
            <label>SELECT VERSIONS TO INCLUDE</label>
            <div className="exp-strip-picker">
              <label className="exp-strip-opt">
                <input type="radio" name="portraitVersionScope" value="starred" />
                <span>Starred only</span>
              </label>
              <label className="exp-strip-opt">
                <input type="radio" name="portraitVersionScope" value="visible" defaultChecked />
                <span>Visible only</span>
              </label>
              <label className="exp-strip-opt">
                <input type="radio" name="portraitVersionScope" value="all" />
                <span>All (including hidden versions)</span>
              </label>
            </div>
          </div>
          <div className="text-modal-btns">
            <button className="btn" id="portraitExportCancel">Cancel</button>
            <button className="btn btn-accent" id="portraitExportGo">Export</button>
          </div>
        </div>
      </div>

      {/* Portrait (9:16) image export modal */}
      <div className="export-modal hidden" id="portraitImageExportModal">
        <div className="export-modal-box">
          <div className="exp-title">Export 9:16 as Images</div>
          <div className="exp-field">
            <label>Project name</label>
            <input type="text" id="portraitImageExportName" placeholder="Storyboard" />
          </div>
          <div className="exp-field" id="portraitImageGroupPickerWrap" style={{ display: 'none' }}>
            <label>Select group to export</label>
            <div className="exp-group-picker" id="portraitImageGroupPicker"></div>
          </div>
          <div className="exp-field">
            <label>SELECT STRIPS TO INCLUDE</label>
            <div className="exp-strip-picker" id="portraitImageStripPicker"></div>
          </div>
          <div className="exp-field">
            <label className="exp-inline">
              <input type="checkbox" id="portraitImageIncludeHiddenMain" /> Include hidden main frames
            </label>
          </div>
          <div className="exp-field">
            <label>SELECT VERSION FRAMES TO INCLUDE</label>
            <div className="exp-strip-picker">
              <label className="exp-strip-opt">
                <input type="radio" name="portraitImageVersionScope" value="starred" defaultChecked />
                <span>Starred frames only</span>
              </label>
              <label className="exp-strip-opt">
                <input type="radio" name="portraitImageVersionScope" value="active" />
                <span>Active frames only</span>
              </label>
              <label className="exp-strip-opt">
                <input type="radio" name="portraitImageVersionScope" value="all" />
                <span>All (including hidden versions)</span>
              </label>
            </div>
          </div>
          <div className="text-modal-btns">
            <button className="btn" id="portraitImageExportCancel">Cancel</button>
            <button className="btn btn-accent" id="portraitImageExportGo">Export</button>
          </div>
        </div>
      </div>
    </>
  );
}

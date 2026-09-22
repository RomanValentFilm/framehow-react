// Account-system modal markup. All interactive behavior is wired up by
// `lib/accountFlow.ts` via getElementById, matching the rest of the app's
// imperative pattern (see lib/modals.ts for reference).

export function AccountModals() {
  return (
    <>
      {/* Save toaster — non-modal, bottom-anchored card. */}
      <div className="save-toaster hidden" id="saveToaster" role="status" aria-live="polite">
        <div className="save-toaster-card">
          <div className="save-toaster-msg" id="saveToasterMsg" />
          <div className="save-toaster-btns">
            <button className="btn" id="saveToasterLater" type="button">Later</button>
            <button className="btn btn-accent" id="saveToasterSave" type="button">Save Now</button>
          </div>
        </div>
      </div>

      {/* Project name */}
      <div className="account-modal hidden" id="projectNameModal">
        <div className="account-card">
          <h2>Name your project</h2>
          <div className="account-row">
            <input type="text" id="projectNameInput" maxLength={200} autoComplete="one-time-code" />
          </div>
          <div className="account-error" id="projectNameError" />
          <div className="account-btns">
            <button className="btn" id="projectNameCancel" type="button">Cancel</button>
            <button className="btn btn-accent" id="projectNameContinue" type="button">Continue</button>
          </div>
        </div>
      </div>

      {/* Signup / login (mode toggle) */}
      <div className="account-modal hidden" id="accountModal">
        <div className="account-card">
          <div className="account-top-toggle" id="accountTopToggle" style={{display:'none'}}>
            <button className="account-link-btn" id="accountToggleTop" type="button">New here? Create an account</button>
            <p className="account-hint" style={{margin:'8px 0'}}>or</p>
          </div>
          <h2 id="accountTitle">Create your account</h2>
          <p className="account-hint" id="accountHint">A free account lets you save and edit on any device.</p>
          <div className="account-row" id="accountRowName">
            <label htmlFor="accountName">Name</label>
            <input type="text" id="accountName" autoComplete="name" maxLength={120} />
          </div>
          <div className="account-row">
            <label htmlFor="accountEmail">Email</label>
            <input type="email" id="accountEmail" autoComplete="email" />
          </div>
          <div className="account-row">
            <label htmlFor="accountPassword">Password</label>
            <input type="password" id="accountPassword" autoComplete="new-password" />
          </div>
          <div className="account-row" id="accountRowProfession">
            <label htmlFor="accountProfession">Profession <span className="account-optional">(optional)</span></label>
            <select id="accountProfession">
              <option value="">— Select —</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="director">Director</option>
              <option value="1st_ad">1st AD</option>
              <option value="script">Script</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="dop">DOP</option>
              <option value="photographer">Photographer</option>
              <option value="camera_dept">Camera Dept.</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="producer">Producer / Production Dept.</option>
              <option value="location_manager">Location Manager</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="production_designer">Production Designer / Art Dept.</option>
              <option value="costume_makeup">Costume &amp; Make-up Dept.</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="post_production">Post-Production</option>
            </select>
          </div>

          {/* AGREEING IS A DELIBERATE ACT (22 Sept). Unticked to begin with,
              and Create account is refused until it is ticked. Shown only when
              creating an account — logging in agrees to nothing new. */}
          <div className="account-row" id="accountRowTerms" style={{ flexDirection: 'row', alignItems: 'flex-start', gap: '8px' }}>
            <input type="checkbox" id="accountTerms" style={{ width: 'auto', marginTop: '2px' }} />
            <label htmlFor="accountTerms" style={{ fontSize: '12px', lineHeight: 1.45, color: '#aaa' }}>
              I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
              {' '}and acknowledge the <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </label>
          </div>

          <div className="account-error" id="accountError" />

          <div className="account-btns">
            <button className="btn" id="accountCancel" type="button">Cancel</button>
            <button className="btn btn-accent" id="accountSubmit" type="button">Create account</button>
          </div>

          <div className="account-links">
            <button className="account-link-btn" id="accountToggle" type="button">Already have an account? Log in</button>
            <button className="account-link-btn" id="accountForgot" type="button">Forgot password?</button>
          </div>
        </div>
      </div>

      {/* Forgot password — BY HAND DURING THE BETA (22 Sept).
          This used to promise "we'll email you a link" and then send nothing:
          no mail has ever left this server. Rather than a promise nobody can
          keep, it says where to write. Roman gives the new password from the
          users page and passes it on himself. */}
      <div className="account-modal hidden" id="forgotModal">
        <div className="account-card">
          <h2>Forgot your password?</h2>
          <p className="account-hint">
            Write to{' '}
            <a href="mailto:info@framehow.com?subject=Framehow%20%E2%80%94%20I%20forgot%20my%20password">
              <b>info@framehow.com</b>
            </a>{' '}
            from the address you signed up with, and we'll send you a new password.
          </p>
          <p className="account-hint" style={{ marginTop: '8px' }}>
            During the beta this is done by hand — usually within a day.
          </p>
          <div className="account-error" id="forgotError" />
          <div className="account-success" id="forgotSuccess" />
          <div className="account-btns">
            <button className="btn" id="forgotCancel" type="button">Close</button>
            {/* Opens their own mail program with the message already written.
                A machine with no mail program set up does nothing at all — so
                the address above stays on screen to be copied by hand. */}
            <button className="btn btn-accent" id="forgotWrite" type="button">Write to us</button>
          </div>
        </div>
      </div>

      {/* Reset password — opened automatically when URL has ?reset=<token> */}
      <div className="account-modal hidden" id="resetModal">
        <div className="account-card">
          <h2>Choose a new password</h2>
          <div className="account-row">
            <label htmlFor="resetPassword">New password</label>
            <input type="password" id="resetPassword" autoComplete="new-password" />
          </div>
          <div className="account-error" id="resetError" />
          <div className="account-btns">
            <button className="btn" id="resetCancel" type="button">Cancel</button>
            <button className="btn btn-accent" id="resetSubmit" type="button">Set password</button>
          </div>
        </div>
      </div>

      {/* Project list */}
      <div className="account-modal hidden" id="projectListModal">
        <div className="account-card account-card-wide">
          <div className="account-header-row">
            <h2>Open project</h2>
            <button className="btn btn-accent" id="projectListNew" type="button">New project</button>
          </div>
          <div id="projectListOfflineNote" className="hidden"
               style={{fontSize:'11px',color:'#888',margin:'-4px 0 10px'}}>
            To access your cloud projects, you have to be online.
          </div>
          <div className="project-list" id="projectListContent">
            {/* populated dynamically */}
          </div>
          <div className="account-btns" style={{justifyContent:'space-between',alignItems:'center'}}>
            <button className="btn" id="projectListEdit" type="button" style={{fontSize:'12px'}}>Edit Projects</button>
            {/* The account's storage, as the server last said it (#533): grey below 80 %, red from 80 %. */}
            <span id="projectListStorage" style={{fontSize:'11px',color:'#888',textAlign:'center'}}></span>
            <button className="btn" id="projectListClose" type="button">Close</button>
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <div className="account-modal hidden" id="deleteConfirmModal">
        <div className="account-card">
          <h2>Delete project</h2>
          <p className="account-hint">Are you sure you want to delete this project?</p>
          <div className="account-btns">
            <button className="btn" id="deleteConfirmCancel" type="button">Cancel</button>
            <button className="btn btn-danger" id="deleteConfirmYes" type="button">Yes</button>
          </div>
        </div>
      </div>

      {/* Delete notice — recoverable for 7 days */}
      <div className="account-modal hidden" id="deleteNoticeModal">
        <div className="account-card">
          <p className="account-hint" style={{margin:'16px 0'}}>This project will be permanently deleted after 7 days. Until then you can recover it from the project list.</p>
          <div className="account-btns">
            <button className="btn" id="deleteNoticeCancel" type="button">Cancel</button>
            <button className="btn btn-accent" id="deleteNoticeOk" type="button">OK</button>
          </div>
        </div>
      </div>

      {/* Recover confirmation */}
      <div className="account-modal hidden" id="recoverConfirmModal">
        <div className="account-card">
          <h2>Recover project</h2>
          <p className="account-hint">Do you want to recover this project?</p>
          <div className="account-btns">
            <button className="btn" id="recoverConfirmNo" type="button">No</button>
            <button className="btn btn-accent" id="recoverConfirmYes" type="button">Yes</button>
          </div>
        </div>
      </div>

      {/* Rename project (edit from project list) */}
      <div className="account-modal hidden" id="renameProjectModal">
        <div className="account-card">
          <h2>Rename project</h2>
          <div className="account-row">
            <input type="text" id="renameProjectInput" maxLength={200} autoComplete="one-time-code" />
          </div>
          <div className="account-error" id="renameProjectError" />
          <div className="account-btns">
            <button className="btn" id="renameProjectCancel" type="button">Cancel</button>
            <button className="btn btn-accent" id="renameProjectSave" type="button">Save</button>
          </div>
        </div>
      </div>

      {/* Account settings */}
      <div className="account-modal hidden" id="accountSettingsModal">
        <div className="account-card">
          <h2>Account</h2>

          <div className="account-row">
            <label htmlFor="settingsName">Name</label>
            <input type="text" id="settingsName" maxLength={120} autoComplete="one-time-code" />
          </div>
          <div className="account-row">
            <label htmlFor="settingsProfession">Profession <span className="account-optional">(optional)</span></label>
            <select id="settingsProfession">
              <option value="">— Select —</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="director">Director</option>
              <option value="1st_ad">1st AD</option>
              <option value="script">Script</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="dop">DOP</option>
              <option value="photographer">Photographer</option>
              <option value="camera_dept">Camera Dept.</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="producer">Producer / Production Dept.</option>
              <option value="location_manager">Location Manager</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="production_designer">Production Designer / Art Dept.</option>
              <option value="costume_makeup">Costume &amp; Make-up Dept.</option>
              <option disabled style={{ color: '#666' }}>─</option>
              <option value="post_production">Post-Production</option>
            </select>
          </div>
          <div className="account-row">
            <label>Email</label>
            <div className="account-readonly" id="settingsEmail" />
          </div>

          <div className="account-error" id="settingsError" />
          <div className="account-success" id="settingsSuccess" />

          <div className="account-btns">
            <button className="btn" id="settingsClose" type="button">Close</button>
            <button className="btn btn-accent" id="settingsSave" type="button">Save changes</button>
          </div>

          <hr className="account-sep" />

          <div className="account-actions-stack">
            <button className="btn" id="settingsChangePassword" type="button">Change password</button>
            <button className="btn" id="settingsLogout" type="button">Log out</button>
            <button className="btn btn-danger" id="settingsDeleteAccount" type="button" style={{ alignSelf: 'center', padding: '8px 24px', fontSize: '12px' }}>Delete account</button>
          </div>
        </div>
      </div>

      {/* Customise — the six column names of the project (#510) */}
      <div className="account-modal hidden" id="customiseModal">
        <div className="account-card">
          <h2>Customise</h2>
          <p className="account-hint">Column names — button, and the label on the cards</p>
          <div className="account-row">
            <label>SHOT</label>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <input type="text" id="customMain" maxLength={6} autoComplete="one-time-code" style={{textTransform:'uppercase',letterSpacing:'.05em',width:'85px',flexShrink:0}} />
            </div>
          </div>
          <div className="account-row">
            <label>STRIP 1</label>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <input type="text" id="customStrip1" maxLength={6} autoComplete="one-time-code" style={{textTransform:'uppercase',letterSpacing:'.05em',width:'85px',flexShrink:0}} />
              <span style={{color:'#666',fontSize:'12px',flexShrink:0}}>label</span>
              <input type="text" id="customFrameLabel1" maxLength={6} autoComplete="one-time-code" style={{width:'70px',fontSize:'13px',padding:'5px 8px'}} />
            </div>
          </div>
          <div className="account-row">
            <label>STRIP 2</label>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <input type="text" id="customStrip2" maxLength={6} autoComplete="one-time-code" style={{textTransform:'uppercase',letterSpacing:'.05em',width:'85px',flexShrink:0}} />
              <span style={{color:'#666',fontSize:'12px',flexShrink:0}}>label</span>
              <input type="text" id="customFrameLabel2" maxLength={6} autoComplete="one-time-code" style={{width:'70px',fontSize:'13px',padding:'5px 8px'}} />
            </div>
          </div>
          <div className="account-row">
            <label>STRIP 3</label>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <input type="text" id="customStrip3" maxLength={6} autoComplete="one-time-code" style={{textTransform:'uppercase',letterSpacing:'.05em',width:'85px',flexShrink:0}} />
              <span style={{color:'#666',fontSize:'12px',flexShrink:0}}>label</span>
              <input type="text" id="customFrameLabel3" maxLength={6} autoComplete="one-time-code" style={{width:'70px',fontSize:'13px',padding:'5px 8px'}} />
            </div>
          </div>
          <div className="account-row">
            <label>NEEDS</label>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <input type="text" id="customNeeds" maxLength={6} autoComplete="one-time-code" style={{textTransform:'uppercase',letterSpacing:'.05em',width:'85px',flexShrink:0}} />
              <span style={{color:'#666',fontSize:'12px',flexShrink:0}}>label</span>
              <input type="text" id="customNeedsLabel" maxLength={6} autoComplete="one-time-code" style={{width:'70px',fontSize:'13px',padding:'5px 8px'}} />
            </div>
          </div>
          <div className="account-row">
            <label>NOTES</label>
            <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
              <input type="text" id="customNotes" maxLength={6} autoComplete="one-time-code" style={{textTransform:'uppercase',letterSpacing:'.05em',width:'85px',flexShrink:0}} />
              <span style={{color:'#666',fontSize:'12px',flexShrink:0}}>label</span>
              <input type="text" id="customNotesLabel" maxLength={6} autoComplete="one-time-code" style={{width:'70px',fontSize:'13px',padding:'5px 8px'}} />
            </div>
          </div>
          <div className="account-btns">
            <button className="btn" id="customiseCancel" type="button">Cancel</button>
            <button className="btn btn-accent" id="customiseSave" type="button">Save</button>
          </div>
        </div>
      </div>

      {/* Change password */}
      <div className="account-modal hidden" id="changePasswordModal">
        <div className="account-card">
          <h2>Change password</h2>
          <div className="account-row">
            <label htmlFor="cpCurrent">Current password</label>
            <input type="password" id="cpCurrent" autoComplete="current-password" />
          </div>
          <div className="account-row">
            <label htmlFor="cpNew">New password</label>
            <input type="password" id="cpNew" autoComplete="new-password" />
          </div>
          <div className="account-error" id="cpError" />
          <div className="account-btns">
            <button className="btn" id="cpCancel" type="button">Cancel</button>
            <button className="btn btn-accent" id="cpSubmit" type="button">Update password</button>
          </div>
        </div>
      </div>
    </>
  );
}

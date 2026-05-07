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
          <p className="account-hint">Give it something memorable — you can rename later.</p>
          <div className="account-row">
            <input type="text" id="projectNameInput" maxLength={200} placeholder="My storyboard" />
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
              <option value="director">Director</option>
              <option value="cinematographer">Cinematographer</option>
              <option value="producer">Producer</option>
              <option value="writer">Writer</option>
              <option value="storyboard_artist">Storyboard artist</option>
              <option value="agency_creative">Agency creative</option>
              <option value="other">Other</option>
            </select>
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

      {/* Forgot password */}
      <div className="account-modal hidden" id="forgotModal">
        <div className="account-card">
          <h2>Reset your password</h2>
          <p className="account-hint">We'll email you a link to choose a new password.</p>
          <div className="account-row">
            <label htmlFor="forgotEmail">Email</label>
            <input type="email" id="forgotEmail" autoComplete="email" />
          </div>
          <div className="account-error" id="forgotError" />
          <div className="account-success" id="forgotSuccess" />
          <div className="account-btns">
            <button className="btn" id="forgotCancel" type="button">Cancel</button>
            <button className="btn btn-accent" id="forgotSubmit" type="button">Send reset link</button>
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
            <h2>Your projects</h2>
            <button className="btn btn-accent" id="projectListNew" type="button">New project</button>
          </div>
          <div className="project-list" id="projectListContent">
            {/* populated dynamically */}
          </div>
          <div className="account-btns">
            <button className="btn" id="projectListClose" type="button">Close</button>
          </div>
        </div>
      </div>

      {/* Account settings */}
      <div className="account-modal hidden" id="accountSettingsModal">
        <div className="account-card">
          <h2>Account</h2>

          <div className="account-row">
            <label htmlFor="settingsName">Name</label>
            <input type="text" id="settingsName" maxLength={120} />
          </div>
          <div className="account-row">
            <label htmlFor="settingsProfession">Profession <span className="account-optional">(optional)</span></label>
            <select id="settingsProfession">
              <option value="">— Select —</option>
              <option value="director">Director</option>
              <option value="cinematographer">Cinematographer</option>
              <option value="producer">Producer</option>
              <option value="writer">Writer</option>
              <option value="storyboard_artist">Storyboard artist</option>
              <option value="agency_creative">Agency creative</option>
              <option value="other">Other</option>
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
            <button className="btn btn-danger" id="settingsDeleteAccount" type="button">Delete account</button>
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

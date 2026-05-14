# Framehow — Account & Sync Technical Plan

## Toaster (Save Prompt)

- Triggers when BOTH conditions are met: user has been active for 5 min AND a storyboard is loaded
- Options: **Save Now** / **Later**
- If "Later": reappears after 15 min if still unsaved, then stops for that session
- Returning user (next session, unsaved project in IndexedDB): same toaster with Save Now / Later — no restrictions, just the reminder
- Note: IndexedDB persists across browser sessions (survives closing the tab/browser). Data only disappears if the user clears site data or the browser evicts storage (can happen on mobile when storage is low, but not immediate). So "Later" is safer than it sounds — but cloud save is still the reliable long-term option.

### Toaster Message (cross-device motivation)
The message motivates saving by highlighting cross-device access:
- **On iOS/iPad**: "To edit this project on your desktop, you'll need to save it first."
- **On Desktop**: "To edit this project on your iPad or iPhone, you'll need to save it first."
- Buttons: **Save Now** / **Later**

### Only One Unsaved Project
- There can only be one unsaved project in IndexedDB at a time.
- If the user tries to load a different project while an unsaved project exists, show a warning: **"Loading a new project will replace your current unsaved work. Save it first?"** with **Save Now** / **Discard & Load**

## Save Now Flow

1. **Name the project** (first screen — user is thinking about their work, not about signing up)
2. **Create account**: Name, Email, Password, Profession (dropdown, optional)
3. **Email verification** sent (account works immediately, but remind user to verify)
4. Project saves to cloud
5. Done

Note: No username field — just Name. Avoids uniqueness headaches. If needed for collaboration later (display names, @mentions), it can be added then.

## Returning User / Login

- Login persistence: browser handles saved credentials, Face ID, Touch ID — we keep the session token alive (standard practice)
- Logged-in user opens the app with no active project → show **project list** (their saved projects) with option to create a new project
- Logged-in user opens the app with a local unsaved project → show the project + the toaster prompt as usual

## Menu Additions

- **Save Project** — manual save anytime (creates cloud save if logged in, IndexedDB if not)
- **Load Project** — open a saved project from their account (shows project list)
- **Account Settings** — overview page + edit account details + **Delete Account** button (GDPR requirement for EU users)
- **Password Reset** — standard email-based reset flow (forgot password on login screen)

## Sync

- Auto-syncs silently whenever: user is logged in AND device is online
- **Only the latest state is synced** — current strips, frames, latest version of each frame, drawings. Version history / undo stack stays local in the app only and is not synced.
- Conflict resolution: **last write wins** (fine for single-user beta — revisit before collaboration launches)
- Login persistence: browser handles it (saved credentials, Face ID, Touch ID) — we just keep the session token alive

## Delete Project

- **Soft delete**: project is marked as deleted, data kept for 10 days, then permanently removed.
- User sees the project disappear immediately. If they contact support within 10 days, it can be recovered.
- Deleting from cloud also clears the local IndexedDB copy of that project.

## Beta Approach

- Everything free during beta
- System built **collaboration-ready from day one** (data structure supports it), feature itself comes later
- Monetisation decided after beta
- Beta badge in the app manages user expectations

## Backend Stack

- **Cloudflare Workers** — API
- **D1** — users, projects, frame metadata
- **R2** — frame images (and drawing overlays) — **not yet activated**, requires payment method. Build the API with R2 bindings ready, but image upload won't work until R2 is activated. For now, images stay local (IndexedDB/canvas only).

### Storage Limits (Beta)

- **10MB** per image
- **350MB** per account
- **400 uploads per hour** per user (rate limit — prevents abuse while allowing heavy real-world use: multiple storyboards with versions in one sitting)

#### When Storage Is Full
- Account Settings shows a **storage usage bar** (e.g. "127 MB / 350 MB used")
- At **90%**: gentle warning — "You're running low on storage. Delete unused projects to free up space."
- At **100%**: block new uploads, but let the user keep working with existing content. Show: "Storage full — the beta version of Framehow has limited storage. Delete a project to free up space."
- The message should be honest and frame it as a beta limitation, not a paywall.

### Storage Alerts for Admin (Roman)
The system must notify the app owner when R2 storage usage reaches critical thresholds. This is an admin-only feature, not user-facing.

- Alert at **30%**, **50%**, **70%**, **80%**, **90%**, **95%** of the Cloudflare plan's R2 capacity
- Method: email notification to the admin email address
- Implementation: a scheduled Cloudflare Worker (cron trigger) that checks R2 usage daily and sends an alert email if a new threshold has been crossed
- Also: an admin dashboard endpoint (`GET /admin/storage`) that returns current R2 usage, number of users, number of projects, and storage per user — so the admin can check status anytime

## Database Schema

```sql
-- Users & Auth
users            → id, name, email, password_hash, profession, email_verified, created_at, updated_at
sessions         → id, user_id, token, device_info, expires_at, created_at
password_resets  → id, user_id, token, expires_at, used_at, created_at

-- Collaboration-ready (empty for now, avoids restructuring later)
project_members  → id, project_id, user_id, role, invited_at

-- Projects & Content
projects         → id, user_id, name, deleted_at, created_at, updated_at
strips           → id, project_id, label, sort_order, updated_at
frames           → id, strip_id, label, sort_order, updated_at
versions         → id, frame_id, label, type, updated_at
images           → id, version_id, r2_key, width, height, updated_at
drawings         → id, version_id, drawing_data (JSON), updated_at
```

### Schema Notes

- **`strips`** table preserves the strip/column layout — without it, the user's frame arrangement would be lost on restore
- **`frames`** belong to a strip (not directly to a project) so the layout structure is maintained
- **`drawings`** stores annotation/drawing overlay data per version as JSON — keeps drawings tied to the specific version they were drawn on
- **`project_members`** is empty for now but exists so we don't have to restructure when collaboration ships
- **`sessions`** stores auth tokens on the backend for validation — `device_info` is useful for "logged in on 2 devices" display in Account Settings
- **`password_resets`** standard token-based reset flow with expiry
- **`projects.deleted_at`** — null means active, timestamp means soft-deleted. A scheduled Worker purges projects where deleted_at is older than 10 days.
- No username field in `users` — just name. Can add later if collaboration needs it.
- All IDs should be UUIDs (not auto-increment) — better for distributed systems and avoids exposing record counts
- All `updated_at` fields are used for sync — last write wins compares these timestamps

## API Endpoints (Cloudflare Workers)

```
POST   /auth/signup          — create account
POST   /auth/login           — login, returns session token
POST   /auth/logout          — invalidate session
POST   /auth/forgot-password — send reset email
POST   /auth/reset-password  — set new password with token
GET    /auth/verify-email    — verify email with token

GET    /user/me              — get current user profile
PUT    /user/me              — update profile (name, profession)
PUT    /user/password        — change password (requires current password)
DELETE /user/me              — delete account (GDPR) — soft-deletes all projects, purges after 10 days

GET    /projects             — list user's projects (excludes soft-deleted)
POST   /projects             — create project
GET    /projects/:id         — get project with all strips/frames/versions
PUT    /projects/:id         — update project name
DELETE /projects/:id         — soft-delete project

POST   /projects/:id/sync   — sync latest project state (upload local changes)
GET    /projects/:id/sync    — get latest project state (download cloud version)

POST   /upload               — upload image to R2, returns r2_key
GET    /images/:r2_key       — get image from R2

GET    /admin/storage        — admin only: current R2 usage, user count, project count, per-user breakdown
```

## Important Notes

- **Don't break what works** — the app must work fully without an account. Accounts add saving/sync on top.
- **iPad-first** — all account UI (toaster, modals, project list) must work with touch.
- **Offline-first** — the app works offline. Sync happens when connectivity returns.
- **IndexedDB stays** — even logged-in users get local IndexedDB cache for offline use. Cloud is the source of truth, IndexedDB is the fast local copy.
- **v1.3 is sacred** — don't touch it. Account/sync goes into future versions.

# Framehow — React Port Changelog

Versions for the Vite + React + TypeScript rewrite of the original
single-file `versions/index_268b.html`. Each release tag corresponds to
a `git tag` in this repo (`git tag` to list, `git checkout <tag>` to roll back).

---

## v4.7.011 — 2026-06-26  *(current — dev)*
### Cross-device sync fixes (iPad ↔ Desktop ↔ iPhone)

1. **Idle-wake pull** (`accountFlow.ts`) — When the Desktop browser window stays
   open and visible but the user works on iPad, no `focus`/`blur` events fire.
   Now detects idle resumption: if 10+ seconds pass with no input and the user
   then moves the mouse, scrolls, or touches the screen, it cancels any pending
   push, checks the heartbeat, shows the 10-second wait overlay, and pulls from
   the server. Covers `mousemove`, `mousedown`, `keydown`, `scroll`, `wheel`
   (Desktop) and `touchstart`, `scroll` (iPad/iPhone). 5-second cooldown
   prevents rapid-fire pulls.

2. **Focus/blur push/pull ordering** (`accountFlow.ts`, `currentProject.ts`) —
   On focus: cancel pending push timers → block all new pushes → check heartbeat
   → pull from server → unblock pushes. On blur: flush-push immediately so data
   reaches the server before switching devices. Prevents stale Desktop data from
   overwriting newer iPad work.

3. **Delta push completeness** (`accountFlow.ts`) — `versionTags` (setup tags on
   strip versions) are now collected from ALL frames, not just dirty ones during
   partial/delta pushes. Groups and metadata-only changes (no frame fingerprint
   change) no longer skip the push.

4. **Frame count guard** (`accountFlow.ts`) — Frame count can never decrease
   unless tombstones account for the difference. Prevents accidental data loss
   from partial sync race conditions.

---

## v1.2 — 2026-05-05
### iOS export — "Save / Share" modal + native share sheet
- After PDF / PPTX / Images-zip generates on iOS, a small in-app modal
  appears with the filename and a **Save / Share** button.
- Tapping it calls `navigator.share({ files })`, which opens iOS's native
  share sheet — Save to Files / AirDrop / Mail / Messages / Print / any
  installed share-enabled app.
- The app never navigates away. State (frames, versions, drawing) is
  fully preserved across exports.
- Desktop export unchanged: direct download via `<a download>`.
- Removed the pre-opened tab + `location.replace` plumbing from v1.1.

## v1.1 — 2026-05-05
### iOS preview-tab back-button made inert
- Replaced `tab.location.href = url` with `tab.location.replace(url)`
  so the new preview tab has only one history entry. Pressing Safari's
  back arrow on the preview tab can no longer re-load the original app
  URL and wipe in-memory state.
- *(Superseded by v1.2 — preview tab approach removed entirely.)*

## v1.0 — 2026-05-05
### iPad / iPhone polish + native preview-tab export
- **Folder image loader fixed** — `renderAll()` wasn't called when the
  async FileReader chain completed.
- **Eraser tap on iPad** — wrapped `.eraser-btn:hover` and
  `.thick-btn:hover` in `@media (hover:hover)` to prevent the iOS Safari
  two-tap-required behavior on `:hover`-styled buttons.
- **Camera guide positioning** — added `requestAnimationFrame` + retry
  timers + a zero-size guard so the white aspect-ratio outline appears
  on iPad even when `clientWidth` reads 0 right after `display:none →
  flex`.
- **Export modal scroll on iPhone** — switched `vh` units to `dvh`
  (dynamic viewport height) so the EXPORT button stays reachable when
  Safari's URL bar shows.
- **Full Overview button on iPhone** — kept visible (was hidden); taps
  on iPhone now show a *"Full Overview available only on your Tablet
  or Desktop"* overlay instead of switching modes. iPad/desktop
  unchanged.
- **iOS exports** — pre-opened tab pattern (`window.open` synchronously
  in the user-gesture event, then redirect after async generation) to
  avoid Safari's same-tab navigation on download.

## v0 — 2026-05-04
### Initial port
- Vite + React 18 + TypeScript scaffold (sibling folder to the original
  single-file build).
- CSS copied verbatim from the original `<style>` block into
  `src/styles/globals.css`.
- Zustand store mirroring the original global mutable state
  (`frames`, `versions`, `activeTab`, draw maps, view mode, …).
- All imperative logic ported into `src/lib/` modules, organized by
  concern: `drawing`, `rasterize`, `modals`, `pdf`, `camera`, `exports`,
  `helpers`, `view`, `render`, `overview`, `actions`, `fullscreen`,
  `init`, `tracking`, `files`.
- React shell components: `Toolbar`, `ViewBar`, `StripColumns`,
  `Modals`, `Overlays`. Original element IDs preserved so imperative
  modules find them via `getElementById`.
- All CDN globals replaced with NPM imports: `pdfjs-dist@4.10.38`,
  `jspdf@2.5.x`, `pptxgenjs@3.12.x`, `tesseract.js@5.x`, `jszip@3.10.x`.
- pdfjs worker resolved via Vite's `?url` import with an ambient
  declaration in `src/vite-env.d.ts`.
- Service worker (`public/sw.js`) registered on app load — verbatim
  copy of the original.
- Telemetry (`fhTrack`) preserved verbatim, same Cloudflare worker
  endpoint, same heartbeat interval.
- Build passes: `tsc -b` clean, `vite build` produces a working bundle.

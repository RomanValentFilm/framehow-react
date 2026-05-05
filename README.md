# Framehow — React Port

A Vite + React + TypeScript rewrite of the original single-file Framehow
app (`index_268b.html`). Same features, same look, same behavior — just
restructured into modules and components.

The original (live at **framehow.com**) is a 5,300-line single-file build.
This port preserves every feature while introducing a real build pipeline
and proper file organization.

## Stack

- **Vite 5** + **React 18** + **TypeScript 5**
- **Zustand** for global state (mirrors the original's mutable globals)
- **pdfjs-dist** (PDF parsing + extraction), **jspdf** (PDF export),
  **pptxgenjs** (Keynote/PowerPoint export), **tesseract.js** (OCR
  fallback), **jszip** (image-set export)

## Architecture

React owns the static shell — toolbar, view bar, three scroll
containers, modals, hidden file inputs. All other behavior (frame
rendering, drawing, action handlers, PDF parsing, camera, exports) lives
in `src/lib/` as imperative TypeScript modules that mutate the DOM via
`getElementById`. This was a deliberate choice to keep the port at
behavioral parity with the original — converting every render path to
JSX would have introduced too much drift.

Element IDs from the original are preserved verbatim so the imperative
modules find their targets in the React-rendered DOM.

## Running locally

```sh
npm install
npm run dev          # localhost:5173
npm run build        # produces dist/
npm run preview      # serves the dist/ build
```

## Versioning

See [`CHANGELOG.md`](./CHANGELOG.md) for what's in each version. Each
tagged version (`git tag`) is also snapshotted as a folder in
`../framehow-react-versions/` for easy browsing.

## Layout

```
src/
├── main.tsx                  React entry
├── App.tsx                   Mounts shell, calls initFramehow()
├── styles/globals.css        Verbatim copy of original <style>
├── store/state.ts            Zustand store + state types
├── components/               React shells (Toolbar, ViewBar, …)
└── lib/                      Imperative modules:
    ├── constants, tracking
    ├── drawing, rasterize    Canvas primitives
    ├── modals                Imperative modal helpers
    ├── pdf                   5-pass PDF extraction + OCR
    ├── camera                Live viewfinder + native fallback + crop UI
    ├── exports               PDF / PPTX / Images
    ├── helpers               Shared HTML fragments + version utils
    ├── view                  View modes, swipe, sync heights, scroll
    ├── render                Main + version card renderers
    ├── overview              Full-overview rendering
    ├── actions               Per-card action handlers
    ├── fullscreen            Fullscreen overlay (desktop)
    ├── files                 Folder-image + scratch loaders
    └── init                  Top-level wiring
```

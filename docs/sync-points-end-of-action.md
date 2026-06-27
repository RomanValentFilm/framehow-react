# Framehow — Sync Points / End of Action Moments

> Action-complete sync: push to server at the logical end of each discrete user action,
> not on a timer. The 5-second debounce becomes a fallback safety net.
>
> Per-slot conflict resolution: each action touches a specific slot (main image, version note,
> frame label, etc.). Only the same slot on the same frame/version can conflict.
> Everything else merges cleanly — last timestamp wins per slot.

---

## PROJECT (PRJ)

| #     | Action                  | End of Action                                    | Notes                                |
|-------|-------------------------|--------------------------------------------------|--------------------------------------|
| PRJ-1 | Save project            | OK in save/name modal                            | Full project push                    |
| PRJ-5 | Rename project          | Save in rename modal                             | Project metadata only                |
| PRJ-6 | Delete project          | Confirm in dialog                                | Server-side delete                   |
| PRJ-7 | Recover deleted project | Confirm in dialog                                | Server-side recover                  |
| PRJ-8 | Import complete         | Flush sync 5s after loading bar finishes         | Covers PDF import, folder import, PDF adjust. Single flush — if it fails, 409 handler pulls+retries automatically |

PRJ-2 (Load project), PRJ-3 (New project), PRJ-4 (Restore snapshot) replace the current state entirely — no sync of the old project needed.

---

## FRAME (FRM)

| #      | Action                    | End of Action                                  | Notes                                |
|--------|---------------------------|------------------------------------------------|--------------------------------------|
| FRM-1  | Create new frame (+)      | Click "+" button                               |                                      |
| FRM-3  | Delete frame              | Choose "Delete" in choice modal                | Records tombstone                    |
| FRM-4  | Hide frame                | Choose "Hide" in choice modal                  |                                      |
| FRM-5  | Un-hide frame             | Click Un-Hide                                  |                                      |
| FRM-6  | Rename frame label        | OK / Enter in label edit                       |                                      |
| FRM-7  | Upload image to main      | File selected (dialog closes)                  |                                      |
| FRM-8  | Paste to main             | Click Paste (or confirm dialog)                | Internal clipboard paste             |
| FRM-10 | Undo on main              | Click Undo                                     |                                      |
| FRM-11 | Toggle Pic/Text/Table     | Click button                                   |                                      |
| FRM-12 | Edit text inline          | **Blur** + 5s inactivity fallback              | Blur covers tap-elsewhere and scroll-away on mobile |
| FRM-13 | Edit table cell inline    | **Blur** + 5s inactivity fallback              | Same as FRM-12                       |
| FRM-14 | Add table row             | Click "+" row button                           |                                      |
| FRM-15 | Write text stroke         | OK in text modal                               |                                      |
| FRM-16 | Edit note                 | OK in note modal                               | Uses markFrameDirty + flushSyncNow   |
| FRM-17 | Camera capture to main    | **Snap** (capture moment)                      | Not crop confirm — image data exists at snap |

---

## REORDER (ORD)

| #     | Action              | End of Action        | Notes                                |
|-------|---------------------|----------------------|--------------------------------------|
| ORD-4 | Exit reorder mode   | Click **DONE**       | Individual moves (up/down arrows) are NOT end-of-action — user typically moves several times before finishing |

---

## VERSION (VER)

| #      | Action                    | End of Action                   | Notes                                |
|--------|---------------------------|---------------------------------|--------------------------------------|
| VER-2  | Add new version (+)       | Click "+" button                |                                      |
| VER-3  | Upload to version         | File selected (dialog closes)   |                                      |
| VER-4  | Multi-file upload         | File dialog closes              | All created versions synced together |
| VER-5  | Draw on version           | **Close fullscreen canvas**     |                                      |
| VER-6  | Write text on version     | OK in text modal                |                                      |
| VER-8  | Paste to version          | Click Paste / confirm           |                                      |
| VER-9  | Hide version              | Choose "Hide" in choice modal   |                                      |
| VER-10 | Delete version            | Choose "Delete" in choice modal | Records tombstone                    |
| VER-11 | Un-hide version           | Click Un-Hide                   |                                      |
| VER-12 | Star/unstar version       | Click star icon                 |                                      |
| VER-13 | Undo on version           | Click Undo                      |                                      |
| VER-14 | Camera capture to version | **Snap** (capture moment)       |                                      |
| VER-15 | Edit note on version      | OK in note modal                | Uses markFrameDirty + flushSyncNow   |
| VER-16 | Rename strip label        | OK in label edit                |                                      |
| VER-19 | Exit version reorder      | Click **DONE**                  | Individual left/right moves are NOT end-of-action |

VER-1 (switch tab) and VER-7 (copy) do not need sync — local UI / clipboard only.

---

## DRAW (DRW)

| #     | Action                 | End of Action                   | Notes                                |
|-------|------------------------|---------------------------------|--------------------------------------|
| DRW-5 | Close fullscreen canvas | Click close / Escape / backdrop | All strokes, color, thickness, eraser changes happen inside the drawing session — the only sync point is closing the canvas |

---

## VIEW (VW) — No sync needed

View changes (3x2 grid, M+2 overview, M+3, strip toggles, cross-compare) are purely local display preferences. No server sync required.

Inline text editing in 3x2 view follows FRM-12 rules: **blur** + 5s inactivity fallback.

---

## GROUP (GRP)

| #     | Action                   | End of Action         | Notes                                |
|-------|--------------------------|-----------------------|--------------------------------------|
| GRP-1 | Create group             | Click **Save**        |                                      |
| GRP-2 | Edit group               | Click **Save**        | Covers rename + frame selection changes |
| GRP-3 | Delete group             | Confirm in dialog     |                                      |
| GRP-6 | Hide frame in group      | Choose "Hide" in choice modal |                              |
| GRP-7 | Reorder frames in group  | Click **DONE**        | Individual moves are NOT end-of-action |

GRP-4 (select active group) is local UI only — no sync needed.
GRP-5 (remove frame from group) is covered by GRP-2 (Save in group editor).

---

## SETUP (STP)

| #     | Action                     | End of Action      | Notes                                |
|-------|----------------------------|--------------------|--------------------------------------|
| STP-1 | Create new setup           | Click **CREATE**   | Name + color chosen                  |
| STP-2 | Edit setup (rename/recolor)| Click **SAVE**     |                                      |
| STP-3 | Delete setup               | Confirm in dialog  | Clears setupId from all affected frames |
| STP-4 | Assign frames to setup     | Click **DONE**     | Not each individual frame tap        |
| STP-5 | Remove setup from frame    | Click **DONE**     |                                      |

STP-6 (switch active setup) is local UI only.

---

## TAG (TAG)

| #     | Action            | End of Action                    | Notes                                |
|-------|-------------------|----------------------------------|--------------------------------------|
| TAG-1 | Tag a version     | TAG pill / OK in info → flush 1s later | Cascades across all same-setup frames (copy versions created). 1s delay lets propagation complete, then pushes all dirty frames at once |
| TAG-2 | Untag a version   | TAG pill / OK in info → flush 1s later | Cascades removal of copy versions across same-setup frames |

---

## IMPORT (IMP)

| #     | Action              | End of Action                              | Notes                                |
|-------|---------------------|--------------------------------------------|--------------------------------------|
| IMP-1 | Import PDF          | Flush sync 5s after loading bar finishes   | Lets app settle (images decoded, state written) |
| IMP-2 | Import folder       | Flush sync 5s after loading bar finishes   | Same                                 |
| IMP-5 | Adjust PDF rects    | Flush sync 5s after frames fully re-loaded | Must wait for ALL frames to be loaded |

IMP-3 (Start from scratch) and IMP-4 (Start portrait) create one empty frame — nothing meaningful to sync until user acts and saves.

---

## CUSTOMISE (CUS)

| #     | Action                 | End of Action      | Notes                                |
|-------|------------------------|--------------------|--------------------------------------|
| CUS-1 | Customise strip labels | Click **Save**     | Rebuilds all version labels          |

---

## Summary

**Total sync points: 38**

**End-of-action patterns:**

- **Button click** (most actions): OK, Save, DONE, CREATE, Confirm, Delete, Hide, Un-Hide, Undo, Star, "+", Paste, Toggle
- **Blur + inactivity** (inline text/table editing): blur event, with 5s inactivity fallback
- **Close canvas** (drawing): close fullscreen overlay
- **Snap** (camera): capture moment, not crop confirm
- **Delayed flush** (tags, imports): 1s (tags, for cascade propagation) or 5s (imports, for loading completion)

**What does NOT need sync:**

- View mode changes (VW-1 through VW-5)
- Tab switching (VER-1)
- Copy to clipboard (FRM-9, VER-7)
- Select active group (GRP-4)
- Switch active setup (STP-6)
- Enter reorder/move mode (ORD-1, VER-17)
- Individual reorder moves (ORD-2, ORD-3, VER-18)
- Drawing tool changes inside canvas (DRW-1 through DRW-4, DRW-6 through DRW-8)

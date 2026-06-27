# Framehow — Sync Rules

> How the sync system behaves in every device/connectivity scenario.
> Companion to `sync-points-end-of-action.md`.

---

## Core Concepts

**Heartbeat**: Active device sends a heartbeat every 5s while user is interacting (last activity within 10s). Other devices check heartbeat on wake/focus.

**End-of-action push**: Each discrete user action triggers an immediate push to the server at its completion point (see sync-points doc). No timer-based debounce as primary mechanism.

**5-second debounce**: Kept as a safety-net fallback only — catches any action that doesn't have an explicit end-of-action sync point.

**5-second text inactivity**: For inline text fields and note modals — if the user stops typing for 5 seconds, treat it as end-of-action and flush sync. This pushes the text to the server BEFORE the heartbeat goes stale (10s), so the other device gets the latest text when it pulls.

**Delta push**: Only frames/versions with changed fingerprints are included in the push payload. Unchanged data is not sent. For each changed frame, the full frame data is sent (image, note, label, strokes, hidden/starred state, all version tabs) — not just the individual field that changed. This keeps it simple and reliable.

**Merge**: Compare what you have locally with what the server has, frame by frame, slot by slot, and decide which version to keep. "This frame was changed locally — keep mine. That frame was only changed on the server — take theirs. This frame was changed on both — ask the user." Not a special function, just the decision process.

**dirtyFrameIds**: A list of frames YOU changed since the last sync. Acts as a shield during merge — frames in this list are protected from being overwritten by server data. "These are MY frames, don't touch them with server data."

**updated_at**: A timestamp on the server (a number like 1719475200000). Every time a device successfully pushes, the server stores the current time as `updated_at` on the project. When the next device tries to push, it sends `base_updated_at` ("the last server timestamp I know about"). If `base_updated_at` is older than the server's current `updated_at`, someone else pushed in between → server rejects with 409.

**409 conflict**: An HTTP status code meaning "conflict." The server says: "I can't accept your push because someone else changed the data since you last synced. Pull the latest version first, merge it with your changes, then try again." The server acts as a referee — it prevents one device from blindly overwriting another device's work.

**Per-slot conflict resolution**: Each action touches a specific slot (main image, version note, frame label, etc.). Only the same slot on the same frame/version can conflict.

---

## Scenario 1: Single device, online

The simplest case. No conflicts possible.

1. User performs an action → end-of-action triggers push
2. Delta push sends only changed frames to server — each changed frame sends its full data (image, note, label, strokes, versions, etc.). Unchanged frames are skipped entirely (fingerprints match).
3. Server accepts (no other device has pushed) → done
4. Pull on focus/wake as a safety check (in case another device pushed while this one was in background)

No heartbeat needed — only one device is active.

---

## Scenario 2: Single device, offline

No server communication. Everything stays local.

1. User performs an action → end-of-action triggers push attempt
2. Push fails (network error) → project added to retry queue
3. State is saved to IndexedDB (2s autosave) — local backup
4. User continues working — each action's end-of-action attempts push, fails, stays queued
5. Dirty flag stays true, dirtyFrameIds accumulates all changed frames

All work is preserved locally. IndexedDB autosave ensures nothing is lost even if the app is killed.

---

## Scenario 3: Single device, offline → comes online

Device reconnects. Needs to reconcile local changes with whatever happened on the server while offline.

1. Browser fires "online" event → triggers retry
2. Before pushing, pull first to see if another device pushed while we were offline
3. Pull compares server timestamp with our last known timestamp:
   - Server timestamp is the same → no changes from other devices → skip to step 5
   - Server timestamp is newer → another device pushed while we were offline → merge (step 4)
4. Merge — compare frame by frame:
   - Frame is in our dirtyFrameIds (we changed it offline) → keep our local version, ignore server
   - Frame is NOT in our dirtyFrameIds (we didn't change it) → accept server version only if it's different from ours (fingerprint comparison). If fingerprints match, nothing happens — no unnecessary download or overwrite
   - Same frame edited by us offline AND by another device on the server → show conflict picker: side-by-side thumbnails for each conflicting frame, user taps which one to keep
5. Push our dirty frames to server — sends full data for each changed frame (image, note, label, strokes, versions). Server accepts because our timestamp now matches.
6. Clear dirty state
7. Both devices now have the same data

---

## Scenario 4: Device offline → comes online, other device is idle

Same as Scenario 3. The idle device's heartbeat is stale (no activity for 10+ seconds).

1. The device that was offline comes online → pulls first to check what happened on the server
2. No active heartbeat from idle device → no "10 sec wait" overlay
3. Merge and push as in Scenario 3
4. Idle device does nothing until user interacts with it
5. When idle device wakes (user taps/clicks/scrolls):
   - Check heartbeat → reconnected device may or may not still be active
   - Pull from server → gets the merged state
   - If reconnected device is still active (heartbeat fresh) → show "10 sec wait" overlay, poll until stale, then pull

The reconnecting device has priority — it pushes freely because the idle device isn't sending heartbeats. The idle device catches up when the user returns to it.

---

## Scenario 5: Device offline → comes online, another device also comes online

Two devices reconnect around the same time. Race condition.

1. Both devices fire "online" → both attempt pull+push
2. First device to push wins — server accepts its data, updates the server timestamp. "Wins" simply means its push arrived first — the server stores it and moves the timestamp forward.
3. Second device's push gets 409 conflict — its timestamp is now stale because the first device already pushed. The server says: "someone changed the data since you last synced, pull first."
4. Second device handles the 409:
   - Pull from server (gets first device's changes)
   - Merge: frames in our dirtyFrameIds → keep ours. Frames only changed by the first device → accept theirs. Frames changed by BOTH → conflict picker (user chooses per frame).
   - Retry push with updated timestamp → server accepts
5. Both devices now have the same data

After both devices are online and synced, normal heartbeat rules apply (Scenarios 6 and 7).

---

## Scenario 6: Two devices online, one makes a change

Both devices are online and have the same server state. One user starts working.

1. Device A: user performs an action → heartbeat starts (activity detected)
2. Device A: end-of-action → push → server accepts
3. Device B is idle — no heartbeat, no activity
4. Device B: when user returns (tap/click/scroll/focus):
   - Wake-from-idle detector fires → check heartbeat
   - If Device A's heartbeat is fresh (user still active on A):
     - Show "10 sec wait" overlay
     - Poll heartbeat every 5s
     - When heartbeat goes stale (Device A user stopped) → pull → overlay dismissed
   - If Device A's heartbeat is stale (user already stopped):
     - No overlay → pull immediately → get Device A's changes
5. Device B now has Device A's changes. If Device B user makes changes → this scenario repeats in reverse.

Key timing: Device A pushes at end-of-action (immediate). Device B pulls on wake/focus. The heartbeat prevents Device B from starting work mid-action on Device A.

---

## Scenario 7: Two devices online, both idle, one starts working

Both devices are online, synced, and idle (no heartbeats from either). One user starts working.

1. Both devices idle — no heartbeats, no activity
2. Device A: user starts interacting → activity detected → heartbeat sender kicks in
3. Device A: first heartbeat sent to server within 5s
4. Device A: user performs actions → end-of-action pushes fire normally
5. Device B stays idle — doesn't know Device A is active (no trigger to check heartbeat)
6. Device B: when user eventually returns:
   - Wake-from-idle / focus event fires → check heartbeat
   - Device A's heartbeat is fresh → "10 sec wait" overlay → wait for Device A to go idle → pull → overlay dismissed
   - OR Device A's heartbeat is stale (user already finished) → pull immediately

No race condition — Device B doesn't do anything until its user interacts. By then, Device A's pushes are already on the server.

---

## Scenario 8: Two devices online, both working simultaneously

Both devices are active, both users making changes at the same time. Both heartbeats are firing.

1. Both devices send heartbeats every 5s — both are "active"
2. Each device pushes at its own end-of-action moments independently
3. First push to arrive at the server succeeds — server updates its timestamp
4. Second device's next push hits 409 — server timestamp moved since its last sync
5. 409 handler: pull → merge → retry:
   - Different frames edited → auto-merge, both changes survive, no interruption
   - Same frame edited by both → conflict picker on the device that got the 409
6. After retry succeeds, that device continues working normally
7. This cycle repeats with each end-of-action push — every push either succeeds (no conflict) or gets a 409 (other device pushed first), merges, and retries

No "10 sec wait" overlay. The overlay only appears when a device wakes from idle and checks heartbeat. If both devices are already active, neither triggers a wake check — they just push and handle 409s as they come.

In practice: since most actions touch different frames, almost all pushes succeed or auto-merge silently. The conflict picker only appears when both users edit the exact same frame within seconds of each other — which is rare.

When one user stops: their heartbeat goes stale after 10 seconds. The other device doesn't notice or care (it's already working). If the stopped user comes BACK, they hit the wake-from-idle check → see the other device's heartbeat → "10 sec wait" → falls into Scenario 6.

---

## Edge Cases

### Both users start working at the exact same time

1. Both devices start sending heartbeats simultaneously
2. Both users perform actions → both attempt end-of-action pushes
3. First push to reach the server wins → second gets 409
4. 409 handler on the losing device: pull → merge → retry
5. If both edited the SAME frame → conflict picker on the device that lost the race
6. If they edited DIFFERENT frames → automatic merge, no conflict picker, both changes survive

### Device A has note/text field open, Device B wants to work

1. Device A: note modal or inline text field is active → typing keeps heartbeat alive via keydown events
2. Device B: user returns → checks heartbeat → "10 sec wait"
3. Device A user stops typing for 5+ seconds:
   - 5-second text inactivity triggers end-of-action → flush sync → text pushed to server
   - After 10 seconds of no interaction, heartbeat goes stale
   - Device B: overlay dismissed → pull → gets the text → can start working
4. Device A user resumes typing → heartbeat resumes → next end-of-action pushes normally
5. If Device B pushed while Device A was paused → Device A gets 409 on next push → pull+merge+retry → text/note is protected by dirtyFrameIds

### App killed / browser closed mid-action

1. User was mid-action (e.g., typing in note, drawing)
2. App killed → no end-of-action fires → no push
3. IndexedDB autosave (2s) has the latest state — local data preserved
4. On next app open → restore from IndexedDB → dirty flag true → normal sync resumes
5. If the action was incomplete (note modal was open, text was in textarea but OK wasn't clicked) → that text is lost (was in DOM only, not in state). Everything committed to state before the kill is preserved.

### App killed, then other device works on the same frame

1. Device A killed → last state preserved in IndexedDB
2. Device B works on the same frame → pushes to server → server has Device B's version
3. Device A reopens → restores from IndexedDB → dirty flag true, dirtyFrameIds has the frames from the killed session
4. Device A comes online → pulls first → server has Device B's newer changes
5. If they changed the SAME frame → conflict picker: "your version (from before the kill) vs the other device's version — which do you want?"
6. If they changed DIFFERENT frames → auto-merge, both survive

IndexedDB preserves Device A's committed work. But uncommitted DOM-only text (note modal open, OK not clicked) is lost.

### Internet drops mid-push

1. End-of-action fires → push starts → network fails
2. Push throws network error → project added to retry queue
3. State preserved locally (IndexedDB autosave)
4. On reconnect (online event) → retry → pull first → push → done

### Very long offline session (many changes)

1. User works offline for hours, makes many changes across many frames
2. dirtyFrameIds accumulates all changed frames
3. On reconnect → pull from server → merge all dirty frames (keep local) → push all at once
4. If another device also worked offline → conflict picker for any overlapping frames
5. Non-overlapping changes merge automatically

---

## Sync Flow Diagram

```
USER ACTION
    │
    ▼
End of Action?
    │
    ├── YES ──► Push to server
    │               │
    │               ├── Online? ──► Send (delta — only changed frames)
    │               │                   │
    │               │                   ├── Server accepts ──► Clear dirty ──► Done
    │               │                   │
    │               │                   └── 409 (someone else pushed) ──► Pull ──► Merge ──► Retry
    │               │                                                      │
    │               │                                                      ├── Same frame both sides ──► Conflict picker
    │               │                                                      └── Different frames ──► Auto-merge
    │               │
    │               └── Offline? ──► Add to retry queue ──► Save to IndexedDB
    │
    └── NO ──► State saved locally ──► 5s debounce fallback (safety net)


DEVICE WAKE / FOCUS
    │
    ▼
Check heartbeat
    │
    ├── Fresh (other device active) ──► "10 sec wait" overlay ──► Poll ──► Stale? ──► Pull
    │
    └── Stale / none ──► Pull immediately
                              │
                              ├── Server has newer data? ──► Merge ──► Apply
                              └── Server same as local? ──► Nothing to do
```

---

## Summary Table

| Scenario | Heartbeat | Push | Pull | Conflict? |
|----------|-----------|------|------|-----------|
| 1. Alone, online | Not needed | End-of-action | On focus (safety) | Never |
| 2. Alone, offline | Not needed | Queued (fails) | Not possible | Never |
| 3. Offline → online | Not needed | After pull | On reconnect | If another device pushed |
| 4. Offline → online, other idle | No overlay | After pull | On reconnect | If other device pushed |
| 5. Both reconnect | Both send | First wins, second retries | Loser pulls | If same frames edited |
| 6. Two online, one works | Active sends | End-of-action | Idle pulls on wake | Only if same frame |
| 7. Two idle, one starts | Starter sends | End-of-action | Other pulls on wake | Only if same frame |
| 8. Two online, both work | Both send | Both push, 409s handled | On each 409 | Only if same frame |

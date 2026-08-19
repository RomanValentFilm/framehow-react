// Project settings as ITEMS, each with its own time of change.
//
// Everything here used to live inside one `metadata` field that was written
// whole, so the last device to PUSH won all of it — including changes made
// earlier on the other device, and changes it had never heard about. Rename a
// needs category on an offline iPad, rename a setup on the desktop, and one of
// the two vanished with no trace.
//
// Now each item is compared on its own. The stamp is taken when the change is
// SEEN LOCALLY (on the autosave that follows it), never at push time: stamping
// at push time would make every offline change look newest and beat everything
// that happened while the device was away.

import { useStore } from '../store/state';
import type { NeedItem, Setup, SortBreak } from '../store/state';

export interface SettingItem {
  kind: string;
  item_id: string;
  value: string | null;      // JSON: { idx, data } — idx keeps the user's order
  changed_at: number;
  deleted_at: number | null;
  /** What the server's stamp was when this device last heard from it. Lets the
   *  server tell "I rearranged on top of theirs" from "we both rearranged
   *  blind" — only the second is worth asking about. */
  base_changed_at?: number;
}

/** What we last saw locally, per item, with the time we first saw it that way. */
const _known = new Map<string, {
  json: string; changed_at: number; deleted_at: number | null;
  /** The server's stamp as of the last time we heard from it. Survives a local
   *  edit — the local stamp moves, this does not. */
  serverAt: number;
}>();

/** Older rows, and anything written before change times existed, have no time
 *  at all. Nothing here creates one of these any more (#263) — but the server
 *  still holds some, and they must never out-rank a real change. */
const UNKNOWN = 0;

/** The first look at a project stamps everything with the project's CREATION
 *  time, not "now" and not zero (#263). Both devices reach the same number, so
 *  neither wins merely by opening the project — and every comparison afterwards
 *  has two real times instead of a blank. */
let _baseline = UNKNOWN;

/** Has the first look happened for this project? Taken when the project LOADS
 *  (#264), not inferred from the memory being empty — inferring it meant a
 *  rename made in the two seconds before the first save was swallowed into the
 *  first look and recorded as "it was always called that", so it could never
 *  travel. */
let _seeded = false;

function key(kind: string, id: string): string { return `${kind}/${id}`; }

/** Every settings item the store currently holds, in the user's order. */
function currentItems(): Array<{ kind: string; item_id: string; json: string }> {
  const s = useStore.getState();
  const out: Array<{ kind: string; item_id: string; json: string }> = [];
  const push = (kind: string, id: string, idx: number, data: unknown) =>
    out.push({ kind, item_id: id, json: JSON.stringify({ idx, data }) });

  // THE STORY FLOW IS ONE THING (#294).
  //
  // A frame's place used to live on the frame, so an arrangement was forty-five
  // separate facts merged one by one — and two people rearranging offline ended
  // up with an order neither had made. Worse, moving frames counted as changing
  // them, so a re-order sent every frame's whole row and could carry an older
  // note over a newer one.
  //
  // It is a list of frame ids, with one time. The later arrangement wins whole.
  // Notes, needs and versions need no special care: they belong to the frame, so
  // they travel with it wherever it lands. An id in the list with no frame
  // behind it is simply skipped, so a deleted frame needs no place-holder.
  const orderedIds = s.frames.map((f) => f.serverFrameId).filter(Boolean) as string[];
  if (orderedIds.length > 0) push('frameOrder', 'main', 0, orderedIds);

  s.groups.forEach((g, i) => push('group', String(g.id), i, g));
  s.sortOrders.forEach((o, i) => push('sortOrder', o.id, i, o));
  (s.needDefinitions?.tabs ?? []).forEach((t, i) => push('needCategory', t.id, i, t));

  // Agreed as one item each: short shared lists, rarely edited on two devices
  // at the same moment.
  push('needLocations', 'needLocations', 0, s.needDefinitions?.locations ?? []);
  // ONE ITEM PER SETUP, NOT ONE ITEM FOR ALL OF THEM (#331).
  //
  // The whole palette used to travel as a single item, so two people each
  // adding a setup while apart meant one list beating the other and one setup
  // simply gone — the same fault the shooting orders had before they were split
  // up, and the same answer.
  //
  // A setup removed here gets a deleted row of its own, so deleting still
  // travels, which is what a plain merge could not have given us.
  //
  // nextSetupId no longer rides along: since #322 an id is not a count, so
  // there is nothing to agree about.
  s.setups.forEach((su, i) => push('setup', su.id, i, su));
  // One item PER BREAK, not one item for all of them. A break the other device
  // added is then simply added here, instead of losing to a newer copy of "the
  // breaks" that never knew about it. Two devices moving the SAME break still
  // settle by time.
  (s.storyFlowBreaks ?? []).forEach((b, i) => push('storyFlowBreak', b.id, i, b));

  return out;
}

/**
 * Compare what the store holds against what we last saw, and stamp whatever
 * differs with the time we noticed. Called from the local autosave, so the
 * stamp is the time of the change and not the time of the connection.
 */
let _projectId: string | null | undefined;

/**
 * The first look, taken the moment a project LOADS (#264).
 *
 * Everything currently in the store is written down as being as old as the
 * project itself, so opening a project is never mistaken for editing it — and
 * anything you do afterwards is a change against a real time.
 *
 * @param createdAt the project's creation time. For a project the server has
 *   never seen there is nothing to agree with, so now is as good as anything.
 */
export function seedSettings(projectId: string | null, createdAt?: number): void {
  _projectId = projectId;
  _baseline = createdAt && createdAt > 0 ? createdAt : Date.now();
  _known.clear();
  for (const it of currentItems()) {
    _known.set(key(it.kind, it.item_id),
      { json: it.json, changed_at: _baseline, deleted_at: null, serverAt: UNKNOWN });
  }
  _seeded = true;
}

export function stampChangedSettings(projectId?: string | null): void {
  // Everything here is remembered for ONE project. Opening another one must
  // start empty, or its settings get pushed into the new project — which is
  // how a brand new project arrived holding ten sort orders that belonged to
  // the last one, conflicts and all.
  if (projectId !== undefined && projectId !== _projectId) {
    _known.clear();
    _projectId = projectId;
    _seeded = false;
  }
  // Backstop only. Every path that loads a project calls seedSettings() or
  // adoptSettingsFromServer() first, so this should not be reached — and if it
  // is, there is genuinely nothing to compare against: whatever the store holds
  // is all we know. Recorded as project-old, because the alternative (calling
  // it all a change made now) would let merely opening a project overwrite real
  // work on the other device.
  if (!_seeded) seedSettings(_projectId ?? null, _baseline);
  const now = Date.now();
  const seen = new Set<string>();

  for (const it of currentItems()) {
    const k = key(it.kind, it.item_id);
    seen.add(k);
    const prev = _known.get(k);
    if (!prev) {
      // Something the first look did not have: a genuinely new group, sort
      // order or category. That is a change, and it happened now.
      _known.set(k, { json: it.json, changed_at: now, deleted_at: null, serverAt: UNKNOWN });
    } else if (prev.json !== it.json || prev.deleted_at !== null) {
      _known.set(k, { json: it.json, changed_at: now, deleted_at: null, serverAt: prev.serverAt });
    }
  }

  // Gone from the store = deleted. Recorded, because without it the device
  // that never saw the deletion pushes the item back and it returns.
  for (const [k, v] of _known) {
    if (seen.has(k) || v.deleted_at !== null) continue;
    _known.set(k, { json: v.json, changed_at: v.changed_at, deleted_at: now, serverAt: v.serverAt });
  }
}

/** Everything we know about, for the push. */
export function settingsForPush(): SettingItem[] {
  const out: SettingItem[] = [];
  for (const [k, v] of _known) {
    const slash = k.indexOf('/');
    out.push({
      kind: k.slice(0, slash),
      item_id: k.slice(slash + 1),
      value: v.deleted_at !== null ? null : v.json,
      changed_at: v.changed_at,
      deleted_at: v.deleted_at,
      base_changed_at: v.serverAt,
    });
  }
  return out;
}

/**
 * Take the server's copy as what we now know, keeping the times it came with —
 * never re-stamping received work as changed here (#265).
 *
 * Two things this must NOT do:
 *
 * - empty the memory when the server had nothing to say (#263). It used to, and
 *   then the next rename was treated as a first look, so it carried no time and
 *   the server refused it silently, for ever.
 * - forget a change this device has made and not yet sent (#262). It used to
 *   overwrite it with the server's older copy, and the rename snapped back in
 *   front of the user with nothing left wanting to push.
 */
export function adoptSettingsFromServer(items: SettingItem[] | undefined, projectId?: string | null): void {
  // A different project must not inherit this one's memory.
  if (projectId !== undefined && projectId !== _projectId) {
    _known.clear();
    _projectId = projectId;
    _seeded = false;
  }
  if (!items || items.length === 0) return;   // nothing said — leave the memory alone
  for (const it of items) {
    const k = key(it.kind, it.item_id);
    const prev = _known.get(k);
    const unsentAndNewer = prev
      && prev.changed_at > prev.serverAt      // we have not sent it
      && prev.changed_at > it.changed_at;     // and ours is the later change
    if (unsentAndNewer) {
      // Keep our value and our time; only learn what the server holds, so the
      // next push is judged against the right base.
      _known.set(k, { ...prev, serverAt: it.changed_at });
      continue;
    }
    _known.set(k, {
      json: it.value ?? '',
      changed_at: it.changed_at,
      deleted_at: it.deleted_at ?? null,
      serverAt: it.changed_at,
    });
  }
  // The server's copy, with real times, is a first look in its own right.
  _seeded = true;
}

/**
 * Put the frames in the arrangement's order — and keep a frame the arrangement
 * has never heard of NEXT TO THE FRAME IT WAS PUT AFTER (#294).
 *
 * A frame made here while the other device was rearranging is not in their list.
 * Dropping it at the end would move it away from the moment it belongs to: a
 * frame drawn between 12 and 13 belongs between 12 and 13, not at the bottom of
 * the storyboard.
 *
 * Nothing extra has to be stored to do this. THIS device knows where the frame
 * sits in its own list, so it knows which frame it follows; the new frame is
 * placed straight after that one wherever it has landed. A new frame at the very
 * top, following nothing, stays at the top.
 */
export function applyArrangement<T extends { serverFrameId?: string }>(
  here: T[],
  arrangement: readonly string[],
): T[] {
  const listed = new Set(arrangement);

  // Which frames follow which, as this device currently has them. `null` means
  // "at the very front".
  const followers = new Map<string | null, T[]>();
  let anchor: string | null = null;
  for (const f of here) {
    if (f.serverFrameId && listed.has(f.serverFrameId)) {
      anchor = f.serverFrameId;                     // a frame both sides know
      continue;
    }
    const group = followers.get(anchor) ?? [];
    group.push(f);
    followers.set(anchor, group);
  }

  const byId = new Map(here.filter((f) => f.serverFrameId).map((f) => [f.serverFrameId!, f]));
  const out: T[] = [...(followers.get(null) ?? [])];
  for (const id of arrangement) {
    const f = byId.get(id);
    if (f) out.push(f);                             // an id with no frame is skipped
    const after = followers.get(id);
    if (after) out.push(...after);
  }
  return out;
}

/**
 * Is this device holding a later change to that item which it has not sent yet?
 * Then an arriving copy must not paint over it (#262) — the whole point of a
 * change time is that the later change wins, and it cannot lose just because it
 * has not reached the server yet.
 */
function localIsNewerAndUnsent(kind: string, itemId: string, arrivingChangedAt: number): boolean {
  const v = _known.get(key(kind, itemId));
  if (!v || v.deleted_at !== null) return false;
  return v.changed_at > v.serverAt && v.changed_at > arrivingChangedAt;
}

/** Write the server's settings into the store. Items the server has never
 *  heard of are left exactly as they are — this only overrides what it holds,
 *  so a project whose settings are still only in `metadata` is untouched. */
export function applySettingsToStore(items: SettingItem[] | undefined): void {
  if (!items || items.length === 0) return;

  type Row = { kind: string; item_id: string; idx: number; data: unknown; changed_at: number; deleted: boolean };
  const rows: Row[] = [];
  for (const it of items) {
    if (it.deleted_at !== null) {
      rows.push({ kind: it.kind, item_id: it.item_id, idx: 0, data: null, changed_at: it.changed_at, deleted: true });
      continue;
    }
    if (!it.value) continue;
    try {
      const { idx, data } = JSON.parse(it.value) as { idx: number; data: unknown };
      rows.push({ kind: it.kind, item_id: it.item_id, idx, data, changed_at: it.changed_at, deleted: false });
    } catch { /* a broken row must not take the rest down with it */ }
  }
  if (rows.length === 0) return;

  const s = useStore.getState();
  const patch: Record<string, unknown> = {};

  /**
   * Merge a list ITEM BY ITEM. Replacing the list with whatever arrived was
   * the bug that made every NEEDS tab but one disappear: only the renamed tab
   * carried a stamp, so the list became that single tab.
   *
   * - a stamped change replaces the item it names, and nothing else
   * - an item this device does not have is added, whatever its stamp — that is
   *   how a device catches up, and how anything already lost comes back
   * - an unstamped item never overwrites one that is already here: it is only
   *   what some device happened to hold, not a change anyone made
   * - an item this device changed LATER and has not sent yet is left alone
   *   (#262) — otherwise a pull landing a second after a rename put the old
   *   name straight back on screen
   * - a deletion removes it, and is applied last so it wins over a stale copy
   */
  function mergeList<T>(kind: string, current: T[], idOf: (x: T) => string): T[] | null {
    const mine = rows.filter((r) => r.kind === kind);
    if (mine.length === 0) return null;
    const out = [...current];
    const at = (id: string) => out.findIndex((x) => idOf(x) === id);

    for (const r of mine.filter((x) => !x.deleted).sort((a, b) => a.changed_at - b.changed_at)) {
      const i = at(r.item_id);
      if (i >= 0) {
        if (r.changed_at > UNKNOWN && !localIsNewerAndUnsent(kind, r.item_id, r.changed_at)) out[i] = r.data as T;
      } else {
        out.splice(Math.min(r.idx, out.length), 0, r.data as T);
      }
    }
    for (const r of mine.filter((x) => x.deleted)) {
      const i = at(r.item_id);
      if (i >= 0) out.splice(i, 1);
    }
    return out;
  }

  const groups = mergeList('group', s.groups, (g) => String(g.id));
  if (groups) patch.groups = groups;

  const orders = mergeList('sortOrder', s.sortOrders, (o) => o.id);
  if (orders) patch.sortOrders = orders;

  const tabs = mergeList('needCategory', s.needDefinitions.tabs, (t) => t.id);
  const locRow = rows.find((r) => r.kind === 'needLocations' && !r.deleted && r.changed_at > UNKNOWN
    && !localIsNewerAndUnsent('needLocations', 'needLocations', r.changed_at));
  if (tabs || locRow) {
    patch.needDefinitions = {
      tabs: tabs ?? s.needDefinitions.tabs,
      locations: locRow ? (locRow.data as NeedItem[]) : s.needDefinitions.locations,
    };
  }

  // Setups. The old whole-palette row is still read, because the server holds
  // them and devices on older builds still send them — but it is applied FIRST,
  // so the per-setup rows below have the last word (#331).
  const palette = rows.find((r) => r.kind === 'setupPalette' && !r.deleted && r.changed_at > UNKNOWN
    && !localIsNewerAndUnsent('setupPalette', 'setupPalette', r.changed_at));
  let setupsNow = s.setups;
  if (palette) {
    const p = palette.data as { setups: Setup[]; nextSetupId: number };
    setupsNow = p.setups ?? [];
    patch.setups = setupsNow;
    patch.nextSetupId = p.nextSetupId ?? 1;
  }
  const setups = mergeList('setup', setupsNow, (su: Setup) => su.id);
  if (setups) patch.setups = setups;

  // The story flow: one arrangement, the later one wins whole (#294).
  const orderRow = rows.find((r) => r.kind === 'frameOrder' && !r.deleted && r.changed_at > UNKNOWN
    && !localIsNewerAndUnsent('frameOrder', 'main', r.changed_at));
  if (orderRow) {
    patch.frames = applyArrangement(s.frames, orderRow.data as string[]);
  }

  // Story-flow breaks merge one by one, like groups and orders. A break only
  // this device has stays; one only the other device has is added; one both
  // know at different positions takes the newer.
  const breaks = mergeList('storyFlowBreak', s.storyFlowBreaks ?? [], (b) => b.id);
  if (breaks) patch.storyFlowBreaks = breaks;

  if (Object.keys(patch).length > 0) useStore.setState(patch as never);
}

/** Does this device hold a settings change the server has not confirmed?
 *
 *  Asked instead of comparing a whole-project fingerprint, which could not
 *  answer until a push had already succeeded once — so on a project that had
 *  not pushed yet, creating or rearranging a sort order changed no frame, and
 *  the push was skipped as "nothing changed". */
export function settingsNeedPush(): boolean {
  for (const v of _known.values()) {
    if (v.deleted_at !== null && v.deleted_at > v.serverAt) return true;
    if (v.changed_at > v.serverAt) return true;
  }
  return false;
}

/** Carried in the local snapshot so a restart does not forget when things
 *  changed and start claiming everything is new. */
export function exportSettingStamps(): SettingItem[] { return settingsForPush(); }

/**
 * Restore the memory after a restart — including WHICH items are still unsent.
 *
 * This used to hand the list to adoptSettingsFromServer, which records every
 * item as confirmed by the server. So a category renamed while offline was
 * remembered with its time, but no longer remembered as unsent: after closing
 * and reopening the app it never pushed. (#267)
 */
export function importSettingStamps(items: SettingItem[] | undefined): void {
  if (!items || items.length === 0) return;
  _known.clear();
  for (const it of items) {
    _known.set(key(it.kind, it.item_id), {
      json: it.value ?? '',
      changed_at: it.changed_at,
      deleted_at: it.deleted_at ?? null,
      // What the server had confirmed when we saved. Missing in older snapshots,
      // where assuming "confirmed" is the safer of two guesses: claiming unsent
      // would push the whole project's settings on every restart.
      serverAt: it.base_changed_at ?? it.changed_at,
    });
  }
  _seeded = true;
}

/**
 * THE RECONCILING LOOK (#297) — how the app reads memory written by an older
 * version of itself.
 *
 * Restored memory says when each item was changed. But an app that has just
 * been updated holds KINDS of item that memory has never heard of: `frameOrder`
 * was born in #294, so every device's saved memory pre-dates it.
 *
 * The ordinary rule says an item nobody remembers is a new group or category
 * the user just made — a change, and it happened now. That is right while the
 * app is running and wrong the moment it starts, because then EVERY device
 * claims to have changed the item at its own boot, and the one that booted last
 * wins. That is precisely what happened: two devices each said they had
 * rearranged the storyboard three seconds after starting, and the real re-order
 * lost to a clock.
 *
 * So: anything present in the app but absent from restored memory is written
 * down as AGE UNKNOWN. It still travels — the server learns it exists — but it
 * cannot outrank work somebody actually did. The next real edit stamps it
 * properly.
 *
 * Must run AFTER the project is in the store, or there is nothing to look at.
 *
 * @returns how many items were unknown, for the log.
 */
export function reconcileRestoredSettings(): number {
  if (!_seeded) return 0;
  let unknown = 0;
  for (const it of currentItems()) {
    const k = key(it.kind, it.item_id);
    if (_known.has(k)) continue;
    _known.set(k, { json: it.json, changed_at: UNKNOWN, deleted_at: null, serverAt: UNKNOWN });
    unknown++;
  }
  return unknown;
}

// ---------------------------------------------------------------------------
// THE OLD LAYER STILL WON (#323)
// ---------------------------------------------------------------------------
//
// Settings live in two places at once. The new one is a row per item, each with
// its own time of change, which is what `applySettingsToStore` above merges. The
// old one is a single blob of the whole project, written whole and read whole.
// Migration 0021 exists to end the blob; the pull never got the message.
//
// On a pull the store is rebuilt from the BLOB first — groups, setups, needs,
// shooting orders, story-flow breaks, all replaced wholesale — and only then are
// the per-item rows merged on top. By that point `mergeList` is reading a store
// that already holds the server's copy, so the protection at the heart of it,
// "an item I changed later and have not sent is left alone", can only decline to
// overwrite something that has already been overwritten. It never puts anything
// back.
//
// That is why a break added a second before a pull vanished, and why "the later
// arrangement wins whole" failed in the direction that lost yours.
//
// The answer is not to reorder the two — the blob still carries things the rows
// do not. It is to remember what this device held before the rebuild, and
// afterwards put back the items it had changed and not yet sent. Those, and only
// those: everything else is the server's to say.

export interface MySettings {
  groups: unknown[];
  sortOrders: unknown[];
  tabs: unknown[];
  locations: unknown;
  setups: unknown[];
  nextSetupId: number;
  storyFlowBreaks: unknown[];
  /** The frame arrangement as server ids, so it can be re-applied to whatever
   *  frames the pull ends up with. */
  frameOrder: string[];
}

/** What this device is holding right now, before a pull rebuilds the store. */
export function captureMySettings(): MySettings {
  const s = useStore.getState();
  return {
    groups: [...s.groups],
    sortOrders: [...s.sortOrders],
    tabs: [...(s.needDefinitions?.tabs ?? [])],
    locations: s.needDefinitions?.locations ?? [],
    setups: [...s.setups],
    nextSetupId: s.nextSetupId,
    storyFlowBreaks: [...(s.storyFlowBreaks ?? [])],
    frameOrder: s.frames.map((f) => f.serverFrameId).filter(Boolean) as string[],
  };
}

/** Has this device changed that item without the server having taken it yet? */
function iHoldUnsent(kind: string, itemId: string): boolean {
  const v = _known.get(key(kind, itemId));
  if (!v || v.deleted_at !== null) return false;
  return v.changed_at > v.serverAt;
}

/**
 * Put back the settings this device changed and has not sent, after a pull has
 * rebuilt the store over the top of them (#323).
 *
 * Item by item, and only the ones actually held. An item the server knows more
 * about than we do is left exactly as the merge left it.
 */
export function keepMyUnsentSettings(before: MySettings): void {
  const s = useStore.getState();
  const patch: Record<string, unknown> = {};

  /** Put my copy back into a list, by id, adding it if the pull removed it. */
  function restore<T>(kind: string, mine: T[], now: T[], idOf: (x: T) => string): T[] | null {
    let changed = false;
    const out = [...now];
    for (const item of mine) {
      if (!iHoldUnsent(kind, idOf(item))) continue;
      const i = out.findIndex((x) => idOf(x) === idOf(item));
      if (i >= 0) { out[i] = item; } else { out.push(item); }
      changed = true;
    }
    return changed ? out : null;
  }

  const groups = restore('group', before.groups as { id: number }[],
    s.groups as { id: number }[], (g) => String(g.id));
  if (groups) patch.groups = groups;

  const orders = restore('sortOrder', before.sortOrders as { id: string }[],
    s.sortOrders as { id: string }[], (o) => o.id);
  if (orders) patch.sortOrders = orders;

  const breaks = restore('storyFlowBreak', before.storyFlowBreaks as { id: string }[],
    (s.storyFlowBreaks ?? []) as { id: string }[], (b) => b.id);
  if (breaks) patch.storyFlowBreaks = breaks;

  const tabs = restore('needCategory', before.tabs as { id: string }[],
    (s.needDefinitions?.tabs ?? []) as { id: string }[], (t) => t.id);
  const locsMine = iHoldUnsent('needLocations', 'needLocations');
  if (tabs || locsMine) {
    patch.needDefinitions = {
      ...s.needDefinitions,
      tabs: tabs ?? s.needDefinitions?.tabs ?? [],
      locations: locsMine ? before.locations : s.needDefinitions?.locations ?? [],
    };
  }

  // Setups, one row each since #331 — so a setup made here and not yet sent
  // comes back on its own, without dragging the whole palette with it.
  const setups = restore('setup', before.setups as { id: string }[],
    s.setups as { id: string }[], (su) => su.id);
  if (setups) patch.setups = setups;
  // The old whole-palette row, for anything still travelling that way.
  if (iHoldUnsent('setupPalette', 'setupPalette')) {
    patch.setups = before.setups;
    patch.nextSetupId = before.nextSetupId;
  }

  // The arrangement is one item too, and it is re-applied rather than restored:
  // the pull may have brought frames this device had never seen, and they must
  // not be dropped just because my arrangement predates them. applyArrangement
  // keeps anything the list does not mention.
  if (iHoldUnsent('frameOrder', 'main') && before.frameOrder.length > 0) {
    patch.frames = applyArrangement(s.frames, before.frameOrder);
  }

  if (Object.keys(patch).length > 0) useStore.setState(patch as never);
}

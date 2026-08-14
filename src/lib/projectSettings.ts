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

/** Seeding (first look, or after taking the server's copy) must NOT stamp
 *  anything as "changed now" — a device that merely opened the project would
 *  then out-rank real work done elsewhere. Unknown means oldest. */
const UNKNOWN = 0;

function key(kind: string, id: string): string { return `${kind}/${id}`; }

/** Every settings item the store currently holds, in the user's order. */
function currentItems(): Array<{ kind: string; item_id: string; json: string }> {
  const s = useStore.getState();
  const out: Array<{ kind: string; item_id: string; json: string }> = [];
  const push = (kind: string, id: string, idx: number, data: unknown) =>
    out.push({ kind, item_id: id, json: JSON.stringify({ idx, data }) });

  s.groups.forEach((g, i) => push('group', String(g.id), i, g));
  s.sortOrders.forEach((o, i) => push('sortOrder', o.id, i, o));
  (s.needDefinitions?.tabs ?? []).forEach((t, i) => push('needCategory', t.id, i, t));

  // Agreed as one item each: short shared lists, rarely edited on two devices
  // at the same moment.
  push('needLocations', 'needLocations', 0, s.needDefinitions?.locations ?? []);
  push('setupPalette', 'setupPalette', 0, { setups: s.setups, nextSetupId: s.nextSetupId });
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

export function stampChangedSettings(projectId?: string | null): void {
  // Everything here is remembered for ONE project. Opening another one must
  // start empty, or its settings get pushed into the new project — which is
  // how a brand new project arrived holding ten sort orders that belonged to
  // the last one, conflicts and all.
  if (projectId !== undefined && projectId !== _projectId) {
    _known.clear();
    _projectId = projectId;
  }
  const now = Date.now();
  const seeding = _known.size === 0;
  const seen = new Set<string>();

  for (const it of currentItems()) {
    const k = key(it.kind, it.item_id);
    seen.add(k);
    const prev = _known.get(k);
    if (!prev) {
      // First sight. Seeding a fresh load is not a change; a genuinely new
      // group or sort order is.
      _known.set(k, { json: it.json, changed_at: seeding ? UNKNOWN : now, deleted_at: null, serverAt: UNKNOWN });
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

/** Take the server's merged copy as what we now know, without stamping it. */
export function adoptSettingsFromServer(items: SettingItem[] | undefined): void {
  if (!items) return;
  _known.clear();
  for (const it of items) {
    _known.set(key(it.kind, it.item_id), {
      json: it.value ?? '',
      changed_at: it.changed_at,
      deleted_at: it.deleted_at ?? null,
      serverAt: it.changed_at,
    });
  }
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
        if (r.changed_at > UNKNOWN) out[i] = r.data as T;
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
  const locRow = rows.find((r) => r.kind === 'needLocations' && !r.deleted && r.changed_at > UNKNOWN);
  if (tabs || locRow) {
    patch.needDefinitions = {
      tabs: tabs ?? s.needDefinitions.tabs,
      locations: locRow ? (locRow.data as NeedItem[]) : s.needDefinitions.locations,
    };
  }

  // Single items: only a real change is worth taking.
  const palette = rows.find((r) => r.kind === 'setupPalette' && !r.deleted && r.changed_at > UNKNOWN);
  if (palette) {
    const p = palette.data as { setups: Setup[]; nextSetupId: number };
    patch.setups = p.setups ?? [];
    patch.nextSetupId = p.nextSetupId ?? 1;
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
export function importSettingStamps(items: SettingItem[] | undefined): void {
  adoptSettingsFromServer(items);
}

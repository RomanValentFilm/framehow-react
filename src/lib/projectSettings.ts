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
import { trace } from './syncTrace';
import {
  orderForSending, orderAsArrived, groupForSending, groupAsArrived,
  type OrderShape, type GroupShape,
} from './orderIds';

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

/** A stamp as the log reads it: "19:40:02.153", or "none" for age unknown. */
function when(t: number): string {
  if (!t || t <= UNKNOWN) return 'none';
  const d = new Date(t);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** The memory in one line: how many items, how many of them unsent. */
export function settingsMemorySummary(): string { return memoryCounts(); }
function memoryCounts(): string {
  let unsent = 0;
  for (const v of _known.values()) {
    if (v.deleted_at !== null ? v.deleted_at > v.serverAt : v.changed_at > v.serverAt) unsent++;
  }
  return `${_known.size} item(s), ${unsent} unsent`;
}

/** Every settings item the store currently holds, in the user's order. */
function currentItems(): Array<{ kind: string; item_id: string; json: string }> {
  const s = useStore.getState();
  const out: Array<{ kind: string; item_id: string; json: string }> = [];
  const push = (kind: string, id: string, idx: number, data: unknown) =>
    out.push({ kind, item_id: id, json: stableJson({ idx, data }) });

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
  // AN ARRANGEMENT IS ALWAYS SENT, EVEN IF A FRAME IS MISSING FROM IT (#398).
  //
  // #397 tried to hold it back while any frame still had no server id, by
  // making this list empty. That was wrong in a way worth writing down: an
  // empty list is not "say nothing". The item simply stops appearing, and the
  // settings machinery reads an item that has stopped appearing as DELETED. So
  // instead of quietly waiting, the device announced that the whole arrangement
  // was gone — `frameOrder/main (deleted)` in Roman's log, seconds after that
  // build went out. Far worse than the misplacement it was meant to cure.
  //
  // Left as it was. A brand-new frame is missing from the order for a second;
  // applyArrangement keeps an unlisted frame behind the one it currently
  // follows, so it is not dropped, and the next push carries the full order.
  // NO SHOT NAMED TWICE (#426). If the same id ever reaches the list — from a
  // damaged copy, or a merge that went wrong — nothing else removes it, and it
  // is then sent to the server and read back by every device for ever. The
  // storyboard would draw that card twice.
  const orderedIds = [...new Set(
    s.frames.map((f) => f.serverFrameId).filter(Boolean) as string[])];
  // REVERTED (#343). #337 put the breaks inside this item so the whole
  // arrangement travelled as one thing. It also changed the SHAPE of a settings
  // value that had been a plain list since #294 — and the app then decided its
  // settings had changed on every single pass, pushing, which bumped the
  // project's time, which made the heartbeat pull, which pushed again. The iPad
  // churned in a loop and every pull redrew the screen.
  //
  // Roman had already said the old behaviour was what he wanted: a break sits
  // where you put it, by position, and the later change wins. So this goes back
  // to what it was, and the breaks stay items of their own.
  if (orderedIds.length > 0) push('frameOrder', 'main', 0, orderedIds);

  // A GROUP AND A SHOOTING ORDER HOLD THEIR SHOTS BY NAME, LIKE THE STORY FLOW
  // ABOVE (#489).
  //
  // Both used to be pushed WHOLE, with this device's private numbers inside
  // them. The project's own blob translated them properly; this copy did not,
  // and it is applied after the blob — so the raw copy won. Roman's iPad, 9
  // September: the Desktop's order said shots 31 to 44, the iPad held 4 to 17,
  // and the order showed nothing. The group arrived as "?27 ?28 ?29 ?30".
  //
  // ONE LANGUAGE, EVERYWHERE. This memory, the wire and the server all speak
  // names; only the running screen speaks numbers. Two languages would be
  // worse than one wrong one: this text is what the app compares each pass to
  // decide "did it change", so a memory in numbers and a wire in names would
  // differ for ever — push, pull, push, pull. That is #343's churn, and it is
  // why the translation is here and not at the moment of sending.
  //
  // `lost` is the alarm, and it should always be empty: since #405 — finished
  // in #489 — a shot has its name from the moment it is made, so there is no
  // such thing as a shot that cannot be named. If one ever is, it is said out
  // loud rather than quietly leaving a short order.
  const nameOf = (n: number) => s.frames.find((f) => f.id === n)?.serverFrameId;
  const noName: (string | number)[] = [];
  s.groups.forEach((g, i) => {
    const sent = groupForSending(g as unknown as GroupShape, nameOf);
    noName.push(...sent.lost);
    push('group', String(g.id), i, sent.order);
  });
  s.sortOrders.forEach((o, i) => {
    const sent = orderForSending(o as unknown as OrderShape, nameOf);
    noName.push(...sent.lost);
    push('sortOrder', o.id, i, sent.order);
  });
  if (noName.length > 0) {
    trace(`  shots with no name yet, left out of the orders/groups: ${noName.join(', ')}`);
  }
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
  // ONE ITEM PER STRIP — its names and prefix (#510). These rode only in the
  // metadata blob, which has no change time: the last device to push won,
  // even one that had renamed nothing. Run 206: the desktop renamed three
  // strips and the iPad's next push, carrying its untouched copy, put the old
  // names back on both. As an item each with a time, the later rename wins
  // and an untouched copy cannot out-rank it. The blob copy is still written
  // and still read, as the fallback for anything older.
  s.stripDefs.forEach((d, i) => push('stripDef', d.id, i, d));
  // And the other three columns — SHOT, NEEDS, NOTES — the same way (#510).
  s.columnNames.forEach((c, i) => push('columnName', c.id, i, c));
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
  trace(`  settings memory: seeded ${_known.size} item(s) as changed at ${when(_baseline)}`
    + `${createdAt && createdAt > 0 ? '' : ' (no project time given — now)'}, project ${projectId ?? 'local'}`);
}

/**
 * EMPTY THE MEMORY IF THIS IS A DIFFERENT PROJECT (#490).
 *
 * Everything here is remembered for ONE project. Opening another one must start
 * empty, or its settings get pushed into the new project — which is how a brand
 * new project arrived holding ten sort orders that belonged to the last one,
 * conflicts and all.
 *
 * IT HAS TO HAPPEN BEFORE THE ARRIVING SETTINGS ARE JUDGED, not after.
 *
 * It used to live only inside `adoptSettingsFromServer`, which runs AFTER
 * `applySettingsToStore` — and `applySettingsToStore` is where the arriving
 * arrangement is weighed against what this device remembers. So opening a
 * project after another one weighed the new project's story flow against the
 * LAST project's time. The story flow is filed under the same name in every
 * project, `frameOrder/main`, so the times collided every time, the device
 * decided its own was newer, and threw the arrangement away. Its own log said
 * so and nobody was reading it:
 *
 *     arrangement NOT taken: changed_at=1788959633351 (mine is newer and unsent)
 *
 * Found by the simulator on 9 September: two devices arriving at one project
 * from different projects, and the rearrangement made on one never reaching the
 * other — while the breaks, which are items of their own, arrived fine.
 *
 * The needs tabs and the locations have fixed names too, so they could go the
 * same way. Groups and shooting orders cannot: their names are their own.
 */
export function forgetAnotherProjectsSettings(projectId?: string | null): void {
  if (projectId !== undefined && projectId !== _projectId) {
    if (_known.size > 0) {
      trace(`  settings memory: cleared — it was project ${_projectId ?? 'local'}'s (${memoryCounts()}); now ${projectId ?? 'local'}`);
    }
    _known.clear();
    _projectId = projectId;
    _seeded = false;
  }
}

/**
 * ONE SPELLING FOR EVERY VALUE (#510, run 218). An order that has been to
 * another device and back comes home with its fields in a different sequence
 * — the same order, a different string. The memory compared strings, called
 * it a change, re-sent it as an edit, and the server (comparing strings too)
 * filed a decision between two identical orders. Fields are written sorted,
 * so the same value is always the same text, whoever wrote it last.
 */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      const x = (v as Record<string, unknown>)[k];
      if (x !== undefined) out[k] = sortKeys(x);
    }
    return out;
  }
  return v;
}

/** Equal once both are in the fixed spelling — so a value the server still
 *  holds in the old spelling is not mistaken for a change. */
function sameText(aJson: string, bJson: string): boolean {
  if (aJson === bJson) return true;
  try { return stableJson(JSON.parse(aJson)) === stableJson(JSON.parse(bJson)); } catch { return false; }
}

/** The same item, only its place in the list differs. */
function sameButIdx(aJson: string, bJson: string): boolean {
  try {
    const a = JSON.parse(aJson) as { data?: unknown };
    const b = JSON.parse(bJson) as { data?: unknown };
    return stableJson(a.data) === stableJson(b.data);
  } catch { return false; }
}

/**
 * THE SAME THING MINUS SHOTS THIS DEVICE DOES NOT HAVE YET (#514, run 234) —
 * for the story flow, a shooting order, a group. A shooting order arrived on
 * the iPad before the new shot it named had; the iPad's copy came out one shot
 * short, the memory called that a change of its own, and the short order went
 * up as the newest — the shot was gone from the order on both devices. If
 * every list of shots in the value is the known one with some left out, in the
 * same sequence, and everything else is the same, nothing was changed here.
 */
/**
 * ...BUT ONLY SHOTS THIS DEVICE DOES NOT HAVE (#517, run 267). A shot taken
 * OUT of a group by hand is also "the known list with one left out, in the
 * same sequence" — and the rule above swallowed it: the removal was never
 * called a change and never went up (BIG DAY part 5, green before #514, red
 * after). A list is a projection only when every id it lacks is a shot this
 * device does not hold; lacking a shot it does hold is a change made here.
 */
function isProjectionOf(kind: string, curJson: string, prevJson: string, held: ReadonlySet<string>): boolean {
  const lists: Record<string, string[]> = {
    frameOrder: [],                                   // the data IS the list
    sortOrder: ['frameOrder', 'sortedSnapshot'],
    group: ['frameIds', 'hiddenFrameIds'],
  };
  const fields = lists[kind];
  if (!fields) return false;
  if (kind === 'frameOrder') return isSubsequenceOf(curJson, prevJson, held);
  try {
    const cur = (JSON.parse(curJson) as { data?: Record<string, unknown> }).data ?? {};
    const prev = (JSON.parse(prevJson) as { data?: Record<string, unknown> }).data ?? {};
    let shorter = false;
    for (const f of fields) {
      const a = cur[f], b = prev[f];
      if (a === undefined && b === undefined) continue;
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      if (a.length > b.length) return false;
      if (a.length < b.length) shorter = true;
      let i = 0;
      for (const id of b) {
        if (i < a.length && a[i] === id) i++;
        else if (held.has(String(id))) return false;   // left out on purpose
      }
      if (i !== a.length) return false;
    }
    if (!shorter) return false;
    const rest = (d: Record<string, unknown>) => {
      const o = { ...d };
      for (const f of fields) delete o[f];
      return stableJson(o);
    };
    return rest(cur) === rest(prev);
  } catch { return false; }
}

/** Is `shorter` the list `longer` with some ids left out, the rest in the same order? */
function isSubsequenceOf(shorterJson: string, longerJson: string, held: ReadonlySet<string>): boolean {
  let a: string[], b: string[];
  try {
    a = (JSON.parse(shorterJson) as { data?: string[] }).data ?? [];
    b = (JSON.parse(longerJson) as { data?: string[] }).data ?? [];
  } catch { return false; }
  if (!Array.isArray(a) || !Array.isArray(b) || a.length >= b.length) return false;
  let i = 0;
  for (const id of b) {
    if (i < a.length && a[i] === id) i++;
    else if (held.has(String(id))) return false;       // left out on purpose
  }
  return i === a.length;
}

export function stampChangedSettings(projectId?: string | null): void {
  forgetAnotherProjectsSettings(projectId);
  // Backstop only. Every path that loads a project calls seedSettings() or
  // adoptSettingsFromServer() first, so this should not be reached — and if it
  // is, there is genuinely nothing to compare against: whatever the store holds
  // is all we know. Recorded as project-old, because the alternative (calling
  // it all a change made now) would let merely opening a project overwrite real
  // work on the other device.
  if (!_seeded) {
    trace('  settings memory: NOT SEEDED when a change was stamped — seeding now (backstop)');
    seedSettings(_projectId ?? null, _baseline);
  }
  const now = Date.now();
  const seen = new Set<string>();
  // The shots this device holds, by the names the lists use (#517).
  const held = new Set<string>();
  for (const f of useStore.getState().frames) if (f.serverFrameId) held.add(f.serverFrameId);

  for (const it of currentItems()) {
    const k = key(it.kind, it.item_id);
    seen.add(k);
    const prev = _known.get(k);
    if (!prev) {
      // Something the first look did not have: a genuinely new group, sort
      // order or category. That is a change, and it happened now.
      _known.set(k, { json: it.json, changed_at: now, deleted_at: null, serverAt: UNKNOWN });
    } else if (!sameText(prev.json, it.json) || prev.deleted_at !== null) {
      // THE SERVER'S ORDER MINUS SHOTS I DO NOT HAVE YET IS NOT MY CHANGE (#510).
      //
      // Run 214: the iPad's push reply carried the desktop's eight-shot
      // arrangement while the iPad still held six — the two new shots had not
      // reached it. It applied what it could, and this stamp then saw "my
      // order differs from the server's", called it a change made now, and
      // pushed six shots as the newest arrangement. The desktop took it, and
      // the new shots fell in wherever the rebuild left them. A list that is
      // the known one with some ids missing, in the same order, is that case
      // (and after a deletion too, which the arrangement never needed to say:
      // an id with no frame is simply skipped). It is left as it was.
      if (prev.deleted_at === null && isProjectionOf(it.kind, it.json, prev.json, held)) continue;
      // A DIFFERENT PLACE IN THE LIST IS NOT A CHANGE (#510, run 217). The
      // value carries `idx` so a new item lands where it belongs on the other
      // device — but adding an order shifts the idx of the ones after it, and
      // every one of them was then re-stamped and re-sent as edited. Two
      // devices holding the orders in different places argued about all of
      // them for ever. The new idx is kept for the wire; the time is not moved.
      if (prev.deleted_at === null && sameButIdx(prev.json, it.json)) {
        _known.set(k, { ...prev, json: it.json });
        continue;
      }
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
      // A DELETION IS A CHANGE, AND ITS TIME IS WHEN IT WAS DELETED (#350).
      //
      // A deleted item was sent carrying its OLD change time. The server only
      // takes an item that is newer than the one it holds — and the old time is
      // not newer than itself, so the deletion was refused. Every time. In
      // silence. The device then had an item it could never get rid of: it
      // pushed on every pass, which moved the project's clock, which made the
      // other side's heartbeat pull, which pushed again.
      //
      // Roman's iPad churned like this all afternoon over one row —
      // setupPalette, retired by #331 and never able to die.
      changed_at: v.deleted_at !== null ? Math.max(v.changed_at, v.deleted_at) : v.changed_at,
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
  // A different project must not inherit this one's memory. By the time this
  // runs the caller has usually cleared it already (#490) — kept here because
  // this is also reached on paths that do not apply settings first.
  forgetAnotherProjectsSettings(projectId);
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
      trace(`    setting ${k}: still mine to send — mine@${when(prev.changed_at)} is later than theirs@${when(it.changed_at)}`);
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
  // AND NOT TWICE ON THE WAY BACK IN EITHER (#426). An arrangement that already
  // names a frame twice — one saved before the fix, sitting on the server —
  // would otherwise put the same frame object into the storyboard twice.
  const alreadyOut = new Set(out.map((f) => f.serverFrameId).filter(Boolean));
  for (const id of arrangement) {
    if (alreadyOut.has(id)) continue;
    const f = byId.get(id);
    if (f) { out.push(f); alreadyOut.add(id); }     // an id with no frame is skipped
    const after = followers.get(id);
    if (after) for (const g of after) {
      if (g.serverFrameId && alreadyOut.has(g.serverFrameId)) continue;
      out.push(g);
      if (g.serverFrameId) alreadyOut.add(g.serverFrameId);
    }
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

  // ...AND BACK INTO THIS DEVICE'S NUMBERS ON ARRIVAL (#489).
  //
  // Everything below merges and then writes straight into the store, which is
  // where the numbers live. So the translation happens once, here, before any
  // of it — never halfway down.
  //
  // A name this device does not hold is a shot it has not got. It is REPORTED,
  // never mistaken for another shot — which is exactly what used to happen when
  // the numbers travelled raw: 31 arrived and the iPad read it as its own 31.
  {
    const numberOf = (name: string) => s.frames.find((f) => f.serverFrameId === name)?.id;
    const notHere: (string | number)[] = [];
    for (const r of rows) {
      if (r.deleted || !r.data) continue;
      if (r.kind === 'sortOrder') {
        const got = orderAsArrived(r.data as never, numberOf);
        notHere.push(...got.lost);
        r.data = got.order;
      } else if (r.kind === 'group') {
        const got = groupAsArrived(r.data as never, numberOf);
        notHere.push(...got.lost);
        r.data = got.order;
      }
    }
    if (notHere.length > 0) {
      trace(`    shots this device has not got yet, named: ${notHere.join(', ')}`);
    }
  }

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
        const differs = stableJson(out[i]) !== stableJson(r.data);
        if (r.changed_at > UNKNOWN && !localIsNewerAndUnsent(kind, r.item_id, r.changed_at)) {
          out[i] = r.data as T;
          if (differs) trace(`    setting ${kind}/${r.item_id}: theirs@${when(r.changed_at)} → taken`);
        } else if (differs) {
          trace(`    setting ${kind}/${r.item_id}: theirs@${when(r.changed_at)} mine@${when(_known.get(key(kind, r.item_id))?.changed_at ?? UNKNOWN)}`
            + ` → KEPT MINE (${r.changed_at > UNKNOWN ? 'mine is newer and unsent' : 'theirs has no age'})`);
        }
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
  {
    const anyLoc = rows.find((r) => r.kind === 'needLocations' && !r.deleted);
    if (anyLoc && stableJson(anyLoc.data) !== stableJson(s.needDefinitions.locations)) {
      trace(locRow
        ? `    setting needLocations: theirs@${when(locRow.changed_at)} → taken`
        : `    setting needLocations: theirs@${when(anyLoc.changed_at)} mine@${when(_known.get('needLocations/needLocations')?.changed_at ?? UNKNOWN)}`
          + ` → KEPT MINE (${anyLoc.changed_at > UNKNOWN ? 'mine is newer and unsent' : 'theirs has no age'})`);
    }
  }
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

  // Strip names, one row each (#510). Applied after the blob's copy, so the
  // timed rows have the last word; a server with no such rows leaves the
  // blob's copy as it is.
  const strips = mergeList('stripDef', s.stripDefs, (d: { id: string }) => d.id);
  if (strips) patch.stripDefs = strips;
  const columns = mergeList('columnName', s.columnNames, (c: { id: string }) => c.id);
  if (columns) {
    patch.columnNames = columns;
    // A card label that changed re-labels every card here, as renaming it on
    // this device would have (#510) — the cards no longer carry it as a change.
    const arrived = (id: string) => (columns as Array<{ id: string; cardLabel: string }>).find((c) => c.id === id)?.cardLabel;
    const held = (id: string) => s.columnNames.find((c) => c.id === id)?.cardLabel;
    const needsLabel = arrived('needs');
    if (needsLabel && needsLabel !== held('needs')) {
      const next: typeof s.frameNeeds = {};
      for (const [fid, ft] of Object.entries(s.frameNeeds)) next[+fid] = { ...ft, label: needsLabel };
      patch.frameNeeds = next;
    }
    const notesLabel = arrived('notes');
    if (notesLabel && notesLabel !== held('notes')) {
      const next: typeof s.frameNotes = {};
      for (const [fid, fn] of Object.entries(s.frameNotes)) next[+fid] = { ...fn, label: notesLabel };
      patch.frameNotes = next;
    }
  }

  // Story-flow breaks merge one by one, like groups and orders (#343, back to
  // how it was). A break only this device has stays; one only the other device
  // has is added; one both know at different positions takes the newer.
  const breaks = mergeList('storyFlowBreak', s.storyFlowBreaks ?? [], (b) => b.id);
  if (breaks) patch.storyFlowBreaks = breaks;

  // The story flow: one arrangement, the later one wins whole (#294). A value
  // written by #337 was an object; anything of that shape is read for its
  // frames so nothing written in that hour is stranded.
  const orderRow = rows.find((r) => r.kind === 'frameOrder' && !r.deleted && r.changed_at > UNKNOWN
    && !localIsNewerAndUnsent('frameOrder', 'main', r.changed_at));
  if (orderRow) {
    const d = orderRow.data as string[] | { frames?: string[] };
    const list = Array.isArray(d) ? d : (d.frames ?? []);
    patch.frames = applyArrangement(s.frames, list);
    trace(`  arrangement arrived: ${list.length} frames`);
  } else {
    const any = rows.find((r) => r.kind === 'frameOrder');
    if (any) {
      trace(`  arrangement NOT taken: changed_at=${any.changed_at}`
        + `${any.changed_at <= UNKNOWN ? ' (age unknown)' : ' (mine is newer and unsent)'}`);
    }
  }

  if (Object.keys(patch).length > 0) useStore.setState(patch as never);
}

/** Does this device hold a settings change the server has not confirmed?
 *
 *  Asked instead of comparing a whole-project fingerprint, which could not
 *  answer until a push had already succeeded once — so on a project that had
 *  not pushed yet, creating or rearranging a sort order changed no frame, and
 *  the push was skipped as "nothing changed". */
/** WHICH settings are unsent, by name (#349). "project settings changed" on
 *  every push with nothing else changing means one item never gets confirmed,
 *  and the device pushes for ever. This says which one. */
export function unsentSettingNames(): string[] {
  const out: string[] = [];
  // With the times (22 Sept): when this device says it changed the item, and
  // what the server had — so a stale copy dated as new can be seen in the log.
  for (const [k, v] of _known) {
    if (v.deleted_at !== null && v.deleted_at > v.serverAt) out.push(`${k} (deleted @${when(v.deleted_at)}, server had @${when(v.serverAt)})`);
    else if (v.changed_at > v.serverAt) out.push(`${k} (mine @${when(v.changed_at)}, server had @${when(v.serverAt)})`);
  }
  return out;
}

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
export function importSettingStamps(items: SettingItem[] | undefined, projectId?: string | null): void {
  if (!items || items.length === 0) return;
  // AND WHOSE MEMORY IT IS (#513, run 227). Restored without the project's
  // name, the first stamp after a restart read "a different project", threw
  // the memory away and re-seeded everything as changed NOW — so the device
  // pushed every setting it held as newer than anything on the server, and a
  // group deleted elsewhere came back to life on both devices.
  if (projectId !== undefined) _projectId = projectId;
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
  stripDefs: unknown[];
  columnNames: unknown[];
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
    stripDefs: [...s.stripDefs],
    columnNames: [...s.columnNames],
  };
}

/**
 * Has this device changed that item, not sent it, AND is its change later than
 * the one that just arrived?
 *
 * The first version of this asked only the first two (#323), which was too
 * eager: merely OPENING a project stamps its items as changed-and-unsent, so a
 * device that had done nothing at all still put its own copy back over whatever
 * the pull had just brought — and the other device's break disappeared the
 * moment after arriving (#340).
 *
 * "Mine is unsent" is not a reason to win. "Mine is unsent AND later" is.
 */
function iHoldUnsent(kind: string, itemId: string, arrived?: Map<string, number>): boolean {
  const v = _known.get(key(kind, itemId));
  if (!v || v.deleted_at !== null) return false;
  if (v.changed_at <= v.serverAt) return false;          // nothing of mine to protect
  const theirs = arrived?.get(key(kind, itemId));
  if (theirs === undefined) return true;                 // they said nothing about it
  return v.changed_at > theirs;                          // mine really is later
}

/**
 * Put back the settings this device changed and has not sent, after a pull has
 * rebuilt the store over the top of them (#323).
 *
 * Item by item, and only the ones actually held. An item the server knows more
 * about than we do is left exactly as the merge left it.
 */
export function keepMyUnsentSettings(before: MySettings, arrivedItems?: SettingItem[]): void {
  const s = useStore.getState();
  // When each arriving item said it was changed, so "mine is later" can be a
  // real comparison rather than a guess (#340).
  const arrived = new Map<string, number>();
  for (const it of arrivedItems ?? []) arrived.set(key(it.kind, it.item_id), it.changed_at);
  const patch: Record<string, unknown> = {};

  /** Put my copy back into a list, by id, adding it if the pull removed it. */
  function restore<T>(kind: string, mine: T[], now: T[], idOf: (x: T) => string): T[] | null {
    let changed = false;
    const out = [...now];
    for (const item of mine) {
      if (!iHoldUnsent(kind, idOf(item), arrived)) continue;
      const i = out.findIndex((x) => idOf(x) === idOf(item));
      if (i >= 0 && stableJson(out[i]) === stableJson(item)) continue;   // the same already
      if (i >= 0) { out[i] = item; } else { out.push(item); }
      changed = true;
      const k = key(kind, idOf(item));
      trace(`    setting ${k}: PUT BACK mine@${when(_known.get(k)?.changed_at ?? UNKNOWN)} over theirs@${when(arrived.get(k) ?? UNKNOWN)} (unsent)`);
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
  const locsMine = iHoldUnsent('needLocations', 'needLocations', arrived);
  if (locsMine && stableJson(before.locations) !== stableJson(s.needDefinitions?.locations ?? [])) {
    trace(`    setting needLocations: PUT BACK mine@${when(_known.get('needLocations/needLocations')?.changed_at ?? UNKNOWN)}`
      + ` over theirs@${when(arrived.get('needLocations/needLocations') ?? UNKNOWN)} (unsent)`);
  }
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

  const strips = restore('stripDef', (before.stripDefs ?? []) as { id: string }[],
    s.stripDefs as { id: string }[], (d) => d.id);
  if (strips) patch.stripDefs = strips;
  const columns = restore('columnName', (before.columnNames ?? []) as { id: string }[],
    s.columnNames as { id: string }[], (c) => c.id);
  if (columns) patch.columnNames = columns;
  // The old whole-palette row, for anything still travelling that way.
  if (iHoldUnsent('setupPalette', 'setupPalette', arrived)) {
    patch.setups = before.setups;
    patch.nextSetupId = before.nextSetupId;
  }

  // The arrangement is one item too, and it is re-applied rather than restored:
  // the pull may have brought frames this device had never seen, and they must
  // not be dropped just because my arrangement predates them. applyArrangement
  // keeps anything the list does not mention.
  if (iHoldUnsent('frameOrder', 'main', arrived) && before.frameOrder.length > 0) {
    patch.frames = applyArrangement(s.frames, before.frameOrder);
  }

  if (Object.keys(patch).length > 0) useStore.setState(patch as never);
}

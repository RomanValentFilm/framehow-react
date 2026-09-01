// THE SORTING SHEET, ON ITS OWN (#411).
//
// A shooting order is built from a sheet of boxes: "DAY 1 first, then DAY 2".
// Everything here works on that sheet and on plain lists of frame numbers —
// no screen, no sync, no project. It lives apart from sortOrder.ts so it can be
// put on the bench and run in a second (test/resort-bench.ts), which is how the
// fault that took 27 shots out of Roman's order is kept out for good.

import { state } from '../store/state';
import type { BracketNodeData, NeedTable } from '../store/state';

/** Tree node — selected goes right, remaining goes down. Like Finder folders. */
export interface BracketNode {
  inputIds: number[];          // frames entering this node
  categoryId: string | null;   // 'setup' | needTable.id | null
  categoryName: string | null;
  itemId: string | null;       // setup.id | needItem.id | null
  itemName: string | null;
  matchedIds: number[];        // frames matching selection → right child
  right: BracketNode | null;   // next selection step (matched frames)
  down: BracketNode | null;    // remaining frames node (auto-created)
  expanded: boolean;           // is the remaining dropdown open?
}

/** Convert BracketNode tree → serialisable BracketNodeData for persistence. */
/** No box may name the same frame twice (#416). */
function once(ids: number[]): number[] {
  const seen = new Set<number>();
  return ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
}

export function serializeBracket(node: BracketNode): BracketNodeData {
  const d: BracketNodeData = {
    inputIds: once(node.inputIds),
    matchedIds: once(node.matchedIds),
  };
  if (node.categoryId) d.categoryId = node.categoryId;
  if (node.categoryName) d.categoryName = node.categoryName;
  if (node.itemId) d.itemId = node.itemId;
  if (node.itemName) d.itemName = node.itemName;
  if (node.expanded) d.expanded = true;
  if (node.right) d.right = serializeBracket(node.right);
  if (node.down) d.down = serializeBracket(node.down);
  return d;
}

/** Restore BracketNode tree from persisted BracketNodeData. */
export function deserializeBracket(d: BracketNodeData): BracketNode {
  return {
    // Deduped coming back in as well, so a sheet already damaged on the server
    // is cleaned the first time it is read (#416).
    inputIds: once(d.inputIds),
    categoryId: d.categoryId ?? null,
    categoryName: d.categoryName ?? null,
    itemId: d.itemId ?? null,
    itemName: d.itemName ?? null,
    matchedIds: once(d.matchedIds),
    right: d.right ? deserializeBracket(d.right) : null,
    down: d.down ? deserializeBracket(d.down) : null,
    expanded: d.expanded ?? false,
  };
}

/** Which of these frames answer yes to this one step, as things stand now. */
export function framesMatching(categoryId: string, itemId: string, frameIds: number[]): number[] {
  const s = state();

  // SETUP is not in the needs — it is the frame's own colour tag.
  if (categoryId === 'setup') {
    return frameIds.filter((fid) => s.frames.find((f) => f.id === fid)?.setupId === itemId);
  }

  let table: NeedTable | undefined;
  for (const tab of s.needDefinitions.tabs) {
    table = tab.tables.find((t) => t.id === categoryId);
    if (table) break;
  }
  // The category itself is gone — renamed away or deleted. Say nobody matches
  // rather than guessing; the step then has nothing under it and the frames
  // fall through to the next step, which is what the sheet already does for an
  // empty step.
  if (!table) return [];

  return frameIds.filter((fid) => {
    const fn = s.frameNeeds[fid];
    if (!fn) return false;
    return table!.type === 'counter'
      ? (fn.counters?.[itemId] || 0) > 0
      : !!fn.toggles?.[itemId];
  });
}

/** Ask every step of the sheet again with today's needs. Says whether anything
 *  came out differently. Walks top down, because each step only ever sees the
 *  frames the step above it did not take. */
export function rematchToNeeds(node: BracketNode): boolean {
  if (!node.categoryId || !node.itemId) return false;   // step never chosen

  const fresh = framesMatching(node.categoryId, node.itemId, node.inputIds);
  const before = node.matchedIds;
  let changed = fresh.length !== before.length || fresh.some((id, i) => id !== before[i]);
  node.matchedIds = fresh;

  // Matched frames are refined by the step to the right; everyone else drops to
  // the step below. Exactly how fixInputIds cascades — but with the answers
  // asked again rather than taken from the shelf.
  if (node.right) {
    node.right.inputIds = [...fresh];
    if (rematchToNeeds(node.right)) changed = true;
  }
  if (node.down) {
    node.down.inputIds = node.inputIds.filter((id) => !fresh.includes(id));
    if (rematchToNeeds(node.down)) changed = true;
  }
  return changed;
}

/**
 * WHICH FRAMES' NEEDS ACTUALLY CHANGED.
 *
 * Every box in the sheet remembers which frames matched it when it was made.
 * Ask the boxes again with today's needs, and a frame that has moved from one
 * box to another is a frame whose needs changed. Everything else answered
 * exactly as it did before.
 *
 * This is the whole trick, and it is Roman's: instead of asking "which frames
 * did the user move by hand" — which cannot be answered honestly, because the
 * app never recorded it and dragging one frame shifts everything behind it —
 * ask "which frames' needs changed". Then the hand moves survive without ever
 * being identified, because nothing else is touched.
 */
export function boxOfEachFrame(root: BracketNode): Map<number, string> {
  const where = new Map<number, string>();
  // THE WHOLE CHAIN, NOT THE FIRST BOX.
  //
  // Boxes lead into boxes: DAY 1, and inside it LOCATION 2. A frame matched by
  // DAY 1 is matched AGAIN by the box to its right, and it is that deepest box
  // that decides where the frame sits. Recording the first box to claim it
  // would file both LOCATION 2 and LOCATION 3 under plain "DAY 1", so moving a
  // frame from one location to the other inside the same day would look like
  // no change at all. Parents are walked before their children, so a child
  // simply writes over its parent and the deepest box wins.
  const walk = (n: BracketNode, path: string): void => {
    const here = n.categoryId && n.itemId ? `${path}/${n.categoryId}|${n.itemId}` : path;
    if (n.categoryId && n.itemId) for (const fid of n.matchedIds) where.set(fid, here);
    if (n.right) walk(n.right, here);
    if (n.down) walk(n.down, path);
  };
  walk(root, '');
  return where;
}

/**
 * Move ONLY the frames whose needs changed; leave every other frame exactly
 * where it is.
 *
 * `fresh` is the order the sheet would give if it were sorted from scratch, and
 * it is used for one thing only: to say where each changed frame now belongs.
 * Each one is dropped in behind the nearest frame in front of it that is
 * staying put. So the list keeps its shape — including every frame somebody
 * moved by hand — and only the frames that answered differently move.
 *
 * A frame moved by hand whose needs then changed DOES move: changing its needs
 * is a later and more deliberate statement about that frame than the drag was.
 * Agreed with Roman explicitly.
 */
export function placeChangedFrames(
  standsAs: number[],
  fresh: number[],
  changed: Set<number>,
  boxOf?: Map<number, string>,
): { list: number[]; outOfStep: Set<number> } {
  const outOfStep = new Set<number>(changed);
  if (changed.size === 0) return { list: standsAs, outOfStep };

  const out = standsAs.filter((id) => !changed.has(id));

  // A SHOT GOES WITH THE OTHERS OF ITS DAY (#419).
  //
  // It used to be dropped in behind the nearest shot in front of it that was
  // not itself moving. That works only while the rest of the list is already in
  // box order — and it very often is not, because somebody rearranged it by
  // hand. Then the anchor is a shot that in TODAY's list sits somewhere else
  // entirely, and a shot correctly filed under DAY 2 in the sheet lands behind
  // the DAY 3 cards. Roman: "look at frame 8B... its green card landed behind
  // DAY 3."
  //
  // So: find where that box's shots actually are in the list in front of you,
  // and put it after the last of them. That is what a person would do, and it
  // can be said in one line — "it goes to the end of its box".
  //
  // BOX, not day. The whole chain counts: DAY 1 > LOCATION 1 is a different box
  // from DAY 1 > LOCATION 2, and a shot joins the one it actually belongs to.
  //
  // When there is nowhere obvious — the box has no other shots yet, or its
  // shots are scattered — the shot is left where it is and MARKED, rather than
  // guessed at. Roman's rule: the app moves what it is sure of and is honest
  // about the rest.
  const placed = new Map<number | null, number[]>();
  for (const fid of fresh) {
    if (!changed.has(fid)) continue;
    let anchor: number | null = null;

    const myBox = boxOf?.get(fid);
    if (myBox !== undefined) {
      // The last shot of MY BOX that is staying put — the whole chain, so
      // DAY 1 > LOCATION 1 and DAY 1 > LOCATION 2 are different places.
      for (let j = out.length - 1; j >= 0; j--) {
        if (boxOf!.get(out[j]) === myBox) { anchor = out[j]; break; }
      }
    }
    if (anchor === null) {
      // Nobody of my box is here. Fall back to the old anchor so the list still
      // makes sense, and let the green say "check this one".
      const at = fresh.indexOf(fid);
      for (let j = at - 1; j >= 0; j--) {
        if (!changed.has(fresh[j])) { anchor = fresh[j]; break; }
      }
    }
    const list = placed.get(anchor) ?? [];
    list.push(fid);                       // in fresh order, so they keep theirs
    placed.set(anchor, list);
  }

  for (const [anchor, group] of placed) {
    if (anchor === null) { out.unshift(...group); continue; }
    const at = out.indexOf(anchor);
    if (at === -1) out.push(...group); else out.splice(at + 1, 0, ...group);
  }

  const list = fillTheGaps(out, standsAs);   // deduped there — see the note in it

  // NOTHING ELSE IS MARKED.
  //
  // A first version also marked any shot standing out of box order — but a
  // shot you moved by hand breaks the run of days on purpose, so every one of
  // its neighbours went green and stayed green. Deliberate work must not look
  // like a warning. Green is for shots whose needs changed, and for shots the
  // app could not place with confidence — both of which are already here.
  return { list, outOfStep };
}

/**
 * PUT BACK ANYBODY THE SHEET LEFT OUT.
 *
 * The sheet's answer is not a complete list. When a box has nothing below it,
 * the frames it did not match are simply left out — so `flattenBracketOrder`
 * can return five of six frames and say nothing about it.
 *
 * That has bitten twice. Once as a loss: 27 shots taken out of Roman's order
 * with nowhere to put them back. Once as a wrong position: a frame moved to
 * another day anchored itself to the wrong neighbour, because the neighbour it
 * should have followed was one of the ones left out.
 *
 * So every list that comes out of the sheet is completed here first: anybody
 * missing goes straight back in behind the frame they currently follow.
 */
export function fillTheGaps(list: number[], standsAs: number[]): number[] {
  // Deduped on the way in. The sheet can name the same frame twice — a box
  // whose matches overlap another's — and a list with a shot in it twice draws
  // that shot twice. Roman: "it duplicates the frames again", and his log:
  // `1 frame(s) moved to match NEEDS · list 18 → 19`. A rebuild must never
  // come out LONGER than it went in.
  const out: number[] = [];
  const have = new Set<number>();
  for (const id of list) if (!have.has(id)) { out.push(id); have.add(id); }
  for (let i = 0; i < standsAs.length; i++) {
    if (have.has(standsAs[i])) continue;
    const before = standsAs.slice(0, i).reverse().find((id) => have.has(id));
    const at = before === undefined ? -1 : out.indexOf(before);
    if (at === -1) out.unshift(standsAs[i]); else out.splice(at + 1, 0, standsAs[i]);
    have.add(standsAs[i]);
  }
  return out;
}


/** After swap, fix inputIds down the chain so dropdowns show correct items.
 *  matchedIds stay unchanged — groupings are preserved. */
export function fixInputIds(node: BracketNode): void {
  if (!node.itemId) return;
  if (node.right) {
    node.right.inputIds = [...node.matchedIds];
    fixInputIds(node.right);
  }
  const remaining = node.inputIds.filter((id) => !node.matchedIds.includes(id));
  if (node.down) {
    node.down.inputIds = remaining;
    fixInputIds(node.down);
  }
}

/** Sync bracket tree with current visible frames.
 *  - Adds new frames to root.inputIds (they cascade to "remaining" buckets via fixInputIds)
 *  - Removes deleted frames from the tree
 *  Returns true if any changes were made. */
export function syncBracketWithVisibleFrames(root: BracketNode, visibleIds: number[]): boolean {
  // WHO IS ALREADY IN THE SHEET — asked of every box, not of the flattened
  // answer (#416).
  //
  // flattenBracketOrder leaves out the frames a box did not match when it has
  // nothing below it. Asking IT who is already here therefore says "not here"
  // about frames that are, and they get added a second time. Roman: "have a
  // look at 4B and 5A in the last REMAINING box." It never showed before
  // because the sheet was thrown away after each use; now it is kept, so the
  // repeats pile up.
  const bracketIds = new Set<number>();
  const gather = (n: BracketNode): void => {
    for (const id of n.inputIds) bracketIds.add(id);
    for (const id of n.matchedIds) bracketIds.add(id);
    if (n.right) gather(n.right);
    if (n.down) gather(n.down);
  };
  gather(root);
  const visibleSet = new Set(visibleIds);
  let changed = false;
  // Add new frames not in bracket
  for (const id of visibleIds) {
    if (!bracketIds.has(id)) {
      root.inputIds.push(id);
      changed = true;
    }
  }
  // Remove deleted frames from bracket
  const removeFromNode = (node: BracketNode) => {
    const before = node.inputIds.length;
    node.inputIds = node.inputIds.filter((id) => visibleSet.has(id));
    node.matchedIds = node.matchedIds.filter((id) => visibleSet.has(id));
    if (node.inputIds.length !== before) changed = true;
    if (node.right) removeFromNode(node.right);
    if (node.down) removeFromNode(node.down);
  };
  removeFromNode(root);
  // Cascade inputIds through the tree so new frames land in correct remaining buckets
  if (changed) fixInputIds(root);
  return changed;
}

/** Extract final frame order from the bracket tree (depth-first: right then down). */
export function flattenBracketOrder(node: BracketNode): number[] {
  if (!node.itemId) {
    // Pending — not yet sorted, keep input order
    return [...node.inputIds];
  }
  const result: number[] = [];
  // Matched frames — refined by right subtree, or as-is
  if (node.right) {
    result.push(...flattenBracketOrder(node.right));
  } else {
    result.push(...node.matchedIds);
  }
  // Remaining frames — refined by down subtree
  if (node.down) {
    result.push(...flattenBracketOrder(node.down));
  }
  return result;
}

/**
 * DOES THIS ORDER STILL MATCH THE NEEDS, AND IF NOT, WHAT SHOULD IT LOOK LIKE?
 *
 * The whole decision, and nothing else — no store, no screen, no sync. Given an
 * order and the frames that are on screen, it says either "leave it alone, and
 * here is why" or "here is the new list".
 *
 * Kept apart from sortOrder.ts on purpose: this is the part that can lose
 * somebody's shooting order, so it has to be runnable on the bench in a second
 * (test/resort-bench.ts) rather than only through two browsers and a deploy.
 */
export interface ResortSaid {
  /** The order's new list, or undefined when nothing should change. */
  frameOrder?: number[];
  /** The sheet with each box's frames brought up to date — SAVE THIS.
   *  Only the matches change; the boxes, their order and the frames entering
   *  them are left exactly as they were. */
  sheet?: BracketNodeData;
  /** What the boxes produce now — what "modified by hand" is measured against. */
  fresh?: number[];
  /** The frames whose needs changed. These are the ones marked green. */
  moved?: Set<number>;
  /** Where the breaks should sit afterwards, when any of them move. */
  breaks?: { id: string; text: string; position: number }[];
  /** Why nothing is changing, in words, for the log. */
  why?: string;
}

/**
 * WHERE A BREAK GOES AFTERWARDS (#415).
 *
 * Roman uses breaks to separate locations, a lunch break, the end of a day —
 * so a break belongs BETWEEN two particular shots, not at a number. It follows
 * the shot above it: sitting after shot 12, it goes back after shot 12,
 * wherever 12 has landed.
 *
 * UNLESS that shot is one whose needs changed. A shot that has just jumped to
 * another day should not drag the lunch break across with it, so in that case
 * the break stays at the position it was given. Roman's rule, and it is the
 * right way round: the break follows a shot that merely moved, and lets go of
 * one that changed what it is.
 *
 * A break at the very top has no shot above it and stays at the top.
 */
export function breaksAfterResort(
  breaks: readonly { id: string; text: string; position: number }[],
  was: number[],
  now: number[],
  moved: ReadonlySet<number>,
): { id: string; text: string; position: number }[] {
  return breaks.map((b) => {
    const above = b.position > 0 ? was[b.position - 1] : undefined;
    if (above === undefined || moved.has(above)) return { ...b };
    const at = now.indexOf(above);
    return at === -1 ? { ...b } : { ...b, position: at + 1 };
  });
}

export function decideResort(
  order: { frameOrder: number[]; bracketTree?: BracketNodeData; sortedSnapshot?: number[];
           breaks?: readonly { id: string; text: string; position: number }[] },
  visibleIds: number[],
  framesHeld = state().frames.length,
): ResortSaid {
  if (!order.bracketTree || !order.sortedSnapshot) {
    return { why: 'no sorting sheet yet — nothing to follow' };
  }
  if (visibleIds.length === 0) return { why: 'no frames on screen yet' };

  // NOT YET. An order opened before the frames are all there would be sorted
  // against half a storyboard. Roman: "it shows sometimes all frames, sometimes
  // not." If this device is holding fewer frames than the order lists, it is
  // not ready to judge anything.
  const here = new Set(visibleIds);
  const listed = new Set(order.frameOrder);
  if ([...listed].filter((id) => here.has(id)).length < listed.size
      && framesHeld < order.frameOrder.length) {
    return { why: `only ${framesHeld} of ${order.frameOrder.length} frames here yet — too early to judge` };
  }

  // A COPY. Working the answer out prunes the sheet to what is on screen, which
  // is right for the answer and quite wrong to keep.
  const root = deserializeBracket(order.bracketTree);
  syncBracketWithVisibleFrames(root, visibleIds);

  const was = boxOfEachFrame(root);
  if (!rematchToNeeds(root)) return { why: 'the boxes match the needs — nothing to do' };
  const now = boxOfEachFrame(root);

  // A frame that changed box is a frame whose needs changed. Nothing else moves.
  const moved = new Set<number>();
  for (const fid of new Set([...was.keys(), ...now.keys()])) {
    if (was.get(fid) !== now.get(fid)) moved.add(fid);
  }
  if (moved.size === 0) return { why: 'answers moved inside their boxes — no frame changed box' };

  // ONLY FRAMES THE SHEET CAN ACTUALLY PLACE.
  //
  // flattenBracketOrder does NOT return everybody: when a box has nothing below
  // it, the frames it did not match are left out entirely. So a frame can be
  // "no longer in a box" and also have no place in the fresh list — and moving
  // a frame the sheet cannot place means taking it out of the order with
  // nowhere to put it back. Roman's log: 27 frames moved, 5 left on screen.
  // Completed first — see fillTheGaps. Anchoring against a list with holes in
  // it puts frames in the wrong place.
  const fresh = fillTheGaps(flattenBracketOrder(root), order.frameOrder);
  // Belt and braces: the rebuild is checked for repeats below, and refused.
  const canBePlaced = new Set(fresh);
  let cannotPlace = 0;
  for (const fid of [...moved]) if (!canBePlaced.has(fid)) { cannotPlace++; moved.delete(fid); }
  if (moved.size === 0) {
    return { why: `${cannotPlace} frame(s) changed box but the sheet cannot place them — left alone` };
  }

  const { list: frameOrder, outOfStep } = placeChangedFrames(order.frameOrder, fresh, moved, now);

  // Never fewer than we started with. If this ever trips, the order is left
  // untouched rather than shortened.
  if (frameOrder.length < order.frameOrder.length) {
    return { why: `re-sort would have lost ${order.frameOrder.length - frameOrder.length} frame(s) — left alone` };
  }
  // NEVER LONGER, AND NEVER THE SAME SHOT TWICE. Between them these two say the
  // rebuild is a rearrangement of the list it was given, and nothing else.
  if (frameOrder.length > order.frameOrder.length || new Set(frameOrder).size !== frameOrder.length) {
    return { why: `re-sort would have repeated a shot (${order.frameOrder.length} → ${frameOrder.length}) — left alone` };
  }
  // The order does not always move when the boxes do — a frame can change day
  // and still sit in the same place. The SHEET has still learned something, and
  // it has to be written down: without this it repeated "4 frame(s) changed
  // box, order comes out the same" on every open for ever, and the next real
  // change was buried in with those four. Seen live on try411.
  const same = frameOrder.length === order.frameOrder.length
    && frameOrder.every((id, i) => id === order.frameOrder[i]);
  if (same) {
    return {
      why: `${moved.size} frame(s) changed box, order comes out the same`,
      sheet: serializeBracket(root),
      // STILL GREEN (#418). Green means "its needs changed", not "it moved" —
      // a shot can change day and stay exactly where it was, and that is
      // precisely when the user has no other way of noticing. Roman doubted
      // this worked; it did not. The set was simply not passed back.
      moved,
    };
  }

  return {
    frameOrder, fresh, moved: outOfStep, sheet: serializeBracket(root),
    breaks: breaksAfterResort(order.breaks ?? [], order.frameOrder, frameOrder, moved),
  };
}

/**
 * THE SHEET HAS TO LEARN WHAT IT NOW HOLDS (#411).
 *
 * Written back whole, and here is why it must be whole.
 *
 * The first try copied only the MATCHES into the sheet as it was saved, leaving
 * each box's incoming frames untouched — the idea being to change as little as
 * possible. That leaves a sheet contradicting itself: a box holding frames that
 * never entered it. The screen then draws the same shot in several boxes at
 * once. Roman: "chaos, the frames are duplicated or even tripled, even the
 * boxes." Nothing was wrong with his project — 13 frames, all present — the
 * sheet describing it was impossible.
 *
 * The worked-out copy is consistent by construction: every box's matches come
 * out of its own incoming frames, and what it does not take drops to the box
 * below. So that is what gets saved.
 *
 * The reason not to save it used to be that working it out prunes the sheet to
 * whatever is on screen, which once cost an order 27 shots. That is now caught
 * earlier: decideResort refuses to run at all while this device is holding
 * fewer frames than the order lists.
 */


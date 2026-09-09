// A SHOOTING ORDER TRAVELS BY THE SHOTS' PERMANENT NAMES, NEVER BY NUMBERS (#489).
//
// WHAT WENT WRONG, in Roman's own logs of 9 September. The same fourteen shots:
//
//     Desktop   17, 18, 19 … 30
//     iPad       3,  1,  2,  4 …
//     iPhone     1,  2,  3,  4 …
//
// A shooting order made on the Desktop says "shots 17 to 30". The iPad has 1 to
// 14. Nothing matched, and the order showed NOTHING: "showing 0 of 14".
//
// WHY THE NUMBERS DIFFER. They are older than the server. Before there was a
// cloud they were the app's only way to point at a shot, and every button, every
// open editor and every per-frame map is still written in them. A shot the
// device already holds keeps its number (#406); a shot it has never seen gets
// the highest number in the storyboard PLUS ONE — and that is whatever the
// device happened to be holding at that moment. Two devices agree only by luck.
//
// Before #406 the app renumbered everything from 1 on every sync, so they agreed
// by accident. #406 stopped the renumbering — rightly, it was making renames
// land on the wrong shot — and the accident stopped with it.
//
// SO THE RULE IS SIMPLE: the numbers are PRIVATE and never leave the device.
// Only permanent names travel. This is the one place that translates, both ways.
//
// TWO THINGS ROMAN ASKED FOR BY NAME, and they are the whole reason this is a
// plain function with a bench behind it rather than a few lines inside the sync:
//
//   "careful with dropping shots!"  — a shot whose name this device does not
//   know is NOT quietly skipped. It is reported, by name, so the caller can say
//   so in the log instead of the order silently coming up short.
//
//   "keep in mind the BREAKS!"      — a break is an INDEX into the order, not a
//   shot. Drop a shot and every break after it must step back one, or the lunch
//   break ends up behind the wrong shot. Same rule as #451 on the other side.

/** A break. It is an INDEX into the order, not a shot. */
export interface OrderBreak { id: string; text: string; position: number }

/**
 * What a shooting order carries.
 *
 * EVERYTHING ELSE ON IT TRAVELS UNTOUCHED (#382). The order also carries its
 * name, its description, which group it belongs to and its bracket tree — and
 * `projectSettings.ts` sends the WHOLE object. #382 exists because a rebuilt
 * object dropped the group, and the order arrived belonging to nothing.
 *
 * So these are open shapes, and the translation COPIES the order and changes
 * only the parts that are written in numbers. Anything this file has never
 * heard of goes through unharmed, which is the only safe way to treat a shape
 * that has grown four times already.
 */
export interface OrderShape {
  frameOrder: number[];
  breaks?: OrderBreak[];
  sortedSnapshot?: number[];
  bracketTree?: unknown;
  [anythingElse: string]: unknown;
}

/** The same, as it travels: permanent names instead of numbers. */
export interface TravellingOrder {
  frameOrder: string[];
  breaks?: OrderBreak[];
  sortedSnapshot?: string[];
  bracketTree?: unknown;
  [anythingElse: string]: unknown;
}

/**
 * The bracket tree points at shots too, in `inputIds` and `matchedIds`, and it
 * nests to the right and downwards. Same translation, applied all the way down.
 *
 * A branch left holding nothing is dropped, exactly as `remapBracketIds` in the
 * sync has always done — an empty branch is not a branch.
 */
function treeTranslated<A, B>(
  node: unknown,
  translate: (id: A) => B | undefined,
): unknown | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = node as Record<string, unknown>;
  const inputIds = ((n.inputIds as A[]) ?? []).map(translate).filter((v) => v != null);
  const matchedIds = ((n.matchedIds as A[]) ?? []).map(translate).filter((v) => v != null);
  if (inputIds.length === 0 && matchedIds.length === 0) return undefined;
  const out: Record<string, unknown> = { ...n, inputIds, matchedIds };
  const right = n.right ? treeTranslated(n.right, translate) : undefined;
  const down = n.down ? treeTranslated(n.down, translate) : undefined;
  if (right) out.right = right; else delete out.right;
  if (down) out.down = down; else delete out.down;
  return out;
}

/** Everything the caller needs to say what happened, including what was lost. */
export interface Translated<T> {
  order: T;
  /** Shots that had no name / no number here. NEVER silently discarded — the
   *  caller logs these. Empty is the normal case. */
  lost: (string | number)[];
}

/**
 * Move every break that sits after a dropped position one step earlier.
 *
 * `at` is the index the shot occupied. A break exactly AT that index stays
 * where it is — it belongs to the shot above, which has not moved. Only breaks
 * BELOW it shift. That is #451's rule, and it is the same rule read the other
 * way round.
 */
function breaksAfterDrop(
  breaks: readonly OrderBreak[],
  at: number,
): OrderBreak[] {
  return breaks.map((b) => (b.position > at ? { ...b, position: b.position - 1 } : { ...b }));
}

/**
 * ON THE WAY OUT — this device's numbers become permanent names.
 *
 * A shot with no permanent name has never reached the server, so no other
 * device can be told about it. It comes out in `lost` and its breaks shift.
 */
export function orderForSending(
  order: OrderShape,
  nameOf: (localNumber: number) => string | undefined,
): Translated<TravellingOrder> {
  const frameOrder: string[] = [];
  const lost: (string | number)[] = [];
  let breaks = [...(order.breaks ?? [])];
  order.frameOrder.forEach((n) => {
    const name = nameOf(n);
    if (name === undefined) {
      lost.push(n);
      breaks = breaksAfterDrop(breaks, frameOrder.length);
      return;
    }
    frameOrder.push(name);
  });
  // A COPY OF THE WHOLE ORDER, with only the numbered parts changed (#382).
  // The spread carries the numbered fields over too; every one of them is
  // replaced below, so the cast is the shape catching up, not a shortcut.
  const out = { ...order, frameOrder, breaks } as unknown as TravellingOrder;
  if (order.sortedSnapshot) {
    out.sortedSnapshot = order.sortedSnapshot
      .map(nameOf).filter((s): s is string => s !== undefined);
  }
  if (order.bracketTree) {
    const tree = treeTranslated<number, string>(order.bracketTree, nameOf);
    if (tree) out.bracketTree = tree; else delete out.bracketTree;
  }
  return { order: out, lost };
}

/**
 * ON THE WAY IN — permanent names become THIS device's numbers.
 *
 * A name this device does not hold is a shot it has not got. Reported, never
 * mistaken for another shot — which is exactly what used to happen when the
 * numbers travelled raw: 17 arrived and this device read it as its own 17.
 */
export function orderAsArrived(
  order: TravellingOrder,
  numberOf: (name: string) => number | undefined,
): Translated<OrderShape> {
  const frameOrder: number[] = [];
  const lost: (string | number)[] = [];
  let breaks = [...(order.breaks ?? [])];
  order.frameOrder.forEach((name) => {
    const n = numberOf(name);
    if (n === undefined) {
      lost.push(name);
      breaks = breaksAfterDrop(breaks, frameOrder.length);
      return;
    }
    frameOrder.push(n);
  });
  // A COPY OF THE WHOLE ORDER, with only the named parts changed (#382).
  // As above: the spread carries the named fields over, and each is replaced.
  const out = { ...order, frameOrder, breaks } as unknown as OrderShape;
  if (order.sortedSnapshot) {
    out.sortedSnapshot = order.sortedSnapshot
      .map(numberOf).filter((n): n is number => n !== undefined);
  }
  if (order.bracketTree) {
    const tree = treeTranslated<string, number>(order.bracketTree, numberOf);
    if (tree) out.bracketTree = tree; else delete out.bracketTree;
  }
  return { order: out, lost };
}

// ---------------------------------------------------------------------------
// A GROUP HOLDS SHOTS BY NUMBER TOO — AND IT HAD THE SAME FAULT (#489).
//
// Found by grepping for every OTHER place, after the shooting order:
// `projectSettings.ts:112` sends the whole group raw, `frameIds` and
// `hiddenFrameIds` in this device's private numbers. The metadata blob
// translates them properly (accountFlow.ts:2201 out, :3118 in) — but the
// per-item copy is applied AFTER the blob, so the raw copy wins. Exactly the
// shooting order's fault, in the line below it.
//
// What it looks like: a group made on the Desktop holding shots 17–30 arrives
// on the iPad, which holds 1–14. Nothing matches and the group is EMPTY. If the
// numbers happen to overlap it is worse — the group holds the WRONG shots.
// ---------------------------------------------------------------------------

/** What a group carries. Open, for the same reason the order's shape is open. */
export interface GroupShape {
  frameIds: number[];
  hiddenFrameIds?: number[];
  [anythingElse: string]: unknown;
}

/** The same, as it travels. */
export interface TravellingGroup {
  frameIds: string[];
  hiddenFrameIds?: string[];
  [anythingElse: string]: unknown;
}

/** ON THE WAY OUT — this device's numbers become permanent names. */
export function groupForSending(
  group: GroupShape,
  nameOf: (localNumber: number) => string | undefined,
): Translated<TravellingGroup> {
  const lost: (string | number)[] = [];
  const translate = (ids: readonly number[]) => {
    const out: string[] = [];
    for (const n of ids) {
      const name = nameOf(n);
      if (name === undefined) { lost.push(n); continue; }
      out.push(name);
    }
    return out;
  };
  const out = { ...group, frameIds: translate(group.frameIds) } as unknown as TravellingGroup;
  if (group.hiddenFrameIds) out.hiddenFrameIds = translate(group.hiddenFrameIds);
  return { order: out, lost };
}

/** ON THE WAY IN — permanent names become THIS device's numbers. */
export function groupAsArrived(
  group: TravellingGroup,
  numberOf: (name: string) => number | undefined,
): Translated<GroupShape> {
  const lost: (string | number)[] = [];
  const translate = (names: readonly string[]) => {
    const out: number[] = [];
    for (const name of names) {
      const n = numberOf(name);
      if (n === undefined) { lost.push(name); continue; }
      out.push(n);
    }
    return out;
  };
  const out = { ...group, frameIds: translate(group.frameIds) } as unknown as GroupShape;
  if (group.hiddenFrameIds) out.hiddenFrameIds = translate(group.hiddenFrameIds);
  return { order: out, lost };
}

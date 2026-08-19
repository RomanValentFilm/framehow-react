// THE RULES, CHECKED AFTER EVERY SINGLE STEP (#344).
//
// The thirteen scripted tests each do five or six things and then look. If step
// two broke something and step four healed it, nobody notices — and if
// something is wrong the whole time in a way the ending happens to hide, nobody
// notices that either.
//
// #337 was exactly that. Every test asked "do the two devices agree?" and in a
// loop they DO agree; they simply never stop talking. The app churned every
// three seconds, redrawing the screen each time, and thirteen tests said green.
//
// So the rules live here, on their own, and are checked after every step of
// every story — scripted or random.

import { expect } from '@playwright/test';
import { Device, say } from './harness';

export interface Snapshot {
  frames: number;
  labels: string[];
  pictures: number;
  orders: string[];
  setups: string[];
  categories: string[];
}

export async function snapshot(d: Device): Promise<Snapshot> {
  const s = await d.read();
  return {
    frames: s.frames.length,
    labels: s.frames.map((f) => f.label),
    // Frames holding something a person made: writing counts, and so does a
    // picture once the door can see one.
    pictures: s.frames.filter((f) => f.text && f.text.length > 0).length,
    orders: s.orders.map((o) => o.name).sort(),
    setups: [...s.setups].sort(),
    categories: [...s.categories],
  };
}

/**
 * NOTHING MAY HAPPEN WHEN NOTHING IS HAPPENING.
 *
 * The one rule that would have caught the loop on its first run. After the app
 * has settled, watch it: any push or pull with nobody touching anything means
 * it is talking to itself.
 *
 * Allowed: the heartbeat, which is how a device hears about the other one, and
 * a single late arrival that was already in flight when we started watching.
 */
export async function mustGoQuiet(devices: Device[], seconds = 12): Promise<void> {
  say(`watching ${devices.map((d) => d.name).join(' and ')} for ${seconds}s of quiet…`);
  const noisy = (l: string) =>
    l.includes('push start') || l.includes('pull: remote is newer');
  const before = await Promise.all(devices.map(async (d) => (await d.log()).filter(noisy).length));

  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    for (const d of devices) await d.nudge();      // as a person on the sofa does
    await devices[0].page.waitForTimeout(500);
  }

  for (let i = 0; i < devices.length; i++) {
    const after = (await devices[i].log()).filter(noisy).length;
    const extra = after - before[i];
    // One is an arrival already on its way. Two or more in twelve idle seconds
    // is a conversation with itself.
    expect(extra, `${devices[i].name} would not settle: ${extra} pushes/pulls in `
      + `${seconds} seconds with nobody touching anything. That is the shape of a `
      + `loop — it pushes, the project's time moves, the heartbeat sees something `
      + `newer, it pulls, and round again.`).toBeLessThan(2);
  }
  say(`  quiet held`);
}

/** Both devices must show the same storyboard, and nothing may have vanished. */
export async function mustAgree(a: Device, b: Device, floor: number): Promise<void> {
  const agreed = await Device.waitUntilTheyAgree(a, b);
  void agreed;
  const [x, y] = [await snapshot(a), await snapshot(b)];
  expect(x.frames, `${a.name} lost frames: ${x.frames} of at least ${floor}`)
    .toBeGreaterThanOrEqual(floor);
  expect(y.frames, `${b.name} lost frames`).toBe(x.frames);
  expect(y.orders, 'the shooting orders differ').toEqual(x.orders);
  expect(y.setups, 'the setups differ').toEqual(x.setups);
  expect(y.categories, 'the needs categories differ').toEqual(x.categories);
}

/** Nothing anyone made may go missing, on either device. */
export function mustNotShrink(was: Snapshot, now: Snapshot, what: string): void {
  expect(now.frames, `${what}: frames went from ${was.frames} to ${now.frames}`)
    .toBeGreaterThanOrEqual(was.frames);
  expect(now.pictures, `${what}: written frames went from ${was.pictures} to ${now.pictures}`)
    .toBeGreaterThanOrEqual(was.pictures);
  for (const o of was.orders) {
    expect(now.orders, `${what}: shooting order "${o}" disappeared`).toContain(o);
  }
  for (const su of was.setups) {
    expect(now.setups, `${what}: setup "${su}" disappeared`).toContain(su);
  }
}

/** Things that must never appear in the log, whatever happened. */
export async function mustNotHaveSaid(d: Device): Promise<void> {
  for (const bad of ['PULL FAILED', 'FULL REPLACE', 'decision(s) waiting']) {
    const hit = (await d.log()).find((l) => l.includes(bad));
    expect(hit, `${d.name} said "${bad}": ${hit}`).toBeUndefined();
  }
}


// ---------------------------------------------------------------------------
// THE LEDGER (#345)
// ---------------------------------------------------------------------------
//
// Roman's question: how do you know what the outcome SHOULD be, when the day
// was random? You do not predict the whole state. You write down every change
// as it is made, and at the end you insist that every one of them is there — on
// BOTH devices — now that everybody is online again.
//
// The one exception is his own rule: if two devices changed the SAME thing while
// apart, only the later survives. So the ledger keeps, per thing, the LAST
// change made to it. That one has no excuse for being missing.
//
// This is what turns "the two devices agree" into "they agree on the right
// thing". Two devices agreeing on an empty project pass the first and fail this.

export interface Change {
  /** What was touched — one entry per thing, the last change winning. */
  what: string;
  /** How it should be recognisable afterwards. */
  looksLike: string;
  /** Where to look for it. */
  kind: 'frameText' | 'order' | 'setup' | 'category';
  by: string;
  at: number;
}

export class Ledger {
  private readonly last = new Map<string, Change>();
  /** Things deliberately destroyed. They must NOT come back. */
  private readonly gone = new Set<string>();

  note(c: Omit<Change, 'at'>): void {
    this.last.set(c.what, { ...c, at: Date.now() });
    this.gone.delete(c.what);
  }

  destroyed(what: string): void {
    this.last.delete(what);
    this.gone.add(what);
  }

  /** Everything written down must be on this device. */
  async mustAllBeOn(d: Device): Promise<void> {
    const s = await d.read();
    const texts = s.frames.map((f) => f.text);
    const orders = s.orders.map((o) => o.name);
    const setups = s.setups;
    const cats = s.categories;

    const missing: string[] = [];
    for (const c of this.last.values()) {
      const there =
        c.kind === 'frameText' ? texts.includes(c.looksLike)
        : c.kind === 'order' ? orders.includes(c.looksLike)
        : c.kind === 'setup' ? setups.includes(c.looksLike)
        : cats.includes(c.looksLike);
      if (!there) missing.push(`${c.kind} "${c.looksLike}" (made on the ${c.by})`);
    }
    expect(missing, `${d.name} is missing work that was made and never undone:\n`
      + missing.map((m) => '    ' + m).join('\n')
      + `\n  It has: ${texts.filter(Boolean).join(' | ') || '(no writing)'}`
      + `\n  orders: ${orders.join(', ') || '(none)'}`
      + `\n  setups: ${setups.join(', ') || '(none)'}`).toEqual([]);

    for (const g of this.gone) {
      expect(texts.includes(g), `${d.name}: "${g}" was deleted and came back`).toBe(false);
    }
  }

  get size(): number { return this.last.size; }
}

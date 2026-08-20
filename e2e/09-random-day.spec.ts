// A RANDOM DAY (#344).
//
// Every other test is a story I thought of. That is the weakness Roman named:
// a scripted test only ever finds what somebody already imagined, and it proves
// the rule I believed rather than the rule that matters. #337 passed thirteen
// scripted tests while making his iPad churn every three seconds, because every
// one of them asked "do the two devices agree?" — and in a loop they do.
//
// So this one does not follow a script. It picks plausible things a person on a
// shoot would do, at random, on either device: write on a frame, rearrange,
// delete, make a shooting order, add a break, make a setup, rename a category,
// go offline, come back. After EVERY step it checks the rules in rules.ts —
// nothing vanished, both devices agree, and above all the app goes quiet when
// nobody is touching it.
//
// It prints the seed. A failure can be replayed exactly:
//
//     FH_SEED=1234567 npm run t -- -g "random day"
//
// Longer is better. FH_STEPS=60 for a proper grind.

import { test } from '@playwright/test';
import { Device, freshAccount, say } from './harness';
import { snapshot, mustAgree, mustNotShrink, mustNotHaveSaid, mustGoQuiet, Ledger } from './rules';

/** A repeatable random number, so a failure can be run again exactly. */
function makeDice(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const SEED = Number(process.env.FH_SEED ?? Date.now() % 1_000_000);
const STEPS = Number(process.env.FH_STEPS ?? 24);

// The title must NOT contain the seed: playwright works out which test to run in
// one process and runs it in another, and a title built from the clock differs
// between the two — "Test not found in the worker process". The seed is printed
// inside instead.
test('a random day', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);

  const dice = makeDice(SEED);
  const pick = <T>(xs: T[]): T => xs[Math.floor(dice() * xs.length)];
  const { token } = await freshAccount();
  const desktop = await Device.open(browser, 'desktop', token);
  const tablet = await Device.open(browser, 'tablet', token, true);

  say(`SEED ${SEED} — to run this exact day again: FH_SEED=${SEED} npm run t -- -g "random day"`);

  const madeId = await desktop.newProject('Random day', 6);
  await tablet.openProject(madeId!);
  await Device.waitUntilTheyAgree(desktop, tablet);
  await desktop.settle();
  await tablet.settle();

  // Every change made, so the end can insist on finding all of it (#345).
  const ledger = new Ledger();
  const away = { desktop: false, tablet: false };
  let orders = 0, setups = 0, written = 0;
  /** Frames deliberately deleted — the floor drops with them. */
  let floor = 6;

  for (let step = 1; step <= STEPS; step++) {
    const who = pick([desktop, tablet]);
    const other = who === desktop ? tablet : desktop;
    const name = who.name as 'desktop' | 'tablet';
    const before = await snapshot(who);

    const doable = ['write', 'write', 'move', 'order', 'break', 'setup', 'category', 'travel'];
    // Deleting is rarer than the rest, as it is in life, and never below three.
    if (before.frames > 3 && dice() < 0.12) doable.push('delete');
    const action = pick(doable);

    say(`step ${step}/${STEPS}: ${name} — ${action}${away[name] ? ' (away)' : ''}`);

    switch (action) {
      case 'write': {
        const i = Math.floor(dice() * before.frames);
        const text = `${name} step ${step}`;
        await who.writeUnder(i, text);
        // Named by the FRAME, so two devices writing on the same one keep only
        // the later — which is the agreed rule, not a fault.
        const s0 = await who.read();
        ledger.note({ what: `frame:${s0.frames[i]?.serverFrameId ?? i}`,
                      looksLike: text, kind: 'frameText', by: name });
        written++;
        break;
      }
      case 'move': {
        if (before.frames < 2) break;
        const from = Math.floor(dice() * before.frames);
        let to = Math.floor(dice() * before.frames);
        if (to === from) to = (to + 1) % before.frames;
        await who.moveFrame(from, to);
        break;
      }
      case 'order': {
        const nm = `ORDER ${++orders} ${name}`;
        const id = await who.newSortOrder(nm);
        ledger.note({ what: `order:${id}`, looksLike: nm, kind: 'order', by: name });
        break;
      }
      case 'break': {
        const s = await who.read();
        if (s.orders.length === 0) { await who.newSortOrder(`ORDER ${++orders} ${name}`); }
        await who.addBreak(0, Math.min(2, before.frames), `BREAK ${step}`);
        break;
      }
      case 'setup': {
        const nm = `S${++setups}`;
        const id = await who.newSetup(nm);
        ledger.note({ what: `setup:${id}`, looksLike: nm, kind: 'setup', by: name });
        break;
      }
      case 'category': {
        const s = await who.read();
        if (s.categories.length > 0) {
          const nm = `CAT ${step} ${name}`;
          await who.renameCategory(0, nm);
          // One name per category: renaming it twice keeps the later, as agreed.
          ledger.note({ what: 'category:0', looksLike: nm, kind: 'category', by: name });
        }
        break;
      }
      case 'delete': {
        const i = Math.floor(dice() * before.frames);
        const s0 = await who.read();
        const doomed = s0.frames[i];
        await who.deleteFrame(i);
        ledger.destroyed(`frame:${doomed?.serverFrameId ?? i}`);
        if (doomed?.text) ledger.destroyed(doomed.text);
        floor--;
        break;
      }
      case 'travel': {
        // Going away and coming back is the thing that breaks syncing, so it
        // happens as often as everything else put together might.
        if (away[name]) {
          const mark = await who.mark();
          await who.offline(false);
          await who.waitForLogAfter(mark, 'back online', 20_000).catch(() => {});
          away[name] = false;
        } else {
          await who.offline(true);
          await who.page.waitForTimeout(4000);      // long enough to be noticed
          away[name] = true;
        }
        break;
      }
    }

    await who.settle().catch(() => {});
    // Nothing this device made may have gone missing on this device.
    //
    // THE ARITHMETIC USED TO BE WRONG, and it hid behind the dice: it compared
    // the count before the step with the count after, so any step that deleted
    // a frame failed itself. Deleting only happens about one step in eight, so
    // the test looked fine for days.
    //
    // The honest rule: the count may never fall below the number of frames the
    // day is entitled to — six, less every frame somebody deliberately deleted.
    // And when a frame goes, whatever was written under it goes with it, so the
    // writing count is not held to anything in that one step.
    const now = await snapshot(who);
    const aFrameWent = now.frames < before.frames;
    mustNotShrink(
      { ...before, frames: floor, pictures: aFrameWent ? 0 : before.pictures },
      now,
      `${name} after ${action}`);
    await mustNotHaveSaid(who);
    await mustNotHaveSaid(other);
  }

  // Everyone comes back at the end of the day.
  for (const d of [desktop, tablet]) {
    if (away[d.name as 'desktop' | 'tablet']) {
      const mark = await d.mark();
      await d.offline(false);
      await d.waitForLogAfter(mark, 'back online', 20_000).catch(() => {});
    }
  }

  await mustAgree(desktop, tablet, Math.max(1, floor));

  // AND THE REAL QUESTION: is everything that was made still here, on BOTH?
  // Everyone is online, so there is no excuse left (#345).
  say(`checking all ${ledger.size} remembered change(s) survived, on both devices`);
  await ledger.mustAllBeOn(desktop);
  await ledger.mustAllBeOn(tablet);
  await mustNotHaveSaid(desktop);
  await mustNotHaveSaid(tablet);

  // And then the app must SHUT UP. This is the rule the loop broke.
  await mustGoQuiet([desktop, tablet]);

  await desktop.close();
  await tablet.close();
});

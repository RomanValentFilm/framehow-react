// THE BOXES, PRESSED THE WAY A PERSON PRESSES THEM — shared by Roman's own
// test (27) and BIG DAY part 6 (#513). Lifted out of 27 unchanged, so both
// press exactly the same buttons: the real needs card, the real bracket,
// the real SORT NOW, the real arrows and DONE.

import type { Page } from '@playwright/test';

export const DAY = ['ti_day1', 'ti_day2', 'ti_day3'];
export const UNIT = ['ti_unit1', 'ti_unit2'];
export const LOC = ['ti_loc1', 'ti_loc2'];
export const DIR = ['ti_dir_a', 'ti_dir_reverse'];
export const EVERY = [...DAY, ...UNIT, ...LOC, ...DIR];

export async function setNeeds(page: Page, frameIndex: number, want: string[]): Promise<void> {
  await page.evaluate(async ([i, wanted, every]) => {
    const t = (window as never as { __fh_test: { openNeedsCard(i: number): void } }).__fh_test;
    const shut = () => document.querySelector('.g3-needs-overlay')?.remove();
    shut();
    await new Promise((r) => setTimeout(r, 120));
    t.openNeedsCard(i as number);
    await new Promise((r) => setTimeout(r, 350));
    const fid = (document.querySelector('[data-needs-toggle]') as HTMLElement | null)?.dataset.needsFid;
    for (const id of every as string[]) {
      const el = document.querySelector(
        `[data-needs-toggle="${id}"][data-needs-fid="${fid}"]`) as HTMLElement | null;
      if (!el) continue;
      const on = el.className.includes('needs-dot-on');
      const shouldBeOn = (wanted as string[]).includes(id);
      if (shouldBeOn !== on) { el.click(); await new Promise((r) => setTimeout(r, 90)); }
    }
    shut();
  }, [frameIndex, want, EVERY] as [number, string[], string[]]);
  await page.waitForTimeout(320);
}

/**
 * Build the sheet as deep as it will go, on EVERY branch, then KEEP ORDER for
 * whatever is left — Roman: "we want all 4 stages of the bracket in each branch
 * always till the end on the right side... then the 40% of the REMAINING >
 * KEEP ORDER."
 *
 * It works the way a person does: take the first box with nothing in it yet,
 * open it, and pick the first thing offered from SHOOT DAY, then LOCATION, then
 * UNIT, then DIRECTION. A box that can be refined no further is left alone, and
 * at the end every box still empty is given KEEP ORDER.
 */
export async function buildFullSheet(page: Page): Promise<void> {
  await page.evaluate(async (order) => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const edit = Array.from(document.querySelectorAll('button'))
      .find((b) => /EDIT ORDER/.test(b.textContent || '')) as HTMLElement | undefined;
    edit?.click();
    await wait(600);

    // Up to a few dozen picks; the sheet is finite and this stops either way.
    for (let guard = 0; guard < 60; guard++) {
      const pending = Array.from(document.querySelectorAll('[data-bact="expand"]')) as HTMLElement[];
      if (pending.length === 0) break;
      let picked = false;
      for (const box of pending) {
        box.click();
        await wait(320);
        let chose: HTMLElement | null = null;
        for (const id of order as string[]) {
          chose = document.querySelector(`[data-bact="pick"][data-bid="${id}"]`) as HTMLElement | null;
          if (chose) break;
        }
        if (chose) { chose.click(); await wait(420); picked = true; break; }
        // Nothing left to refine here — shut it again and try the next one.
        (document.querySelector('[data-bact="collapse"]') as HTMLElement | null)?.click();
        await wait(200);
      }
      if (!picked) break;
    }

    // Everything still open takes KEEP ORDER.
    for (let guard = 0; guard < 30; guard++) {
      const box = document.querySelector('[data-bact="expand"]') as HTMLElement | null;
      if (!box) break;
      box.click();
      await wait(300);
      const keep = document.querySelector('[data-bact="keepasis"]') as HTMLElement | null;
      if (!keep) { (document.querySelector('[data-bact="collapse"]') as HTMLElement | null)?.click(); break; }
      keep.click();
      await wait(380);
    }
  }, [...DAY, ...LOC, ...UNIT, ...DIR]);
  await page.waitForTimeout(600);
}

/** Press SORT NOW and clear anything it asks. */
export async function sortNow(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const btn = Array.from(document.querySelectorAll('button,span'))
      .find((b) => /SORT NOW/.test(b.textContent || '')) as HTMLElement | undefined;
    btn?.click();
    await new Promise((r) => setTimeout(r, 700));
    const yes = Array.from(document.querySelectorAll('button'))
      .find((b) => (b as HTMLElement).offsetParent !== null
        && /^(Yes|OK)$/i.test((b.textContent || '').trim())) as HTMLElement | undefined;
    yes?.click();
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.waitForTimeout(700);
}

/** What the order is showing: the cards, the icons, and who is marked. */
export async function look(page: Page): Promise<{
  order: string[]; stored: string[]; pills: string[];
  greenCards: string[]; greenIcons: string[]; redIcons: string[];
}> {
  return page.evaluate(() => {
    const txt = (e: Element | null) => (e?.textContent || '').trim();
    // A CARD'S NAME IS IN TWO PIECES (run 128). `sort-card-num` holds "6" and
    // `sort-card-extra` holds "#1" — so reading only the first makes the new
    // shot 6#1 look like a second shot 6, and the test spent two runs reporting
    // a duplicate that was never there.
    const cardName = (c: Element) =>
      txt(c.querySelector('.sort-card-num')) + txt(c.querySelector('.sort-card-extra'));
    // WHAT THE LIST SAYS, NOT ONLY WHAT THE SCREEN DRAWS (run 127).
    // The order showed two cards reading "6". That is either a list holding a
    // shot twice or a screen drawing one shot twice, and they are different
    // faults with different fixes. So the test reads both.
    const t = (window as never as {
      __fh_test: { read(): {
        frames: { id: string; label: string }[];
        orders: { id: string; frames: string[] }[] } } }).__fh_test;
    // read() already hands back the LABELS a person sees, not the ids.
    const stored = t.read().orders[0]?.frames ?? [];
    return {
      stored,
      order: Array.from(document.querySelectorAll('.sort-card')).map(cardName),
      pills: Array.from(document.querySelectorAll('.sort-bracket-pill[data-fid]')).map((p) => txt(p)),
      greenCards: Array.from(document.querySelectorAll('.sort-card-resorted')).map(cardName),
      greenIcons: Array.from(document.querySelectorAll('.sort-bracket-pill-new')).map((p) => txt(p)),
      redIcons: Array.from(document.querySelectorAll('.sort-bracket-pill-moved')).map((p) => txt(p)),
    };
  });
}

/**
 * Move a shot with the REAL arrows until it sits at `to` (1-based).
 *
 * IT SAYS WHETHER IT ACTUALLY MOVED. Run 123 reported "no red icon" after a
 * move, and there was no way to tell from that whether the app had failed to
 * mark the shot or the test had failed to move it. A helper that quietly does
 * nothing is worse than no helper — every failure after it is a lie.
 */
export async function moveTo(page: Page, label: string, to: number): Promise<void> {
  const before = (await look(page)).order;
  const at = before.indexOf(label);
  if (at < 0) throw new Error(`no card ${label} in the order`);
  const steps = (to - 1) - at;
  if (steps === 0) return;
  await page.evaluate(async ([want, n]) => {
    const name = (c: Element) =>
      ((c.querySelector('.sort-card-num')?.textContent || '')
        + (c.querySelector('.sort-card-extra')?.textContent || '')).trim();
    const card = Array.from(document.querySelectorAll('.sort-card')).find((c) => name(c) === want);
    if (!card) throw new Error(`no card ${want}`);
    // A CARD IS WOKEN BY ITS OWN BUTTON, not by clicking the card (run 125).
    // The arrows only exist once it is active, so clicking the card did nothing
    // at all and the shot never moved — while the test blamed the app.
    const fid = (card as HTMLElement).dataset.sortFid!;
    (card.querySelector(`[data-sort-activate="${fid}"]`) as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 350));
    const dir = (n as number) < 0 ? 'up' : 'down';
    for (let i = 0; i < Math.abs(n as number); i++) {
      const arrow = document.querySelector(
        `.sort-card-active [data-sort-move="${dir}"]`) as HTMLElement | null;
      if (!arrow) break;
      arrow.click();
      await new Promise((r) => setTimeout(r, 200));
    }
    // DONE is also what puts a card back to sleep — the same button. That is
    // the real path a person takes after nudging a shot.
    (document.querySelector('.sort-card-active [data-sort-deactivate]') as HTMLElement | null)?.click();
  }, [label, steps] as [string, number]);
  await page.waitForTimeout(450);
  const after = (await look(page)).order;
  if (after.indexOf(label) === at) {
    throw new Error(`THE TEST COULD NOT MOVE ${label}: it is still at place ${at + 1}.`
      + ` This is the test's arrows failing, not the app's marking.`
      + `\n  before: ${before.join(' ')}\n  after:  ${after.join(' ')}`);
  }
}

/** Press DONE on one card. */
export async function approve(page: Page, label: string): Promise<void> {
  await page.evaluate(async (want) => {
    const name = (c: Element) =>
      ((c.querySelector('.sort-card-num')?.textContent || '')
        + (c.querySelector('.sort-card-extra')?.textContent || '')).trim();
    const card = Array.from(document.querySelectorAll('.sort-card')).find((c) => name(c) === want);
    (card?.querySelector('.sort-done-btn') as HTMLElement | null)?.click();
    await new Promise((r) => setTimeout(r, 250));
  }, label);
  await page.waitForTimeout(350);
}

/** Which shot the break is sitting behind right now. */
export async function shotAboveBreak(page: Page): Promise<string> {
  return page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.sort-card, .sort-break-card'));
    const at = items.findIndex((i) => i.classList.contains('sort-break-card'));
    if (at < 0) return '';
    const above = items.slice(0, at).filter((i) => i.classList.contains('sort-card')).pop();
    if (!above) return '';
    return ((above.querySelector('.sort-card-num')?.textContent || '')
      + (above.querySelector('.sort-card-extra')?.textContent || '')).trim();
  });
}

/**
 * WAIT FOR THE APP TO GO QUIET.
 *
 * NOT settle(), and not waitForLog either. settle waits for a "saving:" line,
 * and setting needs on twelve shots is nearly fifty pushes — four hundred lines
 * — in a couple of seconds. That storm pushes the "saving:" line out of the
 * log's buffer, and nothing new needs saving afterwards, so the wait can never
 * end however long it is given. Run 122 sat there for ninety seconds.
 *
 * Everything here is local: a push is fifteen milliseconds. Three and a half
 * seconds of quiet is plenty, and it cannot hang.
 */

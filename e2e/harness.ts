// TWO DEVICES, REAL BROWSERS, REAL SERVER (#309).
//
// The benches prove the rules in one second, and they will always be the first
// line of defence. But their "device" is a hand-written imitation of the app, so
// they cannot see a crash in the app's own code — and one such crash (#306) sat
// there for two days killing every pull on every reload, silently, while I asked
// Roman to test by hand.
//
// This runs the ACTUAL app in two browsers against the ACTUAL worker and a local
// database. A test here is the same thing as picking up the iPad, except it takes
// ninety seconds and nobody has to toggle airplane mode by hand.
//
// The pieces:
//   - the app served by vite, pointed at a local worker (VITE_API_BASE_URL)
//   - the worker run by `wrangler dev` with a local D1, so nothing touches
//     anything real
//   - two browser contexts = two devices, each with its own storage, its own
//     service worker, and its own offline switch
//   - the on-screen sync log read straight out of the page, so a test can assert
//     on what the app SAID it did, not only on what ended up on screen

import { type BrowserContext, type Page, type Browser, expect } from '@playwright/test';

/**
 * SAY WHAT IS HAPPENING (#309).
 *
 * These tests wait on real clocks — a three-second connection watch, a
 * five-second heartbeat, a two-second local save — so a minute can pass with
 * nothing on screen, and there is no way to tell "working" from "hung". Every
 * step announces itself, with the time it took.
 */
const started = Date.now();
export function say(what: string): void {
  const secs = ((Date.now() - started) / 1000).toFixed(1).padStart(5);
  console.log(`  ${secs}s  ${what}`);
}

export const API = process.env.FH_API ?? 'http://127.0.0.1:8787';
export const APP = process.env.FH_APP ?? 'http://127.0.0.1:5173';

/** A fresh account, so tests never collide with each other or with real data. */
export async function freshAccount(): Promise<{ email: string; password: string; token: string }> {
  const email = `bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = 'bench-password-1234';
  const res = await fetch(`${API}/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Bench', email, password, profession: 'director' }),
  });
  if (!res.ok) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
  // The token lives at session.token — reading it from the wrong place put
  // "undefined" in every device's storage and cost a three-minute run to find
  // out. So it is checked here, against the server, before anything else starts.
  const body = await res.json() as { session?: { token?: string } };
  const token = body.session?.token;
  if (!token) throw new Error(`signup gave no session token. Answer was: ${JSON.stringify(body)}`);

  const who = await fetch(`${API}/user/me`, { headers: { Authorization: `Bearer ${token}` } });
  if (!who.ok) {
    throw new Error(`the fresh token does not work: /user/me said ${who.status}. `
      + `Nothing else can pass until that does.`);
  }
  return { email, password, token };
}

/**
 * One device: a browser context of its own, signed in, with the app open and the
 * test door available.
 *
 * The session token is put in localStorage before the app loads, which is the
 * app's own restore path — the same one a returning user takes. Nothing is
 * clicked to sign in, because signing in is not what these tests are about.
 */
export class Device {
  readonly name: string;
  readonly ctx: BrowserContext;
  readonly page: Page;

  private constructor(name: string, ctx: BrowserContext, page: Page) {
    this.name = name; this.ctx = ctx; this.page = page;
  }

  /**
   * @param asTablet the app decides whether it is a Desktop, a Tablet or a Phone
   *   from the user agent and the touch points — so a device that should report
   *   itself as "Tablet" has to actually look like an iPad. That name travels in
   *   every push and shows up in the log, which is how we tell the two apart.
   */
  static async open(browser: Browser, name: string, token: string,
                    asTablet = false): Promise<Device> {
    const ctx = await browser.newContext(asTablet
      ? {
        viewport: { width: 1180, height: 820 },
        userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
          + ' (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        hasTouch: true,
        isMobile: false,
        deviceScaleFactor: 2,
      }
      : { viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    // The app reads these at startup. Seeded before the first load so the app
    // comes up signed in, exactly as it does for a returning user.
    await page.addInitScript((tok) => {
      localStorage.setItem('fh_session_token', tok as string);
      localStorage.setItem('fh_test', '1');
      localStorage.setItem('fh_sync_log', '1');   // the log strip, so we can read it
      localStorage.setItem('fh_debug', '1');
    }, token);
    page.on('console', (m) => {
      if (m.type() === 'error') console.log(`  [${name} console] ${m.text()}`);
    });
    page.on('pageerror', (e) => console.log(`  [${name} PAGE ERROR] ${e.message}`));
    say(`opening ${name}…`);
    await page.goto(`${APP}/app/?fhtest=1&fhsync=1`);
    await page.waitForFunction(() => Boolean((window as never as { __fh_test?: unknown }).__fh_test),
      undefined, { timeout: 30_000 });
    say(`${name} is open and signed in`);
    return new Device(name, ctx, page);
  }

  /**
   * Wait until the app has written its local save.
   *
   * The save waits two seconds after your last action, and a reload before it
   * lands finds nothing on the device — which is real, but it is not what these
   * tests are about. A person takes longer than two seconds to reach for the
   * refresh button.
   */
  async settle(): Promise<void> {
    await this.waitForLog('saving:', 20_000);
  }

  /** Reload, as pressing refresh does. The app restores from its own local save. */
  async reload(): Promise<void> {
    say(`${this.name}: reloading`);
    await this.page.reload();
    await this.page.waitForFunction(
      () => Boolean((window as never as { __fh_test?: unknown }).__fh_test),
      undefined, { timeout: 30_000 });
    say(`${this.name}: back up after the reload`);
  }

  /** Airplane mode. Playwright cuts the network for this context only, so one
   *  device can be offline while the other is not. */
  async offline(yes: boolean): Promise<void> {
    say(`${this.name}: ${yes ? 'going offline (airplane mode on)' : 'coming back online'}`);
    await this.ctx.setOffline(yes);
  }

  // --- the test door -------------------------------------------------------

  async newProject(name: string, frames: number): Promise<string | null> {
    say(`${this.name}: making "${name}" with ${frames} frames, and saving it`);
    const id = await this.newProjectInner(name, frames);
    say(`${this.name}: project is on the server (${String(id).slice(0, 8)})`);
    return id;
  }

  private newProjectInner(name: string, frames: number): Promise<string | null> {
    return this.page.evaluate(([n, c]) =>
      (window as never as { __fh_test: { newProject(n: string, c: number): Promise<string | null> } })
        .__fh_test.newProject(n as string, c as number), [name, frames]);
  }

  /** The second device opens the project the first one made. */
  async openProject(id: string): Promise<void> {
    say(`${this.name}: opening the project from the server`);
    await this.page.evaluate((pid) =>
      (window as never as { __fh_test: { openProject(id: string): Promise<void> } })
        .__fh_test.openProject(pid as string), id);
    say(`${this.name}: project open`);
  }

  writeUnder(index: number, text: string): Promise<void> {
    return this.page.evaluate(([i, t]) =>
      (window as never as { __fh_test: { writeUnder(i: number, t: string): void } })
        .__fh_test.writeUnder(i as number, t as string), [index, text]);
  }

  moveFrame(from: number, to: number): Promise<void> {
    return this.page.evaluate(([f, t]) =>
      (window as never as { __fh_test: { moveFrame(f: number, t: number): void } })
        .__fh_test.moveFrame(f as number, t as number), [from, to]);
  }

  renameCategory(index: number, name: string): Promise<void> {
    return this.page.evaluate(([i, n]) =>
      (window as never as { __fh_test: { renameCategory(i: number, n: string): void } })
        .__fh_test.renameCategory(i as number, n as string), [index, name]);
  }

  // --- shooting orders -----------------------------------------------------

  newSortOrder(name?: string): Promise<string> {
    return this.page.evaluate((n) =>
      (window as never as { __fh_test: { newSortOrder(n?: string): string } })
        .__fh_test.newSortOrder(n as string | undefined), name);
  }

  moveInOrder(orderIndex: number, from: number, to: number): Promise<void> {
    return this.page.evaluate(([o, f, t]) =>
      (window as never as { __fh_test: { moveInOrder(o: number, f: number, t: number): void } })
        .__fh_test.moveInOrder(o as number, f as number, t as number), [orderIndex, from, to]);
  }

  addBreak(orderIndex: number, position: number, text: string): Promise<string> {
    return this.page.evaluate(([o, p, t]) =>
      (window as never as { __fh_test: { addBreak(o: number, p: number, t: string): string } })
        .__fh_test.addBreak(o as number, p as number, t as string),
      [orderIndex, position, text] as [number, number, string]);
  }

  moveBreak(orderIndex: number, breakIndex: number, toPosition: number): Promise<void> {
    return this.page.evaluate(([o, b, p]) =>
      (window as never as { __fh_test: { moveBreak(o: number, b: number, p: number): void } })
        .__fh_test.moveBreak(o as number, b as number, p as number), [orderIndex, breakIndex, toPosition]);
  }

  /** One shooting order written out flat: the frames in order with the breaks
   *  sitting between them, exactly as the sort view shows it. The simplest
   *  thing to hold two devices against. */
  async orderAsText(orderIndex = 0): Promise<string> {
    const s = await this.read();
    const o = s.orders[orderIndex];
    if (!o) return '(no order)';
    const out: string[] = [];
    for (let i = 0; i <= o.frames.length; i++) {
      for (const b of o.breaks.filter((x) => x.position === i)) out.push(`[${b.text}]`);
      if (i < o.frames.length) out.push(o.frames[i]);
    }
    return `${o.name}: ${out.join(' ')}`;
  }

  deleteFrame(index: number): Promise<void> {
    return this.page.evaluate((i) =>
      (window as never as { __fh_test: { deleteFrame(i: number): void } })
        .__fh_test.deleteFrame(i as number), index);
  }

  push(): Promise<void> {
    return this.page.evaluate(() =>
      (window as never as { __fh_test: { push(): Promise<void> } }).__fh_test.push());
  }

  read(): Promise<{
    projectId: string | null;
    frames: Array<{ id: string; serverFrameId?: string; label: string; text: string }>;
    categories: string[];
    unsent: string[];
    orders: Array<{
      id: string; name: string; frames: string[];
      breaks: Array<{ id: string; text: string; position: number }>;
    }>;
  }> {
    return this.page.evaluate(() =>
      (window as never as { __fh_test: { read(): never } }).__fh_test.read());
  }

  /** The frames in order, as text — the simplest thing to compare between two
   *  devices, and the thing the user actually looks at. */
  async storyboard(): Promise<string> {
    const s = await this.read();
    return s.frames.map((f) => `${f.label}:${f.text}`).join(' | ');
  }

  // --- the log -------------------------------------------------------------

  /** Every line the app has written to its sync log, newest first. */
  async log(): Promise<string[]> {
    return this.page.$$eval('[data-line]', (els) => els.map((e) => e.textContent ?? ''));
  }

  /** Wait until the log contains a line with this text. Fails with the whole log
   *  attached, so a failure is readable without re-running anything. */
  async waitForLog(needle: string, timeoutMs = 30_000): Promise<void> {
    say(`${this.name}: waiting for the log to say "${needle}"`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const lines = await this.log();
      if (lines.some((l) => l.includes(needle))) { say(`${this.name}: …said it`); return; }
      if (Date.now() > deadline) {
        throw new Error(`[${this.name}] waited ${timeoutMs}ms for "${needle}".\nLog was:\n`
          + lines.slice(0, 40).map((l) => '  ' + l).join('\n'));
      }
      await this.page.waitForTimeout(250);
    }
  }

  /**
   * WAIT FOR A LINE THAT IS NOT THERE YET.
   *
   * `waitForLog` matches ANY line, including one written minutes ago — the log
   * is cumulative. So `push(); waitForLog('push OK')` returns instantly on the
   * strength of the PREVIOUS push, and the test carries on before the thing it
   * is waiting for has happened. It waits for nothing and reports success.
   *
   * That is how #312 first "failed": the test ran its checks 0.1 seconds after
   * asking for a push, because a 'push OK' from six seconds earlier was still
   * in the log.
   *
   * This one remembers what the log already said, and only counts a line that
   * appears afterwards.
   */
  /**
   * Everything the log says RIGHT NOW, to be handed to `waitForLogAfter`.
   *
   * Take this BEFORE the thing you are about to do. `waitForFreshLog` takes its
   * own snapshot when it is called, which is a moment too late: reconnecting a
   * device can produce "back online" before the next line of the test runs, and
   * the line it is waiting for is then already in the "before" picture and
   * ignored. The test waits thirty seconds for something that has happened.
   */
  async mark(): Promise<string[]> {
    return this.log();
  }

  /**
   * Wait until there is one MORE line saying this than there was at `before`.
   *
   * Counting, not matching. The first version asked "is there a line saying
   * this that I had not seen?" — and the log stamps lines to the second, so two
   * pushes inside the same second produce two lines with identical text. The
   * second one looked like the first and did not count, and the test waited
   * thirty seconds for something that had already happened twice.
   */
  async waitForLogAfter(before: string[], needle: string,
                        timeoutMs = 30_000): Promise<void> {
    const had = before.filter((l) => l.includes(needle)).length;
    say(`${this.name}: waiting for a NEW line saying "${needle}"`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const lines = await this.log();
      if (lines.filter((l) => l.includes(needle)).length > had) {
        say(`${this.name}: …said it`); return;
      }
      if (Date.now() > deadline) {
        throw new Error(`[${this.name}] waited ${timeoutMs}ms for a NEW "${needle}".\nLog was:\n`
          + lines.slice(0, 40).map((l) => '  ' + l).join('\n'));
      }
      await this.page.waitForTimeout(250);
    }
  }

  async waitForFreshLog(needle: string, timeoutMs = 30_000): Promise<void> {
    const before = new Set(await this.log());
    say(`${this.name}: waiting for a NEW line saying "${needle}"`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const lines = await this.log();
      if (lines.some((l) => l.includes(needle) && !before.has(l))) {
        say(`${this.name}: …said it`); return;
      }
      if (Date.now() > deadline) {
        throw new Error(`[${this.name}] waited ${timeoutMs}ms for a NEW "${needle}".\nLog was:\n`
          + lines.slice(0, 40).map((l) => '  ' + l).join('\n'));
      }
      await this.page.waitForTimeout(250);
    }
  }

  /** Nothing in the log may say this. Used for the faults that were silent for
   *  days — a crash inside a pull, a device stuck holding a pull back. */
  async expectNeverInLog(needle: string): Promise<void> {
    const lines = await this.log();
    const hit = lines.find((l) => l.includes(needle));
    expect(hit, `[${this.name}] log should not contain "${needle}", but had:\n  ${hit}`)
      .toBeUndefined();
  }

  /** Touch the page, because the heartbeat only runs while a device is being
   *  used — the same reason a real iPad on the table stays quiet. */
  async nudge(): Promise<void> {
    await this.page.mouse.move(10 + Math.random() * 40, 10 + Math.random() * 40);
    await this.page.waitForTimeout(200);
  }

  /** Wait until both devices show the same storyboard, nudging as a person
   *  would. This is the only question that really matters: do they agree? */
  static async waitUntilTheyAgree(a: Device, b: Device, timeoutMs = 60_000): Promise<string> {
    say(`waiting for ${a.name} and ${b.name} to show the same thing…`);
    const deadline = Date.now() + timeoutMs;
    let last = '';
    for (;;) {
      await a.nudge(); await b.nudge();
      const [x, y] = [await a.storyboard(), await b.storyboard()];
      if (x === y) { say(`they agree: ${x.slice(0, 70)}`); return x; }
      last = `\n  ${a.name}: ${x}\n  ${b.name}: ${y}`;
      if (Date.now() > deadline) {
        throw new Error(`the two devices never agreed within ${timeoutMs}ms:${last}\n\n`
          + `${a.name} log:\n${(await a.log()).slice(0, 25).map((l) => '  ' + l).join('\n')}\n\n`
          + `${b.name} log:\n${(await b.log()).slice(0, 25).map((l) => '  ' + l).join('\n')}`);
      }
      await a.page.waitForTimeout(500);
    }
  }

  /** The same question as waitUntilTheyAgree, asked about a shooting order:
   *  the frames in order with the breaks between them. */
  static async waitUntilOrdersAgree(a: Device, b: Device, orderIndex = 0,
                                    timeoutMs = 60_000): Promise<string> {
    say(`waiting for ${a.name} and ${b.name} to show the same shooting order…`);
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await a.nudge(); await b.nudge();
      const [x, y] = [await a.orderAsText(orderIndex), await b.orderAsText(orderIndex)];
      if (x === y && x !== '(no order)') { say(`they agree: ${x.slice(0, 80)}`); return x; }
      if (Date.now() > deadline) {
        throw new Error(`the two devices never agreed on the shooting order within `
          + `${timeoutMs}ms:\n  ${a.name}: ${x}\n  ${b.name}: ${y}\n\n`
          + `${a.name} log:\n${(await a.log()).slice(0, 25).map((l) => '  ' + l).join('\n')}\n\n`
          + `${b.name} log:\n${(await b.log()).slice(0, 25).map((l) => '  ' + l).join('\n')}`);
      }
      await a.page.waitForTimeout(500);
    }
  }

  async close(): Promise<void> { await this.ctx.close(); }
}

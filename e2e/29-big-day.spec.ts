// BIG DAY (#509) — one script, one sitting, every function of the app.
//
// Roman, 10 September: "a basic heavy duty test that runs all functions of the
// app, back and forth… so every time we do some change, we immediately know if
// we broke anything else elsewhere." Named by him on the 11th.
//
//     FH_RUN=<n> npm run t -- -g "big day"
//
// Built in PARTS, each green before the next is added. The outline of the
// whole day is in 29-BIG-DAY.outline.md. Every check is `expect.soft`, so one
// run reports everything that is wrong, not only the first thing.
//
// PART 1 — starting projects every way there is, opening them on the other
// devices, and the one check everything later stands on: the whole project,
// written out flat, identical on every device.

import { test, expect } from '@playwright/test';
import { Device, freshAccount, say } from './harness';

test.describe.configure({ timeout: 600_000 });

// ROMAN'S PDFs in e2e/fixtures (on his Mac only) and how many pictures each
// holds — his count, not the app's. The import must find exactly that many.
const PDF_SHOTS: Record<string, number> = {
  'storyboard01.pdf': 18,
  'storyboard02.pdf': 23,
  'storyboard03.pdf': 12,
};
const DAILY_PDF = 'storyboard03.pdf';

test('big day, part 1: every way to start a project, seen the same on three devices',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);

    // ── 1. Starting projects — every way in ──────────────────────────────
    const made: Array<{ name: string; id: string | null; shots: number }> = [];

    const scratch = await desktop.newProjectOfKind('BIG DAY — SCRATCH', 'landscape', 6);
    await desktop.settle();
    made.push({ name: 'BIG DAY — SCRATCH', id: scratch, shots: 6 });

    const portrait = await desktop.newProjectOfKind('BIG DAY — PORTRAIT', 'portrait', 4);
    await desktop.settle();
    made.push({ name: 'BIG DAY — PORTRAIT', id: portrait, shots: 4 });

    const fitting = await desktop.newProjectOfKind('BIG DAY — FITTING', 'fitting', 3);
    await desktop.settle();
    made.push({ name: 'BIG DAY — FITTING', id: fitting, shots: 3 });

    // Roman's own storyboard PDF, from e2e/fixtures (kept on his Mac only).
    const fromPdf = await desktop.importPdfProject('BIG DAY — FROM PDF', DAILY_PDF);
    await desktop.settle();
    const pdfShots = fromPdf ? (JSON.parse(await desktop.whole()) as { shots: unknown[] }).shots.length : 0;
    say(`the PDF gave ${pdfShots} shots`);
    expect.soft(pdfShots, `THE PDF IMPORT DID NOT FIND ALL THE SHOTS in ${DAILY_PDF}`).toBe(PDF_SHOTS[DAILY_PDF]);
    made.push({ name: 'BIG DAY — FROM PDF', id: fromPdf, shots: pdfShots });

    const fromPics = await desktop.importPicturesProject('BIG DAY — FROM PICTURES', 4);
    await desktop.settle();
    made.push({ name: 'BIG DAY — FROM PICTURES', id: fromPics, shots: 4 });

    for (const m of made) {
      expect.soft(m.id, `"${m.name}" must have reached the server`).not.toBeNull();
    }

    // ── the project list on the server holds them all ────────────────────
    const listed = await Device.projectNames(token);
    for (const m of made) {
      expect.soft(listed, `"${m.name}" must be in the project list`).toContain(m.name);
    }

    // ── 2. Each one opened on the iPad: identical, shot for shot ─────────
    for (const m of made) {
      if (!m.id) continue;
      say(`── ${m.name}: desktop opens, iPad opens, both must hold the same ──`);
      await desktop.openProject(m.id);
      await desktop.settle();
      await ipad.openProject(m.id);
      await ipad.settle();
      const agreed = await Device.waitUntilWholeAgrees(desktop, ipad,
        `${m.name.toUpperCase()}: THE IPAD DOES NOT HOLD WHAT THE DESKTOP HOLDS.`);
      const parsed = JSON.parse(agreed) as { shots: Array<{ picture: boolean }>; kind: string; name: string };
      expect.soft(parsed.shots.length, `${m.name}: shot count`).toBe(m.shots);
      expect.soft(parsed.name, `${m.name}: the name travelled`).toBe(m.name);
      if (m.name.includes('PDF') || m.name.includes('PICTURES')) {
        expect.soft(parsed.shots.every((s) => s.picture), `${m.name}: every shot has its picture on both`).toBe(true);
      }
      if (m.name.includes('FITTING')) expect.soft(parsed.kind, 'a fitting stays a fitting').toBe('fitting');
      if (m.name.includes('PORTRAIT')) expect.soft(parsed.kind, 'a portrait stays a portrait').toBe('portrait');
    }

    await desktop.close();
    await ipad.close();
  });

// Every PDF Roman put in e2e/fixtures must import with at least one shot —
// the import is tuned on real storyboards, and these are the real ones.
test('big day, part 1b: every storyboard PDF in the fixtures folder imports',
  async ({ browser }) => {
    const pdfs = Device.fixturePdfs();
    test.skip(pdfs.length === 0, 'no PDFs in e2e/fixtures');
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    for (const f of pdfs) {
      const id = await desktop.importPdfProject(`PDF — ${f}`, f);
      await desktop.settle();
      const shots = (JSON.parse(await desktop.whole()) as { shots: Array<{ picture: boolean }> }).shots;
      say(`${f}: ${shots.length} shots, ${shots.filter((s) => s.picture).length} with a picture`);
      expect.soft(id, `${f} must be saved`).not.toBeNull();
      if (PDF_SHOTS[f] !== undefined) {
        expect.soft(shots.length, `${f}: THE IMPORT FOUND ${shots.length} SHOTS, ROMAN COUNTS ${PDF_SHOTS[f]}`).toBe(PDF_SHOTS[f]);
      } else {
        expect.soft(shots.length, `${f}: THE IMPORT FOUND NO SHOTS`).toBeGreaterThan(0);
      }
      expect.soft(shots.every((s) => s.picture), `${f}: every shot has its picture`).toBe(true);
    }
    await desktop.close();
  });

// PART 2 — shots. Made, named, written under, moved, hidden, un-hidden and
// deleted, from both sides, and the other device must hold every bit of it.
test('big day, part 2: shots made, named, moved, hidden and deleted on both devices',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);
    type Shot = { name: string; label: string; text: string; hidden: boolean };
    const shotsOf = (w: string) => (JSON.parse(w) as { shots: Shot[] }).shots;

    const id = await desktop.newProjectOfKind('BIG DAY — SHOTS', 'landscape', 6);
    await desktop.settle();
    expect(id, 'the project must reach the server').not.toBeNull();
    await ipad.openProject(id!);
    await ipad.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: THE IPAD DOES NOT HOLD THE SIX SHOTS.');

    // ── desktop: two new shots — one after the last, one in between ──────
    say('── desktop makes shots: NEW after the last, NEW after the 3rd ──');
    await desktop.newFrameAfter(5);
    await desktop.page.waitForTimeout(600);     // a person sees the card before pressing again
    await desktop.newFrameAfter(2);
    const rightAfter = shotsOf(await desktop.whole()).map((s) => s.label);
    say(`desktop, straight after the two presses: ${rightAfter.join(' · ')}`);
    const ids = (await desktop.read()).frames.map((f) => `${f.label}(${f.id}/${(f.serverFrameId ?? '?').slice(0, 6)})`);
    say(`  with their numbers and names: ${ids.join(' ')}`);
    await desktop.settle();
    let agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: THE TWO NEW SHOTS DID NOT REACH THE IPAD.'));
    say(`the shots now: ${agreed.map((s) => s.label).join(' · ')}`);
    expect.soft(agreed.length, 'eight shots after two NEWs').toBe(8);
    const rightOrder = ['1', '2', '3', '3#1', '4', '5', '6', '6#1'];
    expect.soft(rightAfter, 'the app itself puts the new shots where NEW was pressed').toEqual(rightOrder);
    if (agreed.map((s) => s.label).join() !== rightOrder.join()) {
      say(`desktop log (newest first):\n${(await desktop.log()).slice(0, 60).map((l) => '    ' + l).join('\n')}`);
      say(`ipad log (newest first):\n${(await ipad.log()).slice(0, 60).map((l) => '    ' + l).join('\n')}`);
    }
    expect.soft(agreed.map((s) => s.label), 'after the sync the new shots still sit where NEW was pressed')
      .toEqual(rightOrder);
    const names8 = agreed.map((s) => s.name);

    // ── desktop: names and text ──────────────────────────────────────────
    say('── desktop names three shots and writes under one ──');
    await desktop.renameFrame(0, 'OPENING');
    await desktop.renameFrame(3, 'THE NEW ONE');
    await desktop.renameFrame(7, 'LAST');
    await desktop.typeUnder(1, 'wide, she enters');
    await desktop.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: THE NAMES OR THE TEXT DID NOT REACH THE IPAD.'));
    say(`the shots now: ${agreed.map((s) => s.label).join(' · ')}`);
    expect.soft(agreed.map((s) => s.label), 'the three names, where they were put')
      .toEqual(['OPENING', '2', '3', 'THE NEW ONE', '4', '5', '6', 'LAST']);
    expect.soft(agreed[1].text, 'the text under shot 2').toBe('wide, she enters');

    // ── desktop: move the 5th shot up to first place, one arrow at a time ─
    say('── desktop moves the 5th shot up to first place ──');
    const fifth = names8[4];
    await desktop.moveShot(4, 'up', 4);
    await desktop.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: THE MOVE DID NOT REACH THE IPAD.'));
    expect.soft(agreed[0].name, 'the 5th shot is now first').toBe(fifth);
    expect.soft(agreed.map((s) => s.name), 'the rest kept their order')
      .toEqual([fifth, ...names8.filter((n) => n !== fifth)]);

    // ── desktop hides one; iPad must hold it as hidden, then un-hides it ──
    say('── desktop hides shot 3; iPad un-hides it ──');
    const hiddenOne = agreed[2].name;
    await desktop.hideFrame(2);
    await desktop.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: THE HIDE DID NOT REACH THE IPAD.'));
    expect.soft(agreed.length, 'a hidden shot is still a shot').toBe(8);
    expect.soft(agreed.find((s) => s.name === hiddenOne)?.hidden, 'shot 3 is hidden on both').toBe(true);
    await ipad.unhideFrame(2);
    await ipad.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: THE UN-HIDE DID NOT REACH THE DESKTOP.'));
    expect.soft(agreed.find((s) => s.name === hiddenOne)?.hidden, 'shot 3 is back on both').toBe(false);

    // ── iPad deletes one; desktop must lose it ───────────────────────────
    say('── iPad deletes shot 6 ──');
    const gone = agreed[5].name;
    await ipad.deleteFrame(5);
    await ipad.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: THE DELETE DID NOT REACH THE DESKTOP.'));
    expect.soft(agreed.length, 'seven shots after the delete').toBe(7);
    expect.soft(agreed.map((s) => s.name), 'the deleted shot is gone on both').not.toContain(gone);

    // ── iPad renames what the desktop named — the later name wins ────────
    say('── iPad renames OPENING to TITLES; desktop renames LAST to CLOSING ──');
    const openingAt = agreed.findIndex((s) => s.label === 'OPENING');
    const lastAt = agreed.findIndex((s) => s.label === 'LAST');
    await ipad.renameFrame(openingAt, 'TITLES');
    await ipad.settle();
    await desktop.renameFrame(lastAt, 'CLOSING');
    await desktop.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: THE RENAMES FROM BOTH SIDES DID NOT MEET.'));
    const labels = agreed.map((s) => s.label);
    expect.soft(labels, 'TITLES is there').toContain('TITLES');
    expect.soft(labels, 'CLOSING is there').toContain('CLOSING');
    expect.soft(labels, 'OPENING is gone').not.toContain('OPENING');
    expect.soft(labels, 'LAST is gone').not.toContain('LAST');

    // ── reload both: what is on the server is what they show ─────────────
    await desktop.reload();
    await ipad.reload();
    await desktop.openProject(id!);
    await ipad.openProject(id!);
    await desktop.settle();
    const fresh = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'SHOTS: AFTER A RELOAD THE TWO DEVICES DIFFER.'));
    expect.soft(fresh, 'a reload changes nothing').toEqual(agreed);

    await desktop.close();
    await ipad.close();
  });

// A 64×64 red square, the smallest picture worth uploading.
const RED_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAe0lEQVR4nO3PUQkAIBTAwJfGAPav'
  + 'YR9D+HEIgwW4zVn764YLGtCCBrSgAS1oQAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1o'
  + 'QAsa0IIGtKABLWhACxrQgga0oAEtaEALGtCCBrSgAS1oQAsa0IIGtKABLXjsAvoi0Q8CaWIRAAAA'
  + 'AElFTkSuQmCC';

// PART 3 — what is ON the cards. A picture uploaded through the app's own
// chooser, a drawing on the main card, versions made with +, drawings on them,
// a star, a hidden version, the ANGLE and SKETCH strips, and written text.
// The iPad must hold every stroke, star and picture.
test('big day, part 3: pictures, drawings, versions and stars, held on both devices',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);
    type Ver = { label: string; stars: number; hidden: boolean; picture: boolean; strokes: number };
    type Shot = { label: string; picture: boolean; strokes: number; versions: Record<string, Ver[]> };
    const shotsOf = (w: string) => (JSON.parse(w) as { shots: Shot[] }).shots;

    const id = await desktop.newProjectOfKind('BIG DAY — CARDS', 'landscape', 4);
    await desktop.settle();
    expect(id, 'the project must reach the server').not.toBeNull();
    await ipad.openProject(id!);
    await ipad.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, 'CARDS: THE IPAD DOES NOT HOLD THE FOUR SHOTS.');

    // ── a picture on shot 1, through UPLOAD and the file chooser ─────────
    say('── desktop uploads a picture onto shot 1 ──');
    await desktop.uploadPicture(0, 'main', RED_PNG);
    await desktop.settle();
    let agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'CARDS: THE PICTURE DID NOT REACH THE IPAD.'));
    expect.soft(agreed[0].picture, 'shot 1 has its picture on both').toBe(true);

    // ── a drawing on the main card of shot 2 ─────────────────────────────
    say('── desktop draws on shot 2 (main card) ──');
    const mainStrokes = await desktop.draw(1, 'main', 0);
    expect.soft(mainStrokes, 'the stroke landed on shot 2 main card').toBeGreaterThan(0);
    await desktop.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'CARDS: THE MAIN-CARD DRAWING DID NOT REACH THE IPAD.'));
    expect.soft(agreed[1].strokes, 'shot 2 main card drawing on both').toBeGreaterThan(0);

    // ── versions on shot 3: +, draw on the new one, star it, write on it ──
    say('── desktop: + on shot 3, draws on the new version, stars it, writes on it ──');
    await desktop.pressNewVersion(2, 'ver');
    let labels = await desktop.versionLabels(2, 'ver');
    say(`   shot 3 VER versions: ${labels.join(' · ')}`);
    expect.soft(labels.length, 'shot 3 has two VER versions after +').toBe(2);
    const drawn = await desktop.draw(2, 'ver', 1);
    expect.soft(drawn, 'the stroke landed on the second version').toBeGreaterThan(0);
    await desktop.pressStar(2, 'ver', 1);
    await desktop.writeOnCard(2, 'ver', 1, 'HERO SHOT');
    await desktop.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'CARDS: THE NEW VERSION, ITS DRAWING, STAR OR TEXT DID NOT REACH THE IPAD.'));
    const v3 = agreed[2].versions.ver;
    say(`   shot 3 VER on both: ${v3.map((v) => `${v.label}${v.stars ? '★' : ''}${v.strokes ? `(${v.strokes} strokes)` : ''}`).join(' · ')}`);
    expect.soft(v3.length, 'two VER versions on both').toBe(2);
    expect.soft(v3.some((v) => v.stars > 0), 'a starred version on both').toBe(true);
    expect.soft(v3.some((v) => v.strokes > 0), 'a drawn version on both').toBe(true);

    // ── the other strips: ANGLE (floor) and SKETCH (refs) on shot 4 ──────
    say('── desktop draws on shot 4 ANGLE and SKETCH, uploads a picture to SKETCH ──');
    await desktop.showStrip('floor');
    const onFloor = await desktop.draw(3, 'floor', 0);
    expect.soft(onFloor, 'a stroke on ANGLE').toBeGreaterThan(0);
    await desktop.showStrip('refs');
    const onRefs = await desktop.draw(3, 'refs', 0);
    expect.soft(onRefs, 'a stroke on SKETCH').toBeGreaterThan(0);
    await desktop.uploadPicture(3, 'refs', RED_PNG);
    await desktop.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'CARDS: THE ANGLE/SKETCH WORK DID NOT REACH THE IPAD.'));
    expect.soft(agreed[3].versions.floor.some((v) => v.strokes > 0), 'ANGLE drawing on both').toBe(true);
    expect.soft(agreed[3].versions.refs.some((v) => v.strokes > 0), 'SKETCH drawing on both').toBe(true);
    expect.soft(agreed[3].versions.refs.some((v) => v.picture), 'SKETCH picture on both').toBe(true);

    // ── iPad hides shot 3's first version; desktop must see it hidden ────
    say('── iPad hides shot 3 VER version 1 ──');
    await ipad.hideVersion(2, 'ver', 0);
    await ipad.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'CARDS: THE HIDDEN VERSION DID NOT REACH THE DESKTOP.'));
    expect.soft(agreed[2].versions.ver.filter((v) => v.hidden).length, 'one hidden version on both').toBe(1);
    expect.soft(agreed[2].versions.ver.length, 'hiding keeps the version').toBe(2);

    // ── iPad writes on shot 1's main card; desktop must hold the text ────
    say('── iPad writes on shot 1 main card ──');
    await ipad.writeOnCard(0, 'main', 0, 'OPENING WIDE');
    await ipad.settle();
    agreed = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'CARDS: THE WRITTEN TEXT DID NOT REACH THE DESKTOP.'));
    expect.soft(agreed[0].strokes, 'shot 1 main card carries the text stroke on both').toBeGreaterThan(0);

    // ── reload both: the server holds all of it ──────────────────────────
    await desktop.reload();
    await ipad.reload();
    await desktop.openProject(id!);
    await ipad.openProject(id!);
    await desktop.settle();
    const fresh = shotsOf(await Device.waitUntilWholeAgrees(desktop, ipad, 'CARDS: AFTER A RELOAD THE TWO DEVICES DIFFER.'));
    expect.soft(fresh, 'a reload changes nothing').toEqual(agreed);

    await desktop.close();
    await ipad.close();
  });

// PART 4 — the words around the shots. Strip names, the needs (a category
// renamed, a column and an item renamed, ticks and counters on shots), note
// cards, setups made and put on shots, a version tagged for its setup — from
// both sides, held on both.
test('big day, part 4: strips, needs, notes and setups, held on both devices',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);
    type Shot = { label: string; setup: string | null; needsOn: string[]; counters: Record<string, number>; noteCard: string;
      versions: Record<string, Array<{ label: string; picture: boolean; tag: string | null }>> };
    type Whole = { shots: Shot[]; strips: string[]; categories: string[]; setups: Array<{ name: string; color: number }> };
    const parse = (w: string) => JSON.parse(w) as Whole;

    const id = await desktop.newProjectOfKind('BIG DAY — WORDS', 'landscape', 4);
    await desktop.settle();
    expect(id, 'the project must reach the server').not.toBeNull();
    await ipad.openProject(id!);
    await ipad.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE IPAD DOES NOT HOLD THE FOUR SHOTS.');

    // ── strip names ──────────────────────────────────────────────────────
    say('── desktop renames the strips: LOOKS, PLAN, MOOD ──');
    await desktop.renameStrip('ver', 'LOOKS');
    await desktop.renameStrip('floor', 'PLAN');
    await desktop.renameStrip('refs', 'MOOD');
    say(`   desktop straight after: ${parse(await desktop.whole()).strips.join(' · ')}`);
    await desktop.settle();
    let w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE STRIP NAMES DID NOT REACH THE IPAD.'));
    say(`   strips on both: ${w.strips.join(' · ')}`);
    if (!w.strips.join(' ').includes('LOOKS')) {
      say(`desktop log:\n${(await desktop.log()).slice(0, 40).map((l) => '    ' + l).join('\n')}`);
      say(`ipad log:\n${(await ipad.log()).slice(0, 25).map((l) => '    ' + l).join('\n')}`);
    }
    expect.soft(w.strips.join(' '), 'LOOKS travelled').toContain('LOOKS');
    expect.soft(w.strips.join(' '), 'PLAN travelled').toContain('PLAN');
    expect.soft(w.strips.join(' '), 'MOOD travelled').toContain('MOOD');

    // ── Customise: all six columns, saved with the project (#510) ────────
    say('── desktop: Customise → six names; iPad must show them; a NEW project on the iPad opens with them ──');
    const six = {
      main: 'FRAME', ver: 'TAKES', floor: 'PLAN', refs: 'MOOD', needs: 'WANTS', notes: 'MEMO',
      verLabel: 'take', floorLabel: 'plan', refsLabel: 'mood', needsLabel: 'wants', notesLabel: 'memo',
    };
    await desktop.customise(six);
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE SIX NAMES DID NOT REACH THE IPAD.'));
    say(`   columns on both: ${(w as unknown as { columns: string[] }).columns.join(' · ')} | strips: ${w.strips.join(' · ')}`);
    const cols = (w as unknown as { columns: string[] }).columns.join(' ');
    expect.soft(cols, 'SHOT button renamed').toContain('main:FRAME/');
    expect.soft(cols, 'NEEDS button + card label renamed').toContain('needs:WANTS/wants');
    expect.soft(cols, 'NOTES button + card label renamed').toContain('notes:MEMO/memo');
    expect.soft(w.strips.join(' '), 'ANGLE renamed').toContain('ver:TAKES/take/t');
    expect.soft(w.strips.join(' '), 'SKETCH renamed').toContain('floor:PLAN/plan/p');
    expect.soft(w.strips.join(' '), 'REFS renamed').toContain('refs:MOOD/mood/m');

    // A NEW project on the OTHER device — the names follow the account.
    const nextId = await ipad.newProjectOfKind('BIG DAY — NEXT ONE', 'landscape', 2);
    await ipad.settle();
    expect(nextId, 'the new project must reach the server').not.toBeNull();
    const next = parse(await ipad.whole());
    say(`   the iPad's new project: ${(next as unknown as { columns: string[] }).columns.join(' · ')} | ${next.strips.join(' · ')}`);
    if (!(next as unknown as { columns: string[] }).columns.join(' ').includes('main:FRAME/')) {
      say(`desktop log (names):\n${(await desktop.log()).filter((l) => /default names|new project:/.test(l)).map((l) => '    ' + l).join('\n')}`);
      say(`ipad log (names):\n${(await ipad.log()).filter((l) => /default names|new project:/.test(l)).map((l) => '    ' + l).join('\n')}`);
    }
    expect.soft((next as unknown as { columns: string[] }).columns.join(' '), 'NEW project: SHOT name follows the account').toContain('main:FRAME/');
    expect.soft(next.strips.join(' '), 'NEW project: strip names follow the account').toContain('ver:TAKES/take/t');
    // Back to the project of the day, on both.
    await ipad.openProject(id!);
    await ipad.settle();
    await desktop.openProject(id!);
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: BACK ON THE PROJECT, THE TWO DEVICES DIFFER.'));

    // ── the needs: names ─────────────────────────────────────────────────
    const layout = await desktop.needsLayout();
    expect(layout.length, 'the project has need categories').toBeGreaterThan(0);
    const cat = layout[0];
    const toggleTable = cat.tables.find((t) => t.type === 'toggle' && t.items.length > 0);
    const counterTable = layout.flatMap((c) => c.tables.map((t) => ({ c, t }))).find(({ t }) => t.type === 'counter' && t.items.length > 0);
    say(`   needs: ${layout.map((c) => `${c.name} (${c.tables.map((t) => `${t.name}:${t.type}×${t.items.length}`).join(', ')})`).join(' | ')}`);
    expect(toggleTable, 'a column with toggles to tick').toBeTruthy();

    say('── desktop renames the first category, a column and an item ──');
    await desktop.renameCategory(0, 'CAMERA DEPT');
    await desktop.renameNeedTable(toggleTable!.id, 'RIGS');
    await desktop.renameNeedItem(toggleTable!.id, toggleTable!.items[0].id, 'DOLLY');
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE NEEDS NAMES DID NOT REACH THE IPAD.'));
    say(`   categories on both: ${w.categories.join(' | ')}`);
    expect.soft(w.categories[0], 'the category name').toContain('CAMERA DEPT');
    expect.soft(w.categories[0], 'the column name').toContain('RIGS[');
    expect.soft(w.categories[0], 'the item name').toContain('DOLLY');

    // ── the needs: ticks and counters on shots, from both sides ──────────
    say('── desktop ticks DOLLY on shot 1 and 3; iPad ticks the second item on shot 2 and sets a counter ──');
    await desktop.showNeeds();
    await desktop.pressNeedsTab(0, cat.id);
    await desktop.pressNeed(0, toggleTable!.items[0].id, 'DOLLY');
    await desktop.pressNeedsTab(2, cat.id);
    await desktop.pressNeed(2, toggleTable!.items[0].id, 'DOLLY');
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE TICKS DID NOT REACH THE IPAD.'));
    expect.soft(w.shots[0].needsOn, 'shot 1 has DOLLY on both').toContain(toggleTable!.items[0].id);
    expect.soft(w.shots[2].needsOn, 'shot 3 has DOLLY on both').toContain(toggleTable!.items[0].id);

    await ipad.showNeeds();
    await ipad.pressNeedsTab(1, cat.id);
    const second = toggleTable!.items[1] ?? toggleTable!.items[0];
    await ipad.pressNeed(1, second.id, second.name);
    if (counterTable) {
      await ipad.pressNeedsTab(1, counterTable.c.id);
      await ipad.setNeedCounter(1, counterTable.t.items[0].id, 3, counterTable.t.items[0].name);
    }
    await ipad.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, "WORDS: THE IPAD'S TICK OR COUNTER DID NOT REACH THE DESKTOP."));
    expect.soft(w.shots[1].needsOn, 'shot 2 has the iPad\'s tick on both').toContain(second.id);
    if (counterTable) expect.soft(w.shots[1].counters[counterTable.t.items[0].id], 'shot 2 counter = 3 on both').toBe(3);
    expect.soft(w.shots[0].needsOn, 'shot 1 still has DOLLY').toContain(toggleTable!.items[0].id);

    // ── note cards ───────────────────────────────────────────────────────
    say('── desktop writes a note on shot 4; iPad writes one on shot 1 ──');
    await desktop.showNotes();
    await desktop.typeNote(3, 'golden hour only');
    say(`   desktop shot 4 note straight after typing: "${parse(await desktop.whole()).shots[3].noteCard}"`);
    await desktop.settle();
    say(`   desktop shot 4 note after settling: "${parse(await desktop.whole()).shots[3].noteCard}"`);
    await ipad.showNotes();
    say(`   ipad shot 4 note before it types its own: "${parse(await ipad.whole()).shots[3].noteCard}"`);
    await ipad.typeNote(0, 'bring the 50mm');
    await ipad.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE NOTES DID NOT MEET.'));
    if (w.shots[3].noteCard !== 'golden hour only') {
      say(`desktop log:\n${(await desktop.log()).slice(0, 45).map((l) => '    ' + l).join('\n')}`);
      say(`ipad log:\n${(await ipad.log()).slice(0, 30).map((l) => '    ' + l).join('\n')}`);
    }
    expect.soft(w.shots[3].noteCard, 'shot 4 note on both').toBe('golden hour only');
    expect.soft(w.shots[0].noteCard, 'shot 1 note on both').toBe('bring the 50mm');

    // ── setups ───────────────────────────────────────────────────────────
    say('── desktop makes setup A and puts it on shots 1–2; iPad makes setup B for shot 3, tags a version ──');
    const setupA = await desktop.newSetup('A — KITCHEN');
    await desktop.putSetupOnFrame(0, setupA);
    await desktop.putSetupOnFrame(1, setupA);
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: SETUP A DID NOT REACH THE IPAD.'));
    expect.soft(w.setups.map((s) => s.name), 'setup A on both').toContain('A — KITCHEN');
    expect.soft(w.shots[0].setup, 'shot 1 in setup A on both').toBe('A — KITCHEN');
    expect.soft(w.shots[1].setup, 'shot 2 in setup A on both').toBe('A — KITCHEN');

    // ── a picture tagged into setup A (#516, Roman by hand, 15 September) ──
    // Every shot in the setup gets ONE copy; a shot's own versions are never
    // touched; a second tag from the other device adds one more copy, not a
    // second of the first; untag takes every copy away and leaves the origin
    // as a plain version on its frame.
    type Ver = { label: string; picture: boolean; tag: string | null };
    const verOf = (shot: { versions: Record<string, Ver[]> }) => shot.versions.ver ?? [];
    const show = (vs: Ver[]) => vs.map((v) => `${v.label}${v.picture ? '📷' : ''}${v.tag ? `[${v.tag}]` : ''}`).join(' · ');
    const copies = (vs: Ver[]) => vs.filter((v) => v.tag === 'copy').length;
    const own = (vs: Ver[]) => vs.filter((v) => !v.tag).length;

    say('── desktop: shot 2 gets two own versions; shot 1 gets a picture, tagged into setup A ──');
    await desktop.leaveSetups();
    await desktop.showStrip('ver');
    await desktop.pressNewVersion(1, 'ver');
    await desktop.writeOnCard(1, 'ver', 0, 'MINE ONE');
    await desktop.writeOnCard(1, 'ver', 1, 'MINE TWO');
    await desktop.uploadPicture(0, 'ver', RED_PNG);
    await desktop.settle();
    await desktop.tagVersion(0, 'ver', 0);
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE TAGGED PICTURE DID NOT MEET ON BOTH DEVICES.'));
    say(`   shot 1 VER on both: ${show(verOf(w.shots[0]))}`);
    say(`   shot 2 VER on both: ${show(verOf(w.shots[1]))}`);
    expect.soft(verOf(w.shots[0]).filter((v) => v.tag === 'origin').length, 'shot 1 holds the origin').toBe(1);
    expect.soft(copies(verOf(w.shots[1])), 'shot 2 holds exactly one copy').toBe(1);
    expect.soft(verOf(w.shots[1]).find((v) => v.tag === 'copy')?.picture, 'the copy has the picture').toBe(true);
    expect.soft(own(verOf(w.shots[1])), 'shot 2 keeps its own two versions').toBe(2);

    say('── desktop puts shot 4 into setup A; iPad tags a picture of its own on shot 4 ──');
    await desktop.putSetupOnFrame(3, setupA);
    await desktop.leaveSetups();
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: SHOT 4 JOINING THE SETUP DID NOT MEET.'));
    say(`   shot 4 VER on both: ${show(verOf(w.shots[3]))}`);
    expect.soft(copies(verOf(w.shots[3])), 'shot 4 got exactly one copy on joining').toBe(1);
    await ipad.showStrip('ver');
    await ipad.pressNewVersion(3, 'ver');
    const shot4 = await ipad.versionLabels(3, 'ver');
    await ipad.uploadPicture(3, 'ver', RED_PNG);
    await ipad.settle();
    await ipad.tagVersion(3, 'ver', shot4.length - 1);
    await ipad.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, "WORDS: THE IPAD'S TAG DID NOT MEET."));
    for (const i of [0, 1, 3]) say(`   shot ${i + 1} VER on both: ${show(verOf(w.shots[i]))}`);
    expect.soft(copies(verOf(w.shots[0])), 'shot 1: one copy (of the iPad\'s)').toBe(1);
    expect.soft(copies(verOf(w.shots[1])), 'shot 2: two copies, one of each origin').toBe(2);
    expect.soft(copies(verOf(w.shots[3])), 'shot 4: still one copy (of the desktop\'s)').toBe(1);
    expect.soft(own(verOf(w.shots[1])), 'shot 2 still keeps its own two').toBe(2);
    expect.soft(verOf(w.shots[3]).filter((v) => v.tag === 'origin').length, 'shot 4 holds its origin').toBe(1);

    say('── desktop untags its picture on shot 1: the copies go, the origin stays as a plain version ──');
    await desktop.tagVersion(0, 'ver', verOf(parse(await desktop.whole()).shots[0]).findIndex((v) => v.tag === 'origin'));
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE UNTAG DID NOT MEET.'));
    for (const i of [0, 1, 3]) say(`   shot ${i + 1} VER on both: ${show(verOf(w.shots[i]))}`);
    expect.soft(verOf(w.shots[0]).filter((v) => v.tag === 'origin').length, 'shot 1: no origin any more').toBe(0);
    expect.soft(verOf(w.shots[0]).filter((v) => !v.tag && v.picture).length, 'shot 1: the picture stays as its own version').toBe(1);
    expect.soft(copies(verOf(w.shots[1])), 'shot 2: one copy left (the iPad\'s)').toBe(1);
    expect.soft(copies(verOf(w.shots[3])), 'shot 4: no copy left').toBe(0);
    expect.soft(own(verOf(w.shots[1])), 'shot 2 still keeps its own two').toBe(2);

    // Untag pressed on a COPY (#519, Roman by hand: five presses on copies did
    // nothing). The iPad presses the pill on shot 2's remaining copy — of the
    // iPad's own origin on shot 4 — and every copy of it goes, the origin stays.
    say('── iPad untags by pressing the pill on the COPY on shot 2 ──');
    const copyAt = verOf(parse(await ipad.whole()).shots[1]).findIndex((v) => v.tag === 'copy');
    expect(copyAt, 'shot 2 holds a copy to press').toBeGreaterThanOrEqual(0);
    await ipad.tagVersion(1, 'ver', copyAt);
    await ipad.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: THE UNTAG ON A COPY DID NOT MEET.'));
    for (const i of [0, 1, 3]) say(`   shot ${i + 1} VER on both: ${show(verOf(w.shots[i]))}`);
    expect.soft(copies(verOf(w.shots[1])), 'shot 2: no copy left').toBe(0);
    expect.soft(copies(verOf(w.shots[0])), 'shot 1: no copy left').toBe(0);
    expect.soft(verOf(w.shots[3]).filter((v) => v.tag === 'origin').length, 'shot 4: no origin any more').toBe(0);
    expect.soft(verOf(w.shots[3]).filter((v) => !v.tag && v.picture).length, 'shot 4: its picture stays as a plain version').toBe(1);
    expect.soft(own(verOf(w.shots[1])), 'shot 2 still keeps its own two').toBe(2);

    const setupB = await ipad.newSetup('B — GARDEN');
    await ipad.putSetupOnFrame(2, setupB);
    await ipad.tagVersion(2, 'ver', 0);
    await ipad.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: SETUP B OR THE TAG DID NOT REACH THE DESKTOP.'));
    expect.soft(w.setups.map((s) => s.name).sort(), 'both setups on both').toEqual(['A — KITCHEN', 'B — GARDEN']);
    expect.soft(w.shots[2].setup, 'shot 3 in setup B on both').toBe('B — GARDEN');
    expect.soft(w.shots[2].versions.ver?.[0]?.tag, 'shot 3 version 1 tagged on both').toBeTruthy();

    // ── reload both ──────────────────────────────────────────────────────
    await desktop.reload();
    await ipad.reload();
    await desktop.openProject(id!);
    await ipad.openProject(id!);
    await desktop.settle();
    const fresh = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'WORDS: AFTER A RELOAD THE TWO DEVICES DIFFER.'));
    expect.soft(fresh, 'a reload changes nothing').toEqual(w);

    await desktop.close();
    await ipad.close();
  });

// PART 5 — groups. Made on one device, seen on the other; shots added and
// taken out; a shot hidden inside the group; NEW inside the group; the
// group's story flow moved with the sort view's own arrow AND by drag (this
// is the fault Roman found by hand on 14 September — #512); renamed; deleted.
// ALL must stay exactly as it was throughout: a group's order is its own.
test('big day, part 5: groups, made, changed, moved and deleted on both devices',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);
    type Whole = { shots: Array<{ label: string }>; groups: Array<{ name: string; shots: string[]; hidden: string[] }> };
    const parse = (w: string) => JSON.parse(w) as Whole;
    const labelsOf = async (d: Device) => (await d.read()).frames.map((f) => f.label).join(' ');

    const id = await desktop.newProjectOfKind('BIG DAY — GROUPS', 'landscape', 8);
    await desktop.settle();
    expect(id, 'the project must reach the server').not.toBeNull();
    await ipad.openProject(id!);
    await ipad.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, 'GROUPS: THE IPAD DOES NOT HOLD THE EIGHT SHOTS.');
    const allBefore = await labelsOf(desktop);

    // ── two groups, one from each device ─────────────────────────────────
    say('── desktop makes KITCHEN (2,3,4,5); iPad makes GARDEN (6,7) ──');
    const kitchen = await desktop.makeGroup('KITCHEN', [1, 2, 3, 4]);
    await desktop.settle();
    const garden = await ipad.makeGroup('GARDEN', [5, 6]);
    await ipad.settle();
    let w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'GROUPS: THE TWO GROUPS DID NOT MEET.'));
    say(`   groups on both: ${w.groups.map((g) => `${g.name}[${g.shots.length}]`).join(' · ')}`);
    expect.soft(w.groups.map((g) => g.name).sort(), 'both groups on both').toEqual(['GARDEN', 'KITCHEN']);
    expect.soft(await Device.waitUntilGroupsAgree(desktop, ipad, kitchen), 'KITCHEN as made').toBe('KITCHEN: 2 3 4 5');
    expect.soft(await Device.waitUntilGroupsAgree(desktop, ipad, garden), 'GARDEN as made').toBe('GARDEN: 6 7');

    // ── the group's story flow: the sort view's own arrow, then a drag ───
    say('── desktop: in KITCHEN\'s story flow, arrow 5 up; then drag 2 to the end ──');
    await desktop.enterGroup(kitchen);
    await desktop.pickStoryFlow(kitchen);
    await desktop.pressSortArrow(4, 'up');            // shot "5" (index 4 in ALL) one place up → 2 3 5 4
    expect.soft(await desktop.sortViewFrames(), 'the arrow move shows at once').toEqual(['2', '3', '5', '4']);
    await desktop.dragInSortView(0, 3);              // "2" dragged to the end → 3 5 4 2
    const afterDrag = await desktop.sortViewFrames();
    say(`   after the drag the sort view shows: ${afterDrag.join(' ')}`);
    expect.soft(afterDrag, 'THE DRAG DID NOT STICK in the group\'s story flow').toEqual(['3', '5', '4', '2']);
    await desktop.enterGroup(null);
    expect.soft(await labelsOf(desktop), 'ALL untouched by moves inside the group').toBe(allBefore);
    await desktop.push();
    await desktop.settle();
    expect.soft(await Device.waitUntilGroupsAgree(desktop, ipad, kitchen), 'KITCHEN\'s new order reaches the iPad').toBe('KITCHEN: 3 5 4 2');

    // ── hide inside the group (iPad), take one out (desktop) ─────────────
    say('── iPad hides the first shot inside KITCHEN; desktop takes shot 2 out of it ──');
    await ipad.enterGroup(kitchen);
    await ipad.hideInGroup(0);                       // "3" hidden inside KITCHEN
    await ipad.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'GROUPS: THE HIDE INSIDE THE GROUP DID NOT REACH THE DESKTOP.'));
    let k = w.groups.find((g) => g.name === 'KITCHEN')!;
    expect.soft(k.hidden.length, 'one shot hidden inside KITCHEN on both').toBe(1);
    expect.soft(k.shots.length, 'hiding keeps it in the group').toBe(4);
    await desktop.enterGroup(kitchen);
    await desktop.removeFromGroup(3);                // "2" (last in the group's order) out
    await desktop.settle();
    await desktop.enterGroup(null);
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'GROUPS: TAKING A SHOT OUT DID NOT REACH THE IPAD.'));
    k = w.groups.find((g) => g.name === 'KITCHEN')!;
    if (k.shots.length !== 3) {
      for (const d of [desktop, ipad]) {
        say(`${d.name} log (newest first):\n${(await d.log()).slice(0, 50).map((l) => '    ' + l.slice(0, 200)).join('\n')}`);
      }
    }
    expect.soft(k.shots.length, 'three shots left in KITCHEN on both').toBe(3);
    expect.soft(w.shots.length, 'the shot itself is still in the project').toBe(8);

    // ── NEW inside a group ───────────────────────────────────────────────
    say('── iPad presses NEW inside GARDEN ──');
    await ipad.enterGroup(garden);
    await ipad.newFrameAfter(5);                     // after shot "6" (index 5 in ALL)
    await ipad.settle();
    await ipad.enterGroup(null);
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'GROUPS: THE NEW SHOT MADE INSIDE A GROUP DID NOT MEET.'));
    expect.soft(w.shots.length, 'nine shots now').toBe(9);
    expect.soft(w.groups.find((g) => g.name === 'GARDEN')!.shots.length, 'the new shot joined GARDEN on both').toBe(3);
    expect.soft(w.shots.map((s) => s.label), 'the new shot sits after 6 in ALL').toEqual(['1', '2', '3', '4', '5', '6', '6#1', '7', '8']);

    // ── rename (desktop) and delete (iPad) ───────────────────────────────
    say('── desktop renames GARDEN to YARD and adds shot 8; iPad deletes KITCHEN ──');
    await desktop.editGroup(garden, 'YARD', [5, 6, 7, 8]);
    await desktop.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'GROUPS: THE RENAME DID NOT REACH THE IPAD.'));
    expect.soft(w.groups.map((g) => g.name).sort(), 'YARD on both').toEqual(['KITCHEN', 'YARD']);
    expect.soft(w.groups.find((g) => g.name === 'YARD')!.shots.length, 'YARD holds four').toBe(4);
    await ipad.deleteGroup(kitchen);
    await ipad.settle();
    w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'GROUPS: THE DELETED GROUP CAME BACK.'));
    expect.soft(w.groups.map((g) => g.name), 'only YARD left, on both').toEqual(['YARD']);
    expect.soft(w.shots.length, 'deleting a group deletes no shot').toBe(9);

    // ── reload both ──────────────────────────────────────────────────────
    await desktop.reload();
    await ipad.reload();
    await desktop.openProject(id!);
    await ipad.openProject(id!);
    await desktop.settle();
    const fresh = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'GROUPS: AFTER A RELOAD THE TWO DEVICES DIFFER.'));
    if (fresh.groups.length !== w.groups.length) {
      say(`   groups after the reload: ${fresh.groups.map((g) => g.name).join(', ')} (before: ${w.groups.map((g) => g.name).join(', ')})`);
      for (const d of [desktop, ipad]) {
        const lines = (await d.log()).filter((l) => /group|unsent|kept|restor|deletion|settings arrived|snapshot|offline cache|boot/i.test(l));
        say(`${d.name} log (groups, newest first):\n${lines.slice(0, 45).map((l) => '    ' + l.slice(0, 200)).join('\n')}`);
      }
    }
    expect.soft(fresh, 'a reload changes nothing').toEqual(w);

    await desktop.close();
    await ipad.close();
  });

// PART 6 — shooting orders and the boxes, across two devices. The needs set
// on shots; an order made and sorted by the boxes; a needs change made on the
// OTHER device shows as a green mark on this one and DONE clears it (the mark
// Roman confirmed by hand on 11 September, now held); arrows, a break named,
// moved; a group order made on the iPad; both devices editing DIFFERENT orders
// while apart, nobody asked anything; an order deleted. Pressed with the same
// helpers as Roman's own loop test (27), from e2e/boxes.ts.
import { setNeeds, buildFullSheet, sortNow, look, moveTo, approve } from './boxes';

test('big day, part 6: shooting orders and the boxes, on both devices',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);
    type Whole = { orders: Array<{ name: string; group: string | null; shots: string[]; breaks: Array<{ text: string; position: number }> }> };
    const parse = (w: string) => JSON.parse(w) as Whole;

    const id = await desktop.newProjectOfKind('BIG DAY — ORDERS', 'landscape', 8);
    await desktop.settle();
    expect(id, 'the project must reach the server').not.toBeNull();
    await ipad.openProject(id!);
    await ipad.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, 'ORDERS: THE IPAD DOES NOT HOLD THE EIGHT SHOTS.');

    // ── needs on the shots (desktop), seen on the iPad ───────────────────
    say('── desktop sets SHOOT DAY on six shots: 1-3 day 1, 4-5 day 2, 6 day 3 ──');
    for (const [i, day] of [[0, 'ti_day1'], [1, 'ti_day1'], [2, 'ti_day1'], [3, 'ti_day2'], [4, 'ti_day2'], [5, 'ti_day3']] as Array<[number, string]>) {
      await setNeeds(desktop.page, i, [day]);
    }
    await desktop.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, 'ORDERS: THE NEEDS DID NOT REACH THE IPAD.');

    // ── an order, sorted by the boxes (desktop) ──────────────────────────
    say('── desktop makes DAY ORDER, builds the sheet by day, SORT NOW ──');
    await desktop.newSortOrder('DAY ORDER');
    await desktop.settle();
    await desktop.openOrder(0);
    await desktop.page.waitForTimeout(600);
    await buildFullSheet(desktop.page);
    await sortNow(desktop.page);
    let seen = await look(desktop.page);
    say(`   sorted: ${seen.order.join(' ')} · green: ${seen.greenCards.join(' ') || 'none'}`);
    expect.soft(seen.order.length, 'the order holds all eight').toBe(8);
    expect.soft(seen.order.slice(0, 3).sort(), 'day 1 shots first').toEqual(['1', '2', '3']);
    expect.soft(seen.greenCards, 'SORT NOW marks nothing green').toEqual([]);
    await desktop.closeOrder();
    await desktop.settle();
    const sortedText = await desktop.orderTextByName('DAY ORDER');
    expect.soft(await Device.waitUntilNamedOrdersAgree(desktop, ipad, 'DAY ORDER'), 'the sorted order reaches the iPad').toBe(sortedText);

    // ── the OTHER device changes a need; this one sees the green mark ─────
    say('── iPad gives shot 8 SHOOT DAY 1; desktop opens the order: 8 moved into day 1, green ──');
    await setNeeds(ipad.page, 7, ['ti_day1']);
    await ipad.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, "ORDERS: THE IPAD'S NEED DID NOT REACH THE DESKTOP.");
    await desktop.openOrder(0);
    await desktop.page.waitForTimeout(900);
    seen = await look(desktop.page);
    say(`   desktop sees: ${seen.order.join(' ')} · green cards: ${seen.greenCards.join(' ') || 'none'} · green icons: ${seen.greenIcons.join(' ') || 'none'}`);
    expect.soft(seen.order.indexOf('8'), 'shot 8 moved up into the day 1 box').toBeLessThan(4);
    expect.soft(seen.greenCards, 'shot 8 is marked green on the desktop').toContain('8');
    await approve(desktop.page, '8');
    seen = await look(desktop.page);
    expect.soft(seen.greenCards, 'DONE clears the green').toEqual([]);
    await desktop.closeOrder();
    await desktop.settle();
    await Device.waitUntilNamedOrdersAgree(desktop, ipad, 'DAY ORDER');

    // ── arrows and a break (desktop) ─────────────────────────────────────
    say('── desktop moves shot 1 to third place with the arrows; adds, names and moves a break ──');
    await desktop.openOrder(0);
    await desktop.page.waitForTimeout(600);
    await moveTo(desktop.page, '1', 3);
    seen = await look(desktop.page);
    expect.soft(seen.order[2], 'shot 1 sits third').toBe('1');
    expect.soft(seen.redIcons, 'a move WITHIN its box is not red').toEqual([]);
    await moveTo(desktop.page, '6', 1);          // a day-3 shot to the front — out of its box
    seen = await look(desktop.page);
    expect.soft(seen.redIcons, 'a shot moved out of its box goes red — shot 6').toContain('6');
    await desktop.closeOrder();
    const dayIdx = await desktop.orderIndexOf('DAY ORDER');
    const brk = await desktop.addBreak(dayIdx, 4, 'LUNCH');
    const dayOrderId = (await desktop.read()).orders[dayIdx].id;
    await desktop.renameBreak(dayOrderId, brk, 'LUNCH 60');
    await desktop.moveBreak(dayIdx, 0, 3);
    await desktop.push();
    await desktop.settle();
    const withBreak = await desktop.orderTextByName('DAY ORDER');
    say(`   desktop: ${withBreak}`);
    expect.soft(withBreak, 'the break is named and at place 3').toContain('[LUNCH 60]');
    expect.soft(await Device.waitUntilNamedOrdersAgree(desktop, ipad, 'DAY ORDER'), 'arrows and the break reach the iPad').toBe(withBreak);

    // ── a group order, made on the iPad ──────────────────────────────────
    say('── iPad makes group CREW (5,6,7) and an order inside it ──');
    const crew = await ipad.makeGroup('CREW', [4, 5, 6]);
    await ipad.enterGroup(crew);
    await ipad.newSortOrder('CREW ORDER');
    await ipad.push();
    await ipad.settle();
    await ipad.enterGroup(null);
    const crewText = await ipad.orderTextByName('CREW ORDER');
    say(`   iPad: ${crewText}`);
    expect.soft(await Device.waitUntilNamedOrdersAgree(desktop, ipad, 'CREW ORDER'), 'the group order reaches the desktop').toBe(crewText);
    const w1 = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'ORDERS: AFTER THE GROUP ORDER THE DEVICES DIFFER.'));
    expect.soft(w1.orders.find((o) => o.name === 'CREW ORDER')?.group, 'CREW ORDER belongs to CREW on both').toBe('CREW');

    // ── apart: each edits a DIFFERENT order; nobody is asked ─────────────
    say('── both go offline: desktop moves in DAY ORDER, iPad adds a break in CREW ORDER; both return ──');
    await desktop.offline(true);
    await ipad.offline(true);
    await desktop.page.waitForTimeout(3000);
    await desktop.openOrder(await desktop.orderIndexOf('DAY ORDER'));
    await desktop.page.waitForTimeout(600);
    await moveTo(desktop.page, '2', 5);
    await desktop.closeOrder();
    const crewIdx = await ipad.orderIndexOf('CREW ORDER');
    await ipad.addBreak(crewIdx, 1, 'TEA');
    await ipad.push().catch(() => {});
    await desktop.push().catch(() => {});
    const dayMine = await desktop.orderTextByName('DAY ORDER');
    const crewMine = await ipad.orderTextByName('CREW ORDER');
    await desktop.offline(false);
    await ipad.offline(false);
    await desktop.page.waitForTimeout(3000);
    expect.soft(await Device.waitUntilNamedOrdersAgree(desktop, ipad, 'DAY ORDER'), "the desktop's move survived").toBe(dayMine);
    expect.soft(await Device.waitUntilNamedOrdersAgree(desktop, ipad, 'CREW ORDER'), "the iPad's break survived").toBe(crewMine);
    for (const d of [desktop, ipad]) {
      const asked = (await d.log()).find((l) => l.includes('decision(s) waiting'));
      expect.soft(asked, `${d.name} was asked about an order nobody clashed on: ${asked}`).toBeUndefined();
    }

    // ── delete an order (iPad) ───────────────────────────────────────────
    say('── iPad deletes DAY ORDER ──');
    await ipad.deleteOrder(await ipad.orderIndexOf('DAY ORDER'));
    await ipad.settle();
    const w2 = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'ORDERS: THE DELETED ORDER CAME BACK.'));
    expect.soft(w2.orders.map((o) => o.name), 'only CREW ORDER left, on both').toEqual(['CREW ORDER']);

    // ── reload both ──────────────────────────────────────────────────────
    await desktop.reload();
    await ipad.reload();
    await desktop.openProject(id!);
    await ipad.openProject(id!);
    await desktop.settle();
    const fresh = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'ORDERS: AFTER A RELOAD THE TWO DEVICES DIFFER.'));
    expect.soft(fresh, 'a reload changes nothing').toEqual(w2);

    await desktop.close();
    await ipad.close();
  });

// PART 7 — exports. Every export the app offers, through its own window and
// its own GO, in every project type it applies to; the file it saves is
// caught and judged by what it is: a PDF starts with %PDF, a Keynote/PPTX and
// a set of images are zips (PK). Done on the desktop, where saving is a
// download (iOS shows a share sheet instead).
test('big day, part 7: every export produces its file',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);

    const expectFile = (got: { name: string; size: number; head: string }, kind: string, head: string, ext: string) => {
      expect.soft(got.head.startsWith(head), `${kind}: the file is a ${ext} (starts "${head}")`).toBe(true);
      expect.soft(got.size, `${kind}: the file has something in it`).toBeGreaterThan(2_000);
      expect.soft(got.name.toLowerCase().endsWith(ext), `${kind}: named .${ext}`).toBe(true);
    };

    // ── landscape: pictures on the shots, a drawing, needs, an order ─────
    say('── a landscape project with pictures, a drawing, needs and an order ──');
    const land = await desktop.importPicturesProject('BIG DAY — EXPORTS', 5);
    await desktop.settle();
    expect(land, 'the project must reach the server').not.toBeNull();
    await desktop.draw(1, 'ver', 0);
    await setNeeds(desktop.page, 0, ['ti_day1']);
    await setNeeds(desktop.page, 1, ['ti_day2']);
    await desktop.newSortOrder('EXPORT ORDER');
    await desktop.settle();

    expectFile(await desktop.exportAndCatch('pdf'), 'PDF', '%PDF', 'pdf');
    expectFile(await desktop.exportAndCatch('pptx'), 'Keynote/PowerPoint', 'PK', 'pptx');
    expectFile(await desktop.exportAndCatch('images'), 'images', 'PK', 'zip');

    // ── portrait ─────────────────────────────────────────────────────────
    say('── a portrait project ──');
    await desktop.newProjectOfKind('BIG DAY — PORTRAIT EXPORT', 'portrait', 3);
    await desktop.settle();
    await desktop.uploadPicture(0, 'main', RED_PNG);
    await desktop.settle();
    expectFile(await desktop.exportAndCatch('portrait-pdf'), 'portrait PDF', '%PDF', 'pdf');
    expectFile(await desktop.exportAndCatch('portrait-pptx'), 'portrait Keynote/PowerPoint', 'PK', 'pptx');
    expectFile(await desktop.exportAndCatch('portrait-images'), 'portrait images', 'PK', 'zip');

    // ── fitting ──────────────────────────────────────────────────────────
    say('── a fitting ──');
    await desktop.newProjectOfKind('BIG DAY — FITTING EXPORT', 'fitting', 2);
    await desktop.settle();
    await desktop.uploadPicture(0, 'ver', RED_PNG);
    await desktop.settle();
    expectFile(await desktop.exportAndCatch('fitting-pdf'), 'fitting PDF', '%PDF', 'pdf');
    expectFile(await desktop.exportAndCatch('fitting-pptx'), 'fitting Keynote/PowerPoint', 'PK', 'pptx');
    expectFile(await desktop.exportAndCatch('fitting-images'), 'fitting images', 'PK', 'zip');

    await desktop.close();
  });

// PART 8 — an offline day. Both devices lose the signal at once and work on
// the same project for a while, each on its own shots: a new shot, names,
// text, a picture, a drawing, needs, a note, a group, an order with a break.
// Then both come back. Nothing may be lost, nothing may be asked (they never
// touched the same order), and afterwards both hold the same whole project.
test('big day, part 8: an offline day — both work apart, both come back, nothing lost',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);
    type Shot = { label: string; text: string; picture: boolean; strokes: number; needsOn: string[]; noteCard: string;
      versions: Record<string, Array<{ strokes: number }>> };
    type Whole = { shots: Shot[]; groups: Array<{ name: string; shots: string[] }>;
      orders: Array<{ name: string; breaks: Array<{ text: string }> }> };
    const parse = (w: string) => JSON.parse(w) as Whole;

    const id = await desktop.newProjectOfKind('BIG DAY — OFFLINE', 'landscape', 8);
    await desktop.settle();
    expect(id, 'the project must reach the server').not.toBeNull();
    await ipad.openProject(id!);
    await ipad.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, 'OFFLINE: THE IPAD DOES NOT HOLD THE EIGHT SHOTS.');

    // ── the signal goes ──────────────────────────────────────────────────
    say('── both devices go offline ──');
    await desktop.offline(true);
    await ipad.offline(true);
    await desktop.page.waitForTimeout(3000);

    // ── the desktop's afternoon ──────────────────────────────────────────
    say('── desktop, offline: NEW after 2, names, text, picture, drawing, needs, note, group, order ──');
    await desktop.newFrameAfter(1);                            // 2#1 → nine shots
    await desktop.renameFrame(0, 'OPENING');
    await desktop.typeUnder(3, 'desk: wide');                   // shot "3" (index 3 now)
    // THE SIMULATOR CANNOT READ A FILE WHILE ITS AIRPLANE MODE IS ON (runs
    // 241–243: "NotReadableError: The I/O read operation failed" — the test's
    // file lives on the runner side and WebKit fetches it through a channel the
    // offline flag cuts; a real iPad reads a local file fine). So the picture
    // goes on through the store door here. What this part tests still holds:
    // a picture made offline is uploaded and reaches the other device.
    await desktop.putPicture(4, 'data:image/png;base64,' + RED_PNG);   // shot "4"
    await desktop.draw(5, 'ver', 0);                            // shot "5"
    await setNeeds(desktop.page, 6, ['ti_day1']);               // shot "6"
    await desktop.showNotes();
    await desktop.typeNote(7, 'desk note');                     // shot "7"
    const setA = await desktop.makeGroup('SET A', [0, 1]);
    await desktop.newSortOrder('DESK ORDER');
    const deskIdx = await desktop.orderIndexOf('DESK ORDER');
    await desktop.addBreak(deskIdx, 2, 'DESK BREAK');
    const deskMine = {
      whole: parse(await desktop.whole()),
      order: await desktop.orderTextByName('DESK ORDER'),
      group: await desktop.groupAsText(setA),
    };
    say(`   desktop holds ${deskMine.whole.shots.length} shots · ${deskMine.order} · ${deskMine.group}`);

    // ── the iPad's afternoon ─────────────────────────────────────────────
    say('── iPad, offline: names, text, drawing on ANGLE, needs, note, group, order ──');
    // Different SHOTS from the desktop's, except shot 3 — where the desktop
    // wrote text (the shot's record) and the iPad draws on ANGLE (a version):
    // two records, both must survive (#514). Two edits to the SAME record are
    // settled by the later one, by the rule, so the test does not do that here.
    await ipad.renameFrame(7, 'CLOSING');                       // shot "8"
    await ipad.setView('main');                                 // the iPad opens in 3x2; the text box lives on the main card
    await ipad.typeUnder(1, 'pad: close-up');                   // shot "2"
    await ipad.showStrip('floor');
    await ipad.draw(2, 'floor', 0);                             // shot "3" ANGLE — the desktop wrote under 3
    await setNeeds(ipad.page, 4, ['ti_day2']);                  // shot "5" (the iPad has no 2#1 yet, so index 4) — the desktop drew on 5's VER version
    await ipad.showNotes();
    await ipad.typeNote(1, 'pad note');                         // shot "2" (its own text is there too)
    const setB = await ipad.makeGroup('SET B', [5, 6]);
    await ipad.newSortOrder('PAD ORDER');
    const padMine = {
      order: await ipad.orderTextByName('PAD ORDER'),
      group: await ipad.groupAsText(setB),
    };
    say(`   iPad: ${padMine.order} · ${padMine.group}`);
    await desktop.push().catch(() => {});
    await ipad.push().catch(() => {});

    // ── the signal returns ───────────────────────────────────────────────
    say('── both come back online ──');
    await desktop.offline(false);
    await ipad.offline(false);
    await desktop.page.waitForTimeout(3000);
    const w = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'OFFLINE: THE TWO AFTERNOONS DID NOT MEET.', 120_000));
    const byLabel = (l: string) => w.shots.find((s) => s.label === l);
    say(`   shots on both: ${w.shots.map((s) => s.label).join(' ')}`);
    if (!byLabel('OPENING') || byLabel('4')?.picture !== true) {
      for (const d of [desktop, ipad]) {
        const lines = (await d.log()).filter((l) => /push|pull|change times|sending frames|accepted|older than|keep|mine\(newer\)|taking theirs|back online|offline|image|upload|picture|delta/i.test(l));
        say(`${d.name} log (newest first):\n${lines.slice(0, 50).map((l) => '    ' + l.slice(0, 190)).join('\n')}`);
      }
    }

    expect.soft(w.shots.length, 'nine shots: the desktop\'s NEW survived').toBe(9);
    expect.soft(byLabel('OPENING'), 'desktop\'s rename of 1').toBeTruthy();
    expect.soft(byLabel('CLOSING'), 'iPad\'s rename of 8').toBeTruthy();
    expect.soft(byLabel('3')?.text, 'desktop\'s text under 3').toBe('desk: wide');
    expect.soft(byLabel('2')?.text, 'iPad\'s text under 2').toBe('pad: close-up');
    expect.soft(byLabel('4')?.picture, 'desktop\'s picture on 4').toBe(true);
    expect.soft(byLabel('5')?.versions.ver?.[0]?.strokes ?? 0, 'desktop\'s drawing on 5').toBeGreaterThan(0);
    expect.soft(byLabel('3')?.versions.floor?.[0]?.strokes ?? 0, 'iPad\'s ANGLE drawing on 3').toBeGreaterThan(0);
    expect.soft(byLabel('6')?.needsOn, 'desktop\'s need on 6').toContain('ti_day1');
    expect.soft(byLabel('5')?.needsOn, 'iPad\'s need on 5 (the desktop drew on its version)').toContain('ti_day2');
    expect.soft(byLabel('7')?.noteCard, 'desktop\'s note on 7').toBe('desk note');
    expect.soft(byLabel('2')?.noteCard, 'iPad\'s note on 2').toBe('pad note');
    expect.soft(w.groups.map((g) => g.name).sort(), 'both groups').toEqual(['SET A', 'SET B']);
    expect.soft(w.orders.map((o) => o.name).sort(), 'both orders').toEqual(['DESK ORDER', 'PAD ORDER']);
    // The labels in an order's text follow the shots' names — and the OTHER
    // side renamed two shots — so the text is judged by its shape, not by the
    // text taken before the meet.
    const deskNow = await Device.waitUntilNamedOrdersAgree(desktop, ipad, 'DESK ORDER');
    expect.soft(deskNow, 'DESK ORDER keeps its break').toContain('[DESK BREAK]');
    expect.soft(deskNow, 'DESK ORDER keeps the new shot').toContain('2#1');
    const orderShots = async (name: string) => (await desktop.read()).orders.find((o) => o.name === name)?.frames.length ?? -1;
    expect.soft(await orderShots('DESK ORDER'), 'DESK ORDER holds nine shots').toBe(9);
    await Device.waitUntilNamedOrdersAgree(desktop, ipad, 'PAD ORDER');
    expect.soft(await orderShots('PAD ORDER'), 'PAD ORDER holds its eight shots').toBe(8);
    for (const d of [desktop, ipad]) {
      const asked = (await d.log()).find((l) => l.includes('decision(s) waiting'));
      expect.soft(asked, `${d.name} was asked a question though nobody touched the same order: ${asked}`).toBeUndefined();
      const lost = (await d.log()).find((l) => /FULL REPLACE|PULL FAILED/.test(l));
      expect.soft(lost, `${d.name} said something that must never be said: ${lost}`).toBeUndefined();
    }

    // ── reload both ──────────────────────────────────────────────────────
    say(`   before the reload — groups: ${w.groups.map((g) => g.name).join(' · ')} | orders: ${w.orders.map((o) => o.name).join(' · ')}`);
    const before = { desktop: (await desktop.log()).slice(0, 40), ipad: (await ipad.log()).slice(0, 40) };
    await desktop.reload();
    await ipad.reload();
    await desktop.openProject(id!);
    await ipad.openProject(id!);
    await desktop.settle();
    const fresh = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'OFFLINE: AFTER A RELOAD THE TWO DEVICES DIFFER.'));
    say(`   after the reload — groups: ${fresh.groups.map((g) => g.name).join(' · ')} | orders: ${fresh.orders.map((o) => o.name).join(' · ')}`);
    if (JSON.stringify(fresh) !== JSON.stringify(w)) {
      for (const d of ['desktop', 'ipad'] as const) {
        say(`${d} log before the reload (newest first):\n${before[d].map((l) => '    ' + l.slice(0, 200)).join('\n')}`);
      }
    }
    expect.soft(fresh, 'a reload changes nothing').toEqual(w);

    await desktop.close();
    await ipad.close();
  });


// PART 9 — restore points, delete and recover. A restore point made, more work
// done and seen on the iPad, then the desktop goes back to the point: the
// iPad follows. The project deleted on the desktop leaves the list on the
// server; recovered from the iPad, it is back whole on both.
test('big day, part 9: restore points, delete and recover a project, on both devices',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);
    type Whole = { shots: Array<{ label: string; text: string }> };
    const parse = (w: string) => JSON.parse(w) as Whole;

    const id = await desktop.newProjectOfKind('BIG DAY — RESTORE', 'landscape', 5);
    await desktop.settle();
    expect(id, 'the project must reach the server').not.toBeNull();
    await ipad.openProject(id!);
    await ipad.settle();
    await Device.waitUntilWholeAgrees(desktop, ipad, 'RESTORE: THE IPAD DOES NOT HOLD THE FIVE SHOTS.');

    // ── a point to come back to ──────────────────────────────────────────
    say('── desktop names shot 1 BEFORE and makes a restore point ──');
    await desktop.renameFrame(0, 'BEFORE');
    await desktop.push();
    await desktop.settle();
    await desktop.makeRestorePoint();
    const points = await desktop.restorePoints();
    say(`   restore points: ${points.length}`);
    expect(points.length, 'a restore point exists').toBeGreaterThan(0);
    const point = points.reduce((a, b) => (a.created_at >= b.created_at ? a : b));   // the newest = "here"
    const before = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'RESTORE: BEFORE DID NOT REACH THE IPAD.'));
    expect.soft(before.shots[0].label, 'BEFORE on both').toBe('BEFORE');

    // ── more work, seen on the iPad ──────────────────────────────────────
    say('── desktop: shot 1 → AFTER, text under 2, delete shot 5 ──');
    await desktop.renameFrame(0, 'AFTER');
    await desktop.typeUnder(1, 'later work');
    await desktop.deleteFrame(4);
    say(`   desktop straight after the delete: ${parse(await desktop.whole()).shots.length} shots`);
    await desktop.push();
    await desktop.settle();
    say(`   desktop after the push: ${parse(await desktop.whole()).shots.length} shots`);
    const after = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'RESTORE: THE LATER WORK DID NOT REACH THE IPAD.'));
    if (after.shots.length !== 4) {
      for (const d of [desktop, ipad]) {
        const lines = (await d.log()).filter((l) => /delet|tombstone|rescued|vanish|keep|push|pull|accepted|frames changed/i.test(l));
        say(`${d.name} log (newest first):\n${lines.slice(0, 40).map((l) => '    ' + l.slice(0, 190)).join('\n')}`);
      }
    }
    expect.soft(after.shots.length, 'four shots after the delete, on both').toBe(4);
    expect.soft(after.shots[0].label, 'AFTER on both').toBe('AFTER');

    // ── back to the point; the iPad follows ──────────────────────────────
    say('── desktop restores to the point ──');
    await desktop.restoreTo(point.id);
    await desktop.settle();
    const restored = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'RESTORE: THE IPAD DID NOT FOLLOW THE RESTORE.', 120_000));
    say(`   after the restore, both hold: ${restored.shots.map((s) => s.label).join(' ')}`);
    expect.soft(restored.shots.length, 'five shots again on both').toBe(5);
    expect.soft(restored.shots[0].label, 'BEFORE again on both').toBe('BEFORE');
    expect.soft(restored.shots[1].text, 'the later text is gone on both').toBe('');

    // ── a restore point SAVED by hand, named, kept, and deletable (#523) ──
    say('── desktop saves a restore point "BEFORE CUT"; it is in the list on both; then deletes it ──');
    await desktop.saveRestorePoint('BEFORE CUT');
    let saved = (await desktop.restorePoints()).filter((p) => p.reason === 'saved');
    expect.soft(saved.map((p) => p.label), 'the saved point is listed with its name').toContain('BEFORE CUT');
    const savedOnIpad = (await ipad.restorePoints()).filter((p) => p.reason === 'saved');
    expect.soft(savedOnIpad.map((p) => p.label), 'the iPad sees the saved point too').toContain('BEFORE CUT');
    const auto = (await desktop.restorePoints()).find((p) => p.reason !== 'saved');
    if (auto) {
      await desktop.deleteRestorePoint(auto.id);      // the ✕ is for saved points only
      expect.soft((await desktop.restorePoints()).some((p) => p.id === auto.id), 'an automatic point cannot be deleted by hand').toBe(true);
    }
    await desktop.deleteRestorePoint(saved[0].id);
    saved = (await desktop.restorePoints()).filter((p) => p.reason === 'saved');
    expect.soft(saved.length, 'the saved point is gone after its ✕').toBe(0);

    // ── delete on the desktop, recover from the iPad ─────────────────────
    say('── iPad moves to another project; desktop deletes RESTORE; iPad recovers it ──');
    const other = await ipad.newProjectOfKind('BIG DAY — OTHER', 'landscape', 2);
    await ipad.settle();
    expect(other, 'the other project must reach the server').not.toBeNull();
    await desktop.deleteThisProject();
    await desktop.page.waitForTimeout(1500);
    let listed = await Device.projectsWithState(token);
    say(`   the server's list: ${listed.map((p) => `${p.name}${p.deleted ? ' (deleted)' : ''}`).join(' · ')}`);
    expect.soft(listed.find((p) => p.name === 'BIG DAY — RESTORE')?.deleted, 'RESTORE is deleted on the server').toBe(true);
    expect.soft((await desktop.read()).frames.length, 'the desktop shows nothing of it any more').toBe(0);

    await ipad.recoverProject(id!);
    await ipad.page.waitForTimeout(1000);
    listed = await Device.projectsWithState(token);
    expect.soft(listed.find((p) => p.name === 'BIG DAY — RESTORE')?.deleted, 'RESTORE is back on the server').toBe(false);
    await ipad.openProject(id!);
    await ipad.settle();
    await desktop.openProject(id!);
    await desktop.settle();
    const back = parse(await Device.waitUntilWholeAgrees(desktop, ipad, 'RESTORE: THE RECOVERED PROJECT DIFFERS BETWEEN THE DEVICES.'));
    expect.soft(back, 'the recovered project is what it was').toEqual(restored);

    await desktop.close();
    await ipad.close();
  });

// PART 10 — the closing pass. Three projects of three kinds, made from both
// sides; each worked on by the device that did NOT make it, while the other
// device is on a different project; then switched around, then both devices
// reloaded — and every project must read identically on both, and exactly as
// it did before the reload. The day ends with nothing left on one device only.
test('big day, part 10: the closing pass — switching, reloading, every project identical on both devices',
  async ({ browser }) => {
    const { token } = await freshAccount();
    const desktop = await Device.open(browser, 'desktop', token);
    const ipad = await Device.open(browser, 'ipad', token, true);
    type Whole = { name: string | null; kind: string; shots: Array<{ label: string; text: string; picture: boolean }>;
      groups: Array<{ name: string; shots: string[] }> };
    const parse = (w: string) => JSON.parse(w) as Whole;
    const agreed: Record<string, string> = {};   // the last agreed text of each project

    // ── three projects, from both sides ──────────────────────────────────
    say('── desktop makes A (landscape) and C (fitting); iPad makes B (portrait) ──');
    const A = await desktop.newProjectOfKind('BIG DAY — A LANDSCAPE', 'landscape', 4);
    await desktop.settle();
    const B = await ipad.newProjectOfKind('BIG DAY — B PORTRAIT', 'portrait', 3);
    await ipad.settle();
    const C = await desktop.newProjectOfKind('BIG DAY — C FITTING', 'fitting', 3);
    await desktop.settle();
    expect(A, 'A must reach the server').not.toBeNull();
    expect(B, 'B must reach the server').not.toBeNull();
    expect(C, 'C must reach the server').not.toBeNull();

    // ── each worked on by the OTHER device, while the two are on different projects ──
    say('── iPad works on A while the desktop works on C ──');
    await ipad.openProject(A!);
    await ipad.settle();
    await ipad.setView('main');
    await ipad.renameFrame(0, 'A ONE');
    await ipad.typeUnder(1, 'from the ipad');
    await ipad.putPicture(2, 'data:image/png;base64,' + RED_PNG);
    await ipad.settle();
    await desktop.renameFrame(0, 'C ONE');
    await desktop.typeUnder(1, 'fitting notes');
    await desktop.settle();

    say('── desktop comes to A: the iPad\'s work is there ──');
    await desktop.openProject(A!);
    await desktop.settle();
    let w = parse(agreed.A = await Device.waitUntilWholeAgrees(desktop, ipad, 'CLOSING: A DIFFERS BETWEEN THE DEVICES.'));
    say(`   A on both: ${w.shots.map((s) => `${s.label}${s.text ? `(${s.text})` : ''}${s.picture ? '📷' : ''}`).join(' · ')}`);
    expect.soft(w.name, 'A keeps its name').toBe('BIG DAY — A LANDSCAPE');
    expect.soft(w.shots[0].label, 'A ONE on both').toBe('A ONE');
    expect.soft(w.shots[1].text, 'the iPad\'s text on both').toBe('from the ipad');
    expect.soft(w.shots[2].picture, 'the iPad\'s picture on both').toBe(true);

    say('── both come to C: the desktop\'s work is there ──');
    await ipad.openProject(C!);
    await ipad.settle();
    await desktop.openProject(C!);
    await desktop.settle();
    w = parse(agreed.C = await Device.waitUntilWholeAgrees(desktop, ipad, 'CLOSING: C DIFFERS BETWEEN THE DEVICES.'));
    say(`   C on both: ${w.shots.map((s) => `${s.label}${s.text ? `(${s.text})` : ''}`).join(' · ')}`);
    expect.soft(w.kind, 'C stays a fitting').toBe('fitting');
    expect.soft(w.shots[0].label, 'C ONE on both').toBe('C ONE');
    expect.soft(w.shots[1].text, 'the desktop\'s text on both').toBe('fitting notes');

    say('── both come to B: desktop renames and makes a group; iPad types ──');
    await desktop.openProject(B!);
    await desktop.settle();
    await ipad.openProject(B!);
    await ipad.settle();
    await ipad.setView('main');
    await desktop.renameFrame(0, 'B ONE');
    await desktop.makeGroup('B GROUP', [0, 1]);
    await desktop.settle();
    await ipad.typeUnder(2, 'last words');
    await ipad.settle();
    w = parse(agreed.B = await Device.waitUntilWholeAgrees(desktop, ipad, 'CLOSING: B DIFFERS BETWEEN THE DEVICES.'));
    say(`   B on both: ${w.shots.map((s) => `${s.label}${s.text ? `(${s.text})` : ''}`).join(' · ')} | groups: ${w.groups.map((g) => `${g.name}[${g.shots.join(',')}]`).join(' ')}`);
    expect.soft(w.kind, 'B stays a portrait').toBe('portrait');
    expect.soft(w.shots[0].label, 'B ONE on both').toBe('B ONE');
    expect.soft(w.groups.map((g) => g.name), 'B GROUP on both').toContain('B GROUP');
    expect.soft(w.shots[2].text, 'last words on both').toBe('last words');

    // ── work done on A while the other device is elsewhere must be there when it comes ──
    say('── desktop goes back to A and renames shot 2 while the iPad stays on B ──');
    await desktop.openProject(A!);
    await desktop.settle();
    await desktop.renameFrame(1, 'A TWO');
    await desktop.settle();
    await ipad.openProject(A!);
    await ipad.settle();
    w = parse(agreed.A = await Device.waitUntilWholeAgrees(desktop, ipad, 'CLOSING: A TWO DID NOT REACH THE IPAD.'));
    expect.soft(w.shots[1].label, 'A TWO on both').toBe('A TWO');
    expect.soft(w.shots[1].text, 'the iPad\'s text survived the rename').toBe('from the ipad');

    // ── reload both; every project identical, and exactly as before ──────
    say('── both devices reload; every project must read as it did ──');
    await desktop.reload();
    await ipad.reload();
    for (const [name, id] of [['A', A!], ['B', B!], ['C', C!]] as Array<[string, string]>) {
      await desktop.openProject(id);
      await desktop.settle();
      await ipad.openProject(id);
      await ipad.settle();
      const now = await Device.waitUntilWholeAgrees(desktop, ipad, `CLOSING: AFTER THE RELOAD, ${name} DIFFERS BETWEEN THE DEVICES.`);
      expect.soft(now, `${name} after the reload is exactly what it was`).toBe(agreed[name]);
    }

    const listed = await Device.projectNames(token);
    for (const n of ['BIG DAY — A LANDSCAPE', 'BIG DAY — B PORTRAIT', 'BIG DAY — C FITTING']) {
      expect.soft(listed, `"${n}" is on the server's list`).toContain(n);
    }

    await desktop.close();
    await ipad.close();
  });

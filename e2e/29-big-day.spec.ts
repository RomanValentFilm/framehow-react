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
      say(`desktop log:\n${(await desktop.log()).slice(-40).map((l) => '    ' + l).join('\n')}`);
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

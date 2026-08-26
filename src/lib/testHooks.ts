// THE SIMULATOR'S HANDS (#309).
//
// A test that clicks pixels breaks every time a button moves, and one that
// re-implements what a button does is a copy that drifts from the app — which is
// exactly the weakness of the benches we already have: their "device" is my
// impression of the app, not the app.
//
// So the browser tests drive the REAL functions, the same ones the buttons call,
// through this one small door. Nothing here contains a rule or a decision: every
// function is a pass-through. If a test passes, it passed against the code that
// ships.
//
// The door only exists when it is asked for — `?fhtest=1` in the address — so a
// real user never has it. And it is deliberately tiny: anything that grows a
// decision of its own belongs in the app, where the app's own tests can see it.

import { useStore } from '../store/state';
import type { SortOrder, StripType } from '../store/state';
import { getVisibleFrames, createGroup, enterGroup } from './groups';
import { ensureStripVersions, getStripVersions } from './helpers';
import { openFullscreen, closeFullscreen } from './fullscreen';
import { setViewMode } from './view';
import { openSortEditView, closeSortMode, openOrderView, addNewOrder, toggleSortDropdown } from './sortOrder';
import { toggleScribbleMode, attachScribbleOverlays } from './scribble';
import { trace } from './syncTrace';
import { startFromScratch } from './files';
import { deleteFrameForGood } from './actions';
import { createSetup, handleSetupFrameClick, handleStripTagClick } from './setups';
import { renameNeedTab, renameNeedTable, renameNeedItem } from './needs';
import { saveNow, openCloudProjectById } from './accountFlow';
import { flushSyncNow, markFrameDirty, getDirtyFrameIds } from './currentProject';
import { stampChangedContent } from './changeStamps';
import { stampChangedSettings } from './projectSettings';
import { setProjectName, getCurrentProject } from './currentProject';

function on(): boolean {
  try {
    if (/fhtest=1/.test(location.search)) { localStorage.setItem('fh_test', '1'); return true; }
    return localStorage.getItem('fh_test') === '1';
  } catch { return false; }
}

/** Everything the browser tests are allowed to do, and nothing more. */
export interface TestDoor {
  /** A new project of `count` frames, named, exactly as the New Project modal
   *  makes one. Then the real save, which creates it on the server. */
  newProject(name: string, count: number): Promise<string | null>;
  /** Open a project the server already has — what the second device does, and
   *  what the project list does when you tap a name. */
  openProject(id: string): Promise<void>;
  /** Write under a frame, by its place on screen (0 = first). The same store
   *  write the text editor makes, followed by the same stamping the autosave
   *  does — so the change carries an honest time. */
  writeUnder(index: number, text: string): void;
  /** Move a frame from one place to another. The arrangement is one item now
   *  (#294), so this is simply the order of the frames. */
  moveFrame(from: number, to: number): void;
  /** Rename a NEEDS category by its place in the list. */
  renameCategory(index: number, name: string): void;
  /** Rename a column inside a category, as clicking its heading does (#388). */
  renameNeedTable(tableId: string, name: string): void;
  /** Rename one item inside a column, as clicking its name does (#388). */
  renameNeedItem(tableId: string, itemId: string, name: string): void;
  /** Every column heading in a category, as they read on screen. */
  needTables(categoryIndex: number): string[];
  /** Every item name inside one column. */
  needItems(tableId: string): string[];
  /** Delete a frame for good, by its place on screen. The same function the
   *  DELETE choice calls, tombstones and all — not a copy of it. */
  deleteFrame(index: number): void;
  /** Make a setup, exactly as the CREATE button does. Returns its id. */
  newSetup(name: string, colorIndex?: number): string;

  // --- setups on frames and versions (#375) --------------------------------

  /** Put the currently chosen setup on a frame, as tapping the frame in SETUPS
   *  mode does. Choosing which setup is active is part of it. */
  putSetupOnFrame(frameIndex: number, setupId: string): void;

  /** Tag a version with the frame's setup, as tapping its TAG pill does. */
  tagVersion(frameIndex: number, strip?: StripType, versionIndex?: number): void;

  /** What the version's tag says now: 'none', or the name of the setup whose
   *  colour it is wearing. This is what the person actually sees. */
  versionTag(frameIndex: number, strip?: StripType, versionIndex?: number): string;
  /** Put a break in the STORY FLOW at a place in the frame order (#337). */
  addStoryBreak(position: number, text: string): string;

  // --- shooting orders -----------------------------------------------------
  // An order is ONE settings item, breaks and all (see projectSettings, where
  // each order is pushed whole under `sortOrder:<id>`). So two devices editing
  // the same order do not merge — the later one wins entire. These doors exist
  // to prove that is what actually happens, and that nothing else is dragged
  // down with it.

  /** Press + ADD ORDER. The order holds every frame the view is showing, which
   *  inside a group means that group's frames. Returns its id. */
  newSortOrder(name?: string): string;
  // --- groups and the orders made inside them (#382) ------------------------
  /** Make a group holding the frames at these positions. Returns its id. */
  makeGroup(name: string, frameIndexes: number[]): number;
  /** Go into a group, or back to ALL with null — the sidebar's own call. */
  enterGroup(groupId: number | null): void;
  /** Which group the view is in, null for ALL. */
  whichGroup(): number | null;
  /** The group name as it reads in the view bar, or null if it is not there. */
  groupLabelOnScreen(): string | null;
  /** Choose an order from the SORT BY menu, as clicking its line does. */
  pickOrder(orderIndex: number): void;
  /** Choose a story flow line: null for the project's, or a group's id. */
  pickStoryFlow(groupId: number | null): void;
  /** Each line of the SORT BY menu as text, e.g. "SHOOTING ORDER 2 / KITCHEN". */
  sortMenuLines(): string[];
  /** Move a frame inside an order — the drag in the sort edit view. */
  moveInOrder(orderIndex: number, from: number, to: number): void;
  /** ADD BREAK, at a place in the order. Returns the break's id. */
  addBreak(orderIndex: number, position: number, text: string): string;
  /** Drag a break to a different place. */
  moveBreak(orderIndex: number, breakIndex: number, toPosition: number): void;
  // --- the pen (#356) ------------------------------------------------------
  // Roman's report: "the moment you draw it disappears". Every guess I made
  // about it was a guess, because nothing in the simulator could hold a pencil.
  // These two doors are what let a test draw a real stroke on the real canvas,
  // through the app's own drawing code, and then ask the PROJECT whether the
  // stroke is actually in it.
  //
  // Nothing here decides anything. It opens the version the way the DRAW button
  // does, and it moves a finger across the canvas the way a finger does. Every
  // rule about what a stroke is, where it is kept and when it counts as unsent
  // belongs to the app.

  /** Draw one stroke on a version, and say how many strokes that version then
   *  holds. Opens the real fullscreen drawing view, dispatches real pointer
   *  events on the real canvas, and closes it again. */
  drawOnVersion(frameIndex: number, strip?: StripType, versionIndex?: number): Promise<number>;

  /** How many strokes the PROJECT holds for that version — read from the store,
   *  not from the screen, so a test cannot be fooled by a stale picture. */
  strokeCount(frameIndex: number, strip?: StripType, versionIndex?: number): number;

  /** WHAT THE CARD IS SHOWING (#356). The other half of the question, and the
   *  half every test so far was blind to: 'main', or 'ver 2' and so on. Roman's
   *  drawings were never lost — the card simply stopped showing the version they
   *  were on, which to the person holding the iPad is the same thing. */
  cardShowing(frameIndex: number): string;

  /** Which view the app is in: 'grid3x2', 'main', 'overview'… */
  viewMode(): string;

  /** WHERE THE PAGE IS (#363). How far down whatever is scrolling right now.
   *  A test can watch this across an action and insist it did not move. */
  scrollPosition(): number;

  /** Scroll the page, as a finger does. */
  scrollTo(y: number): void;

  /** WHICH thing is doing the scrolling — so a test can say what it measured
   *  instead of me assuming (#363). */
  scrollerName(): string;

  /** Cross-swipe a card to its version, as a finger across the canvas does. */
  swipeCard(frameIndex: number): void;

  /** Press one of the view buttons. The app's own function, so the rule about
   *  what a view change does to the screen is the app's, not a copy. */
  setView(mode: string): void;

  /** Open a shooting order for editing, as tapping its name does (#357). */
  openOrder(orderIndex: number): void;

  /** Which shooting order is open for editing, or null. This is the thing a
   *  pull was quietly closing — and being thrown out of it is what put Roman
   *  back in 3x2 while he was naming a break. */
  orderBeingEdited(): string | null;

  /** Close it, as pressing done does. Fetching held while it was open catches
   *  up now (#380). */
  closeOrder(): void;

  /** LOOK at a strip, as showing it on screen does (#358). Nothing is created
   *  by a person here — this is only the app preparing the strip to be drawn. */
  lookAtStrip(frameIndex: number, strip: StripType): void;

  /** The version tabs on a frame, as they read on screen: ['v1', 'v2'…]. */
  versionLabels(frameIndex: number, strip?: StripType): string[];

  // --- the flash (#360) ----------------------------------------------------

  /** Put a picture on a version, as loading one from the camera roll does. */
  putPicture(frameIndex: number, dataUrl: string): void;

  /** Is the card's canvas showing NOTHING at this instant? This is how a test
   *  sees the flash: watch it across a sync, and it must never be blank. */
  cardIsBlank(frameIndex: number, strip?: StripType, versionIndex?: number): boolean;

  // --- scribble (#361) -----------------------------------------------------

  /** Turn the pencil on or off, as the toolbar button does. */
  setScribbleMode(on: boolean): void;

  /** Draw one scribble stroke across a card, with real pointer events on the
   *  real overlay. Returns how many scribble strokes that frame then holds. */
  scribbleOn(frameIndex: number): number;

  /** The same stroke, but held open: put the pen down and move it, and stop.
   *  Whatever happens next — a sync, a redraw — happens with the pen down, which
   *  is the state nothing in the app currently knows about. */
  scribbleStart(frameIndex: number): void;
  /** Lift the pen. Returns how many strokes the frame then holds. */
  scribbleEnd(frameIndex: number): number;

  /** How many scribble strokes a frame holds. */
  scribbleCount(frameIndex: number): number;

  /** A quick small mark — a tick, a short dash — made with a finger. Fast, and
   *  it never gets far from where it started, which is what the app measures. */
  scribbleQuickTick(frameIndex: number): void;

  /** How far the frame's last scribble stroke travels, as a share of the card.
   *  A real mark has a span. A dot has none. */
  lastScribbleSpan(frameIndex: number): number;

  /** Send whatever is unsent, now, without waiting for the debounce. */
  push(): Promise<void>;
  /** What is on screen, in order, as plain facts a test can compare. */
  read(): {
    projectId: string | null;
    frames: Array<{ id: string; serverFrameId?: string; label: string; text: string }>;
    categories: string[];
    setups: string[];
    storyBreaks: Array<{ id: string; text: string; position: number }>;
    unsent: string[];
    orders: Array<{
      id: string;
      name: string;
      /** The frame LABELS in this order, not the internal numbers — a test that
       *  compares numbers compares things the two devices never agreed on. */
      frames: string[];
      breaks: Array<{ id: string; text: string; position: number }>;
    }>;
  };
}

/**
 * Whichever column or page is doing the scrolling right now (#363).
 *
 * Asked by MEASURING rather than by guessing from the view: the first attempt
 * named the column it thought was scrolling, set a position on it, and got
 * nothing — because in that view the whole window scrolls, not the column. So
 * this looks for something that is actually taller than its own frame, and
 * settles for the window if nothing is.
 */
function whatIsScrolling(): HTMLElement | null {
  const ids = ['overviewScroll', 'mainScroll', 'versionsScroll', 'floorScroll', 'refsScroll'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.scrollHeight > el.clientHeight + 4) return el;
  }
  const doc = document.scrollingElement as HTMLElement | null;
  if (doc && doc.scrollHeight > doc.clientHeight + 4) return doc;
  return null;
}

/** Where to put the pen for a given frame's card, on whichever scribble layer is
 *  on the page RIGHT NOW. Looked up fresh every time on purpose (#361). */
function scribbleAim(frameIndex: number): {
  cvs: HTMLCanvasElement;
  at: (dx: number, dy: number) => PointerEventInit;
} {
  const f = useStore.getState().frames[frameIndex];
  if (!f) throw new Error(`no frame at ${frameIndex}`);
  const card = document.querySelector(`.grid3x2-card-wrap[data-g3fid="${f.id}"]`) as HTMLElement | null;
  if (!card) throw new Error(`frame ${frameIndex} has no card in the 3x2 grid — `
    + `the pencil only exists there`);
  const cvs = document.querySelector('.scribble-page-canvas') as HTMLCanvasElement | null;
  if (!cvs) throw new Error('the scribble layer is not on the page');
  const r = card.getBoundingClientRect();
  return {
    cvs,
    at: (dx: number, dy: number) => ({
      clientX: r.left + r.width * dx,
      clientY: r.top + r.height * dy,
      bubbles: true,
      pointerId: 1,
      pointerType: 'pen',
      isPrimary: true,
    }),
  };
}

/** Change one shooting order in place, then stamp it — every order door goes
 *  through here so none of them can forget the "when". */
function editOrder(orderIndex: number, change: (o: SortOrder) => SortOrder): void {
  const s = useStore.getState();
  const target = s.sortOrders[orderIndex];
  if (!target) throw new Error(`no shooting order at ${orderIndex}`);
  useStore.setState({
    sortOrders: s.sortOrders.map((o, i) => (i === orderIndex ? change(o) : o)),
  } as never);
  stampChangedSettings(getCurrentProject().projectId);
  (window as never as { __fh_renderAll?: () => void }).__fh_renderAll?.();
}

/**
 * WATCH WHO SENDS A CARD BACK TO THE MAIN FRAME (#368).
 *
 * Only with the test door open, so a real user never has this.
 *
 * Four explanations have been ruled out by tracing: the close sets the card
 * correctly and the project has not been replaced; the rebuild says it never
 * moved a card; and at the last instant before the rebuild the card is ALREADY
 * back on the main frame. So the write happens somewhere nobody has looked, and
 * naming suspects has cost four runs.
 *
 * This wraps the map itself and says who wrote what, from where. The map is
 * replaced wholesale on every pull, so it is re-wrapped whenever that happens.
 */
function watchWhoMovesCards(): void {
  let wrapped: object | null = null;
  const wrap = () => {
    const s = useStore.getState() as unknown as { crossCompare: Record<number, number> };
    const live = s.crossCompare;
    if (!live || live === wrapped) return;
    const spy = new Proxy(live, {
      set(target, prop, value) {
        const who = new Error().stack?.split('\n')[2]?.trim().replace(/^at /, '') ?? '?';
        trace(`card ${String(prop)} → ${String(value)}   (${who.slice(0, 70)})`);
        return Reflect.set(target, prop, value);
      },
    });
    wrapped = spy;
    useStore.setState({ crossCompare: spy, stripCrossCompare: {
      ...(useStore.getState() as never as { stripCrossCompare: Record<string, unknown> }).stripCrossCompare,
      ver: spy,
    } } as never);
  };
  wrap();
  setInterval(wrap, 200);
}

export function installTestDoor(): void {
  if (!on()) return;
  // watchWhoMovesCards() is deliberately NOT called: it replaces the map it is
  // watching, which is the very thing being investigated, so it changes the
  // answer. It stays for the next time a card moves for no visible reason —
  // useful, but only with that in mind.
  void watchWhoMovesCards;

  const door: TestDoor = {
    async newProject(name, count) {
      startFromScratch();
      // startFromScratch makes one frame; add the rest the same way the store holds them
      const first = useStore.getState().frames[0];
      if (!first) return null;
      const extra = Array.from({ length: Math.max(0, count - 1) }, (_, i) => ({
        ...first,
        id: first.id + i + 1,
        label: String(i + 2),
        serverFrameId: undefined,
        serverMainVersionId: undefined,
      }));
      useStore.setState({ frames: [first, ...extra] } as never);
      setProjectName(name);
      (window as never as { __fh_renderAll?: () => void }).__fh_renderAll?.();
      await saveNow();
      return getCurrentProject().projectId;
    },

    async openProject(id) { await openCloudProjectById(id); },

    writeUnder(index, text) {
      const s = useStore.getState();
      const f = s.frames[index];
      if (!f) throw new Error(`no frame at ${index}`);
      useStore.setState({
        frames: s.frames.map((x, i) => (i === index ? { ...x, textContent: text } : x)),
      } as never);
      if (f.serverFrameId) markFrameDirty(f.serverFrameId);
      stampChangedContent();          // the honest "when" — as the autosave does
    },

    moveFrame(from, to) {
      const s = useStore.getState();
      const frames = [...s.frames];
      const [moved] = frames.splice(from, 1);
      if (!moved) throw new Error(`no frame at ${from}`);
      frames.splice(to, 0, moved);
      useStore.setState({ frames } as never);
      stampChangedSettings(getCurrentProject().projectId);
      (window as never as { __fh_renderAll?: () => void }).__fh_renderAll?.();
    },

    // A COPY UNTIL #388, AND IT HID A REAL FAULT FOR WEEKS.
    //
    // This built new objects, put them in the store and stamped them — which is
    // what a rename SHOULD do, and not what any of the app's renames did. So
    // "a renamed category reaches the other device" passed while renaming one
    // by hand never left the device at all.
    renameCategory(index, name) {
      const tab = useStore.getState().needDefinitions?.tabs?.[index];
      if (!tab) throw new Error(`no category at ${index}`);
      renameNeedTab(tab.id, name);
    },

    /** Rename a column inside a category, as clicking its heading does. */
    renameNeedTable(tableId, name) {
      renameNeedTable(tableId, name);
    },

    /** Rename one item inside a column, as clicking its name does. */
    renameNeedItem(tableId, itemId, name) {
      renameNeedItem(tableId, itemId, name);
    },

    /** Every column heading in a category, as they read on screen. */
    needTables(categoryIndex) {
      const tab = useStore.getState().needDefinitions?.tabs?.[categoryIndex];
      if (!tab) throw new Error(`no category at ${categoryIndex}`);
      return tab.tables.map((t) => t.name);
    },

    /** Every item name inside one column. */
    needItems(tableId) {
      for (const tab of useStore.getState().needDefinitions?.tabs ?? []) {
        const t = tab.tables.find((x) => x.id === tableId);
        if (t) return t.items.map((i) => i.name);
      }
      throw new Error(`no column called ${tableId}`);
    },

    // PRESSES + ADD ORDER, IT DOES NOT BUILD AN ORDER (#382).
    //
    // This used to assemble a SortOrder here, field by field. It was a copy of
    // the app's own creation and it had already drifted: the app stamps the
    // group an order is made in, and a copy made here never would — so a test
    // could pass while the real button was broken. Every door is a pass-through
    // to the real function, and this one was not.
    //
    // The name is set afterwards, because the button names orders itself.
    newSortOrder(name) {
      // THE NAME GOES IN AT BIRTH, IT IS NOT SET AFTERWARDS (#382).
      //
      // Renaming after the fact looked harmless and was not: making an order
      // pushes it, so the placeholder name reached the server and the other
      // device before the real one replaced it. The tablet then had an order
      // that existed for a few seconds and vanished, which the random day
      // reports as `shooting order "SHOOTING ORDER 2" disappeared`. It is also
      // why a name set this way never seemed to travel.
      addNewOrder(name);
      const made = useStore.getState().sortOrders.slice(-1)[0];

      // + ADD ORDER also OPENS the order it just made, which the copy this
      // replaced did not do. Six tests written against the copy expect this
      // door to mean "an order now exists" and nothing more, so it is closed
      // again here. A test that wants it open opens it, as a person would.
      closeSortMode();

      stampChangedSettings(getCurrentProject().projectId);
      return made.id;
    },

    // PICKS AN ORDER OUT OF THE SORT BY MENU — the same call the menu makes,
    // so whatever choosing an order does to the view happens here too (#382).
    // Choose a story flow line: null for the project's, or a group's id. The
    // same call the menu makes, so the switching is the app's, not the test's.
    pickStoryFlow(groupId) {
      openOrderView(groupId === null ? '__storyflow__' : `__storyflow__:${groupId}`);
    },

    pickOrder(orderIndex) {
      const o = useStore.getState().sortOrders[orderIndex];
      if (!o) throw new Error(`no shooting order at ${orderIndex}`);
      openOrderView(o.id);
    },

    makeGroup(name, frameIndexes) {
      const s = useStore.getState();
      const ids = frameIndexes.map((i) => {
        const f = s.frames[i];
        if (!f) throw new Error(`no frame at ${i}`);
        return f.id;
      });
      const gid = createGroup(name, ids);
      stampChangedSettings(getCurrentProject().projectId);
      return gid;
    },

    enterGroup(groupId) {
      enterGroup(groupId);
    },

    whichGroup() { return useStore.getState().activeGroupId; },

    // WHAT THE VIEW BAR ACTUALLY SAYS, off the screen itself — not what the
    // store thinks (#383). Roman: picking a group's order opens the order but
    // the group's name does not appear next to the GROUP button. The store and
    // the screen have to be asked separately or there is no way to tell which
    // of the two is wrong.
    groupLabelOnScreen() {
      const el = document.getElementById('groupActiveLabel');
      if (!el) return null;
      // ASK WHETHER IT IS ON SCREEN, NOT WHETHER IT IS HIDDEN.
      //
      // This first asked getComputedStyle(el).display, which was worthless: an
      // element inside a hidden parent still reports its OWN display. The label
      // is written into the view bar, and the view bar is what gets hidden — so
      // the door said the name was on screen while Roman was looking at a
      // screen with no name on it, and the test passed on a real fault.
      //
      // getClientRects() is empty for anything that takes up no space on the
      // page, whatever the reason: itself hidden, a parent hidden, or never
      // laid out at all.
      if (el.getClientRects().length === 0) return null;
      return el.textContent ?? '';
    },

    // THE MENU AS IT IS ACTUALLY DRAWN (#383).
    //
    // This used to walk the store and build the lines itself, which is a copy
    // of renderDropdown and would have said nothing about whether the menu on
    // screen was right. It now opens the real menu, reads what is in it, and
    // closes it again — so a line that is missing here is missing on screen.
    //
    // A separator comes back as "---".
    sortMenuLines() {
      const dd = document.getElementById('sortDropdown');
      if (!dd) return [];
      const wasOpen = dd.style.display !== 'none';
      if (!wasOpen) toggleSortDropdown();

      const lines: string[] = [];
      dd.querySelectorAll('.sort-dd-sep, .sort-dd-item').forEach((el) => {
        if (el.classList.contains('sort-dd-sep')) { lines.push('---'); return; }
        if (el.classList.contains('sort-dd-add')) { lines.push('+ ADD ORDER'); return; }
        const title = el.querySelector('.sort-dd-title')?.textContent?.trim() ?? '';
        const grp = el.querySelector('.sort-dd-group')?.textContent?.trim() ?? '';
        lines.push(grp ? `${title} ${grp}` : title);
      });

      if (!wasOpen) toggleSortDropdown();
      return lines;
    },

    moveInOrder(orderIndex, from, to) {
      editOrder(orderIndex, (o) => {
        const frameOrder = [...o.frameOrder];
        const [moved] = frameOrder.splice(from, 1);
        if (moved === undefined) throw new Error(`no frame at ${from} in order ${orderIndex}`);
        frameOrder.splice(to, 0, moved);
        return { ...o, frameOrder };
      });
    },

    addBreak(orderIndex, position, text) {
      const id = `brk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      editOrder(orderIndex, (o) => ({ ...o, breaks: [...o.breaks, { id, text, position }] }));
      return id;
    },

    moveBreak(orderIndex, breakIndex, toPosition) {
      editOrder(orderIndex, (o) => {
        if (!o.breaks[breakIndex]) throw new Error(`no break at ${breakIndex}`);
        return {
          ...o,
          breaks: o.breaks.map((b, i) => (i === breakIndex ? { ...b, position: toPosition } : b)),
        };
      });
    },

    deleteFrame(index) {
      const f = useStore.getState().frames[index];
      if (!f) throw new Error(`no frame at ${index}`);
      deleteFrameForGood(f.id);
    },

    newSetup(name, colorIndex = 0) { return createSetup(name, colorIndex); },

    putSetupOnFrame(frameIndex, setupId) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      // Being IN setups mode, with that setup chosen and open for editing, and
      // then tapping the frame. All three are required — the app quite properly
      // ignores a tap that arrives without them, which is why the first version
      // of this door did nothing at all.
      useStore.setState({
        setupMode: true, setupEditing: true, activeSetupId: setupId,
      } as never);
      handleSetupFrameClick(f.id);
    },

    tagVersion(frameIndex, strip = 'ver', versionIndex = 0) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      ensureStripVersions(f.id, strip);
      // The pill asks for confirmation the first time; a person who has said
      // "don't ask again" gets the tag straight away, and so does this.
      useStore.setState({ stripTagInfoDismissed: true } as never);
      handleStripTagClick(f.id, versionIndex, strip);
    },

    versionTag(frameIndex, strip = 'ver', versionIndex = 0) {
      const s = useStore.getState();
      const f = s.frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      const ver = getStripVersions(f.id, strip)[versionIndex];
      if (!ver || !ver.setupTagged) return 'none';
      // A tag has no colour of its own — it wears whatever setup the MAIN frame
      // is currently in. That is exactly the thing under suspicion, so the door
      // reports what the person would see rather than what is stored.
      const setup = s.setups.find((su) => su.id === f.setupId);
      return setup ? setup.name : 'none';
    },

    addStoryBreak(position, text) {
      const id = `brk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const s = useStore.getState();
      useStore.setState({
        storyFlowBreaks: [...(s.storyFlowBreaks ?? []), { id, text, position }],
      } as never);
      stampChangedSettings(getCurrentProject().projectId);
      return id;
    },

    async drawOnVersion(frameIndex, strip = 'ver', versionIndex = 0) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      ensureStripVersions(f.id, strip);
      closeFullscreen();                       // in case one is already up
      openFullscreen(f.id, versionIndex, strip, 'draw');

      const cvs = document.getElementById(`fs_cvs_${f.id}_${versionIndex}`) as HTMLCanvasElement | null;
      if (!cvs) throw new Error(
        `the drawing canvas never appeared for frame ${frameIndex} (${strip} ${versionIndex + 1}). `
        + `On screen: ${Array.from(document.querySelectorAll('canvas')).map((c) => c.id).join(', ') || 'no canvas at all'}`);

      const r = cvs.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) throw new Error('the drawing canvas has no size on screen');
      const at = (dx: number, dy: number) => ({
        clientX: r.left + r.width * dx,
        clientY: r.top + r.height * dy,
        bubbles: true,
      });
      // A stroke is a press, a few movements and a release — one short line.
      cvs.dispatchEvent(new MouseEvent('mousedown', at(0.2, 0.2)));
      cvs.dispatchEvent(new MouseEvent('mousemove', at(0.4, 0.4)));
      cvs.dispatchEvent(new MouseEvent('mousemove', at(0.6, 0.6)));
      cvs.dispatchEvent(new MouseEvent('mousemove', at(0.8, 0.7)));
      cvs.dispatchEvent(new MouseEvent('mouseup', at(0.8, 0.7)));

      // CLOSING TAKES A MOMENT, AND THE TEST MUST NOT READ THROUGH IT.
      //
      // The big view zooms back into the card over about a fifth of a second,
      // and everything that happens on closing — including which version the
      // card is left showing — happens at the END of that. Reading straight
      // after the call caught the screen mid-animation and reported the state
      // from before, which looked exactly like the fix having failed.
      closeFullscreen();
      const until = Date.now() + 3000;
      while (document.querySelector('.fs-overlay') && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 50));
      }
      if (document.querySelector('.fs-overlay')) throw new Error('the big view would not close');

      return getStripVersions(f.id, strip)[versionIndex]?.strokes?.length ?? 0;
    },

    strokeCount(frameIndex, strip = 'ver', versionIndex = 0) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      return getStripVersions(f.id, strip)[versionIndex]?.strokes?.length ?? 0;
    },

    cardShowing(frameIndex) {
      const s = useStore.getState();
      const f = s.frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      const cc = s.crossCompare[f.id] ?? -1;
      return cc < 0 ? 'main' : `${s.crossCompareStrip[f.id] ?? 'ver'} ${cc + 1}`;
    },

    viewMode() { return String(useStore.getState().currentViewMode); },

    setView(mode) { setViewMode(mode as never); },

    scrollPosition() {
      const el = whatIsScrolling();
      return el ? el.scrollTop : Math.round(window.scrollY);
    },

    scrollTo(y) {
      const el = whatIsScrolling();
      if (el) el.scrollTop = y; else window.scrollTo(0, y);
    },

    scrollerName() {
      const el = whatIsScrolling();
      if (!el) return 'the window';
      return el.id || el.tagName.toLowerCase();
    },

    swipeCard(frameIndex) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      const holders = [
        `.grid3x2-card-wrap[data-g3fid="${f.id}"] .canvas-wrap`,
        `.frame-card[data-mfid="${f.id}"] .canvas-wrap`,
        `.frame-card[data-vfid="${f.id}"] .canvas-wrap`,
      ];
      let el: HTMLElement | null = null;
      for (const h of holders) {
        const found = document.querySelector(h) as HTMLElement | null;
        if (found) { el = found; break; }
      }
      if (!el) throw new Error(`no canvas to swipe on frame ${frameIndex}`);
      const r = el.getBoundingClientRect();
      const y = r.top + r.height / 2;
      // Proper Touch objects. A plain object looks close enough to read but
      // WebKit refuses it outright — "Type error" — which is what the first
      // attempt at this got.
      const touch = (x: number) => {
        const t = new Touch({ identifier: 1, target: el as EventTarget, clientX: x, clientY: y });
        return { bubbles: true, cancelable: true, touches: [t], changedTouches: [t], targetTouches: [t] };
      };
      // Right to left across the picture — the swipe that shows the version.
      el.dispatchEvent(new TouchEvent('touchstart', touch(r.right - 20)));
      el.dispatchEvent(new TouchEvent('touchmove', touch(r.left + r.width * 0.5)));
      el.dispatchEvent(new TouchEvent('touchmove', touch(r.left + 20)));
      el.dispatchEvent(new TouchEvent('touchend', touch(r.left + 20)));
    },

    openOrder(orderIndex) {
      const o = useStore.getState().sortOrders[orderIndex];
      if (!o) throw new Error(`no shooting order at ${orderIndex}`);
      openSortEditView(o.id);
    },

    orderBeingEdited() { return useStore.getState().sortEditingId ?? null; },

    closeOrder() { closeSortMode(); },

    lookAtStrip(frameIndex, strip) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      ensureStripVersions(f.id, strip);
    },

    versionLabels(frameIndex, strip = 'ver') {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      return getStripVersions(f.id, strip).map((v) => v.label ?? '');
    },

    putPicture(frameIndex, dataUrl) {
      const s = useStore.getState();
      const f = s.frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      // ON THE MAIN FRAME, which is what the card is showing.
      //
      // The first two attempts put it on a version, which is real but is not on
      // screen unless the card has been cross-swiped to it — so the test watched
      // a card that was showing the main frame and quite correctly reported
      // nothing there. The picture goes where the eye is.
      useStore.setState({
        frames: s.frames.map((x, i) => (i === frameIndex
          ? { ...x, src: dataUrl, r2Key: undefined } : x)),
      } as never);
      if (f.serverFrameId) markFrameDirty(f.serverFrameId);
      stampChangedContent();
      (window as never as { __fh_renderAll?: () => void }).__fh_renderAll?.();
    },

    cardIsBlank(frameIndex, strip = 'ver', versionIndex = 0) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      const ids = [
        `g3_mc_${f.id}`,
        `g4_mc_${f.id}`,
        `ov_mc_${f.id}`,
        `mcvs_${f.id}`,
        `g3_vc_${f.id}_${versionIndex}`,
        `g4_vc_${f.id}_${versionIndex}`,
        `ov_vc_${f.id}_${versionIndex}`,
        `cvs_${strip}_${f.id}_${versionIndex}`,
      ];
      // ON SCREEN, not merely in the page. The strip columns stay in the
      // document while 3x2 is showing, so the first attempt at this measured a
      // hidden canvas that nothing had painted, and called it blank.
      const showing = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1;
      };
      let cvs: HTMLCanvasElement | null = null;
      for (const id of ids) {
        const el = document.getElementById(id) as HTMLCanvasElement | null;
        if (el && showing(el)) { cvs = el; break; }
      }

      // A MAIN FRAME HOLDING A PICTURE IS NOT A CANVAS AT ALL.
      //
      // It is a plain picture element, and there is no canvas on that card. The
      // test looked only for canvases and reported "nothing on screen" three
      // times before this was noticed — which is also why the flash was never
      // going to be explained by the canvas alone.
      if (!cvs) {
        const holders = [
          `[data-g3fid="${f.id}"]`, `[data-mfid="${f.id}"]`,
          `[data-ofid="${f.id}"]`, `[data-vfid="${f.id}"]`,
        ];
        for (const h of holders) {
          const img = document.querySelector(`${h} img`) as HTMLImageElement | null;
          if (img && showing(img)) {
            return !(img.complete && img.naturalWidth > 0);
          }
        }
      }

      if (!cvs) throw new Error(`no canvas visible for frame ${frameIndex}. `
        + `Looked for: ${ids.join(', ')}. `
        + `On the page: ${Array.from(document.querySelectorAll('canvas'))
          .map((c) => `${c.id}${showing(c as HTMLElement) ? '' : ' (hidden)'}`)
          .join(', ') || 'no canvas at all'}`);
      const ctx = cvs.getContext('2d');
      if (!ctx) throw new Error('the canvas has no drawing surface');
      const px = ctx.getImageData(0, 0, cvs.width, cvs.height).data;
      for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) return false;
      return true;
    },

    setScribbleMode(on) {
      if (useStore.getState().scribbleMode !== on) toggleScribbleMode();
      attachScribbleOverlays();
    },

    scribbleOn(frameIndex) {
      const { cvs, at } = scribbleAim(frameIndex);
      cvs.dispatchEvent(new PointerEvent('pointerdown', at(0.3, 0.3)));
      cvs.dispatchEvent(new PointerEvent('pointermove', at(0.4, 0.4)));
      cvs.dispatchEvent(new PointerEvent('pointermove', at(0.55, 0.5)));
      cvs.dispatchEvent(new PointerEvent('pointermove', at(0.7, 0.6)));
      cvs.dispatchEvent(new PointerEvent('pointerup', at(0.7, 0.6)));

      return useStore.getState().frames[frameIndex]?.scribbles?.length ?? 0;
    },

    scribbleStart(frameIndex) {
      const { cvs, at } = scribbleAim(frameIndex);
      cvs.dispatchEvent(new PointerEvent('pointerdown', at(0.3, 0.3)));
      cvs.dispatchEvent(new PointerEvent('pointermove', at(0.4, 0.4)));
      cvs.dispatchEvent(new PointerEvent('pointermove', at(0.5, 0.45)));
    },

    scribbleEnd(frameIndex) {
      // Deliberately asks the page for the layer AGAIN, rather than remembering
      // the one the stroke began on. If the app threw that canvas away and made
      // a new one, this is a pen coming up on a canvas that never saw it go
      // down — which is exactly what happens to a person's hand.
      const { cvs, at } = scribbleAim(frameIndex);
      cvs.dispatchEvent(new PointerEvent('pointermove', at(0.65, 0.55)));
      cvs.dispatchEvent(new PointerEvent('pointerup', at(0.65, 0.55)));
      return useStore.getState().frames[frameIndex]?.scribbles?.length ?? 0;
    },

    scribbleQuickTick(frameIndex) {
      // A FINGER, on purpose: a finger is allowed 400ms and 30 pixels before the
      // app calls it a tap. That is the generous branch, and the dangerous one.
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      const card = document.querySelector(`.grid3x2-card-wrap[data-g3fid="${f.id}"]`) as HTMLElement | null;
      if (!card) throw new Error(`frame ${frameIndex} has no card in the 3x2 grid`);
      const cvs = document.querySelector('.scribble-page-canvas') as HTMLCanvasElement | null;
      if (!cvs) throw new Error('the scribble layer is not on the page');
      const r = card.getBoundingClientRect();
      // A tick: down, across and down by about twenty pixels, back up a little.
      // Never more than thirty from the start, and over in a few milliseconds.
      const px = (x: number, y: number) => ({
        clientX: r.left + r.width * 0.4 + x,
        clientY: r.top + r.height * 0.4 + y,
        bubbles: true, pointerId: 1, pointerType: 'touch', isPrimary: true,
      });
      cvs.dispatchEvent(new PointerEvent('pointerdown', px(0, 0)));
      cvs.dispatchEvent(new PointerEvent('pointermove', px(6, 8)));
      cvs.dispatchEvent(new PointerEvent('pointermove', px(12, 16)));
      cvs.dispatchEvent(new PointerEvent('pointermove', px(18, 6)));
      cvs.dispatchEvent(new PointerEvent('pointermove', px(22, -4)));
      cvs.dispatchEvent(new PointerEvent('pointerup', px(22, -4)));
    },

    lastScribbleSpan(frameIndex) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      const all = f.scribbles ?? [];
      const last = all[all.length - 1];
      if (!last || !last.points || last.points.length === 0) return 0;
      let far = 0;
      const a = last.points[0];
      for (const p of last.points) {
        const dx = p.x - a.x, dy = p.y - a.y;
        far = Math.max(far, Math.sqrt(dx * dx + dy * dy));
      }
      return far;
    },

    scribbleCount(frameIndex) {
      const f = useStore.getState().frames[frameIndex];
      if (!f) throw new Error(`no frame at ${frameIndex}`);
      return f.scribbles?.length ?? 0;
    },

    async push() { await flushSyncNow(); },

    read() {
      const s = useStore.getState();
      return {
        projectId: getCurrentProject().projectId,
        frames: s.frames.map((f) => ({
          id: String(f.id),
          serverFrameId: f.serverFrameId,
          label: f.label ?? '',
          text: f.textContent ?? '',
        })),
        categories: (s.needDefinitions?.tabs ?? []).map((t) => t.name),
        setups: s.setups.map((su) => su.name),
        storyBreaks: (s.storyFlowBreaks ?? []).map((b) => ({ id: b.id, text: b.text, position: b.position })),
        unsent: [...getDirtyFrameIds()],
        orders: s.sortOrders.map((o) => ({
          id: o.id,
          name: o.name,
          // frameOrder holds this device's internal frame numbers, which mean
          // nothing on the other device. Turn them into the labels a person
          // reads, so a test compares what is actually on the two screens.
          frames: o.frameOrder.map((n) => s.frames.find((f) => f.id === n)?.label ?? `?${n}`),
          breaks: o.breaks.map((b) => ({ id: b.id, text: b.text, position: b.position })),
        })),
      };
    },
  };

  (window as never as { __fh_test?: TestDoor }).__fh_test = door;
}

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
import type { SortOrder } from '../store/state';
import { getVisibleFrames } from './groups';
import { startFromScratch } from './files';
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

  // --- shooting orders -----------------------------------------------------
  // An order is ONE settings item, breaks and all (see projectSettings, where
  // each order is pushed whole under `sortOrder:<id>`). So two devices editing
  // the same order do not merge — the later one wins entire. These doors exist
  // to prove that is what actually happens, and that nothing else is dragged
  // down with it.

  /** Make a shooting order holding every visible frame, as the SHOOTING ORDER
   *  button does the first time it is pressed. Returns its id. */
  newSortOrder(name?: string): string;
  /** Move a frame inside an order — the drag in the sort edit view. */
  moveInOrder(orderIndex: number, from: number, to: number): void;
  /** ADD BREAK, at a place in the order. Returns the break's id. */
  addBreak(orderIndex: number, position: number, text: string): string;
  /** Drag a break to a different place. */
  moveBreak(orderIndex: number, breakIndex: number, toPosition: number): void;
  /** Send whatever is unsent, now, without waiting for the debounce. */
  push(): Promise<void>;
  /** What is on screen, in order, as plain facts a test can compare. */
  read(): {
    projectId: string | null;
    frames: Array<{ id: string; serverFrameId?: string; label: string; text: string }>;
    categories: string[];
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

export function installTestDoor(): void {
  if (!on()) return;

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

    renameCategory(index, name) {
      const s = useStore.getState();
      const tabs = [...(s.needDefinitions?.tabs ?? [])];
      if (!tabs[index]) throw new Error(`no category at ${index}`);
      tabs[index] = { ...tabs[index], name };
      useStore.setState({
        needDefinitions: { ...s.needDefinitions, tabs },
      } as never);
      stampChangedSettings(getCurrentProject().projectId);
    },

    newSortOrder(name) {
      const s = useStore.getState();
      const id = `sort_${s.nextSortOrderId}`;
      useStore.setState({
        sortOrders: [...s.sortOrders, {
          id,
          name: name ?? `SHOOTING ORDER ${s.sortOrders.length + 1}`,
          description: 'Your custom frame order',
          frameOrder: getVisibleFrames().map((f) => f.id),
          breaks: [],
        }],
        activeSortOrderId: id,
        nextSortOrderId: s.nextSortOrderId + 1,
      } as never);
      stampChangedSettings(getCurrentProject().projectId);
      return id;
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

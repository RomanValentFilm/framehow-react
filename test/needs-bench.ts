// THE BENCH, app side: does a NEEDS category change survive the round trip?
//
// Run:  npm run bench        (from the project root)
//
// The server's side of the decision is checked in backend/test/sync-bench.ts.
// This one drives the real store and the real settings code — seedSettings,
// stampChangedSettings, settingsForPush, applySettingsToStore — as two devices,
// and reads what actually comes out. No browser, no iPad, no deploy.

import { useStore, DEFAULT_NEED_DEFINITIONS } from '../src/store/state';
import type { NeedTab } from '../src/store/state';
import {
  stampChangedSettings, settingsForPush, adoptSettingsFromServer,
  applySettingsToStore, settingsNeedPush, seedSettings, importSettingStamps,
  reconcileRestoredSettings,
  exportSettingStamps, type SettingItem,
} from '../src/lib/projectSettings';
import { stampChangedContent, frameChangedAt, seedContentStamps } from '../src/lib/changeStamps';
import { shouldSendOnlyChanges } from '../src/lib/pushMode';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

const TABS = clone(DEFAULT_NEED_DEFINITIONS.tabs);
const FIRST = TABS[0].id;
const CREATED = Date.UTC(2026, 7, 1, 9, 0, 0);     // when the project was made

// A clock the bench controls. Without it every stamp in a case lands in the
// same millisecond, so "later" and "earlier" cannot be told apart — and an
// equal time is a real tie, which is not what any of these cases are about.
let NOW = CREATED + 60 * 60_000;
Date.now = () => NOW;
/** Time passes: the user goes and does something else for a minute. */
const later = (minutes = 1) => { NOW += minutes * 60_000; };

/** Opening a project, exactly as the app does it: fill the store, then take the
 *  first look with the project's creation time. */
function loadProject(tabs: NeedTab[] = TABS, projectId = 'p', createdAt = CREATED): void {
  useStore.setState({
    needDefinitions: { tabs: clone(tabs), locations: [] },
    groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [],
  } as never);
  seedSettings(projectId, createdAt);
}

/** Opening a project whose settings the server already holds: the store is
 *  filled and the server's copy, with its times, is adopted. */
function loadProjectFromServer(serverItems: SettingItem[], projectId = 'p'): void {
  useStore.setState({
    needDefinitions: { tabs: clone(TABS), locations: [] },
    groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [],
  } as never);
  seedSettings(projectId, CREATED);
  applySettingsToStore(serverItems);
  adoptSettingsFromServer(serverItems, projectId);
}

function tabNames(): string[] {
  return useStore.getState().needDefinitions.tabs.map((t) => t.name);
}

function renameTab(index: number, name: string): void {
  const tabs = clone(useStore.getState().needDefinitions.tabs);
  tabs[index].name = name;
  useStore.setState({ needDefinitions: { ...useStore.getState().needDefinitions, tabs } } as never);
}

function setTabs(tabs: NeedTab[]): void {
  useStore.setState({
    needDefinitions: { ...useStore.getState().needDefinitions, tabs: clone(tabs) },
  } as never);
}

/** The one item for one category, as the push would carry it. */
function itemFor(items: SettingItem[], tabId: string): SettingItem | undefined {
  return items.find((i) => i.kind === 'needCategory' && i.item_id === tabId);
}

/** The server's rule, copied from the ON CONFLICT ... WHERE clause in the push
 *  handler: an item is only written if it is NEWER than what is already there. */
function serverWouldTake(incoming: SettingItem, heldChangedAt: number): boolean {
  return incoming.changed_at > heldChangedAt;
}

const results: Array<{ what: string; got: string; want: string }> = [];
const check = (what: string, got: unknown, want: unknown) =>
  results.push({ what, got: String(got), want: String(want) });

// ---------------------------------------------------------------------------
// 1. Opening a project is not editing it (#263)
// ---------------------------------------------------------------------------
{
  loadProject();
  const seeded = itemFor(settingsForPush(), FIRST)!;
  check('opening: the category is as old as the project', seeded.changed_at, CREATED);
  check('opening: no item claims to have changed now', seeded.changed_at < Date.now(), true);
}

// ---------------------------------------------------------------------------
// 2. A rename, and the other device receiving it
// ---------------------------------------------------------------------------
{
  loadProject();
  later();
  renameTab(0, 'RENAMED');
  stampChangedSettings('p');
  const after = itemFor(settingsForPush(), FIRST)!;
  check('a rename carries a real change time', after.changed_at > CREATED, true);
  check('a rename wants to be pushed', settingsNeedPush(), true);
  check('the server would take it', serverWouldTake(after, CREATED), true);
  const pushed = settingsForPush();

  loadProject();                             // the other device
  applySettingsToStore(pushed);
  check('the other device sees the new name', tabNames()[0], 'RENAMED');
  check('the other device keeps all its categories', tabNames().length, TABS.length);
  check('the other names are untouched', tabNames().slice(1).join(','),
        TABS.slice(1).map((t) => t.name).join(','));
}

// ---------------------------------------------------------------------------
// 3. A rename in the seconds right after opening, before the first save (#264)
// ---------------------------------------------------------------------------
{
  loadProject();
  renameTab(0, 'RENAMED AT ONCE');           // no autosave has run yet
  stampChangedSettings('p');                 // the first save, two seconds later
  const it = itemFor(settingsForPush(), FIRST)!;
  check('a rename made before the first save carries a time', it.changed_at > CREATED, true);
  check('...and the server would take it', serverWouldTake(it, CREATED), true);
}

// ---------------------------------------------------------------------------
// 4. A pull that brings NO settings must not empty the memory (#263)
// ---------------------------------------------------------------------------
{
  loadProject();
  adoptSettingsFromServer([], 'p');          // a pull whose settings list is empty
  renameTab(0, 'AFTER EMPTY PULL');
  stampChangedSettings('p');
  const it = itemFor(settingsForPush(), FIRST)!;
  check('rename after a pull with no settings carries a time', it.changed_at > CREATED, true);
  check('...and the server would take it', serverWouldTake(it, CREATED), true);
}

// ---------------------------------------------------------------------------
// 5. A pull must not undo a rename this device has not sent yet (#262)
// ---------------------------------------------------------------------------
{
  // what the server holds: renamed a while ago, by the other device
  loadProject();
  renameTab(0, 'SERVER OLD');
  stampChangedSettings('p');
  const serverHas = clone(settingsForPush());

  later(10);

  // this device: has seen that, then renames it again — ten minutes later
  loadProjectFromServer(serverHas);
  renameTab(0, 'MY NEWER NAME');
  stampChangedSettings('p');

  // a pull lands before the push goes out
  applySettingsToStore(serverHas);
  adoptSettingsFromServer(serverHas, 'p');
  check('a pull does not undo my unsent rename', tabNames()[0], 'MY NEWER NAME');
  check('...and it still wants to push it', settingsNeedPush(), true);
  const mine = itemFor(settingsForPush(), FIRST)!;
  check('...and the server would take it', serverWouldTake(mine, itemFor(serverHas, FIRST)!.changed_at), true);
}

// ---------------------------------------------------------------------------
// 6. A pull with a NEWER rename does replace mine (the other direction)
// ---------------------------------------------------------------------------
{
  loadProject();
  renameTab(0, 'MINE, EARLIER');
  stampChangedSettings('p');
  const sent = clone(settingsForPush());
  adoptSettingsFromServer(sent, 'p');        // it went up and was accepted

  const later = clone(sent);
  const it = itemFor(later, FIRST)!;
  it.changed_at = NOW + 60_000;              // the other device changed it after me
  it.value = JSON.stringify({ idx: 0, data: { ...TABS[0], name: 'THEIRS, LATER' } });
  applySettingsToStore(later);
  check('a newer rename from the other device wins', tabNames()[0], 'THEIRS, LATER');
}

// ---------------------------------------------------------------------------
// 7. A restart must not forget what is still unsent (#267)
// ---------------------------------------------------------------------------
{
  loadProject();
  renameTab(0, 'MADE OFFLINE');
  stampChangedSettings('p');
  const snapshot = clone(exportSettingStamps());   // what goes into the local save

  // the app is closed and reopened, still offline
  loadProject();
  importSettingStamps(snapshot);
  check('after a restart the offline rename is still unsent', settingsNeedPush(), true);
  const it = itemFor(settingsForPush(), FIRST)!;
  check('...and it kept the time it was made', it.changed_at > CREATED, true);
}

// ---------------------------------------------------------------------------
// 8. A new category, and a deleted one
// ---------------------------------------------------------------------------
{
  const extra: NeedTab = { id: 'tab_new', name: 'NEW ONE', tables: [] };

  loadProject();
  setTabs([...TABS, extra]);
  stampChangedSettings('p');
  check('a new category carries a change time', itemFor(settingsForPush(), 'tab_new')!.changed_at > CREATED, true);
  const withExtra = clone(settingsForPush());

  loadProject();
  applySettingsToStore(withExtra);
  check('the other device gains the new category', tabNames().includes('NEW ONE'), true);

  loadProject([...TABS, extra]);
  setTabs(TABS);                             // deleted here
  stampChangedSettings('p');
  const gone = itemFor(settingsForPush(), 'tab_new')!;
  check('a deleted category is recorded as deleted', gone.deleted_at !== null, true);
  const withDeletion = clone(settingsForPush());

  loadProject([...TABS, extra]);
  applySettingsToStore(withDeletion);
  check('the other device loses the deleted category', tabNames().includes('NEW ONE'), false);
}

// ---------------------------------------------------------------------------
// 9. Two devices must agree on the starting time, or opening beats working
// ---------------------------------------------------------------------------
{
  loadProject(TABS, 'p', CREATED);
  const a = itemFor(settingsForPush(), FIRST)!.changed_at;
  loadProject(TABS, 'p', CREATED);
  const b = itemFor(settingsForPush(), FIRST)!.changed_at;
  check('both devices start from the same time', a === b, true);
  check('...so neither would overwrite the other by opening', serverWouldTake({ ...itemFor(settingsForPush(), FIRST)!, changed_at: a }, b), false);
}

// ---------------------------------------------------------------------------
// 10. Work RECEIVED from the server keeps the time it came with (#265)
// ---------------------------------------------------------------------------
{
  const frame = { id: 1, serverFrameId: 'srv-1', label: '1', textContent: 'mine' } as never;
  useStore.setState({
    frames: [frame], stripVersions: {}, frameNeeds: {}, frameNotes: {},
  } as never);
  stampChangedContent('r1');                       // the first look
  later(5);

  // the other device changed it half an hour ago; the pull applies its copy
  const theirTime = NOW - 30 * 60_000;
  useStore.setState({
    frames: [{ ...(frame as object), textContent: 'theirs' }],
  } as never);
  stampChangedContent(undefined, new Map([['f/srv-1', theirTime]]));
  check('a received frame keeps the time it was changed', frameChangedAt('srv-1'), theirTime);
  check('...and does not claim to have changed now', frameChangedAt('srv-1') === NOW, false);

  // and a real edit here afterwards is this device's own change
  later(2);
  useStore.setState({
    frames: [{ ...(frame as object), textContent: 'mine again' }],
  } as never);
  stampChangedContent();
  check('an edit made here is stamped here', frameChangedAt('srv-1'), NOW);
}

// ---------------------------------------------------------------------------
// 11. A full replace is for a brand new project and nothing else (#268)
// ---------------------------------------------------------------------------
{
  const mode = (confirmedFrames: number, framesTheServerHas: number, hasCloudId = false) =>
    shouldSendOnlyChanges({ hasCloudId, confirmedFrames, framesTheServerHas })
      ? 'changes only' : 'full replace';

  check('a project made here that the server has never seen', mode(0, 0), 'full replace');
  check('a project this device has already pushed', mode(45, 45), 'changes only');
  // The case that wiped a project: a pull kept every local frame, so the app
  // forgot what the server had confirmed — but it had still HEARD about them.
  check('after a pull that kept every local frame', mode(0, 45), 'changes only');
  check('after a restart, frames known to the server', mode(0, 45), 'changes only');

  // THE ONE THAT ACTUALLY HAPPENED (#300). An iPad restarted having forgotten
  // everything about the server — no confirmed frames, no known times — and by
  // the old rule that reads as "brand new project", so it sent a full replace
  // over a project both devices had been working on all afternoon.
  check('a device that forgot everything but still holds the cloud id',
    mode(0, 0, true), 'changes only');
  check('...and a project with no cloud id is still the one real full replace',
    mode(0, 0, false), 'full replace');
}

// ---------------------------------------------------------------------------
// 12. A change in the first seconds after opening still carries a time (#289)
// ---------------------------------------------------------------------------
{
  const three = [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
    { id: 3, serverFrameId: 'c', label: '3' },
  ] as never[];
  useStore.setState({ frames: three, stripVersions: {}, frameNeeds: {}, frameNotes: {} } as never);

  // the project loads — the first look happens HERE, not on the first save
  seedContentStamps('p9');
  seedSettings('p9', CREATED);
  check('opening a project stamps nothing as changed', frameChangedAt('c'), 'undefined');

  // ...and the user immediately writes on a frame, before any save
  later();
  useStore.setState({
    frames: [{ ...(three[0] as object), textContent: 'written at once' }, three[1], three[2]],
  } as never);
  stampChangedContent();
  check('an edit made straight after opening carries a time',
    typeof frameChangedAt('a') === 'number' && frameChangedAt('a')! > 0, true);
  check('...and the frames not touched carry none', frameChangedAt('b'), 'undefined');

  // ...and a re-order made straight after opening carries a time too — on the
  // ARRANGEMENT, which is where a re-order belongs now (#294), not on the frames
  later();
  useStore.setState({ frames: [three[2], three[0], three[1]] } as never);
  stampChangedSettings('p9');
  const order = settingsForPush().find((i) => i.kind === 'frameOrder');
  check('a re-order made straight after opening carries a time',
    Boolean(order && order.changed_at > CREATED), true);
}

// ---------------------------------------------------------------------------
// 13. THE STORY FLOW IS ONE THING (#294)
// ---------------------------------------------------------------------------
{
  const threeFrames = [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
    { id: 3, serverFrameId: 'c', label: '3' },
  ] as never[];
  const load = () => {
    useStore.setState({ frames: threeFrames, stripVersions: {}, frameNeeds: {}, frameNotes: {},
      needDefinitions: { tabs: clone(TABS), locations: [] },
      groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [] } as never);
    seedSettings('p10', CREATED);
    seedContentStamps('p10');
  };

  load();
  const orderItem = () => settingsForPush().find((i) => i.kind === 'frameOrder');
  check('the arrangement travels as ONE item', Boolean(orderItem()), true);
  check('...holding the frames in order',
    JSON.parse(String(orderItem()!.value)).data.join(','), 'a,b,c');

  // drag the last frame to the front
  later();
  useStore.setState({ frames: [threeFrames[2], threeFrames[0], threeFrames[1]] } as never);
  stampChangedSettings('p10');
  stampChangedContent();

  check('a re-order changes the arrangement',
    JSON.parse(String(orderItem()!.value)).data.join(','), 'c,a,b');
  check('...with a real change time', orderItem()!.changed_at > CREATED, true);
  check('...and it wants to be sent', settingsNeedPush(), true);

  // THE POINT: moving frames is not editing them
  check('moving a frame does not mark the frame as changed', frameChangedAt('c'), 'undefined');
  check('...nor the ones it moved past', frameChangedAt('a'), 'undefined');
}
{
  // The other device receives an arrangement it has never seen
  const four = [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
    { id: 3, serverFrameId: 'c', label: '3' },
    { id: 4, serverFrameId: 'mine', label: '4' },   // made here, unknown to them
  ] as never[];
  useStore.setState({ frames: four, stripVersions: {}, frameNeeds: {}, frameNotes: {},
    needDefinitions: { tabs: clone(TABS), locations: [] },
    groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [] } as never);
  seedSettings('p11', CREATED);

  applySettingsToStore([{
    kind: 'frameOrder', item_id: 'main',
    value: JSON.stringify({ idx: 0, data: ['c', 'a', 'b'] }),
    changed_at: NOW + 60_000, deleted_at: null,
  }]);
  const order = useStore.getState().frames.map((f) => f.serverFrameId).join(',');
  // 'mine' was made after 'c' here, so it travels with 'c' — which the
  // arrangement puts first. Staying with its neighbour is the point (#294).
  check('a later arrangement is taken whole', order, 'c,mine,a,b');
  check('...and a frame it never heard of is kept', order.includes('mine'), true);
}
{
  // A NEW FRAME STAYS WITH ITS NEIGHBOUR (#294).
  //
  // While the other device was rearranging, a frame was drawn here between 2
  // and 3. It belongs there — not at the bottom of the storyboard.
  const withNew = [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
    { id: 9, serverFrameId: 'new', label: 'NEW' },   // drawn here, after b
    { id: 3, serverFrameId: 'c', label: '3' },
  ] as never[];
  useStore.setState({ frames: withNew } as never);
  seedSettings('p13', CREATED);

  // their arrangement knows nothing of the new frame, and puts c first
  applySettingsToStore([{
    kind: 'frameOrder', item_id: 'main',
    value: JSON.stringify({ idx: 0, data: ['c', 'a', 'b'] }),
    changed_at: NOW + 60_000, deleted_at: null,
  }]);
  check('a new frame follows the frame it was put after',
    useStore.getState().frames.map((f) => f.serverFrameId).join(','), 'c,a,b,new');

  // ...and one drawn at the very top stays at the top
  useStore.setState({ frames: [
    { id: 9, serverFrameId: 'first', label: 'NEW' },
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
  ] as never[] } as never);
  seedSettings('p14', CREATED);
  applySettingsToStore([{
    kind: 'frameOrder', item_id: 'main',
    value: JSON.stringify({ idx: 0, data: ['b', 'a'] }),
    changed_at: NOW + 60_000, deleted_at: null,
  }]);
  check('a new frame drawn at the very top stays at the top',
    useStore.getState().frames.map((f) => f.serverFrameId).join(','), 'first,b,a');

  // ...and two frames drawn in the same gap keep their own order
  useStore.setState({ frames: [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 8, serverFrameId: 'n1', label: 'N1' },
    { id: 9, serverFrameId: 'n2', label: 'N2' },
    { id: 2, serverFrameId: 'b', label: '2' },
  ] as never[] } as never);
  seedSettings('p15', CREATED);
  applySettingsToStore([{
    kind: 'frameOrder', item_id: 'main',
    value: JSON.stringify({ idx: 0, data: ['b', 'a'] }),
    changed_at: NOW + 60_000, deleted_at: null,
  }]);
  check('two frames drawn in the same gap stay together, in order',
    useStore.getState().frames.map((f) => f.serverFrameId).join(','), 'b,a,n1,n2');
}
{
  // An arrangement naming a frame that no longer exists just skips it — a
  // deleted frame needs no place-holder in the list.
  useStore.setState({ frames: [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
  ] as never[] } as never);
  seedSettings('p12', CREATED);
  applySettingsToStore([{
    kind: 'frameOrder', item_id: 'main',
    value: JSON.stringify({ idx: 0, data: ['b', 'DELETED-FRAME', 'a'] }),
    changed_at: NOW + 60_000, deleted_at: null,
  }]);
  check('an arrangement naming a deleted frame simply skips it',
    useStore.getState().frames.map((f) => f.serverFrameId).join(','), 'b,a');
}

// ---------------------------------------------------------------------------
// 18. THE APP HAS JUST BEEN UPDATED (#297)
//
// The fault that cost a whole afternoon, and the one shape of fault this bench
// had no case for at all: memory written by YESTERDAY's app, read by today's.
//
// #294 invented the arrangement as an item of its own. Every device's saved
// memory pre-dates it, so on the first start after the update the app found an
// item nobody remembered and applied the ordinary rule — a new item is a change,
// and it happened now. Both devices therefore claimed to have rearranged the
// storyboard three seconds after booting, and the arrangement was settled by
// which device started last.
// ---------------------------------------------------------------------------
{
  const three = [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
    { id: 3, serverFrameId: 'c', label: '3' },
  ] as never[];

  // YESTERDAY: the app saves its memory. It has no idea arrangements exist.
  useStore.setState({
    needDefinitions: { tabs: clone(TABS), locations: [] },
    groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [],
    frames: [], stripVersions: {}, frameNeeds: {}, frameNotes: {},
  } as never);
  seedSettings('p16', CREATED);
  const yesterday = clone(exportSettingStamps());
  check('yesterday\'s memory knows nothing of an arrangement',
    yesterday.some((i) => i.kind === 'frameOrder'), false);

  // TODAY: the updated app starts. Store first, then the restored memory, then
  // the reconciling look — the order the app itself uses.
  later(120);
  useStore.setState({
    needDefinitions: { tabs: clone(TABS), locations: [] },
    groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [],
    frames: three, stripVersions: {}, frameNeeds: {}, frameNotes: {},
  } as never);
  importSettingStamps(yesterday);
  const unknown = reconcileRestoredSettings();
  check('the update finds one item the memory never heard of', unknown, 1);

  // The first autosave now runs, as it does three seconds after every start.
  later();
  stampChangedSettings('p16');
  const order = settingsForPush().find((i) => i.kind === 'frameOrder');
  check('starting an updated app does not claim the storyboard was rearranged',
    order?.changed_at, 0);
  check('...and the arrangement is not pretending to be unsent work',
    (order?.changed_at ?? 0) > (order?.base_changed_at ?? 0), false);

  // ...and a real re-order, after all that, still travels normally.
  later();
  useStore.setState({ frames: [three[2], three[0], three[1]] } as never);
  stampChangedSettings('p16');
  const real = settingsForPush().find((i) => i.kind === 'frameOrder');
  check('a re-order made afterwards still carries a real time',
    Boolean(real && real.changed_at > CREATED), true);
  check('...and wants to be sent', settingsNeedPush(), true);
}

// ---------------------------------------------------------------------------
// 19. AN UPDATE MUST NOT BEAT REAL WORK ON THE OTHER DEVICE (#297)
//
// The other half: the updated device meets a device that genuinely rearranged.
// Age unknown must lose to a real time, whichever device started last.
// ---------------------------------------------------------------------------
{
  const three = [
    { id: 1, serverFrameId: 'a', label: '1' },
    { id: 2, serverFrameId: 'b', label: '2' },
    { id: 3, serverFrameId: 'c', label: '3' },
  ] as never[];
  useStore.setState({
    needDefinitions: { tabs: clone(TABS), locations: [] },
    groups: [], sortOrders: [], setups: [], nextSetupId: 1, storyFlowBreaks: [],
    frames: three, stripVersions: {}, frameNeeds: {}, frameNotes: {},
  } as never);
  seedSettings('p17', CREATED);
  const memoryWithoutArrangements = clone(exportSettingStamps())
    .filter((i) => i.kind !== 'frameOrder');
  importSettingStamps(memoryWithoutArrangements);
  reconcileRestoredSettings();
  later();
  stampChangedSettings('p17');

  // the other device really did rearrange, an hour ago
  applySettingsToStore([{
    kind: 'frameOrder', item_id: 'main',
    value: JSON.stringify({ idx: 0, data: ['c', 'b', 'a'] }),
    changed_at: NOW - 60 * 60_000, deleted_at: null,
  }]);
  check('a real re-order beats a freshly updated app that changed nothing',
    useStore.getState().frames.map((f) => f.serverFrameId).join(','), 'c,b,a');
}

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

const width = Math.max(...results.map((r) => r.what.length));
let failed = 0;
console.log('');
for (const r of results) {
  const ok = r.got === r.want;
  if (!ok) failed++;
  console.log(`${ok ? '  ok  ' : ' WRONG'}  ${r.what.padEnd(width)}  ->  ${r.got.padEnd(14)}` +
              (ok ? '' : `  (should be ${r.want})`));
}
console.log(`\n${results.length - failed} of ${results.length} correct` + (failed ? `, ${failed} WRONG\n` : '\n'));
process.exit(failed ? 1 : 0);

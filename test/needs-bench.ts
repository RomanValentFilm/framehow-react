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
  exportSettingStamps, type SettingItem,
} from '../src/lib/projectSettings';
import { stampChangedContent, frameChangedAt } from '../src/lib/changeStamps';
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
  const mode = (confirmedFrames: number, framesTheServerHas: number) =>
    shouldSendOnlyChanges({ confirmedFrames, framesTheServerHas }) ? 'changes only' : 'full replace';

  check('a project made here that the server has never seen', mode(0, 0), 'full replace');
  check('a project this device has already pushed', mode(45, 45), 'changes only');
  // The case that wiped a project: a pull kept every local frame, so the app
  // forgot what the server had confirmed — but it had still HEARD about them.
  check('after a pull that kept every local frame', mode(0, 45), 'changes only');
  check('after a restart, frames known to the server', mode(0, 45), 'changes only');
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

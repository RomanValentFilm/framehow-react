// THE NAMES A NEW PROJECT OPENS WITH (#510).
//
// Roman, 12 September: the six column names are per project, and the ones you
// last saved in Customise should be what your next NEW project starts with —
// on any of your devices. So they are remembered twice: on this device (works
// signed out and offline) and with the account (follows you). The account copy
// wins when there is one.
//
// Only landscape projects take the strip names; portrait and fitting have
// their own. The column names (SHOT / NEEDS / NOTES) apply to all.

import { useStore, DEFAULT_STRIP_DEFS, DEFAULT_COLUMN_NAMES } from '../store/state';
import type { StripDef, ColumnName } from '../store/state';
import { api } from './api';
import { getToken, getUser, setUser } from './session';
import type { SessionUser } from './session';
import { trace } from './syncTrace';

export interface DefaultNames { stripDefs: StripDef[]; columnNames: ColumnName[] }

const KEY = 'fh_default_names';

function fromAccount(): DefaultNames | null {
  const u = getUser();
  if (!u?.preferences) return null;
  try {
    const p = JSON.parse(u.preferences) as { names?: DefaultNames };
    return isNames(p.names) ? p.names! : null;
  } catch { return null; }
}

function fromDevice(): DefaultNames | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as DefaultNames;
    return isNames(p) ? p : null;
  } catch { return null; }
}

function isNames(p: unknown): p is DefaultNames {
  const x = p as DefaultNames | undefined;
  return !!x && Array.isArray(x.stripDefs) && Array.isArray(x.columnNames)
    && x.stripDefs.length === DEFAULT_STRIP_DEFS.length
    && x.columnNames.length === DEFAULT_COLUMN_NAMES.length;
}

/** What a new project should be called by — the account's, else the device's, else the app's. */
/** Defaults that are a fitting's strip names (LOOKS / LOOK2), or the old
 *  9:16 ones (LOOK1 / LOOK2 / LOOK3), were saved by mistake from such a
 *  project (26 Oct): the strips go back to the app's own, the column names
 *  the user chose are kept. */
function withoutFittingStrips(n: DefaultNames, from: string): DefaultNames {
  const labels = n.stripDefs.map((d) => (d.buttonLabel || '').toUpperCase().replace(/\s+/g, ''));
  const fittingLike = labels[0] === 'LOOKS' || labels.every((l) => /^LOOK\d$/.test(l));
  if (!fittingLike) return n;
  trace(`  new project: the strip names from ${from} were a fitting's (${labels.join(' / ')}) — using the app's own`);
  return { stripDefs: DEFAULT_STRIP_DEFS, columnNames: n.columnNames };
}

export function readDefaultNames(): DefaultNames {
  const a = fromAccount();
  if (a) { trace('  new project: names from the account'); return withoutFittingStrips(a, 'the account'); }
  const d = fromDevice();
  if (d) { trace('  new project: names from this device'); return withoutFittingStrips(d, 'this device'); }
  trace(`  new project: the app's own names (signed in: ${getUser() ? 'yes' : 'no'})`);
  return { stripDefs: DEFAULT_STRIP_DEFS, columnNames: DEFAULT_COLUMN_NAMES };
}

/** Called after Customise is saved: remember these for the next new project. */
export function rememberDefaultNames(d: DefaultNames): void {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* private mode — the account copy still works */ }
  const token = getToken();
  const u = getUser();
  if (!token || !u) { trace(`  default names kept on this device only (token: ${token ? 'yes' : 'no'}, user: ${u ? 'yes' : 'no'})`); return; }
  let prefs: Record<string, unknown> = {};
  try { prefs = u.preferences ? JSON.parse(u.preferences) as Record<string, unknown> : {}; } catch { prefs = {}; }
  prefs.names = d;
  api.put<{ user: SessionUser }>('/user/me', { preferences: prefs }, token)
    .then((res) => { setUser(res.user); trace('  default names saved with the account'); })
    .catch(() => trace('  default names: could not reach the account — kept on this device'));
}

/** Give a freshly reset project the user's names. `strips` false = portrait/fitting. */
export function applyDefaultNames(strips: boolean): void {
  const d = readDefaultNames();
  useStore.setState({
    columnNames: d.columnNames,
    ...(strips ? { stripDefs: d.stripDefs } : {}),
  });
}

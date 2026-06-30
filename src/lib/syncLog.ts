// Visible sync debug log — temporary, remove after diagnosing sync issue.
// Writes timestamped entries to a small floating panel on screen.

const MAX_ENTRIES = 80;
const _entries: string[] = [];
let _panel: HTMLElement | null = null;
let _list: HTMLElement | null = null;
let _minimized = true;

function _ensurePanel(): void {
  if (_panel) return;

  _panel = document.createElement('div');
  _panel.id = 'syncLogPanel';
  _panel.style.cssText =
    'position:fixed;bottom:4px;left:4px;z-index:9999999;' +
    'font-family:monospace;font-size:10px;line-height:1.3;' +
    'background:rgba(0,0,0,0.85);color:#0f0;border-radius:6px;' +
    'max-width:340px;max-height:50vh;pointer-events:auto;';

  const header = document.createElement('div');
  header.style.cssText =
    'padding:4px 8px;cursor:pointer;font-weight:bold;font-size:11px;' +
    'border-bottom:1px solid #333;user-select:none;color:#0f0;';
  header.textContent = '▶ SYNC LOG';
  header.addEventListener('click', () => {
    _minimized = !_minimized;
    if (_list) _list.style.display = _minimized ? 'none' : 'block';
    header.textContent = _minimized ? '▶ SYNC LOG' : '▼ SYNC LOG (tap to hide)';
  });

  _list = document.createElement('div');
  _list.style.cssText =
    'padding:4px 8px;overflow-y:auto;max-height:45vh;display:none;' +
    'white-space:pre-wrap;word-break:break-all;';

  _panel.appendChild(header);
  _panel.appendChild(_list);
  document.body.appendChild(_panel);
}

export function syncLog(msg: string): void {
  const now = new Date();
  const ts = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  const entry = `${ts} ${msg}`;
  _entries.push(entry);
  if (_entries.length > MAX_ENTRIES) _entries.shift();

  // Also console.log for Safari Web Inspector if connected
  console.log('[sync]', msg);

  _ensurePanel();
  if (_list) {
    const line = document.createElement('div');
    line.textContent = entry;
    line.style.borderBottom = '1px solid #222';
    line.style.padding = '1px 0';
    _list.appendChild(line);
    // Auto-scroll to bottom
    _list.scrollTop = _list.scrollHeight;
    // Trim old DOM entries
    while (_list.children.length > MAX_ENTRIES) {
      _list.removeChild(_list.firstChild!);
    }
  }
}

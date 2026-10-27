// Studio shield: tells the admin when a signed-in creator opens the browser's developer tools or tries to view the source,
// and makes the usual shortcuts and "save image" menus inconvenient. It is a deterrent and an alarm, not a lock:
// a determined person can bypass anything that runs in their own browser. The real protection is on the server
// (every shared file and every action is checked there). Admins are never monitored.

export const GAP = Object.freeze({ width: 220, height: 280 });   // docked developer tools make the window noticeably bigger than the page
export const REPORT_EVERY_MS = 10 * 60 * 1000;

/** is the window much bigger than the page inside it (developer tools docked at the side or bottom)? */
export const sizeLooksDocked = ({ outerWidth, innerWidth, outerHeight, innerHeight }) =>
  outerWidth - innerWidth > GAP.width || outerHeight - innerHeight > GAP.height;

/** 'devtools' | 'view-source' | null for a keyboard event that opens the developer tools or the page source */
export function inspectShortcut(e) {
  const key = String(e.key || '').toLowerCase(), mod = e.ctrlKey || e.metaKey;
  if (e.key === 'F12') return { kind: 'shortcut', detail: 'F12' };
  if (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(key)) return { kind: 'shortcut', detail: `${e.metaKey ? 'Cmd' : 'Ctrl'}+Shift+${key.toUpperCase()}` };
  if (e.metaKey && e.altKey && ['i', 'j', 'c', 'u'].includes(key)) return { kind: key === 'u' ? 'view-source' : 'shortcut', detail: `Cmd+Option+${key.toUpperCase()}` };
  if (mod && !e.shiftKey && !e.altKey && key === 'u') return { kind: 'view-source', detail: `${e.metaKey ? 'Cmd' : 'Ctrl'}+U` };
  return null;
}

/** Chrome draws a logged element's properties only while the console is open, so a getter on it fires only then */
export function consoleLooksOpen(con = console, makeProbe = () => new Image()) {
  let seen = false;
  try {
    const probe = makeProbe();
    Object.defineProperty(probe, 'id', { get() { seen = true; return ''; } });
    con.log(probe); con.clear?.();
  } catch { /* an old browser: the size check still works */ }
  return seen;
}

export function createShield({ win = window, doc = document, report, notice = () => {}, now = () => Date.now(), probe = consoleLooksOpen } = {}) {
  const last = new Map();
  let timer = 0, stopped = false, noticed = false, dockedTwice = 0;
  const send = (kind, detail) => {
    const t = now(), key = `${kind}:${detail}`;
    if (last.has(key) && t - last.get(key) < REPORT_EVERY_MS) return false;
    last.set(key, t);
    Promise.resolve(report({ kind, detail, path: String(win.location?.hash || '').slice(0, 60) })).catch(() => {});
    if (!noticed) { noticed = true; notice('Security notice: viewing or copying this website\'s source, developer tools or data is not allowed. This activity has been recorded and reported to the admin.'); }
    return true;
  };
  function check() {
    if (stopped) return null;
    let found = null;
    if (probe()) found = 'console';
    else if (sizeLooksDocked(win)) { dockedTwice++; if (dockedTwice >= 2) found = 'window-size'; } else dockedTwice = 0;     // a browser side panel alone is not enough: it must stay that way
    if (found) send('devtools', found);
    return found;
  }
  const onKey = (e) => { const hit = inspectShortcut(e); if (!hit) return; e.preventDefault(); e.stopPropagation(); send(hit.kind, hit.detail); };
  const onMenu = (e) => { if (e.target?.closest?.('canvas,img,video')) e.preventDefault(); };      // no "save image as" on the stage and the library pictures
  const onDrag = (e) => { if (e.target?.closest?.('img,canvas')) e.preventDefault(); };
  function start() {
    doc.addEventListener('keydown', onKey, true); doc.addEventListener('contextmenu', onMenu, true); doc.addEventListener('dragstart', onDrag, true);
    win.addEventListener('resize', check); win.addEventListener('focus', check);
    timer = win.setInterval(check, 2000);
    return stop;
  }
  function stop() {
    stopped = true; win.clearInterval(timer);
    doc.removeEventListener('keydown', onKey, true); doc.removeEventListener('contextmenu', onMenu, true); doc.removeEventListener('dragstart', onDrag, true);
    win.removeEventListener('resize', check); win.removeEventListener('focus', check);
  }
  return { start, stop, check, send };
}

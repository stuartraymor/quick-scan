// SPDX-License-Identifier: AGPL-3.0-only
// Branded startup splash: a small frameless window shown while the main
// window loads hidden. The main window is revealed once React reports ready,
// on any startup failure (so error dialogs have a visible parent) or after a
// safety timeout. It never delays a working window by more than minMs.

const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="76" height="76" aria-hidden="true"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2186c8"/><stop offset="1" stop-color="#0f4f7a"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><g fill="none" stroke="#e8f5ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22V12h10M42 12h10v10M52 42v10H42M22 52H12V42"/><circle cx="32" cy="31" r="12"/><path d="m37 37 9 10"/></g></svg>';

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function splashHtml(version) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>Quick Scan</title><style>
html,body{margin:0;height:100%;background:#14171b;color:#e8eef4;font-family:"Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;overflow:hidden;user-select:none;-webkit-app-region:drag}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;position:relative;border:1px solid #263039;box-sizing:border-box}
.grid{position:absolute;inset:0;background-image:linear-gradient(#1d2730 1px,transparent 1px),linear-gradient(90deg,#1d2730 1px,transparent 1px);background-size:28px 28px;mask-image:radial-gradient(circle at 50% 42%,#000 0,transparent 72%);opacity:.75}
.glow{position:absolute;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,#1f78b455 0,transparent 65%);top:-40px}
.mark{position:relative;animation:pop .6s cubic-bezier(.2,.9,.3,1.2) both;filter:drop-shadow(0 10px 24px #0a3a5c99)}
.scan{position:absolute;left:8px;right:8px;height:2px;top:14px;background:linear-gradient(90deg,transparent,#8fd3ff,transparent);animation:sweep 1.6s ease-in-out infinite}
h1{position:relative;margin:18px 0 2px;font-size:28px;font-weight:600;letter-spacing:.2px}
p{position:relative;margin:0;color:#8a9bab;font-size:13px}
.bar{position:relative;margin-top:26px;width:220px;height:3px;border-radius:3px;background:#222c35;overflow:hidden}
.bar i{position:absolute;top:0;bottom:0;width:38%;border-radius:3px;background:linear-gradient(90deg,#1a6ea8,#5cc0ff);animation:load 1.25s ease-in-out infinite}
.foot{position:absolute;bottom:14px;left:0;right:0;display:flex;justify-content:space-between;padding:0 18px;font-size:11px;color:#5f6f7e}
@keyframes load{0%{left:-40%}100%{left:100%}}
@keyframes sweep{0%,100%{top:14px;opacity:0}15%,85%{opacity:1}50%{top:60px}}
@keyframes pop{from{transform:scale(.85);opacity:0}to{transform:none;opacity:1}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.bar i{left:0;width:100%;opacity:.6}}
</style></head><body>
<div class="grid"></div><div class="glow"></div>
<div class="mark">${LOGO}<span class="scan"></span></div>
<h1>Quick Scan</h1>
<p>Scan to measured, editable CAD</p>
<div class="bar" role="progressbar" aria-label="Loading"><i></i></div>
<div class="foot"><span>Starting workspace…</span><span>v${escapeHtml(version)}</span></div>
</body></html>`;
}

// Pure reveal controller (tested without Electron).
function createReveal({ show, closeSplash, shownAt, now = Date.now, schedule = setTimeout, cancel = clearTimeout, minMs = 900, maxMs = 15000 }) {
  const created = now();
  // Without a splash to ask, count from creation.
  if (!shownAt) shownAt = () => created;
  let done = false, pending = null;
  const finish = () => {
    if (done) return;
    done = true;
    cancel(safety); if (pending) cancel(pending);
    try { show(); } finally { try { closeSplash(); } catch { /* splash may already be gone */ } }
  };
  const safety = schedule(finish, maxMs);
  return {
    // React mounted: keep the splash on screen at least minMs so it never
    // flickers. Counted from when it became visible (under load that can be
    // well after it was created); not yet visible counts as just shown.
    ready() { if (done || pending) return; const from = shownAt() ?? now(); const wait = Math.max(0, minMs - (now() - from)); if (wait === 0) finish(); else pending = schedule(finish, wait); },
    // Failure or explicit request: show the main window at once.
    now: finish,
    get done() { return done; },
  };
}

function openSplash({ BrowserWindow, version, icon }) {
  let splash = null, shownAt = null;
  try {
    splash = new BrowserWindow({
      width: 460, height: 300, frame: false, resizable: false, movable: true, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: false, center: true, show: false, backgroundColor: '#14171b', title: 'Quick Scan',
      icon, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false },
    });
    splash.setMenu(null);
    splash.once('ready-to-show', () => { if (splash && !splash.isDestroyed()) { splash.show(); shownAt = Date.now(); } });
    splash.webContents.on('will-navigate', event => event.preventDefault());
    splash.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    void splash.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(splashHtml(version))).catch(() => {});
  } catch { splash = null; }
  return {
    window: () => splash,
    shownAt: () => shownAt,
    close() { if (splash && !splash.isDestroyed()) splash.destroy(); splash = null; },
  };
}

module.exports = { splashHtml, createReveal, openSplash };

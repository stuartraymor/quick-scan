// SPDX-License-Identifier: AGPL-3.0-only
// Startup recovery is deliberately disabled forever after the first React mount.
// Reloading an interactive document could discard unsaved work.
function createStartupGuard({ reload, report, failed, schedule = setTimeout, cancel = clearTimeout, timeoutMs = 20000 }) {
  let state = 'starting', retries = 0, timer;
  const log = event => report({ event, state, retries });
  const arm = () => { cancel(timer); timer = schedule(() => fail('timeout'), timeoutMs); };
  function fail(reason) {
    if (state === 'closed') return;
    if (state === 'ready') { log('ignored-after-ready'); return; }
    if (state !== 'starting') return;
    cancel(timer);
    log(['timeout', 'renderer-gone', 'load-failed', 'preload-failed', 'boot-error'].includes(reason) ? reason : 'boot-error');
    if (retries === 1) { state = 'failed'; log('failed'); failed(); return; }
    retries++;
    state = 'recovering';
    timer = schedule(() => {
      state = 'starting'; log('retry'); arm();
      Promise.resolve().then(() => { if (state === 'starting') return reload(); }).catch(() => fail('load-failed'));
    }, 250);
  }
  log('start'); arm();
  return {
    fail,
    ready() { if (state === 'closed' || state === 'ready') return; cancel(timer); state = 'ready'; log('ready'); },
    close() { cancel(timer); state = 'closed'; },
    get state() { return state; },
  };
}
// The renderer cancels unload while work is unsaved. Electron then drops the
// close silently unless the main process asks, so the window seemed stuck.
// Ask once; "Close without saving" lets the unload continue.
function createUnloadPrompt({ ask, automated = false, onKeep = () => {} }) {
  return event => {
    if (automated) { event.preventDefault(); return; }
    let choice = 1;
    try {
      choice = ask({
        type: 'warning', title: 'Unsaved changes', noLink: true,
        message: 'Close Quick Scan without saving?',
        detail: 'Your project has unsaved changes. Quick Scan keeps a local checkpoint of recent work that you can restore the next time it opens.',
        buttons: ['Close without saving', 'Keep working'], defaultId: 1, cancelId: 1,
      });
    } catch { choice = 1; }
    if (choice === 0) event.preventDefault();
    else { try { onKeep(); } catch { /* keeping the window open must never fail */ } }
  };
}

// "Restart to update": the installer closes any Quick Scan it finds running,
// so it starts only once the app is really quitting. If the user keeps
// working at the unsaved-changes prompt, nothing is installed and the button
// goes back to "Restart to update".
function createInstallOnQuit({ spawn, quit, delayMs = 300, schedule = setTimeout }) {
  let pending = null;
  return {
    request(file) {
      if (pending) return pending.promise;
      let resolve;
      const promise = new Promise(r => { resolve = r; });
      pending = { file, resolve, promise };
      schedule(() => quit(), delayMs);
      return promise;
    },
    kept() {
      if (!pending) return;
      const { resolve } = pending; pending = null;
      resolve({ status: 'cancelled', detail: 'The update will install when Quick Scan restarts.' });
    },
    quitting() {
      if (!pending) return false;
      const { file } = pending; pending = null;
      spawn(file);
      return true;
    },
    get pending() { return !!pending; },
  };
}

// Every version keeps its own profile, so an update used to start with
// default preferences. A new version's first launch copies the preferences
// (Local Storage) of the newest older version; never a newer one, never
// checkpoints, and never over a profile that already exists.
const PROFILE = /^QuickScan-v(\d+)\.(\d+)\.(\d+)$/;
const versionKey = name => { const m = PROFILE.exec(name); return m ? m.slice(1).map(Number) : null; };
const older = (a, b) => { for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i]; return false; };
function seedProfile({ appData, version, fs, path }) {
  const ownName = `QuickScan-v${version}`, own = versionKey(ownName), target = path.join(appData, ownName);
  if (!own || fs.existsSync(target)) return null;
  let best = null;
  try {
    for (const entry of fs.readdirSync(appData, { withFileTypes: true })) {
      const key = entry.isDirectory() && versionKey(entry.name);
      if (!key || !older(key, own) || (best && !older(best.key, key))) continue;
      if (fs.existsSync(path.join(appData, entry.name, 'Local Storage'))) best = { name: entry.name, key };
    }
  } catch { return null; }
  if (!best) return null;
  const to = path.join(target, 'Local Storage');
  try {
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(path.join(appData, best.name, 'Local Storage'), to, { recursive: true, filter: src => !/(^|[\\/])LOCK$/.test(src) });
    return best.name;
  } catch {
    try { fs.rmSync(to, { recursive: true, force: true }); } catch { /* fall back to defaults */ }
    return null;
  }
}
module.exports = { createStartupGuard, createUnloadPrompt, createInstallOnQuit, seedProfile };

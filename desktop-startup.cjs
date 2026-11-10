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
module.exports = { createStartupGuard };

// SPDX-License-Identifier: AGPL-3.0-only
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStartupGuard } = require('../desktop-startup.cjs');

function fixture(reloadError = false) {
  let id = 0, reloads = 0, failures = 0;
  const timers = new Map(), records = [];
  const guard = createStartupGuard({
    reload: () => { reloads++; if (reloadError) return Promise.reject(new Error('failure')); },
    failed: () => failures++, report: record => records.push(record),
    schedule: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    cancel: key => timers.delete(key),
  });
  return { guard, timers, records, get reloads() { return reloads; }, get failures() { return failures; },
    async tick() { const [key, timer] = timers.entries().next().value; timers.delete(key); timer.fn(); await new Promise(resolve => setImmediate(resolve)); },
  };
}
test('mounted app cancels startup timeout and never reloads after errors or renderer crash', async () => {
  const f = fixture(); f.guard.ready();
  for (const reason of ['renderer-gone', 'boot-error', 'load-failed', 'timeout']) f.guard.fail(reason);
  assert.equal(f.guard.state, 'ready'); assert.equal(f.timers.size, 0); assert.equal(f.reloads, 0); assert.equal(f.failures, 0);
});
for (const reason of ['renderer-gone', 'boot-error', 'load-failed', 'preload-failed', 'timeout']) {
  test(`${reason} retries once and reports a persistent failure without a reload loop`, async () => {
    const f = fixture(); f.guard.fail(reason); f.guard.fail(reason);
    await f.tick(); assert.equal(f.reloads, 1);
    f.guard.fail(reason); f.guard.fail(reason);
    assert.equal(f.guard.state, 'failed'); assert.equal(f.failures, 1); assert.equal(f.timers.size, 0);
  });
}
test('hung startup times out on both attempts', async () => {
  const f = fixture(); await f.tick(); await f.tick(); await f.tick();
  assert.equal(f.reloads, 1); assert.equal(f.failures, 1);
});
test('failed retry navigation is handled without an unhandled rejection', async () => {
  const f = fixture(true); f.guard.fail('load-failed'); await f.tick();
  assert.equal(f.failures, 1); assert.equal(f.timers.size, 0);
});
test('late ready cancels pending recovery and avoids discarding mounted state', async () => {
  const f = fixture(); f.guard.fail('boot-error'); f.guard.ready();
  assert.equal(f.timers.size, 0); assert.equal(f.reloads, 0);
});
test('successful retry becomes permanently ready', async () => {
  const f = fixture(); f.guard.fail('renderer-gone'); await f.tick(); f.guard.ready(); f.guard.fail('renderer-gone');
  assert.equal(f.reloads, 1); assert.equal(f.failures, 0); assert.equal(f.timers.size, 0);
});
test('closing the window cancels all recovery', () => {
  const f = fixture(); f.guard.fail('boot-error'); f.guard.close(); f.guard.ready(); f.guard.fail('timeout');
  assert.equal(f.timers.size, 0); assert.equal(f.guard.state, 'closed'); assert.equal(f.reloads, 0);
});
test('diagnostics never record arbitrary error text', () => {
  const f = fixture(); f.guard.fail('C:/private/project.scanruler');
  assert.equal(JSON.stringify(f.records).includes('private'), false);
});

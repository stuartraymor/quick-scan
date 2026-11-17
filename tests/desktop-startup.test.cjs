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

const { createUnloadPrompt } = require('../desktop-startup.cjs');
const unloadEvent = () => { const e = { allowed: false, preventDefault() { e.allowed = true; } }; return e; };
test('unsaved-work close asks instead of silently ignoring the window close', () => {
  const asked = [];
  const leave = unloadEvent(); createUnloadPrompt({ ask: o => { asked.push(o); return 0; } })(leave);
  assert.equal(leave.allowed, true); assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].buttons, ['Close without saving', 'Keep working']); assert.equal(asked[0].cancelId, 1);
  const stay = unloadEvent(); createUnloadPrompt({ ask: () => 1 })(stay); assert.equal(stay.allowed, false);
});
test('a failed prompt keeps the work open and automated smoke runs never block', () => {
  const failed = unloadEvent(); createUnloadPrompt({ ask: () => { throw new Error('no dialog'); } })(failed); assert.equal(failed.allowed, false);
  const smoke = unloadEvent(); createUnloadPrompt({ automated: true, ask: () => { throw new Error('must not ask'); } })(smoke); assert.equal(smoke.allowed, true);
});

const { createInstallOnQuit, seedProfile } = require('../desktop-startup.cjs');
const fsys = require('node:fs'), pth = require('node:path'), os = require('node:os');
const installFixture = () => {
  const spawned = [], timers = []; let quits = 0;
  const q = createInstallOnQuit({ spawn: f => spawned.push(f), quit: () => quits++, schedule: fn => timers.push(fn) });
  return { q, spawned, timers, get quits() { return quits; } };
};
test('the update installer starts only once Quick Scan is really quitting', () => {
  const f = installFixture(); void f.q.request('setup.exe');
  assert.equal(f.spawned.length, 0); f.timers.shift()(); assert.equal(f.quits, 1);
  assert.equal(f.spawned.length, 0, 'not while the unsaved-changes prompt may still keep the app open');
  assert.equal(f.q.quitting(), true); assert.deepEqual(f.spawned, ['setup.exe']);
  assert.equal(f.q.quitting(), false, 'an ordinary later quit installs nothing'); assert.equal(f.spawned.length, 1);
});
test('keep working at the prompt cancels the install and leaves the update ready', async () => {
  const f = installFixture(); const result = f.q.request('setup.exe'); f.timers.shift()();
  createUnloadPrompt({ ask: () => 1, onKeep: () => f.q.kept() })(unloadEvent());
  assert.deepEqual((await result).status, 'cancelled'); assert.equal(f.q.quitting(), false); assert.equal(f.spawned.length, 0);
  void f.q.request('setup.exe'); assert.equal(f.q.pending, true, 'the user can restart to update again');
});
test('close without saving lets the pending install go ahead', () => {
  const f = installFixture(); void f.q.request('setup.exe'); f.timers.shift()();
  const leave = unloadEvent(); createUnloadPrompt({ ask: () => 0, onKeep: () => f.q.kept() })(leave);
  assert.equal(leave.allowed, true); assert.equal(f.q.quitting(), true); assert.deepEqual(f.spawned, ['setup.exe']);
});
const profiles = layout => {
  const dir = fsys.mkdtempSync(pth.join(os.tmpdir(), 'qs-profiles-'));
  for (const [name, value] of Object.entries(layout)) {
    fsys.mkdirSync(pth.join(dir, name, 'Local Storage', 'leveldb'), { recursive: true });
    fsys.writeFileSync(pth.join(dir, name, 'Local Storage', 'leveldb', '000003.log'), value);
    fsys.writeFileSync(pth.join(dir, name, 'Local Storage', 'leveldb', 'LOCK'), '');
  }
  return dir;
};
const prefs = (dir, name) => fsys.readFileSync(pth.join(dir, name, 'Local Storage', 'leveldb', '000003.log'), 'utf8');
test('an updated version starts with the newest older version\'s preferences', () => {
  const dir = profiles({ 'QuickScan-v1.1.9': 'nine', 'QuickScan-v1.1.93': 'ninety-three', 'QuickScan-v1.1.93-verification': 'smoke', 'QuickScan-v2.0.0': 'newer' });
  try {
    assert.equal(seedProfile({ appData: dir, version: '1.1.94', fs: fsys, path: pth }), 'QuickScan-v1.1.93');
    assert.equal(prefs(dir, 'QuickScan-v1.1.94'), 'ninety-three');
    assert.equal(fsys.existsSync(pth.join(dir, 'QuickScan-v1.1.94', 'Local Storage', 'leveldb', 'LOCK')), false);
    assert.equal(seedProfile({ appData: dir, version: '1.1.94', fs: fsys, path: pth }), null, 'an existing profile is never overwritten');
  } finally { fsys.rmSync(dir, { recursive: true, force: true }); }
});
test('preferences never come from a newer version and a fresh install starts clean', () => {
  const dir = profiles({ 'QuickScan-v2.0.0': 'newer' });
  try {
    assert.equal(seedProfile({ appData: dir, version: '1.1.94', fs: fsys, path: pth }), null);
    assert.equal(fsys.existsSync(pth.join(dir, 'QuickScan-v1.1.94')), false);
    assert.equal(seedProfile({ appData: pth.join(dir, 'missing'), version: '1.1.94', fs: fsys, path: pth }), null);
  } finally { fsys.rmSync(dir, { recursive: true, force: true }); }
});
test('a failed copy leaves no partial preferences behind', () => {
  const dir = profiles({ 'QuickScan-v1.1.93': 'x' });
  try {
    const broken = { ...fsys, cpSync: (from, to) => { fsys.mkdirSync(to, { recursive: true }); throw Object.assign(new Error('busy'), { code: 'EBUSY' }); } };
    assert.equal(seedProfile({ appData: dir, version: '1.1.94', fs: broken, path: pth }), null);
    assert.equal(fsys.existsSync(pth.join(dir, 'QuickScan-v1.1.94', 'Local Storage')), false);
  } finally { fsys.rmSync(dir, { recursive: true, force: true }); }
});
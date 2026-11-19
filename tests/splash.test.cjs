// SPDX-License-Identifier: AGPL-3.0-only
const test = require('node:test');
const assert = require('node:assert/strict');
const { createReveal, splashHtml } = require('../splash.cjs');

function clock() {
  let t = 0, id = 0; const timers = new Map();
  return {
    now: () => t,
    schedule: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    cancel: h => timers.delete(h),
    advance(ms) { t += ms; for (const [h, x] of [...timers].sort((a, b) => a[1].at - b[1].at)) if (x.at <= t && timers.has(h)) { timers.delete(h); x.fn(); } },
    pending: () => timers.size,
  };
}

test('ready shows the main window no sooner than the minimum splash time', () => {
  const c = clock(), log = [];
  const r = createReveal({ show: () => log.push('show'), closeSplash: () => log.push('close'), ...c, minMs: 900, maxMs: 15000 });
  c.advance(200); r.ready();
  assert.deepEqual(log, []);
  c.advance(699); assert.deepEqual(log, []);
  c.advance(1); assert.deepEqual(log, ['show', 'close']);
  assert.equal(r.done, true); assert.equal(c.pending(), 0);
});

test('ready after the minimum reveals at once, exactly once', () => {
  const c = clock(), log = [];
  const r = createReveal({ show: () => log.push('show'), closeSplash: () => log.push('close'), ...c });
  c.advance(2000); r.ready(); r.ready(); r.now(); c.advance(20000);
  assert.deepEqual(log, ['show', 'close']);
});

test('the minimum counts from when the splash became visible, not when it was created', () => {
  const c = clock(), log = []; let visible = null;
  const r = createReveal({ show: () => log.push('show'), closeSplash: () => log.push('close'), shownAt: () => visible, ...c, minMs: 900 });
  c.advance(1500); visible = c.now(); c.advance(100); r.ready();
  c.advance(799); assert.deepEqual(log, []);
  c.advance(1); assert.deepEqual(log, ['show', 'close']);
});

test('ready before the splash is visible still keeps it for the minimum', () => {
  const c = clock(), log = [];
  const r = createReveal({ show: () => log.push('show'), closeSplash: () => log.push('close'), shownAt: () => null, ...c, minMs: 900 });
  c.advance(3000); r.ready(); c.advance(899); assert.deepEqual(log, []);
  c.advance(1); assert.deepEqual(log, ['show', 'close']);
});

test('safety timeout reveals a window that never reports ready', () => {
  const c = clock(), log = [];
  createReveal({ show: () => log.push('show'), closeSplash: () => log.push('close'), ...c, maxMs: 15000 });
  c.advance(14999); assert.deepEqual(log, []);
  c.advance(1); assert.deepEqual(log, ['show', 'close']);
});

test('failure path reveals immediately and still closes the splash if show throws', () => {
  const c = clock(), log = [];
  const r = createReveal({ show: () => { throw Error('gone'); }, closeSplash: () => log.push('close'), ...c });
  assert.throws(() => r.now());
  assert.deepEqual(log, ['close']); assert.equal(c.pending(), 0);
});

test('splash page escapes the version and allows no scripts or remote content', () => {
  const html = splashHtml('1.2.2<script>');
  assert.match(html, /v1\.2\.2&lt;script&gt;/);
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /default-src 'none'/);
});

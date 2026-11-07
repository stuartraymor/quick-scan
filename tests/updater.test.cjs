const test = require('node:test'), assert = require('node:assert'), crypto = require('node:crypto'), os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const u = require('../updater.cjs');
const P = 'https://github.com/stuartraymor/quick-scan/releases/download/v0.0.5/';
const bytes = Buffer.from('installer-bytes'), sha = crypto.createHash('sha256').update(bytes).digest('hex');
const rel = (over = {}) => ({ tag_name: 'v0.0.5', body: 'n', html_url: 'x', assets: [{ name: 'Quick-Scan-Setup-0.0.5.exe', browser_download_url: P + 'Quick-Scan-Setup-0.0.5.exe', size: bytes.length }, { name: 'Quick-Scan-Setup-0.0.5.exe.sha256', browser_download_url: P + 's' }], ...over });
const fakeFetch = (r, status = 200, data = bytes, sum = sha) => async url => url.includes('api.github.com') ? { ok: status < 400, status, json: async () => r }
  : url.endsWith('/s') ? { ok: true, text: async () => `${sum}  Quick-Scan-Setup-0.0.5.exe` }
  : { ok: true, status: 200, headers: { get: () => String(data.length) }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(data)); c.close(); } }) };
test('version compare', () => { assert(u.isNewer('0.0.10', '0.0.9')); assert(!u.isNewer('0.0.4', '0.0.4')); assert(!u.isNewer('junk', '0.0.4')); });
test('newer release available', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch(rel()), current: '0.0.4' })).status, 'available'));
test('same version is current', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch(rel()), current: '0.0.5' })).status, 'current'));
test('no releases (404)', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch({}, 404), current: '0.0.4' })).status, 'none'));
test('prerelease ignored', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch(rel({ prerelease: true })), current: '0.0.4' })).status, 'current'));
test('off-repo asset rejected', async () => { const r = rel(); r.assets[0].browser_download_url = 'https://evil.example/Quick-Scan-Setup-0.0.5.exe'; assert.equal((await u.checkForUpdate({ fetch: fakeFetch(r), current: '0.0.4' })).status, 'error'); });
test('missing checksum rejected', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch(rel({ assets: [rel().assets[0]] })), current: '0.0.4' })).status, 'error'));
test('download verifies and saves', async () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-')); const f = await u.downloadUpdate({ fetch: fakeFetch(rel()), release: rel(), dir: d }); assert.deepEqual(fs.readFileSync(f), bytes); });
// U-01: the rename into place once failed with EBUSY (a scanner still held the
// file). The move now waits out a transient lock with a back-off.
const busy = code => Object.assign(new Error(code), { code });
test('rename waits out EBUSY then succeeds', async () => {
  const slept = [], outcomes = [busy('EBUSY'), busy('EPERM'), null]; let calls = 0;
  const rename = async () => { calls++; const e = outcomes.shift(); if (e) throw e; };
  await u.renameWithRetry('a.part', 'a', { rename, sleep: async ms => { slept.push(ms); } });
  assert.equal(calls, 3); assert.deepEqual(slept, [50, 100]);
});
test('rename gives up after the back-off and reports the lock', async () => {
  let calls = 0; const rename = async () => { calls++; throw busy('EBUSY'); };
  await assert.rejects(u.renameWithRetry('a.part', 'a', { rename, sleep: async () => {} }), { code: 'EBUSY' });
  assert.equal(calls, u.RENAME_DELAYS_MS.length + 1);
});
test('rename does not retry other errors', async () => {
  let calls = 0; const rename = async () => { calls++; throw busy('ENOENT'); };
  await assert.rejects(u.renameWithRetry('a.part', 'a', { rename, sleep: async () => { assert.fail('slept'); } }), { code: 'ENOENT' });
  assert.equal(calls, 1);
});
test('download survives a transient lock on the rename', async () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-')); const real = fs.promises.rename; let first = true;
  fs.promises.rename = async (a, b) => { if (first) { first = false; throw busy('EBUSY'); } return real(a, b); };
  try { const f = await u.downloadUpdate({ fetch: fakeFetch(rel()), release: rel(), dir: d }); assert.deepEqual(fs.readFileSync(f), bytes); assert.deepEqual(fs.readdirSync(d), ['Quick-Scan-Setup-0.0.5.exe']); }
  finally { fs.promises.rename = real; }
});
test('hash mismatch discarded', async () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-')); await assert.rejects(u.downloadUpdate({ fetch: fakeFetch(rel(), 200, bytes, 'a'.repeat(64)), release: rel(), dir: d }), /SHA-256/); assert.deepEqual(fs.readdirSync(d), []); });

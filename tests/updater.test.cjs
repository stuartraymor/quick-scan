const test = require('node:test'), assert = require('node:assert'), crypto = require('node:crypto'), os = require('node:os'), fs = require('node:fs'), path = require('node:path');
const u = require('../updater.cjs');
const P = 'https://github.com/stuartraymor/quick-scan/releases/download/v0.0.5/';
const bytes = Buffer.from('installer-bytes'), sha = crypto.createHash('sha256').update(bytes).digest('hex');
const rel = (over = {}) => ({ tag_name: 'v0.0.5', body: 'n', html_url: 'x', assets: [{ name: 'Quick-Scan-Setup-0.0.5.exe', browser_download_url: P + 'Quick-Scan-Setup-0.0.5.exe', size: bytes.length }, { name: 'Quick-Scan-Setup-0.0.5.exe.sha256', browser_download_url: P + 'Quick-Scan-Setup-0.0.5.exe.sha256' }], ...over });
const fakeFetch = (r, status = 200, data = bytes, sum = sha) => async url => url.includes('api.github.com') ? { ok: status < 400, status, json: async () => r }
  : url.endsWith('.sha256') || url.endsWith('/SHA256SUMS.txt') ? { ok: true, text: async () => `${sum}  Quick-Scan-Setup-0.0.5.exe` }
  : { ok: true, status: 200, headers: { get: () => String(data.length) }, body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(data)); c.close(); } }) };
test('version compare', () => { assert(u.isNewer('0.0.10', '0.0.9')); assert(!u.isNewer('0.0.4', '0.0.4')); assert(!u.isNewer('junk', '0.0.4')); });
test('newer release available', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch(rel()), current: '0.0.4' })).status, 'available'));
test('same version is current', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch(rel()), current: '0.0.5' })).status, 'current'));
test('no releases (404)', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch({}, 404), current: '0.0.4' })).status, 'none'));
test('prerelease ignored', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch(rel({ prerelease: true })), current: '0.0.4' })).status, 'current'));
test('off-repo asset rejected', async () => { const r = rel(); r.assets[0].browser_download_url = 'https://evil.example/Quick-Scan-Setup-0.0.5.exe'; assert.equal((await u.checkForUpdate({ fetch: fakeFetch(r), current: '0.0.4' })).status, 'error'); });
test('missing checksum rejected', async () => assert.equal((await u.checkForUpdate({ fetch: fakeFetch(rel({ assets: [rel().assets[0]] })), current: '0.0.4' })).status, 'error'));

const manifestRelease = () => rel({ assets: [rel().assets[0], { name: 'SHA256SUMS.txt', browser_download_url: P + 'SHA256SUMS.txt' }] });
const fetchChecksum = (release, text, status = 200) => {
  const regular = fakeFetch(release);
  return async url => url.endsWith('/SHA256SUMS.txt') || url.endsWith('.sha256')
    ? { ok: status === 200, status, text: async () => text } : regular(url);
};

test('release with only SHA256SUMS.txt is available', async () => {
  assert.equal((await u.checkForUpdate({ fetch: fakeFetch(manifestRelease()), current: '0.0.4' })).status, 'available');
});

test('installer version and asset URL must match the release tag', () => {
  assert.equal(u.pickAssets(rel({ tag_name: 'v0.0.6' })), null);
  for (const index of [0, 1]) {
    const r = rel(); r.assets[index].browser_download_url = r.assets[index].browser_download_url.replace('/v0.0.5/', '/v0.0.4/');
    assert.equal(u.pickAssets(r), null);
  }
});

test('manifest download selects installer hash, not the source archive first', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-manifest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = manifestRelease();
  const text = `\uFEFF${'a'.repeat(64)}  Quick-Scan-0.0.5-source.zip\r\n${sha.toUpperCase()} *Quick-Scan-Setup-0.0.5.exe\r\n`;
  const file = await u.downloadUpdate({ fetch: fetchChecksum(release, text), release, dir });
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('legacy hash-only sidecar remains supported', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-sidecar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = rel();
  const file = await u.downloadUpdate({ fetch: fetchChecksum(release, sha + '\n'), release, dir });
  assert.deepEqual(fs.readFileSync(file), bytes);
});

test('manifest is preferred when both checksum formats are published', () => {
  const r = manifestRelease(); r.assets.push(rel().assets[1]);
  assert.equal(u.pickAssets(r).sum.name, 'SHA256SUMS.txt');
});

test('an off-repository checksum manifest is refused', () => {
  const r = manifestRelease(); r.assets[1].browser_download_url = 'https://example.com/SHA256SUMS.txt';
  assert.equal(u.pickAssets(r), null);
});

test('a sidecar naming another installer is refused', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-wrong-sidecar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = rel();
  await assert.rejects(u.downloadUpdate({ fetch: fetchChecksum(release, `${sha}  Quick-Scan-Setup-0.0.4.exe`), release, dir }), /exactly one entry/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('an installer HTTP failure is reported without saving bytes', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-http-failure-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const release = manifestRelease(), checksumFetch = fetchChecksum(release, `${sha}  Quick-Scan-Setup-0.0.5.exe`);
  await assert.rejects(u.downloadUpdate({ release, dir, fetch: url => url.endsWith('/SHA256SUMS.txt') ? checksumFetch(url) : { ok: false, status: 503 } }), /Download failed \(503\)/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('checksum errors never download or save an installer', async t => {
  const cases = [
    ['missing exact filename', `${sha}  Quick-Scan-0.0.5-source.zip`, 200, /exactly one entry/],
    ['wrong installer version', `${sha}  Quick-Scan-Setup-0.0.4.exe`, 200, /exactly one entry/],
    ['duplicate filename', `${sha}  Quick-Scan-Setup-0.0.5.exe\n${sha}  Quick-Scan-Setup-0.0.5.exe`, 200, /exactly one entry/],
    ['hash without filename in manifest', sha, 200, /malformed/],
    ['invalid hash', `${'g'.repeat(64)}  Quick-Scan-Setup-0.0.5.exe`, 200, /malformed/],
    ['too-long hash', `${sha}a  Quick-Scan-Setup-0.0.5.exe`, 200, /malformed/],
    ['checksum HTTP error', `${sha}  Quick-Scan-Setup-0.0.5.exe`, 404, /Checksum download failed \(404\)/],
  ];
  for (const [name, text, status, expected] of cases) await t.test(name, async t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-bad-sum-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const release = manifestRelease(), checksumFetch = fetchChecksum(release, text, status);
    await assert.rejects(u.downloadUpdate({ release, dir, fetch: url => { assert(url.endsWith('/SHA256SUMS.txt'), 'installer must not be fetched'); return checksumFetch(url); } }), expected);
    assert.deepEqual(fs.readdirSync(dir), []);
  });
});
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

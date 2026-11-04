const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const r = require('../recents.cjs');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qs-rec-')), list = path.join(dir, 'recent.json');
const mk = n => { const p = path.join(dir, n); fs.writeFileSync(p, 'x'); return p; };
test('remembers newest first and moves repeats to the top', () => {
  const a = mk('a.stl'), b = mk('b.scanruler');
  r.remember(list, a, 1); r.remember(list, b, 2); const out = r.remember(list, a, 3);
  assert.deepEqual(out.map(e => e.name), ['a.stl', 'b.scanruler']);
});
test('refuses unsupported or relative paths', () => { const n = r.load(list).length; r.remember(list, path.join(dir, 'x.exe')); r.remember(list, 'rel.stl'); assert.equal(r.load(list).length, n); });
test('caps the list', () => { for (let i = 0; i < 20; i++) r.remember(list, mk(`f${i}.obj`)); assert.equal(r.load(list).length, r.MAX); });
test('reads only listed files and flags missing ones', () => {
  const p = mk('listed.ply'); r.remember(list, p);
  assert.equal(r.read(list, p).data.toString(), 'x');
  assert.throws(() => r.read(list, mk('unlisted.ply')), /not in the recent list/);
  fs.unlinkSync(p); assert.equal(r.describe(list).find(e => e.path === p).exists, false);
});
test('corrupt file is an empty list; clear empties', () => { fs.writeFileSync(list, '{nope'); assert.deepEqual(r.load(list), []); r.remember(list, mk('z.stl')); assert.deepEqual(r.clear(list), []); });

test('project save replaces the whole archive and preserves the old file on failure', async () => {
  const target = mk('existing.scanruler');
  const archive = Uint8Array.from([0x50, 0x4b, 3, 4]);
  await r.writeProject(target, archive);
  assert.deepEqual(fs.readFileSync(target), Buffer.from(archive));
  await assert.rejects(r.writeProject(target, new Uint8Array(1)), /Invalid project/);
  assert.deepEqual(fs.readFileSync(target), Buffer.from(archive));
  const locked = path.join(dir, 'directory.scanruler');
  fs.mkdirSync(locked);
  await assert.rejects(r.writeProject(locked, archive));
  assert.ok(fs.statSync(locked).isDirectory());
  assert.equal(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 0);
});

// SPDX-License-Identifier: AGPL-3.0-only
// Recent documents for the desktop app: a short list of files the user opened
// or saved, kept in one file shared by every Quick Scan version. Pure of
// Electron so it can be tested.
const fs = require('node:fs');
const path = require('node:path');

const MAX = 12;
const LARGEST = 1.5 * 1024 ** 3;
const OPENABLE = new Set(['.scanruler', '.stl', '.ply', '.obj', '.3mf', '.step', '.stp', '.png', '.jpg', '.jpeg']);

const allowed = p => typeof p === 'string' && path.isAbsolute(p) && OPENABLE.has(path.extname(p).toLowerCase());

function load(file) {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list.filter(e => e && allowed(e.path) && Number.isFinite(e.openedAt)).slice(0, MAX) : [];
  } catch { return []; }
}
function save(file, list) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list)); } catch { /* a list that cannot be kept is not worth failing a save */ }
}
/** Put `p` first (moving it if present). Returns the new list, or the old one for a path that may not be listed. */
function remember(file, p, now = Date.now()) {
  const list = load(file);
  if (!allowed(p)) return list;
  const next = [{ path: p, name: path.basename(p), openedAt: now }, ...list.filter(e => e.path.toLowerCase() !== p.toLowerCase())].slice(0, MAX);
  save(file, next);
  return next;
}
const clear = file => { save(file, []); return []; };
/** The list with whether each file is still there. */
const describe = file => load(file).map(e => ({ ...e, folder: path.dirname(e.path), exists: fs.existsSync(e.path) }));
/** Read a listed file; refuses anything that is not on the list or is too large. */
function read(file, p) {
  if (!load(file).some(e => e.path === p)) throw new Error('That file is not in the recent list.');
  const size = fs.statSync(p).size;
  if (size > LARGEST) throw new Error('That file is too large to open from the recent list.');
  return { name: path.basename(p), data: fs.readFileSync(p) };
}
/** Replace only a complete project archive. A failed write leaves the previous
 *  file intact, including when the disk is full or the destination is locked. */
async function writeProject(file, bytes) {
  if (!path.isAbsolute(file) || path.extname(file).toLowerCase() !== '.scanruler') throw Error('Choose a .scanruler project file.');
  if (!(bytes instanceof Uint8Array) || bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw Error('Invalid project archive.');
  const temp = path.join(path.dirname(file), `.quickscan-${require('node:crypto').randomUUID()}.tmp`);
  const handle = await fs.promises.open(temp, 'wx');
  try {
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.promises.rename(temp, file);
  } finally {
    await fs.promises.rm(temp, { force: true }).catch(() => {});
  }
}
module.exports = { writeProject, MAX, allowed, load, remember, clear, describe, read };

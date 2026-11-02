// SPDX-License-Identifier: AGPL-3.0-only
// Native setup is callable only from the app's guarded IPC handler. Tests use
// explicit temporary directories; no renderer-supplied filesystem paths exist.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomBytes } = require('node:crypto');

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function mergeJson(text, entry) {
  let data;
  try { data = text.trim() ? JSON.parse(text) : {}; }
  catch { throw Error('Invalid JSON. The file was left unchanged; repair its syntax and try again.'); }
  if (!plain(data) || (data.mcpServers !== undefined && !plain(data.mcpServers))) throw Error('Expected a JSON object with an mcpServers object. The file was left unchanged.');
  const existed = Object.hasOwn(data.mcpServers ?? {}, 'scanruler');
  return { text: JSON.stringify({ ...data, mcpServers: { ...data.mcpServers, scanruler: entry } }, null, 2) + '\n', existed };
}

// Recognize table headers outside multiline strings. An instruction containing
// a sample [mcp_servers.scanruler] must never become a write location.
function headers(text) {
  let triple = null, offset = 0;
  const out = [];
  for (const line of text.split(/(?<=\n)/)) {
    if (!triple) {
      const m = /^\s*(\[\[?)([^\]\n]+)(\]\]?)\s*(?:#.*)?$/.exec(line.trimEnd());
      if (m && m[1].length === m[3].length) out.push({ start: offset, key: m[2].replace(/\s+/g, '').replace(/["']/g, ''), array: m[1].length === 2 });
    }
    let quote = null;
    for (let i = 0; i < line.length; i++) {
      if (triple) { if (line.startsWith(triple, i) && (triple === "'''" || line[i - 1] !== '\\')) { i += 2; triple = null; } continue; }
      if (quote) { if (line[i] === quote && (quote === "'" || line[i - 1] !== '\\')) quote = null; continue; }
      if (line[i] === '#') break;
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) { triple = line.slice(i, i + 3); i += 2; }
      else if (line[i] === '"' || line[i] === "'") quote = line[i];
    }
    offset += line.length;
  }
  if (triple) throw Error('Unclosed TOML multiline string. The file was left unchanged.');
  return out;
}
function mergeToml(text, entry) {
  const list = headers(text), target = 'mcp_servers.scanruler';
  if (list.some(h => h.array && (h.key === target || h.key.startsWith(target + '.')))) throw Error('The scanruler entry must be a TOML table, not an array table. The file was left unchanged.');
  if (list.filter(h => h.key === target).length > 1) throw Error('Duplicate scanruler TOML tables. The file was left unchanged.');
  const ranges = list.map((h, i) => ({ ...h, end: list[i + 1]?.start ?? text.length })).filter(h => h.key === target || h.key.startsWith(target + '.'));
  const existed = ranges.length > 0;
  let section = `[mcp_servers.scanruler]\ncommand = ${JSON.stringify(entry.command)}\nargs = ${JSON.stringify(entry.args)}\nstartup_timeout_sec = 60\ntool_timeout_sec = 300\n`;
  if (entry.env) {
    section += '\n[mcp_servers.scanruler.env]\n';
    for (const [key, value] of Object.entries(entry.env)) section += `${key} = ${JSON.stringify(value)}\n`;
  }
  if (ranges.length) {
    let merged = text.slice(0, ranges[0].start) + section, cursor = ranges[0].end;
    for (const range of ranges.slice(1)) { merged += text.slice(cursor, range.start); cursor = range.end; }
    return { text: merged + text.slice(cursor), existed };
  }
  return { text: text + (text && !text.endsWith('\n') ? '\n' : '') + (text ? '\n' : '') + section, existed };
}
function writeMerged(file, text, backup = true) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const exists = fs.existsSync(file);
  if (exists && fs.readFileSync(file, 'utf8') === text) return false;
  if (exists && backup) fs.copyFileSync(file, file + '.bak-quickscan');
  const temporary = file + `.quickscan-${process.pid}-${randomBytes(5).toString('hex')}.tmp`;
  try { fs.writeFileSync(temporary, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' }); fs.renameSync(temporary, file); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
  return true;
}
function locations(options = {}) {
  const env = options.env ?? process.env, home = options.home ?? os.homedir();
  const appData = options.appData ?? env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
  return { home, appData, env, documents: options.documents ?? path.join(home, 'Documents'), configDir: env.SCANRULER_MCP_CONFIG_DIR || path.join(appData, 'scanruler-mcp'), sharedDir: path.join(appData, 'QuickScan-shared') };
}
function pairing(options = {}, create = true) {
  const loc = locations(options), file = path.join(loc.configDir, 'config.json');
  let data = {};
  if (fs.existsSync(file)) {
    try { data = JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch { throw Error('The Quick Scan connector config.json has invalid JSON. It was left unchanged.'); }
    if (!plain(data)) throw Error('The connector config.json must contain an object. It was left unchanged.');
  } else if (!create) return null;
  const port = Number(loc.env.SCANRULER_MCP_PORT ?? data.port ?? 7317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('The connector port must be a whole number from 1 to 65535.');
  const token = typeof data.token === 'string' && /^[\w-]{16,}$/.test(data.token) ? data.token : create ? randomBytes(24).toString('base64url') : null;
  if (!token) return null;
  if (create) writeMerged(file, JSON.stringify({ ...data, token, port }, null, 2) + '\n');
  return { port, token };
}
function setup(options = {}) {
  const loc = locations(options), pair = pairing(options);
  const args = ['-y', 'scanruler-mcp@latest', '--port', String(pair.port)];
  const env = loc.env.SCANRULER_MCP_CONFIG_DIR ? { SCANRULER_MCP_CONFIG_DIR: loc.configDir } : undefined;
  const entry = { command: 'npx', args, ...(env ? { env } : {}) };
  const desktopOut = path.join(loc.documents, 'Quick Scan');
  const targets = [
    { app: 'Claude Code', folder: path.join(loc.home, '.claude'), file: path.join(loc.home, '.claude.json'), entry },
    { app: 'Claude Desktop', folder: path.join(loc.appData, 'Claude'), file: path.join(loc.appData, 'Claude', 'claude_desktop_config.json'), entry: { ...entry, args: [...args, '--out', desktopOut] } },
    { app: 'Codex', folder: path.join(loc.home, '.codex'), file: path.join(loc.home, '.codex', 'config.toml'), entry, toml: true },
  ];
  const apps = targets.map(t => {
    if (!fs.existsSync(t.folder) && !fs.existsSync(t.file)) return { app: t.app, status: 'not-installed', detail: 'No existing app configuration folder was found.' };
    try {
      const text = fs.existsSync(t.file) ? fs.readFileSync(t.file, 'utf8') : '';
      const merged = (t.toml ? mergeToml : mergeJson)(text, t.entry);
      const changed = writeMerged(t.file, merged.text);
      if (t.app === 'Claude Desktop') fs.mkdirSync(desktopOut, { recursive: true });
      return { app: t.app, status: merged.existed ? 'updated' : 'added', detail: changed ? 'Connector configured. Restart this AI app once.' : 'Connector is already configured. Restart this AI app if it is not connected.' };
    } catch (error) { return { app: t.app, status: 'error', detail: error.message }; }
  });
  return { ...pair, apps };
}
function remember(state, options = {}) {
  if (!state || typeof state.enabled !== 'boolean' || typeof state.consent !== 'boolean') throw Error('Invalid connection preference.');
  const file = path.join(locations(options).sharedDir, 'agent-preferences.json');
  writeMerged(file, JSON.stringify({ enabled: state.enabled && state.consent, consent: state.consent }, null, 2) + '\n', false);
  return true;
}
function remembered(options = {}) {
  const file = path.join(locations(options).sharedDir, 'agent-preferences.json');
  if (!fs.existsSync(file)) return null;
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
  if (typeof state.enabled !== 'boolean' || state.consent !== true) return null;
  const pair = pairing(options, false);
  return pair ? { enabled: state.enabled, consent: true, ...pair } : null;
}
module.exports = { mergeJson, mergeToml, pairing, setup, remember, remembered };

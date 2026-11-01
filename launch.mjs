import { spawn } from 'node:child_process';
import { existsSync, openSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('.', import.meta.url));
const url = 'http://127.0.0.1:5187/';
async function ready() {
  try { const r = await fetch(url, {signal: AbortSignal.timeout(1500)}); return r.ok && (await r.text()).includes('<title>Quick Scan'); } catch { return false; }
}
if (!(await ready())) {
  const log = openSync(new URL('server.log', import.meta.url), 'a');
  const child = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', '5187', '--strictPort'], {cwd: root, detached: true, windowsHide: true, stdio: ['ignore', log, log]});
  child.unref();
  for (let i = 0; i < 60 && !(await ready()); i++) await new Promise(r => setTimeout(r, 500));
  if (!(await ready())) throw new Error('Quick Scan could not start; see server.log');
}
if (!process.argv.includes('--no-window')) {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const child = spawn(existsSync(chrome) ? chrome : edge, [`--app=${url}`, `--user-data-dir=${root}app-profile`, '--no-first-run', '--no-default-browser-check'], {detached: true, windowsHide: true, stdio: 'ignore'});
  child.unref();
}

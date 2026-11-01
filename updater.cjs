// SPDX-License-Identifier: AGPL-3.0-only
// Quick Scan self-update: ask GitHub for the latest release, download the
// Windows setup program next to its published SHA-256, verify it, then run it.
// Pure of Electron so it can be tested; the caller supplies fetch and paths.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'stuartraymor/quick-scan';
const SETUP = /^Quick-Scan-Setup-(\d+\.\d+\.\d+)\.exe$/;
const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`;

const parse = v => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim()); return m ? m.slice(1).map(Number) : null; };
const isNewer = (candidate, current) => {
  const a = parse(candidate), b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
};

/** Pick the setup program and its checksum from a release; null if either is missing or off-repo. */
function pickAssets(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const setup = assets.find(a => SETUP.test(a?.name ?? '') && String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX));
  const sum = setup && assets.find(a => a?.name === `${setup.name}.sha256` && String(a.browser_download_url).startsWith(DOWNLOAD_PREFIX));
  return setup && sum ? { setup, sum } : null;
}

async function checkForUpdate({ fetch, current, repo = REPO }) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Quick-Scan-Updater' } });
  if (response.status === 404) return { status: 'none', detail: 'No published releases were found.' };
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`);
  const release = await response.json();
  const version = String(release.tag_name ?? '').replace(/^v/, '');
  if (release.draft || release.prerelease || !parse(version)) return { status: 'current', version: current };
  if (!isNewer(version, current)) return { status: 'current', version: current };
  if (!pickAssets(release)) return { status: 'error', detail: `Release ${version} has no verified Windows installer.` };
  return { status: 'available', version, notes: String(release.body ?? '').slice(0, 4000), url: release.html_url, release };
}

async function downloadUpdate({ fetch, release, dir, onProgress = () => {} }) {
  const picked = pickAssets(release);
  if (!picked) throw new Error('No verified Windows installer in this release.');
  const sumText = await (await fetch(picked.sum.browser_download_url)).text();
  const expected = /^[0-9a-f]{64}/i.exec(sumText.trim())?.[0]?.toLowerCase();
  if (!expected) throw new Error('The published checksum is malformed.');
  const response = await fetch(picked.setup.browser_download_url);
  if (!response.ok || !response.body) throw new Error(`Download failed (${response.status}).`);
  await fs.promises.mkdir(dir, { recursive: true });
  const target = path.join(dir, picked.setup.name);
  const partial = target + '.part';
  const total = Number(response.headers.get('content-length')) || picked.setup.size || 0;
  const hash = crypto.createHash('sha256');
  const out = fs.createWriteStream(partial);
  let received = 0;
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value); received += value.length;
      if (!out.write(value)) await new Promise(r => out.once('drain', r));
      onProgress(total ? Math.min(1, received / total) : 0);
    }
  } finally { await new Promise(r => out.end(r)); }
  if (hash.digest('hex') !== expected) { await fs.promises.rm(partial, { force: true }); throw new Error('The download did not match its published SHA-256 and was discarded.'); }
  await fs.promises.rename(partial, target);
  return target;
}

module.exports = { REPO, parse, isNewer, pickAssets, checkForUpdate, downloadUpdate };

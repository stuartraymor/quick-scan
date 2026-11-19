// SPDX-License-Identifier: AGPL-3.0-only
// Points every Download button straight at the latest installer and shows its
// version, size and SHA-256 (from GitHub's release asset digest). Without
// JavaScript, or if the API is unreachable, the buttons keep linking to the
// releases/latest page, which always works.
(() => {
  const API = 'https://api.github.com/repos/stuartraymor/quick-scan/releases/latest';
  const KEY = 'qs-latest-release-v1';
  const $$ = (sel) => document.querySelectorAll(sel);
  const set = (sel, fn) => $$(sel).forEach(fn);

  function apply(r) {
    if (!r || !r.url) return;
    const mb = r.size ? `${Math.round(r.size / 1048576)} MB` : '';
    const date = r.date ? new Date(r.date).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    set('a[data-download]', (a) => { a.href = r.url; });
    set('[data-dl-meta]', (el) => { el.textContent = [`v${r.version}`, '64-bit', mb].filter(Boolean).join(' · '); });
    set('[data-dl-name]', (el) => { el.textContent = r.name; });
    set('[data-dl-name-plain]', (el) => { el.textContent = r.name; });
    set('[data-dl-size]', (el) => { el.textContent = [mb, date && `released ${date}`].filter(Boolean).join(' · '); });
    if (r.sha256) {
      set('[data-dl-hash]', (el) => { el.textContent = r.sha256; });
      set('button[data-copy="#hash"]', (b) => { b.hidden = false; });
      set('[data-dl-cmd]', (el) => { el.textContent = `(Get-FileHash .\\${r.name}).Hash -eq '${r.sha256}'`; });
    } else {
      set('[data-dl-cmd]', (el) => { el.textContent = `Get-FileHash .\\${r.name}`; });
    }
  }

  function parse(json) {
    const asset = (json.assets || []).find((a) => /^Quick-Scan-Setup-.*\.exe$/i.test(a.name));
    if (!asset) return null;
    const digest = typeof asset.digest === 'string' && /^sha256:[0-9a-f]{64}$/i.test(asset.digest) ? asset.digest.slice(7).toUpperCase() : '';
    return { url: asset.browser_download_url, name: asset.name, size: asset.size, sha256: digest, version: String(json.tag_name || '').replace(/^v/, ''), date: json.published_at };
  }

  try { apply(JSON.parse(sessionStorage.getItem(KEY))); } catch { /* storage unavailable */ }
  fetch(API, { headers: { Accept: 'application/vnd.github+json' } })
    .then((res) => (res.ok ? res.json() : Promise.reject(res.status)))
    .then((json) => { const r = parse(json); if (!r) return; apply(r); try { sessionStorage.setItem(KEY, JSON.stringify(r)); } catch { /* ignore */ } })
    .catch(() => { /* keep the releases/latest fallback */ });

  set('button[data-copy]', (btn) => btn.addEventListener('click', async () => {
    const text = document.querySelector(btn.dataset.copy)?.textContent ?? '';
    try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; } catch { btn.textContent = 'Select & copy'; }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1600);
  }));

})();

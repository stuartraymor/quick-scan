// SPDX-License-Identifier: AGPL-3.0-only
// Renders the installer wizard images from HTML at exact pixel sizes.
// Run: node_modules/electron/dist/electron.exe installer/art/render.cjs
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs'), path = require('node:path');
const out = path.join(__dirname, '..', 'assets');
const mark = fs.readFileSync(path.join(__dirname, 'mark.svg'), 'utf8');
const side = (w, h) => { const s = w / 164; return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:#101317;font-family:"Segoe UI Variable Display","Segoe UI",sans-serif;color:#eef4f9}
.bg{position:absolute;inset:0;background:radial-gradient(ellipse at 30% 18%,#1b4f78 0,#12283b 38%,#101317 75%)}
.grid{position:absolute;inset:0;background-image:linear-gradient(#ffffff0d ${s}px,transparent ${s}px),linear-gradient(90deg,#ffffff0d ${s}px,transparent ${s}px);background-size:${14*s}px ${14*s}px;mask-image:linear-gradient(#000 0,#000 55%,transparent 100%)}
.ring{position:absolute;border:${s}px solid #5cc0ff22;border-radius:50%;width:${220*s}px;height:${220*s}px;left:${-60*s}px;top:${150*s}px}
.ring.b{width:${300*s}px;height:${300*s}px;left:${-100*s}px;top:${110*s}px;border-color:#5cc0ff14}
.c{position:absolute;left:${18*s}px;right:${14*s}px;top:${34*s}px}
svg{width:${54*s}px;height:${54*s}px;filter:drop-shadow(0 ${4*s}px ${10*s}px #000a)}
h1{margin:${14*s}px 0 0;font-size:${21*s}px;font-weight:650;letter-spacing:0.2px;line-height:1.1}
p{margin:${6*s}px 0 0;font-size:${9.5*s}px;line-height:1.4;color:#a9bccc}
ul{list-style:none;padding:0;margin:${18*s}px 0 0;font-size:${8.5*s}px;color:#c9d7e3}
li{margin:0 0 ${6*s}px;display:flex;align-items:center;gap:${6*s}px}
li:before{content:"";width:${4*s}px;height:${4*s}px;border-radius:50%;background:#5cc0ff;box-shadow:0 0 ${5*s}px #5cc0ff}
.f{position:absolute;left:${18*s}px;bottom:${14*s}px;font-size:${7.5*s}px;color:#6f8396;line-height:1.5}
</style></head><body><div class="bg"></div><div class="grid"></div><div class="ring"></div><div class="ring b"></div>
<div class="c">${mark}<h1>Quick Scan</h1><p>Scan to measured,<br>editable CAD.</p>
<ul><li>Fit &amp; measure</li><li>Compare to CAD</li><li>Rebuild as STEP</li></ul></div>
<div class="f">Free &amp; open source<br>AGPL-3.0 · Built on ScanRuler</div></body></html>`; };
const small = w => `<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${w}px;overflow:hidden;background:transparent}svg{width:${w}px;height:${w}px;display:block}</style></head><body>${mark}</body></html>`;
const jobs = [
  ['wizard-164x314.png', 164, 314, side(164, 314)], ['wizard-246x471.png', 246, 471, side(246, 471)],
  ['wizard-328x628.png', 328, 628, side(328, 628)], ['wizard-410x785.png', 410, 785, side(410, 785)],
  ['small-55.png', 55, 55, small(55)], ['small-83.png', 83, 83, small(83)], ['small-110.png', 110, 110, small(110)], ['small-138.png', 138, 138, small(138)],
];
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  for (const [name, w, h, html] of jobs) {
    const win = new BrowserWindow({ width: w, height: h, show: false, frame: false, useContentSize: true, transparent: name.startsWith('small'), webPreferences: { offscreen: true } });
    const tmp = path.join(app.getPath('temp'), 'qs-art-' + name + '.html'); fs.writeFileSync(tmp, html);
    await win.loadFile(tmp); fs.unlinkSync(tmp);
    await new Promise(r => setTimeout(r, 300));
    const img = await win.webContents.capturePage({ x: 0, y: 0, width: w, height: h });
    fs.writeFileSync(path.join(out, name), img.resize({ width: w, height: h, quality: 'best' }).toPNG());
    win.destroy();
  }
  app.exit(0);
});

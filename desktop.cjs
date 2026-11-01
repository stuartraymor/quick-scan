const { app, BrowserWindow, protocol, net, dialog, ipcMain } = require('electron');
const { spawn } = require('node:child_process');
const updater = require('./updater.cjs');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
app.setName('Quick Scan');
app.setPath('userData', path.join(app.getPath('appData'), `QuickScan-v${app.getVersion()}${process.argv.includes('--desktop-smoke') ? '-verification' : ''}`));
protocol.registerSchemesAsPrivileged([{ scheme: 'scanruler', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);
const smoke = process.argv.includes('--desktop-smoke');
if (smoke) app.commandLine.appendSwitch('remote-debugging-port', '9237');
let win;
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    const root = path.join(__dirname, 'dist');
    protocol.handle('scanruler', request => {
      const url = new URL(request.url);
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (url.host !== 'app' || !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    win = new BrowserWindow({ width: 1500, height: 960, minWidth: 1000, minHeight: 650, title: `Quick Scan v${app.getVersion()}`, backgroundColor: '#e7e6e1', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: !smoke } });
    win.setMenu(null);
    wireUpdater();
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('scanruler://app/')) event.preventDefault(); });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.session.on('will-download', (event, item) => {
      if (smoke) item.setSavePath(path.join(app.getPath('userData'), 'desktop-smoke.scanruler'));
      else item.setSaveDialogOptions({ title: 'Save Quick Scan file', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    });
    await win.loadURL('scanruler://app/');
    if (smoke) {
      const oldSave = path.join(app.getPath('userData'), 'desktop-smoke.scanruler');
      if (fs.existsSync(oldSave)) fs.unlinkSync(oldSave);
      const errors = [];
      win.webContents.on('console-message', (event, details) => { if (details.level === 'error') errors.push(details.message); });
      try {
        const result = await win.webContents.executeJavaScript(`(async () => {
          const wait = async fn => { for(let i=0;i<160;i++){ if(fn()) return; await new Promise(r=>setTimeout(r,250)); } throw Error('Timed out'); };
          await wait(()=>document.querySelector('[data-test="save-project"]'));
          await new Promise(r=>setTimeout(r,1500));
          const d = new DataTransfer(); d.items.add(new File(['v 0 0 0\\nv 10 0 0\\nv 0 10 0\\nf 1 2 3\\n'], 'desktop-test.obj'));
          window.dispatchEvent(new DragEvent('drop', {dataTransfer:d,bubbles:true,cancelable:true}));
          await wait(()=>document.querySelector('.file-info')?.textContent.includes('1 triangles'));
          await wait(()=>!document.querySelector('[data-test="save-project"]').disabled);
          document.querySelector('[data-test="save-project"]').click();
          return {title:document.title, mesh:document.querySelector('.file-info').textContent};
        })()`);
        const saved = path.join(app.getPath('userData'), 'desktop-smoke.scanruler');
        for (let i=0; i<80 && !fs.existsSync(saved); i++) await new Promise(r=>setTimeout(r,250));
        if (!fs.existsSync(saved) || fs.statSync(saved).size === 0) throw Error('Project was not saved');
        result.saved = saved;
        const bytes = Array.from(fs.readFileSync(saved));
        await win.reload();
        await new Promise(resolve => win.webContents.once('did-finish-load', resolve));
        result.reopened = await win.webContents.executeJavaScript(`(async () => {
          const wait = async fn => { for(let i=0;i<720;i++){ if(fn()) return; await new Promise(r=>setTimeout(r,250)); } throw Error('Timed out reopening project or loading CAD kernel'); };
          await wait(()=>document.querySelector('[data-test="save-project"]'));
          await new Promise(r=>setTimeout(r,1500));
          const d = new DataTransfer(); d.items.add(new File([new Uint8Array(${JSON.stringify(bytes)})], 'desktop-smoke.scanruler'));
          window.dispatchEvent(new DragEvent('drop',{dataTransfer:d,bubbles:true,cancelable:true}));
          await wait(()=>document.querySelector('.file-info')?.textContent.includes('desktop-test.obj'));
          document.querySelector('[data-test="workspace-reverse"]').click();
          await wait(()=>/ready/.test(document.querySelector('[data-test="kernel-status"]')?.textContent??''));
          return {mesh:document.querySelector('.file-info').textContent, kernel:document.querySelector('[data-test="kernel-status"]').textContent};
        })()`);
        result.errors = errors;
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(app.getPath('userData'), 'desktop-smoke.png'), image.toPNG());
        fs.writeFileSync(path.join(app.getPath('userData'), 'desktop-smoke.json'), JSON.stringify(result,null,2));
        app.exit(0);
      } catch(error) {
        fs.writeFileSync(path.join(app.getPath('userData'), 'desktop-smoke-error.txt'), error.stack + '\n' + JSON.stringify(errors));
        fs.writeFileSync(path.join(app.getPath('userData'), 'desktop-smoke-dom.txt'), await win.webContents.executeJavaScript('document.body.innerText'));
        app.exit(1);
      }
    }
  }).catch(error => { dialog.showErrorBox('Quick Scan could not start', error.stack); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}

// In-app updates from the latest GitHub release (updater.cjs verifies SHA-256).
function wireUpdater() {
  let found = null, installer = null;
  const ours = event => event.senderFrame?.url?.startsWith('scanruler://app/');
  ipcMain.handle('updater:check', async event => {
    if (!ours(event)) return { status: 'error', detail: 'Refused.' };
    try {
      const result = await updater.checkForUpdate({ fetch: net.fetch.bind(net), current: app.getVersion() });
      found = result.status === 'available' ? result.release : null; installer = null;
      const { release, ...safe } = result; return safe;
    } catch (error) { return { status: 'error', detail: `Could not check for updates: ${error.message}` }; }
  });
  ipcMain.handle('updater:download', async event => {
    if (!ours(event) || !found) return { status: 'error', detail: 'Check for updates first.' };
    try {
      installer = await updater.downloadUpdate({ fetch: net.fetch.bind(net), release: found, dir: path.join(app.getPath('temp'), 'QuickScanUpdate'), onProgress: p => win?.webContents.send('updater:progress', p) });
      return { status: 'ready' };
    } catch (error) { installer = null; return { status: 'error', detail: error.message }; }
  });
  ipcMain.handle('updater:install', async event => {
    if (!ours(event) || !installer) return { status: 'error', detail: 'Nothing downloaded.' };
    spawn(installer, ['/SILENT', '/CLOSEAPPLICATIONS', '/RESTARTAPPLICATIONS'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
    return { status: 'installing' };
  });
}

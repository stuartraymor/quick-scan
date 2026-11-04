const { app, BrowserWindow, protocol, net, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const updater = require('./updater.cjs');
const recents = require('./recents.cjs');
const agentSetup = require('./agent-setup.cjs');
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
    const libraryFile = path.join(app.getPath('appData'), 'QuickScan-shared', 'example-library.json');
    let library = '';
    try { const p = JSON.parse(fs.readFileSync(libraryFile, 'utf8')); if (typeof p === 'string' && path.isAbsolute(p)) library = p; } catch { /* first launch */ }
    const {indexFolder,resolveKey}=require('./example-library.cjs');
    const catalog=require('./src/app/referenceExamples.json');
    const ours=e=>e.senderFrame?.url?.startsWith('scanruler://app/');
    let index=null, refresh=null;
    const scan=async()=>{
      const dir=library;
      if(!dir) return null;
      const next=await indexFolder(dir,catalog);
      if(library===dir) index=next;
      return next;
    };
    const inspect=async()=>{
      try {
        if(!refresh)refresh=scan().finally(()=>{refresh=null});
        await refresh;
        return {folder:library,entries:index?.entries??[],slots:index?.slots??{},truncated:!!index?.truncated};
      } catch {index=null;return {folder:library,entries:[],slots:{},unavailable:true}}
    };
    const save=async dir=>{
      await fs.promises.mkdir(path.dirname(libraryFile),{recursive:true});
      await fs.promises.writeFile(libraryFile,JSON.stringify(dir));library=dir;index=null;
    };
    ipcMain.handle('files:exampleLibrary',event=>ours(event)?inspect():null);
    ipcMain.handle('files:clearExamples',async event=>{if(ours(event))await save('')});
    ipcMain.handle('files:chooseExamples', async event => {
      if (!ours(event)) return false;
      const pick = await dialog.showOpenDialog(win, { title: 'Choose local example folder', defaultPath:library||undefined, properties: ['openDirectory'] });
      if (pick.canceled || !pick.filePaths[0]) return false;
      const dir=pick.filePaths[0], next=await indexFolder(dir,catalog);
      await save(dir); index=next; return true;
    });
    const exampleDirs = () => [ process.env.QS_EXAMPLES_DIR, path.join(app.getPath('appData'), 'QuickScan', 'reference-examples'), path.join(root, 'reference-examples')].filter(Boolean);
    ipcMain.handle('files:examples', event => {
      if (!event.senderFrame?.url?.startsWith('scanruler://app/')) return [];
      return [...Object.entries(index?.slots??{}).filter(([,v])=>v.verify).map(([id])=>catalog.find(c=>c.id===id).file), ...exampleDirs().flatMap(dir => {
        try { return fs.readdirSync(dir, {withFileTypes: true}).filter(entry => entry.isFile() && /\.stl$/i.test(entry.name)).map(entry => entry.name); }
        catch { return []; }
      })];
    });
    protocol.handle('scanruler', async request => {
      const url = new URL(request.url);
      if(url.host==='app' && url.pathname.startsWith('/mapped-examples/')){
        const key=url.pathname.slice('/mapped-examples/'.length);
        try {const f=await resolveKey(index,key);if(f)return net.fetch(pathToFileURL(f).href)}catch{}
        return new Response('Example not found',{status:404});
      }
      // Help > Examples: the reference example meshes are third-party files
      // and are not shipped. They are read from a local folder on this PC.
      if (url.host === 'app' && url.pathname.startsWith('/reference-examples/')) {
        const name = path.basename(decodeURIComponent(url.pathname));
        if (!/^(?:lego|basic_part|aerosol_knob|bearinghousing|machine_part|tool|steel|impeller|yholder|qsm)\.stl$/.test(name)) return new Response('Not found', {status: 404});
        const ref=catalog.find(c=>c.file===name), slot=index?.slots[ref?.id];
        const mapped=slot?.verify ? await resolveKey(index,slot.key).catch(()=>null) : null;
        const found = mapped || exampleDirs().map(d => path.join(d, name)).find(f => fs.existsSync(f));
        return found ? net.fetch(pathToFileURL(found).href) : new Response('Not found', { status: 404 });
      }
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
      if (url.host !== 'app' || !file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).href);
    });
    win = new BrowserWindow({ width: 1500, height: 960, minWidth: 1000, minHeight: 650, title: `Quick Scan v${app.getVersion()}`, backgroundColor: '#e7e6e1', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: !smoke } });
    win.setMenu(null);
    wireUpdater();
    wireFiles();
    wireAgentSetup();
    win.webContents.on('will-navigate', (event, url) => { if (!url.startsWith('scanruler://app/')) event.preventDefault(); });
    // Help links open in the user's browser — only these hosts, never in the app.
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\/(github\.com|www\.cnckitchen\.com)\//.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.session.on('will-download', (event, item) => {
      if (smoke) item.setSavePath(path.join(app.getPath('userData'), 'desktop-smoke.scanruler'));
      else {
        item.setSaveDialogOptions({ title: 'Save Quick Scan file', defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
        item.once('done', (e, state) => { if (state === 'completed') { recents.remember(recentFile(), item.getSavePath()); win?.webContents.send('files:changed'); } });
      }
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
          const setup = ${Boolean(process.env.QUICKSCAN_AGENT_TEST_HOME)} ? await window.quickScanAgent.setup() : null;
          return {title:document.title, mesh:document.querySelector('.file-info').textContent, bridges:[typeof window.quickScanFiles, typeof window.quickScanUpdater, typeof window.quickScanAgent], recent:Array.isArray(await window.quickScanFiles.recent()), ...(setup ? {agentSetup:setup.apps} : {})};
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
        // Kernel readiness can precede the compositor's first frame after
        // reload. Make the verification window visible and wait for paint
        // before requesting screenshot evidence.
        win.show();
        win.focus();
        await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
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
    spawn(installer, ['/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/RELAUNCH'], { detached: true, stdio: 'ignore' }).unref();
    setTimeout(() => app.quit(), 300);
    return { status: 'installing' };
  });
}

// Recent documents: remembered in one file shared by all versions.
const recentFile = () => path.join(app.getPath('appData'), 'QuickScan-shared', 'recent-documents.json');
function wireFiles() {
  const ours = event => event.senderFrame?.url?.startsWith('scanruler://app/');
  ipcMain.handle('files:recent', event => (ours(event) ? recents.describe(recentFile()) : []));
  ipcMain.handle('files:remember', (event, p) => { if (ours(event)) recents.remember(recentFile(), p); return recents.describe(recentFile()); });
  ipcMain.handle('files:clear', event => { if (ours(event)) recents.clear(recentFile()); return []; });
  ipcMain.handle('files:open', (event, p) => {
    if (!ours(event)) throw new Error('Refused.');
    const { name, data } = recents.read(recentFile(), p);
    recents.remember(recentFile(), p);
    return { name, data: new Uint8Array(data) };
  });
}

function wireAgentSetup() {
  const ours = event => event.senderFrame?.url?.startsWith('scanruler://app/');
  const options = () => {
    if (!smoke) return { home: app.getPath('home'), appData: app.getPath('appData'), documents: app.getPath('documents') };
    const home = process.env.QUICKSCAN_AGENT_TEST_HOME || path.join(app.getPath('userData'), 'agent-fixture');
    return { home, appData: path.join(home, 'roaming'), documents: path.join(home, 'Documents'), env: { APPDATA: path.join(home, 'roaming') } };
  };
  ipcMain.handle('agent:setup', event => {
    if (!ours(event)) throw Error('Refused.');
    return agentSetup.setup(options());
  });
  ipcMain.handle('agent:remembered', event => {
    if (!ours(event)) throw Error('Refused.');
    return agentSetup.remembered(options());
  });
  ipcMain.handle('agent:remember', (event, state) => {
    if (!ours(event)) throw Error('Refused.');
    return agentSetup.remember(state, options());
  });
}

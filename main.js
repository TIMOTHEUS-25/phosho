const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { Session, searchFolder, findApps } = require('./src/converter');
const { ProfileStore, parseCsv, toCsv } = require('./src/profiles');

let win = null;
let session = null;
let busy = false;
let profileStore = null; // created once the app is ready (needs userData path)

const ICON = path.join(__dirname, 'renderer', 'assets', 'logo.png');
const SPLASH_MIN_MS = 2000;

// Splash first; the main window loads hidden behind it and takes over once
// it's ready and the splash has been up for at least SPLASH_MIN_MS.
function createWindow() {
  const splash = new BrowserWindow({
    width: 836, height: 470, frame: false, resizable: false, movable: true,
    show: false, center: true, backgroundColor: '#5a03e2', icon: ICON,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splash.once('ready-to-show', () => splash.show());
  splash.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
  const shownAt = Date.now();

  win = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 820,
    minHeight: 600,
    title: 'PhoSho!',
    show: false,
    icon: ICON,
    backgroundColor: '#f6f3fb',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.once('ready-to-show', () => {
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      win.show();
      if (!splash.isDestroyed()) splash.close();
    }, Math.max(0, SPLASH_MIN_MS - (Date.now() - shownAt)));
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function closeSession() {
  if (session) { session.dispose(); session = null; }
}

function uniqueOutPath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 2; i < 1000; i++) {
    const c = path.join(dir, `${base} ${i}${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

async function guarded(fn) {
  if (busy) throw new Error('Already working. Please wait for the current job to finish.');
  busy = true;
  try { return await fn(); } finally { busy = false; }
}

ipcMain.handle('app:info', () => ({ platform: process.platform, apps: findApps() }));

ipcMain.handle('dialog:pickIndd', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'InDesign documents', extensions: ['indd'] }],
  });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('doc:open', (_e, docPath) => guarded(async () => {
  if (!/\.indd$/i.test(docPath)) throw new Error('That is not an InDesign document (.indd).');
  closeSession();
  session = new Session(docPath);
  const a = await session.analyze((p) => send('progress', p));
  for (const p of a.pages) p.thumbUrl = p.thumb ? pathToFileURL(p.thumb).href : null;

  // Look for missing links next to the document before asking the user.
  const missing = a.links.filter((l) => l.status === 'missing' || l.status === 'inaccessible');
  if (missing.length) {
    const found = await searchFolder(path.dirname(docPath), missing.map((l) => l.name), { maxDepth: 4, maxEntries: 20000 });
    for (const l of missing) if (found[l.name]) l.suggestion = found[l.name];
  }
  const ext = '.psd';
  a.outPath = uniqueOutPath(path.join(path.dirname(docPath), path.basename(docPath, path.extname(docPath)) + ext));
  return a;
}));

ipcMain.handle('dialog:relinkFile', async (_e, name) => {
  const r = await dialog.showOpenDialog(win, { title: `Locate “${name}”`, properties: ['openFile'] });
  return r.canceled ? null : r.filePaths[0];
});

ipcMain.handle('dialog:searchFolder', async (_e, names) => {
  const r = await dialog.showOpenDialog(win, { title: 'Choose a folder to search for missing links', properties: ['openDirectory'] });
  if (r.canceled) return null;
  send('progress', { stage: 'search', msg: 'Searching ' + r.filePaths[0] });
  return searchFolder(r.filePaths[0], names);
});

ipcMain.handle('dialog:saveAs', async (_e, current) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: current,
    filters: [
      { name: 'Photoshop document (PSD)', extensions: ['psd'] },
      { name: 'Photoshop large document (PSB)', extensions: ['psb'] },
    ],
  });
  return r.canceled ? null : r.filePath;
});

ipcMain.handle('doc:convert', (_e, opts) => guarded(async () => {
  if (!session) throw new Error('No document is loaded.');
  if (!opts.pageIndexes || !opts.pageIndexes.length) throw new Error('Select at least one page.');
  return session.convert({ ...opts, dpi: 300 }, (p) => send('progress', p));
}));

// ---------- colour profiles ----------
ipcMain.handle('profiles:load', () => profileStore.load());
ipcMain.handle('profiles:save', (_e, data) => profileStore.save(data));

ipcMain.handle('profiles:importCsv', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Import brand colours (CSV)',
    properties: ['openFile'],
    filters: [{ name: 'Colour list', extensions: ['csv', 'txt', 'tsv'] }],
  });
  if (r.canceled) return null;
  const file = r.filePaths[0];
  const colors = parseCsv(fs.readFileSync(file, 'utf8'));
  return { name: path.basename(file, path.extname(file)), colors };
});

ipcMain.handle('profiles:exportCsv', async (_e, profile) => {
  const r = await dialog.showSaveDialog(win, {
    title: 'Export brand colours',
    defaultPath: (profile.name || 'Colour profile').replace(/[\\/:*?"<>|]/g, '-') + '.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, toCsv(profile), 'utf8');
  return r.filePath;
});

ipcMain.handle('doc:close', () => { closeSession(); return true; });

ipcMain.handle('shell:reveal', (_e, p) => { shell.showItemInFolder(p); return true; });

app.whenReady().then(() => {
  profileStore = new ProfileStore(path.join(app.getPath('userData'), 'colour-profiles.json'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  closeSession();
  app.quit();
});

app.on('before-quit', closeSession);

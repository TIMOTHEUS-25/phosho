// Launches the real app, loads the sample, and saves screenshots.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
require('../main.js');
const out = path.join(__dirname, 'out');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.on('browser-window-created', async (_e, win) => {
  win.webContents.on('console-message', (e) => console.log('CONSOLE', e.level, e.message, e.lineNumber));
  win.webContents.on('preload-error', (_e, p, err) => console.log('PRELOAD', err.message));
  win.webContents.once('did-finish-load', async () => {
    if (/splash\.html$/.test(win.webContents.getURL())) {
      await wait(600);
      fs.writeFileSync(path.join(out, 'ui_splash.png'), (await win.capturePage()).toPNG());
      return;
    }
    while (!win.isVisible()) await wait(100);
    await wait(800);
    fs.writeFileSync(path.join(out, 'ui_empty.png'), (await win.capturePage()).toPNG());
    const doc = path.join(__dirname, 'sample.indd');
    await win.webContents.executeJavaScript(`openDoc(${JSON.stringify(doc)})`);
    for (let i = 0; i < 360; i++) { await wait(500); if (await win.webContents.executeJavaScript('!!state.doc && document.getElementById("busy").classList.contains("hidden")')) break; }
    await win.webContents.executeJavaScript(`document.querySelector('.thumb[data-i="0"]').click(); document.querySelector('.thumb[data-i="1"]').click();`);
    await wait(500);
    fs.writeFileSync(path.join(out, 'ui_doc.png'), (await win.capturePage()).toPNG());
    if (process.env.UI_TWEAKS) {
      console.log('toggles', await win.webContents.executeJavaScript(`(() => { const t = document.querySelector('[data-toggle]'); if (!t) return 0; t.click(); return document.querySelectorAll('[data-toggle]').length; })()`));
      await wait(300);
      fs.writeFileSync(path.join(out, 'ui_expanded.png'), (await win.capturePage()).toPNG());
      await win.webContents.executeJavaScript(`document.getElementById('back').click()`);
      await wait(400);
      console.log('home', await win.webContents.executeJavaScript(`!document.getElementById('drop').classList.contains('hidden') && document.getElementById('back').classList.contains('hidden')`));
      fs.writeFileSync(path.join(out, 'ui_back.png'), (await win.capturePage()).toPNG());
    }
    if (process.env.UI_CONVERT) {
      await win.webContents.executeJavaScript(`state.outPath = ${JSON.stringify(path.join(out, 'ui.psd'))}; renderOut(); document.getElementById('convert').click();`);
      await wait(2500);
      fs.writeFileSync(path.join(out, 'ui_busy.png'), (await win.capturePage()).toPNG());
      for (let i = 0; i < 240; i++) { await wait(500); if (await win.webContents.executeJavaScript('!document.getElementById("result").classList.contains("hidden")')) break; }
      await wait(300);
      fs.writeFileSync(path.join(out, 'ui_result.png'), (await win.capturePage()).toPNG());
    }
    app.quit();
  });
});

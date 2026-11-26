// Launches the real app, loads the sample, and saves screenshots.
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
// UI_PROFILE: exercise the colour profile editor, with settings kept in a temp
// folder so the real app's saved profiles are never touched.
if (process.env.UI_PROFILE) app.setPath('userData', fs.mkdtempSync(path.join(require('os').tmpdir(), 'phosho-ui-')));
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
    if (process.env.UI_PROFILE) {
      win.setSize(1100, 760);
      await win.webContents.executeJavaScript(`document.getElementById('manageProfiles').click()`);
      await wait(300);
      fs.writeFileSync(path.join(out, 'ui_profile_empty.png'), (await win.capturePage()).toPNG());
      console.log('editor', await win.webContents.executeJavaScript(`(async () => {
        const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
        set('#pfName', 'Acme CI');
        document.getElementById('pfFromDoc').click();
        const rows = [...document.querySelectorAll('#pfRows tr')];
        const idx = (name) => rows.findIndex((r) => r.querySelector('[data-k="name"]').value === name);
        set('#pfRows input[data-i="' + idx('Green') + '"][data-k="hex"]', '#009B48');
        set('#pfRows input[data-i="' + idx('Black') + '"][data-k="hex"]', '1d1d1b');
        // keep only the two brand colours
        for (let i = rows.length - 1; i >= 0; i--) if (i !== idx('Green') && i !== idx('Black')) document.querySelector('#pfRows [data-del="' + i + '"]').click();
        await new Promise((r) => setTimeout(r, 200));
        return document.querySelectorAll('#pfRows tr').length + ' rows';
      })()`));
      await wait(300);
      fs.writeFileSync(path.join(out, 'ui_profile_editor.png'), (await win.capturePage()).toPNG());
      // validation: a row with no RGB must block saving
      console.log('validation', await win.webContents.executeJavaScript(`(async () => {
        document.getElementById('pfAdd').click();
        const last = document.querySelector('#pfRows tr:last-child [data-k="name"]'); last.value = 'Half done'; last.dispatchEvent(new Event('input', { bubbles: true }));
        document.getElementById('pfSave').click();
        await new Promise((r) => setTimeout(r, 200));
        const msg = document.getElementById('pfError').textContent;
        document.querySelector('#pfRows tr:last-child [data-del]').click();
        return msg;
      })()`));
      fs.writeFileSync(path.join(out, 'ui_profile_invalid.png'), (await win.capturePage()).toPNG());
      console.log('saved', await win.webContents.executeJavaScript(`(async () => {
        document.getElementById('pfSave').click();
        await new Promise((r) => setTimeout(r, 400));
        return JSON.stringify(await api.profiles.load()) + ' | select=' + document.getElementById('colourProfile').selectedOptions[0].textContent + ' | panel=' + document.getElementById('coloursPanel').innerText.replace(/\s+/g, ' ');
      })()`));
      await win.webContents.executeJavaScript(`document.querySelector('.right').scrollTop = 9999`);
      await wait(300);
      fs.writeFileSync(path.join(out, 'ui_profile_doc.png'), (await win.capturePage()).toPNG());
    }
    if (process.env.UI_SIZE) {
      win.setSize(1100, 900);
      console.log('size', await win.webContents.executeJavaScript(`(async () => {
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const set = (id, v, ev) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event(ev, { bubbles: true })); };
        const info = () => document.getElementById('sizeInfo').innerText;
        document.querySelector('.thumb[data-i="1"]').click(); await wait(100); // page 1 only
        const r = [];
        set('sizeMode', 'full', 'change'); r.push('full: ' + info());
        set('sizeMode', 'percent', 'change'); set('sizePercent', '50', 'input'); r.push('50%: ' + info());
        set('sizePercent', '150', 'input'); r.push('150%: ' + info());
        set('sizeMode', 'pixels', 'change'); set('sizeDim', 'height', 'change'); set('sizePx', '1080', 'input'); r.push('1080h: ' + info() + ' | settings ' + JSON.stringify(sizeSettings()));
        set('sizePx', '99999', 'input'); r.push('too big: ' + info());
        set('sizeDim', 'width', 'change'); set('sizePx', '1200', 'input'); r.push('1200w: ' + info());
        return r.join(String.fromCharCode(10));
      })()`));
      await win.webContents.executeJavaScript(`document.querySelector('.right').scrollTop = 9999`);
      await wait(300);
      fs.writeFileSync(path.join(out, 'ui_size.png'), (await win.capturePage()).toPNG());
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

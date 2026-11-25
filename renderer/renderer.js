const $ = (id) => document.getElementById(id);
// `api` is provided by preload.js via contextBridge.

const state = {
  doc: null,          // analysis result
  selected: new Set(),
  focus: 0,
  relinks: {},        // link id -> new path
  outPath: '',
  lastResult: null,
  expanded: new Set(), // link ids whose full path is shown
};

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function basename(p) { return p.split(/[\\/]/).pop(); }
// Keep the end of long paths visible: "…/Folder/Sub/file.ext".
function shortPath(p, keep = 3) {
  const parts = String(p).split(/[\\/]/).filter(Boolean);
  return parts.length > keep ? '…/' + parts.slice(-keep).join('/') : p;
}

// Full path, allowed to wrap after each folder separator.
function wrapPath(p) { return esc(p).replace(/([\\/])/g, '$1<wbr>'); }

// ---------- header ----------
async function showApps() {
  const info = await api.info();
  const pill = (label, a) => a
    ? `<span class="pill ok">${esc(a.name.replace('Adobe ', ''))}</span>`
    : `<span class="pill bad">${label} not found</span>`;
  $('apps').innerHTML = pill('InDesign', info.apps.indesign) + pill('Photoshop', info.apps.photoshop);
}

// ---------- busy / result ----------
function busy(on, msg) {
  $('busy').classList.toggle('hidden', !on);
  if (on) {
    $('busyMsg').textContent = msg || 'Working…';
    $('busyBar').style.width = '0';
    $('busyBar').parentElement.classList.add('indeterminate');
  }
}

api.onProgress((p) => {
  if (p.msg) $('busyMsg').textContent = p.msg;
  const bar = $('busyBar').parentElement;
  if (p.total) {
    // InDesign = first 40%, Photoshop = remaining 60%.
    let frac = p.done / p.total;
    if (p.stage === 'indesign') frac = frac * 0.4;
    else if (p.stage === 'photoshop') frac = 0.4 + frac * 0.6;
    bar.classList.remove('indeterminate');
    $('busyBar').style.width = Math.round(frac * 100) + '%';
  }
});

function showResult(title, html, revealPath) {
  $('resultTitle').textContent = title;
  $('resultBody').innerHTML = html;
  $('resultReveal').classList.toggle('hidden', !revealPath);
  $('resultNew').classList.toggle('hidden', !revealPath);
  state.lastResult = revealPath || null;
  $('result').classList.remove('hidden');
}
$('resultClose').onclick = () => $('result').classList.add('hidden');
$('resultNew').onclick = () => { $('result').classList.add('hidden'); goHome(); };
$('resultReveal').onclick = () => state.lastResult && api.reveal(state.lastResult);

function showError(e) {
  const msg = String(e && e.message ? e.message : e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  let hint = '';
  if (/-1743|not allowed|Not authorized/i.test(msg)) {
    hint = '<p>macOS blocked this app from controlling Adobe apps. Open <b>System Settings → Privacy &amp; Security → Automation</b> and allow it to control InDesign and Photoshop.</p>';
  }
  showResult('Something went wrong', `<p class="error">${esc(msg)}</p>${hint}`);
}

// ---------- open ----------
async function openDoc(path) {
  busy(true, 'Opening in InDesign…');
  try {
    const doc = await api.open(path);
    state.doc = doc;
    state.selected = new Set(doc.pages.length === 1 ? [0] : []);
    state.focus = 0;
    state.relinks = {};
    for (const l of doc.links) if (l.suggestion) state.relinks[l.id] = l.suggestion;
    state.outPath = doc.outPath;
    state.expanded = new Set();
    renderDoc();
    $('drop').classList.add('hidden');
    $('doc').classList.remove('hidden');
    $('back').classList.remove('hidden');
  } catch (e) {
    showError(e);
  } finally {
    busy(false);
  }
}

$('browse').onclick = async () => { const p = await api.pickIndd(); if (p) openDoc(p); };
// Back to the drag-and-drop screen.
function goHome() {
  api.close().catch(() => {});
  state.doc = null;
  state.selected = new Set();
  state.relinks = {};
  $('doc').classList.add('hidden');
  $('back').classList.add('hidden');
  $('drop').classList.remove('hidden');
}
$('back').onclick = goHome;
$('another').onclick = async () => { const p = await api.pickIndd(); if (p) openDoc(p); };

// Drag & drop anywhere in the window.
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const p = api.pathForFile(f);
  if (!/\.indd$/i.test(p)) return showError('Please drop an InDesign document (.indd).');
  openDoc(p);
});

// ---------- document view ----------
function renderDoc() {
  const d = state.doc;
  $('docName').textContent = d.name;
  renderGrid();
  renderPreview();
  renderLinks();
  renderFonts();
  renderOut();
}

function renderGrid() {
  const d = state.doc;
  $('pageCount').textContent = `${d.pages.length} page${d.pages.length === 1 ? '' : 's'} · ${state.selected.size} selected`;
  $('grid').innerHTML = d.pages.map((p) => `
    <div class="thumb ${state.selected.has(p.index) ? 'selected' : ''} ${state.focus === p.index ? 'focused' : ''}" data-i="${p.index}">
      <div class="frame">
        ${p.thumbUrl ? `<img src="${esc(p.thumbUrl)}" alt="">` : '<div class="noimg"></div>'}
        <div class="tick">✓</div>
      </div>
      <div class="label">Page ${esc(p.name)}</div>
    </div>`).join('');
  $('convert').disabled = state.selected.size === 0;
  $('convert').textContent = state.selected.size > 1 ? `Convert ${state.selected.size} pages` : 'Convert';
}

let lastClicked = null;
$('grid').addEventListener('click', (e) => {
  const t = e.target.closest('.thumb');
  if (!t) return;
  const i = Number(t.dataset.i);
  if (e.shiftKey && lastClicked !== null) {
    const [a, b] = [Math.min(lastClicked, i), Math.max(lastClicked, i)];
    for (let k = a; k <= b; k++) state.selected.add(k);
  } else if (state.selected.has(i) && state.focus === i) {
    state.selected.delete(i);
  } else {
    state.selected.add(i);
  }
  lastClicked = i;
  state.focus = i;
  renderGrid();
  renderPreview();
});
$('grid').addEventListener('mouseover', (e) => {
  const t = e.target.closest('.thumb');
  if (t) renderPreview(Number(t.dataset.i));
});
$('grid').addEventListener('mouseleave', () => renderPreview());

$('selAll').onclick = () => { state.doc.pages.forEach((p) => state.selected.add(p.index)); renderGrid(); };
$('selNone').onclick = () => { state.selected.clear(); renderGrid(); };

function renderPreview(i = state.focus) {
  const p = state.doc.pages[i];
  if (!p) return;
  $('preview').innerHTML = p.thumbUrl ? `<img src="${esc(p.thumbUrl)}" alt="">` : '<div class="muted">No preview</div>';
  const sel = state.selected.has(i) ? ' · will be converted' : '';
  $('previewLabel').textContent = `Page ${p.name} · ${Math.round(p.width)} × ${Math.round(p.height)} pt${sel}`;
}

function renderLinks() {
  const links = state.doc.links;
  const problems = links.filter((l) => l.status === 'missing' || l.status === 'inaccessible');
  const panel = $('linksPanel');
  if (!problems.length) {
    panel.className = 'panel good';
    panel.innerHTML = links.length
      ? `<h3>Links</h3><div class="muted">All ${links.filter((l) => l.status !== 'embedded').length} linked files found. They stay linked in Photoshop.</div>`
      : '';
    return;
  }
  const open = problems.filter((l) => !state.relinks[l.id]).length;
  panel.className = 'panel' + (open ? ' warn' : ' good');
  panel.innerHTML = `
    <h3>${open ? `${open} missing link${open === 1 ? '' : 's'}` : 'Missing links fixed'}
      ${open ? '<button class="link" id="searchAll">Search a folder…</button>' : ''}</h3>
    ${problems.map((l) => {
      const fix = state.relinks[l.id];
      const full = fix || l.path;
      const exp = state.expanded.has(String(l.id));
      return `<div class="link-row">
        <div class="info">
          <div class="name">${esc(l.name)}${l.page !== null ? ` <span class="muted">· p${l.page + 1}</span>` : ''}</div>
        </div>
        ${fix ? '<span class="badge fixed">Relinked</span>' : '<span class="badge">Missing</span>'}
        <button class="btn small" data-relink="${l.id}">${fix ? 'Change' : 'Relink…'}</button>
        <div role="button" tabindex="0" aria-expanded="${exp}" class="where ${fix ? 'fixed' : ''} ${exp ? 'expanded' : ''}" data-toggle="${l.id}" title="${exp ? 'Click to collapse' : 'Click to show the full path'}">
          <span class="chev">▸</span><span class="path">${exp ? wrapPath(full) : esc(shortPath(full))}</span>
        </div>
        ${exp && fix ? `<div class="was">Was: <span class="path">${wrapPath(l.path)}</span></div>` : ''}
      </div>`;
    }).join('')}
    ${open ? '<div class="muted small note">Links you don\'t relink are rasterized as smart objects, so they are easy to replace later.</div>' : ''}`;

  panel.querySelectorAll('[data-toggle]').forEach((b) => {
    const toggle = () => {
      const id = b.dataset.toggle;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      renderLinks();
    };
    b.onclick = () => { if (!window.getSelection().toString()) toggle(); }; // selecting text to copy doesn't collapse
    b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
  });
  panel.querySelectorAll('[data-relink]').forEach((b) => {
    b.onclick = async () => {
      const l = problems.find((x) => String(x.id) === b.dataset.relink);
      const p = await api.relinkFile(l.name);
      if (p) { state.relinks[l.id] = p; renderLinks(); }
    };
  });
  const sa = $('searchAll');
  if (sa) sa.onclick = async () => {
    const pending = problems.filter((l) => !state.relinks[l.id]);
    busy(true, 'Searching folder…');
    try {
      const found = await api.searchFolder(pending.map((l) => l.name));
      if (found) {
        let n = 0;
        for (const l of pending) if (found[l.name]) { state.relinks[l.id] = found[l.name]; n++; }
        renderLinks();
        if (!n) showResult('Nothing found', '<p>None of the missing files were found in that folder.</p>');
      }
    } catch (e) { showError(e); } finally { busy(false); }
  };
}

function renderFonts() {
  const bad = state.doc.fonts.filter((f) => f.status !== 'installed');
  const panel = $('fontsPanel');
  if (!bad.length) { panel.innerHTML = ''; return; }
  panel.className = 'panel warn';
  panel.innerHTML = `<h3>Fonts not installed</h3>
    <ul class="font-list">${bad.map((f) => `<li>${esc(f.name)}</li>`).join('')}</ul>
    <div class="muted small note">Text stays editable, but Photoshop will substitute these fonts until you install them.</div>`;
}

function renderOut() {
  $('outPath').textContent = shortPath(state.outPath, 3);
  $('outPath').title = state.outPath;
}
$('changeOut').onclick = async () => {
  const p = await api.saveAs(state.outPath);
  if (p) { state.outPath = /\.psd$/i.test(p) ? p : p + '.psd'; renderOut(); }
};

// ---------- convert ----------
$('convert').onclick = async () => {
  const d = state.doc;
  const pageIndexes = [...state.selected].sort((a, b) => a - b);
  const relinks = Object.entries(state.relinks).map(([id, path]) => ({
    id: Number(id), path, name: (d.links.find((l) => String(l.id) === id) || {}).name || basename(path),
  }));
  busy(true, 'Starting…');
  try {
    const r = await api.convert({ pageIndexes, relinks, outPath: state.outPath, openWhenDone: $('openWhenDone').checked, lockLines: $('keepBreaks').checked });
    let html = `<p>${r.layers} layers across ${pageIndexes.length} artboard${pageIndexes.length === 1 ? '' : 's'}.</p>
      <div class="result-path">${esc(r.outPath)}</div>`;
    if (r.missingFonts.length) {
      html += `<p><b>Fonts Photoshop doesn't have</b> (substituted until installed):</p>
        <ul class="result-list">${r.missingFonts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`;
    }
    if (r.warnings.length) {
      html += `<p><b>Notes</b></p><ul class="result-list">${r.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`;
    }
    showResult('PSD created', html, r.outPath);
  } catch (e) {
    showError(e);
  } finally {
    busy(false);
  }
};

showApps();

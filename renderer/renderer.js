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
  renderColours();
  renderSize();
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
  if (typeof renderSize === 'function') renderSize();
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
      ? `<h3>Links</h3><div class="muted">All ${links.filter((l) => l.status !== 'embedded').length} linked files found. Each is copied into Photoshop as an embedded smart object, so your originals are never changed.</div>`
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
  if (p) { state.outPath = /\.ps[db]$/i.test(p) ? p : p + '.psd'; renderOut(); }
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
    const colourProfile = selectedProfile();
    const size = sizeSettings();
    if (size.error) { busy(false); return showResult('Check the size', `<p>${esc(size.error)}</p>`); }
    const r = await api.convert({
      pageIndexes, relinks, outPath: state.outPath, openWhenDone: $('openWhenDone').checked, lockLines: $('keepBreaks').checked,
      colourProfile: colourProfile ? { name: colourProfile.name, colors: colourProfile.colors } : null,
      scale: size.scale, scaleBy: size.scaleBy,
    });
    let html = (size.scale < 1 ? `<p>Resized in Photoshop to ${esc(size.label)}.</p>` : '') + `<p>${r.layers} layers across ${pageIndexes.length} artboard${pageIndexes.length === 1 ? '' : 's'}.</p>
      <div class="result-path">${esc(r.outPath)}</div>`;
    if (r.colourProfile) {
      const n = r.colourProfile.applied.length;
      html += n
        ? `<p><b>Brand RGB values from “${esc(r.colourProfile.name)}”</b> used for ${n} colour${n === 1 ? '' : 's'}: ${esc(r.colourProfile.applied.join(', '))}.</p>`
        : `<p>No colours in this document matched “${esc(r.colourProfile.name)}”, so the standard conversion was used.</p>`;
    }
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

// ---------- colour profiles ----------
// Profiles map a brand's CMYK colours to its official RGB values. The match
// rule here mirrors profileMatch() in jsx/id_common.jsx: same CMYK in whole
// percentages, else same swatch name; colours already in RGB are left alone.
const STANDARD = '';
let store = { selected: null, profiles: [] };

const hex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase();
function hexToRgb(s) {
  const m = String(s || '').trim().replace(/^#/, '').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((x) => x + x).join('') : m[1];
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}
const cmykKey = (v) => v.map((x) => Math.round(Number(x))).join(',');
const normName = (n) => String(n || '').trim().toLowerCase();
const fmtCmyk = (v) => `C${Math.round(v[0])} M${Math.round(v[1])} Y${Math.round(v[2])} K${Math.round(v[3])}`;
const fmtRgb = (v) => `R${v[0]} G${v[1]} B${v[2]}`;
// Chip colours are set through the CSSOM (inline style attributes are blocked by the CSP).
function paintChips(root) { root.querySelectorAll('[data-chip]').forEach((el) => { el.style.background = el.dataset.chip; }); }

function selectedProfile() { return store.profiles.find((p) => p.id === store.selected) || null; }

function matchColour(profile, col) {
  if (col.space === 'rgb') return null;
  if (col.space === 'cmyk') {
    const k = cmykKey(col.value);
    const hit = profile.colors.find((e) => e.cmyk && cmykKey(e.cmyk) === k);
    if (hit) return hit;
  }
  const n = normName(col.name);
  return (n && profile.colors.find((e) => normName(e.name) === n)) || null;
}

// The document's colours, without duplicates: InDesign keeps unnamed copies
// of colours, which add nothing when a named swatch has the same values.
function docColours() {
  if (!state.doc || !state.doc.colors) return [];
  const key = (c) => c.space + '|' + c.value.join(',');
  const named = new Set(state.doc.colors.filter((c) => c.name).map(key));
  const seen = new Set();
  return state.doc.colors.filter((c) => {
    if (!c.name && named.has(key(c))) return false;
    const k = (c.name || '') + '|' + key(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function renderProfileSelect() {
  const sel = $('colourProfile');
  sel.innerHTML = `<option value="${STANDARD}">Standard conversion</option>` +
    store.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} (${p.colors.length} colour${p.colors.length === 1 ? '' : 's'})</option>`).join('');
  sel.value = store.selected || STANDARD;
}

function renderColours() {
  const panel = $('coloursPanel');
  const prof = selectedProfile();
  if (!prof || !state.doc) { panel.classList.add('hidden'); return; }
  const cols = docColours().filter((c) => c.space !== 'rgb');
  const matched = [], unmatched = [];
  for (const c of cols) { const m = matchColour(prof, c); (m ? matched : unmatched).push({ c, m }); }
  panel.classList.remove('hidden');
  panel.className = 'panel' + (matched.length ? ' good' : '');
  const row = ({ c, m }) => `<div class="colour-row" title="${esc(c.name || 'Unnamed colour')}: standard ${esc(hex(c.rgb || [0, 0, 0]))} → brand ${esc(hex(m.rgb))}">
      <span class="chip" data-chip="${hex(c.rgb || [0, 0, 0])}"></span><span class="arrow">→</span><span class="chip" data-chip="${hex(m.rgb)}"></span>
      <span class="cname">${esc(c.name || 'Unnamed colour')}</span>
      <span class="vals">${c.space === 'cmyk' ? esc(fmtCmyk(c.value)) + ' → ' : ''}${esc(fmtRgb(m.rgb))}</span>
    </div>`;
  panel.innerHTML = `<h3>${matched.length ? `${matched.length} brand colour${matched.length === 1 ? '' : 's'} matched` : 'No brand colours matched'}</h3>
    ${matched.map(row).join('')}
    <div class="muted small note">${unmatched.length
      ? `${unmatched.length} other CMYK colour${unmatched.length === 1 ? '' : 's'} in this document ${unmatched.length === 1 ? 'isn\'t' : 'aren\'t'} in “${esc(prof.name)}” and use${unmatched.length === 1 ? 's' : ''} the standard conversion. `
      : ''}Placed images keep the colours inside their own files.</div>`;
  paintChips(panel);
}

async function loadProfiles() {
  try { store = await api.profiles.load(); } catch { store = { selected: null, profiles: [] }; }
  renderProfileSelect();
}

$('colourProfile').onchange = async () => {
  store.selected = $('colourProfile').value || null;
  try { store = await api.profiles.save(store); } catch (e) { showError(e); }
  renderColours();
};

// ---------- profile editor ----------
// Edits a draft copy; nothing is stored until Save.
const ed = { draft: null, current: null };
const clone = (v) => JSON.parse(JSON.stringify(v));
const newId = () => Math.random().toString(16).slice(2, 14);
const blankRow = () => ({ name: '', cmyk: ['', '', '', ''], rgb: ['', '', ''] });

function edProfile() { return ed.draft.profiles.find((p) => p.id === ed.current) || null; }

function openEditor() {
  ed.draft = clone(store);
  for (const p of ed.draft.profiles) p.colors = p.colors.map((c) => ({ name: c.name, cmyk: c.cmyk ? c.cmyk.slice() : ['', '', '', ''], rgb: c.rgb.slice() }));
  ed.current = store.selected || (ed.draft.profiles[0] && ed.draft.profiles[0].id) || null;
  if (!ed.current) newProfile(false);
  $('pfError').classList.add('hidden');
  renderEditor();
  $('profiles').classList.remove('hidden');
}
function closeEditor() { $('profiles').classList.add('hidden'); ed.draft = null; }

function newProfile(render = true, name = 'New profile', colors = []) {
  const p = { id: newId(), name, colors };
  ed.draft.profiles.push(p);
  ed.current = p.id;
  if (render) renderEditor();
  return p;
}

function renderEditor() {
  const p = edProfile();
  $('pfError').classList.add('hidden');
  $('pfSelect').innerHTML = ed.draft.profiles.map((x) => `<option value="${esc(x.id)}">${esc(x.name || 'Untitled profile')}</option>`).join('');
  $('pfSelect').value = ed.current;
  $('pfName').value = p ? p.name : '';
  $('pfDelete').disabled = !p;
  $('pfFromDoc').classList.toggle('hidden', !state.doc);
  const rows = p ? p.colors : [];
  $('pfEmpty').textContent = rows.length ? '' : 'No colours yet. Add them one by one, import a CSV from the brand guide, or start from this document\'s colours.';
  const num = (i, k, j, v, max, cls = '') => `<td class="${cls}"><input type="number" min="0" max="${max}" step="any" data-i="${i}" data-k="${k}" data-j="${j}" value="${esc(v)}" aria-label="${k === 'cmyk' ? 'CMYK'[j] : 'RGB'[j]}"></td>`;
  $('pfRows').innerHTML = rows.map((c, i) => {
    const rgbOk = c.rgb.every((v) => v !== '' && Number.isFinite(Number(v)));
    return `<tr>
      <td><span class="chip" data-chip="${rgbOk ? hex(c.rgb.map(Number)) : 'transparent'}" data-row-chip="${i}"></span></td>
      <td><input type="text" data-i="${i}" data-k="name" value="${esc(c.name)}" placeholder="e.g. Brand Red" aria-label="Swatch name"></td>
      ${c.cmyk.map((v, j) => num(i, 'cmyk', j, v, 100)).join('')}
      ${c.rgb.map((v, j) => num(i, 'rgb', j, v, 255, j === 0 ? 'gap' : '')).join('')}
      <td><input type="text" class="hex" data-i="${i}" data-k="hex" value="${rgbOk ? hex(c.rgb.map(Number)) : ''}" placeholder="#RRGGBB" aria-label="Hex"></td>
      <td><button class="link del" data-del="${i}" title="Remove this colour" aria-label="Remove">×</button></td>
    </tr>`;
  }).join('');
  paintChips($('pfRows'));
}

$('pfRows').addEventListener('input', (e) => {
  const t = e.target, p = edProfile();
  if (!p || t.dataset.i === undefined) return;
  const i = Number(t.dataset.i), c = p.colors[i], k = t.dataset.k;
  t.classList.remove('bad');
  if (k === 'name') c.name = t.value;
  else if (k === 'cmyk') c.cmyk[Number(t.dataset.j)] = t.value;
  else if (k === 'rgb') {
    c.rgb[Number(t.dataset.j)] = t.value;
    const ok = c.rgb.every((v) => v !== '' && Number.isFinite(Number(v)));
    $('pfRows').querySelector(`input[data-i="${i}"][data-k="hex"]`).value = ok ? hex(c.rgb.map(Number)) : '';
  } else if (k === 'hex') {
    const rgb = hexToRgb(t.value);
    if (rgb) {
      c.rgb = rgb.map(String);
      rgb.forEach((v, j) => { $('pfRows').querySelector(`input[data-i="${i}"][data-k="rgb"][data-j="${j}"]`).value = v; });
    }
  }
  const ok = c.rgb.every((v) => v !== '' && Number.isFinite(Number(v)));
  const chip = $('pfRows').querySelector(`[data-row-chip="${i}"]`);
  chip.style.background = ok ? hex(c.rgb.map(Number)) : 'transparent';
});
$('pfRows').addEventListener('click', (e) => {
  const b = e.target.closest('[data-del]');
  if (!b) return;
  edProfile().colors.splice(Number(b.dataset.del), 1);
  renderEditor();
});

$('pfSelect').onchange = () => { ed.current = $('pfSelect').value; renderEditor(); };
$('pfName').oninput = () => {
  const p = edProfile();
  if (!p) return;
  p.name = $('pfName').value;
  const o = $('pfSelect').selectedOptions[0];
  if (o) o.textContent = p.name || 'Untitled profile';
};
$('pfNew').onclick = () => { newProfile(); $('pfName').select(); };
$('pfDelete').onclick = () => {
  const p = edProfile();
  if (!p || !confirm(`Delete the colour profile “${p.name || 'Untitled profile'}”?`)) return;
  ed.draft.profiles = ed.draft.profiles.filter((x) => x.id !== p.id);
  ed.current = ed.draft.profiles[0] ? ed.draft.profiles[0].id : null;
  if (!ed.current) newProfile(false);
  renderEditor();
};
$('pfAdd').onclick = () => {
  edProfile().colors.push(blankRow());
  renderEditor();
  const last = $('pfRows').querySelector('tr:last-child input');
  if (last) last.focus();
};
// Start from the document's CMYK and spot colours, with InDesign's standard
// RGB filled in, ready to be overwritten with the brand guide's values.
$('pfFromDoc').onclick = () => {
  const p = edProfile();
  let added = 0;
  for (const c of docColours()) {
    if (c.space === 'rgb') continue;
    const probe = { colors: p.colors.filter((x) => x.rgb.every((v) => v !== '')).map((x) => ({ ...x, cmyk: x.cmyk.every((v) => v !== '') ? x.cmyk : null })) };
    if (matchColour(probe, c)) continue;
    p.colors.push({ name: c.name, cmyk: c.space === 'cmyk' ? c.value.map((v) => String(Math.round(v * 100) / 100)) : ['', '', '', ''], rgb: (c.rgb || [0, 0, 0]).map(String) });
    added++;
  }
  renderEditor();
  if (!added) { $('pfError').textContent = 'All of this document\'s CMYK colours are already in this profile.'; $('pfError').classList.remove('hidden'); }
};
$('pfImport').onclick = async () => {
  try {
    const r = await api.profiles.importCsv();
    if (!r) return;
    if (!r.colors.length) { $('pfError').textContent = 'No colours found in that file. It needs a header row with Name, C, M, Y, K and R, G, B (or Hex) columns.'; $('pfError').classList.remove('hidden'); return; }
    const rows = r.colors.map((c) => ({ name: c.name, cmyk: c.cmyk ? c.cmyk.map(String) : ['', '', '', ''], rgb: c.rgb.map(String) }));
    const p = edProfile();
    if (p && !p.colors.length) { p.colors = rows; if (/^(New profile|Untitled profile|)$/.test(p.name.trim())) p.name = r.name; }
    else newProfile(false, r.name, rows);
    $('pfError').classList.add('hidden');
    renderEditor();
  } catch (e) { showError(e); }
};
$('pfExport').onclick = async () => {
  const p = edProfile();
  const v = validateProfile(p);
  if (!v) return;
  try { await api.profiles.exportCsv(v); } catch (e) { showError(e); }
};

// Returns the profile in stored form, or null after marking what's wrong.
function validateProfile(p) {
  const out = { id: p.id, name: (p.name || '').trim() || 'Untitled profile', colors: [] };
  let bad = null;
  p.colors.forEach((c, i) => {
    const filled = (a) => a.filter((v) => String(v).trim() !== '').length;
    const empty = !c.name.trim() && !filled(c.cmyk) && !filled(c.rgb);
    if (empty) return;
    const mark = (sel, msg) => { $('pfRows').querySelectorAll(sel).forEach((el) => el.classList.add('bad')); if (!bad) bad = msg; };
    const nc = filled(c.cmyk), nr = filled(c.rgb);
    const inRange = (a, max) => a.every((v) => Number(v) >= 0 && Number(v) <= max);
    if (nc && (nc < 4 || !inRange(c.cmyk, 100))) mark(`input[data-i="${i}"][data-k="cmyk"]`, `Row ${i + 1}: enter all four CMYK values (0–100), or leave them all empty to match by swatch name.`);
    if (nr < 3 || !inRange(c.rgb, 255)) mark(`input[data-i="${i}"][data-k="rgb"], input[data-i="${i}"][data-k="hex"]`, `Row ${i + 1}: enter the brand's R, G and B values (0–255) or a hex code.`);
    if (!nc && !c.name.trim()) mark(`input[data-i="${i}"][data-k="name"]`, `Row ${i + 1}: give a swatch name or CMYK values to match.`);
    out.colors.push({ name: c.name.trim(), cmyk: nc === 4 ? c.cmyk.map(Number) : null, rgb: c.rgb.map(Number) });
  });
  if (bad) { $('pfError').textContent = bad; $('pfError').classList.remove('hidden'); return null; }
  return out;
}

$('pfSave').onclick = async () => {
  const viewing = ed.current, profiles = [];
  for (const p of ed.draft.profiles) {
    if (ed.current !== p.id) { ed.current = p.id; renderEditor(); }
    const v = validateProfile(p);
    if (!v) return; // stays on the profile with the problem, marked
    if (v.colors.length || (p.name.trim() && p.name.trim() !== 'New profile')) profiles.push(v);
  }
  ed.current = viewing;
  const keep = profiles.some((p) => p.id === viewing) ? viewing : (profiles.some((p) => p.id === store.selected) ? store.selected : null);
  try {
    store = await api.profiles.save({ selected: keep, profiles });
    closeEditor();
    renderProfileSelect();
    renderColours();
  } catch (e) { showError(e); }
};
$('pfCancel').onclick = closeEditor;
$('manageProfiles').onclick = openEditor;

// ---------- size ----------
// Shrinks the finished PSD in Photoshop: by a percentage, or to a width or
// height in pixels (the other side follows the aspect ratio). The factor is
// worked out from the largest selected page, so that page lands on the exact
// size and other pages scale by the same amount. Never enlarges.
const FULL_PPI = 300;
const fullPx = (pt) => Math.round(pt * FULL_PPI / 72);
const SIZE_KEY = 'phosho.size';

function sizePages() {
  const d = state.doc;
  if (!d) return [];
  const sel = [...state.selected].map((i) => d.pages[i]).filter(Boolean);
  return sel.length ? sel : [d.pages[state.focus] || d.pages[0]].filter(Boolean);
}

// { scale, scaleBy, label, info, error }
function sizeSettings() {
  const mode = $('sizeMode').value;
  const pages = sizePages();
  const dim = $('sizeDim').value;
  // the page that sets the size: the largest one along the side being set
  const ref = pages.reduce((a, p) => (!a || (dim === 'height' ? p.height > a.height : p.width > a.width) ? p : a), null);
  const out = { scale: 1, scaleBy: dim, label: 'full size', info: '', error: '' };
  if (!ref) return out;
  const fw = fullPx(ref.width), fh = fullPx(ref.height);
  if (mode === 'percent') {
    const v = Number($('sizePercent').value);
    if (!(v > 0 && v <= 100)) { out.error = 'Enter a percentage between 1 and 100.'; return out; }
    out.scale = v / 100;
    out.scaleBy = fw >= fh ? 'width' : 'height';
  } else if (mode === 'pixels') {
    const v = Math.round(Number($('sizePx').value));
    const full = dim === 'height' ? fh : fw;
    if (!(v >= 1)) { out.error = `Enter the ${dim} in pixels.`; return out; }
    if (v > full) { out.error = `${v} px is bigger than full size (${full} px ${dim}). The size option only makes artwork smaller.`; return out; }
    out.scale = v / full;
  }
  const w = Math.max(1, Math.round(fw * out.scale)), h = Math.max(1, Math.round(fh * out.scale));
  const ppi = Math.round(FULL_PPI * out.scale * 10) / 10;
  out.label = out.scale < 1 ? `${w} × ${h} px (${Math.round(out.scale * 1000) / 10}%, ${ppi} ppi)` : 'full size';
  const many = pages.length > 1 && pages.some((p) => p.width !== ref.width || p.height !== ref.height);
  out.info = out.scale < 1
    ? `Page ${esc(ref.name)}: ${fw} × ${fh} px → <b>${w} × ${h} px</b> at ${ppi} ppi. Text keeps its InDesign point sizes.${many ? ' Set from the largest selected page; the others shrink by the same amount.' : ''}`
    : `Page ${esc(ref.name)}: <b>${fw} × ${fh} px</b> at ${FULL_PPI} ppi.`;
  return out;
}

function renderSize() {
  const mode = $('sizeMode').value;
  $('sizePercentRow').classList.toggle('hidden', mode !== 'percent');
  $('sizePixelsRow').classList.toggle('hidden', mode !== 'pixels');
  if (!state.doc) return;
  const s = sizeSettings();
  $('sizePercent').classList.toggle('bad', mode === 'percent' && !!s.error);
  $('sizePx').classList.toggle('bad', mode === 'pixels' && !!s.error);
  $('sizeInfo').innerHTML = s.error ? `<span class="warn-text">${esc(s.error)}</span>` : s.info;
}

function saveSize() {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify({ mode: $('sizeMode').value, percent: $('sizePercent').value, dim: $('sizeDim').value, px: $('sizePx').value }));
  } catch {}
}
(function loadSize() {
  try {
    const v = JSON.parse(localStorage.getItem(SIZE_KEY) || 'null');
    if (v) { $('sizeMode').value = v.mode || 'full'; $('sizePercent').value = v.percent || 50; $('sizeDim').value = v.dim || 'width'; $('sizePx').value = v.px || 1080; }
  } catch {}
  renderSize();
})();
['sizeMode', 'sizeDim'].forEach((id) => { $(id).onchange = () => { renderSize(); saveSize(); }; });
['sizePercent', 'sizePx'].forEach((id) => { $(id).oninput = () => { renderSize(); saveSize(); }; });

loadProfiles();
showApps();

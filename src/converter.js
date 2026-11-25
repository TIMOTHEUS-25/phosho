// Conversion pipeline: analyze (thumbnails, links, fonts) and convert
// (InDesign extraction -> Photoshop build). UI-independent so it can be
// driven from Electron or from a test script.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { findApps, runJsx } = require('./adobe');

const ROOT_TMP = path.join(os.tmpdir(), 'indd-to-psd');

function newSessionDir() {
  const dir = path.join(ROOT_TMP, crypto.randomBytes(6).toString('hex'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Work on a copy so we never touch (or lock) the user's original. The copy sits
// next to the original so relative link lookups still resolve, falling back to
// the temp folder if that folder is read-only.
function makeWorkingCopy(src, sessionDir) {
  const base = `.idps-${crypto.randomBytes(4).toString('hex')}-${path.basename(src)}`;
  const sibling = path.join(path.dirname(src), base);
  try {
    fs.copyFileSync(src, sibling);
    return sibling;
  } catch {
    const tmp = path.join(sessionDir, path.basename(src));
    fs.copyFileSync(src, tmp);
    return tmp;
  }
}

function removeQuiet(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch {}
}

function pngSize(file) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.alloc(24);
  fs.readSync(fd, buf, 0, 24, 0);
  fs.closeSync(fd);
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function annotatePngs(nodes) {
  for (const n of nodes) {
    if (n.kind === 'raster') Object.assign(n, sizeOf(n.png));
    if (n.fallback) Object.assign(n.fallback, sizeOf(n.fallback.png));
    if (n.mask) Object.assign(n.mask, sizeOf(n.mask.png));
    if (n.children) annotatePngs(n.children);
  }
}
function sizeOf(png) {
  try { const s = pngSize(png); return { pngW: s.w, pngH: s.h }; } catch { return {}; }
}

function watchProgress(file, onProgress) {
  let last = '';
  const t = setInterval(() => {
    try {
      const s = fs.readFileSync(file, 'utf8');
      if (s && s !== last) { last = s; onProgress(JSON.parse(s)); }
    } catch {}
  }, 300);
  return () => clearInterval(t);
}

class Session {
  constructor(docPath) {
    this.docPath = path.resolve(docPath);
    this.dir = newSessionDir();
    this.apps = findApps();
    this.copy = null;
  }

  // Run an InDesign step against a fresh working copy, removed straight after.
  async withCopy(fn) {
    this.copy = makeWorkingCopy(this.docPath, this.dir);
    try { return await fn(this.copy); } finally { removeQuiet(this.copy); this.copy = null; }
  }

  async analyze(onProgress = () => {}) {
    const progressPath = path.join(this.dir, 'progress.json');
    const stop = watchProgress(progressPath, onProgress);
    try {
      const r = await this.withCopy((docPath) => runJsx('indesign', 'id_analyze.jsx', {
        docPath, outDir: this.dir, progressPath,
      }, this.dir, this.apps));
      return { ...r, name: path.basename(this.docPath), docPath: this.docPath, apps: this.apps };
    } finally {
      stop();
    }
  }

  /**
   * opts: { pageIndexes, relinks: [{id, name, path}], outPath, dpi, openWhenDone, lockLines }
   */
  async convert(opts, onProgress = () => {}) {
    const progressPath = path.join(this.dir, 'progress.json');
    const stop = watchProgress(progressPath, onProgress);
    const assets = path.join(this.dir, 'assets_' + Date.now());
    fs.mkdirSync(assets, { recursive: true });
    try {
      const dpi = opts.dpi || 300;
      const extract = await this.withCopy((docPath) => runJsx('indesign', 'id_extract.jsx', {
        docPath, pageIndexes: opts.pageIndexes, relinks: opts.relinks || [],
        outDir: assets, progressPath, dpi, lockLines: opts.lockLines !== false,
      }, this.dir, this.apps));

      for (const p of extract.pages) for (const l of p.layers) annotatePngs(l.nodes);
      const manifest = {
        docName: path.basename(opts.outPath).replace(/\.ps[db]$/i, ''),
        pages: extract.pages, fonts: extract.fonts,
      };
      const manifestPath = path.join(this.dir, 'manifest.json');
      fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

      const build = await runJsx('photoshop', 'ps_build.jsx', {
        manifestPath, outPath: opts.outPath, progressPath, dpi, openWhenDone: opts.openWhenDone !== false,
        simulateLock: process.env.IDPS_SIMULATE_LOCK || '', // test hook only
        debug: !!process.env.IDPS_DEBUG,
      }, this.dir, this.apps);

      return {
        outPath: build.outPath,
        layers: build.layers,
        warnings: [...extract.warnings, ...build.warnings],
        missingFonts: build.missingFonts,
        debug: build.debug,
      };
    } finally {
      stop();
      if (!process.env.IDPS_KEEP_TEMP) removeQuiet(assets);
    }
  }

  dispose() {
    if (this.copy) removeQuiet(this.copy);
    removeQuiet(this.dir);
  }
}

// Look for files by name under a folder (e.g. a server share) to fix missing links.
async function searchFolder(root, names, { maxEntries = 200000, maxDepth = 12 } = {}) {
  const wanted = new Map(names.map((n) => [n.toLowerCase(), n]));
  const found = {};
  let seen = 0;
  async function walk(dir, depth) {
    if (depth > maxDepth || seen > maxEntries || wanted.size === Object.keys(found).length) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      seen++;
      if (e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full, depth + 1);
      else {
        const key = e.name.toLowerCase();
        if (wanted.has(key) && !found[wanted.get(key)]) found[wanted.get(key)] = full;
      }
    }
  }
  await walk(root, 0);
  return found;
}

module.exports = { Session, searchFolder, findApps };

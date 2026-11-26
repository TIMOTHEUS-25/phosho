// Colour profiles: a brand's own RGB values for its CMYK colours.
// Stored as one JSON file: { selected: id | null, profiles: [{ id, name, colors: [{ name, cmyk, rgb }] }] }
// cmyk is [c, m, y, k] in percent (or null to match by swatch name only), rgb is [r, g, b] 0..255.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const clampTo = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) * 100) / 100));

function cleanColor(c) {
  if (!c || !Array.isArray(c.rgb) || c.rgb.length < 3 || c.rgb.slice(0, 3).some((v) => !Number.isFinite(Number(v)))) return null;
  const cmyk = Array.isArray(c.cmyk) && c.cmyk.length === 4 && c.cmyk.every((v) => v !== '' && v !== null && Number.isFinite(Number(v)))
    ? c.cmyk.map((v) => clampTo(v, 100)) : null;
  const name = String(c.name || '').trim();
  if (!cmyk && !name) return null;
  return { name, cmyk, rgb: c.rgb.slice(0, 3).map((v) => Math.round(clampTo(v, 255))) };
}

function cleanProfile(p) {
  return {
    id: String(p.id || crypto.randomBytes(6).toString('hex')),
    name: String(p.name || 'Untitled profile').trim() || 'Untitled profile',
    colors: (p.colors || []).map(cleanColor).filter(Boolean),
  };
}

class ProfileStore {
  constructor(file) { this.file = file; }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return this.finish(d);
    } catch {
      return { selected: null, profiles: [] };
    }
  }

  save(data) { return this.write(data); }

  finish(d) {
    const profiles = (d.profiles || []).map(cleanProfile);
    const selected = profiles.some((p) => p.id === d.selected) ? d.selected : null;
    return { selected, profiles };
  }

  write(d) {
    const out = this.finish(d);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(out, null, 1), 'utf8');
    fs.renameSync(tmp, this.file);
    return out;
  }
}

// ---------- CSV ----------
function splitCsvLine(line, delim) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const HEADERS = {
  name: /^(name|swatch|swatch name|colou?r|colou?r name|label)$/,
  c: /^(c|cyan)$/, m: /^(m|magenta)$/, y: /^(y|yellow)$/, k: /^(k|black|key)$/,
  r: /^(r|red)$/, g: /^(g|green)$/, b: /^(b|blue)$/,
  hex: /^(hex|html|web|#|rgb hex|hex code)$/,
};

function hexToRgb(s) {
  const m = String(s || '').trim().replace(/^#/, '').match(/^([0-9a-f]{6}|[0-9a-f]{3})$/i);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((x) => x + x).join('');
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16));
}

/**
 * Parse a brand colour list. Columns (any order, with a header row):
 * name, C, M, Y, K, and either R, G, B or Hex. Without a header the order
 * name, C, M, Y, K, R, G, B is assumed. Comma, semicolon or tab separated.
 */
function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, '').split(/\r\n|\r|\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const first = lines[0];
  const delim = ['\t', ';', ','].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitCsvLine(first, delim).map((h) => h.toLowerCase().replace(/[%()]/g, '').trim());
  const col = {};
  head.forEach((h, i) => { for (const [k, re] of Object.entries(HEADERS)) if (col[k] === undefined && re.test(h)) col[k] = i; });
  const hasHeader = col.c !== undefined || col.r !== undefined || col.hex !== undefined;
  const map = hasHeader ? col : { name: 0, c: 1, m: 2, y: 3, k: 4, r: 5, g: 6, b: 7 };
  const rows = hasHeader ? lines.slice(1) : lines;
  const num = (cells, k) => (map[k] === undefined || cells[map[k]] === undefined || cells[map[k]] === '' ? NaN : Number(cells[map[k]].replace(',', '.')));
  const colors = [];
  for (const line of rows) {
    const cells = splitCsvLine(line, delim);
    const cmyk = ['c', 'm', 'y', 'k'].map((k) => num(cells, k));
    let rgb = ['r', 'g', 'b'].map((k) => num(cells, k));
    if (rgb.some((v) => !Number.isFinite(v))) rgb = hexToRgb(map.hex !== undefined ? cells[map.hex] : '');
    const c = cleanColor({
      name: map.name !== undefined ? cells[map.name] : '',
      cmyk: cmyk.every(Number.isFinite) ? cmyk : null,
      rgb,
    });
    if (c) colors.push(c);
  }
  return colors;
}

function toCsv(profile) {
  const q = (s) => (/[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  const rows = [['Name', 'C', 'M', 'Y', 'K', 'R', 'G', 'B', 'Hex'].join(',')];
  for (const c of profile.colors) {
    rows.push([q(c.name), ...(c.cmyk || ['', '', '', '']), ...c.rgb, hex(c.rgb)].join(','));
  }
  return rows.join('\n') + '\n';
}

module.exports = { ProfileStore, parseCsv, toCsv, cleanProfile, hexToRgb };

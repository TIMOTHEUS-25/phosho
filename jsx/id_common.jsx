// InDesign-only helpers shared by analyze + extract.

function idOpen(path) {
    app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
    var doc = app.open(new File(path), false);
    var vp = doc.viewPreferences;
    vp.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    vp.verticalMeasurementUnits = MeasurementUnits.POINTS;
    vp.rulerOrigin = RulerOrigin.SPREAD_ORIGIN;
    doc.zeroPoint = [0, 0];
    return doc;
}

function idClose(doc) {
    try { if (doc && doc.isValid) doc.close(SaveOptions.NO); } catch (e) {}
    try { app.scriptPreferences.userInteractionLevel = UserInteractionLevels.INTERACT_WITH_ALL; } catch (e) {}
}

// Absolute OS path of a link (works for local disks and server volumes).
function linkPath(l) {
    try {
        var u = l.linkResourceURI;
        if (u && /^file:/i.test(u)) {
            var s = decodeURI(u.replace(/^file:/i, ''));
            if (/^\/\/\/[A-Za-z]:/.test(s)) s = s.substr(3);          // file:///C:/x
            else if (/^\/\/\//.test(s)) s = s.substr(2);              // file:///Users/x
            else if (/^\/\/[^\/]/.test(s) && $.os.indexOf('Windows') >= 0) s = s.replace(/\//g, '\\'); // UNC
            return new File(s).fsName;
        }
    } catch (e) {}
    try { return new File(l.filePath).fsName; } catch (e2) {}
    return l.filePath;
}

function linkStatusName(st) {
    if (st == LinkStatus.NORMAL) return 'ok';
    if (st == LinkStatus.LINK_MISSING) return 'missing';
    if (st == LinkStatus.LINK_OUT_OF_DATE) return 'modified';
    if (st == LinkStatus.LINK_EMBEDDED) return 'embedded';
    if (st == LinkStatus.LINK_INACCESSIBLE) return 'inaccessible';
    return 'unknown';
}

// Read a font's details safely. Missing/substituted fonts throw on most
// properties, so fall back to the "Family\tStyle" name InDesign always keeps.
function fontInfo(f, fallbackStyle) {
    var info = { name: '', family: '', style: '', ps: '', status: 'missing' };
    if (f && typeof f === 'object') {
        try { info.name = String(f.name); } catch (e) {}
        try { info.family = String(f.fontFamily); } catch (e) {}
        try { info.style = String(f.fontStyleName); } catch (e) {}
        try { info.ps = String(f.postscriptName); } catch (e) {}
        try { info.status = fontStatusName(f.status); } catch (e) {}
    } else if (f) {
        info.name = String(f);
    }
    var parts = info.name.split('\t');
    if (!info.family) info.family = parts[0] || 'Unknown font';
    if (!info.style) info.style = parts[1] || fallbackStyle || 'Regular';
    if (!info.ps) info.ps = (info.family + '-' + info.style).replace(/\s+/g, '');
    info.name = info.family + ' ' + info.style;
    return info;
}

function fontStatusName(st) {
    try {
        if (st == FontStatus.INSTALLED) return 'installed';
        if (st == FontStatus.NOT_AVAILABLE) return 'missing';
        if (st == FontStatus.SUBSTITUTED) return 'substituted';
        if (st == FontStatus.FAUXED) return 'faux';
    } catch (e) {}
    return 'unknown';
}

// ---------- colour ----------
function clamp(v) { return Math.max(0, Math.min(255, Math.round(v))); }

function labToRgb(L, A, B) {
    var y = (L + 16) / 116, x = A / 500 + y, z = y - B / 200;
    function f(t) { return t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787; }
    x = 0.95047 * f(x); y = f(y); z = 1.08883 * f(z);
    var r = x * 3.2406 + y * -1.5372 + z * -0.4986;
    var g = x * -0.9689 + y * 1.8758 + z * 0.0415;
    var b = x * 0.0557 + y * -0.2040 + z * 1.0570;
    function gm(c) { return c > 0.0031308 ? 1.055 * Math.pow(c, 1 / 2.4) - 0.055 : 12.92 * c; }
    return [clamp(gm(r) * 255), clamp(gm(g) * 255), clamp(gm(b) * 255)];
}

function colorRgb(c) {
    try {
        var name = c.name;
        if (name === 'None') return null;
        if (name === 'Paper') return [255, 255, 255];
        if (name === 'Registration') return [0, 0, 0];
    } catch (e) {}
    var ctor = c.constructor.name;
    if (ctor === 'Tint') return tintRgb(colorRgb(c.baseColor), c.tintValue);
    if (ctor === 'Gradient') {
        try { return colorRgb(c.gradientStops[0].stopColor); } catch (e) { return [0, 0, 0]; }
    }
    if (ctor === 'MixedInk') return [0, 0, 0];
    var v = c.colorValue, sp = c.space;
    // Brand RGB from the chosen colour profile wins over any conversion.
    if (sp != ColorSpace.RGB) {
        var hit = profileMatch(c.name, sp, v);
        if (hit) return hit.rgb.slice(0, 3);
    }
    try {
        if (sp != ColorSpace.RGB) {
            // Colour-managed conversion; InDesign returns RGB in the 0..1 range.
            var t = app.colorTransform(v, sp, ColorSpace.RGB);
            if (t && t.length >= 3) {
                var m = (t[0] <= 1 && t[1] <= 1 && t[2] <= 1) ? 255 : 1;
                return [clamp(t[0] * m), clamp(t[1] * m), clamp(t[2] * m)];
            }
        }
    } catch (e) {}
    if (sp == ColorSpace.RGB) return [clamp(v[0]), clamp(v[1]), clamp(v[2])];
    if (sp == ColorSpace.CMYK) {
        var k = 1 - v[3] / 100;
        return [clamp(255 * (1 - v[0] / 100) * k), clamp(255 * (1 - v[1] / 100) * k), clamp(255 * (1 - v[2] / 100) * k)];
    }
    if (sp == ColorSpace.LAB) return labToRgb(v[0], v[1], v[2]);
    return [0, 0, 0];
}

function tintRgb(rgb, tint) {
    if (!rgb) return null;
    if (tint === undefined || tint < 0 || tint >= 100) return rgb;
    var t = tint / 100;
    return [clamp(255 - (255 - rgb[0]) * t), clamp(255 - (255 - rgb[1]) * t), clamp(255 - (255 - rgb[2]) * t)];
}


// ---------- colour profile ----------
// PARAMS.colourProfile = { name, colors: [{ name, cmyk: [c,m,y,k] | null, rgb: [r,g,b] }] }
// A document colour matches an entry when its CMYK values are the same
// (rounded to whole percentages), else when its swatch name is the same.
// Colours that are already RGB are never remapped.
var _profileIndex = null;
function profileIndex() {
    if (_profileIndex) return _profileIndex;
    _profileIndex = { cmyk: {}, name: {} };
    var p = (typeof PARAMS !== 'undefined' && PARAMS.colourProfile) || null;
    var cols = (p && p.colors) || [];
    for (var i = 0; i < cols.length; i++) {
        var e = cols[i];
        if (!e || !e.rgb || e.rgb.length < 3) continue;
        if (e.cmyk && e.cmyk.length === 4) { var k = cmykKey(e.cmyk); if (!_profileIndex.cmyk[k]) _profileIndex.cmyk[k] = e; }
        if (e.name) { var n = normName(e.name); if (n && !_profileIndex.name[n]) _profileIndex.name[n] = e; }
    }
    return _profileIndex;
}
function cmykKey(v) { return [Math.round(v[0]), Math.round(v[1]), Math.round(v[2]), Math.round(v[3])].join(','); }
function normName(n) { return String(n || '').replace(/^\s+|\s+$/g, '').toLowerCase(); }
function profileMatch(name, space, value) {
    var ix = profileIndex();
    try {
        if (space == ColorSpace.RGB) return null;
        if (space == ColorSpace.CMYK && value && value.length === 4) {
            var hit = ix.cmyk[cmykKey(value)];
            if (hit) return hit;
        }
    } catch (e) {}
    var n = normName(name);
    return n ? ix.name[n] || null : null;
}

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

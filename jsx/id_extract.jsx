// InDesign: walk every object on the selected pages and write a manifest
// that Photoshop rebuilds as layers. All geometry is in points, relative to
// the page's top-left corner.
(function () {
    var res = { ok: false, pages: [], fonts: [], warnings: [] };
    var doc = null;
    var fontMap = {};
    var pngCount = 0;

    var PS_LINKABLE = /\.(psd|psb|tif|tiff|jpg|jpeg|jpe|png|gif|bmp|ai|pdf|eps|webp|heic|svg|tga)$/i;

    function warn(m) { res.warnings.push(m); }
    function pushAll(arr, more) { for (var i = 0; i < more.length; i++) arr.push(more[i]); }

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

    // ---------- geometry ----------
    function resolveSpread(obj, anchor) {
        var r = obj.resolve([anchor, BoundingBoxLimits.GEOMETRIC_PATH_BOUNDS, CoordinateSpaces.INNER_COORDINATES], CoordinateSpaces.SPREAD_COORDINATES);
        return (r[0] instanceof Array) ? r[0] : r;
    }

    function corners(obj, ctx) {
        var tl = resolveSpread(obj, AnchorPoint.TOP_LEFT_ANCHOR);
        var tr = resolveSpread(obj, AnchorPoint.TOP_RIGHT_ANCHOR);
        var bl = resolveSpread(obj, AnchorPoint.BOTTOM_LEFT_ANCHOR);
        return {
            tl: [tl[0] - ctx.sx, tl[1] - ctx.sy],
            tr: [tr[0] - ctx.sx, tr[1] - ctx.sy],
            bl: [bl[0] - ctx.sx, bl[1] - ctx.sy]
        };
    }

    function hasLiveCorners(item) {
        var k = ['topLeftCornerOption', 'topRightCornerOption', 'bottomLeftCornerOption', 'bottomRightCornerOption'];
        for (var i = 0; i < k.length; i++) { try { if (item[k[i]] != CornerOptions.NONE) return true; } catch (e) {} }
        return false;
    }

    // A frame's path data doesn't include live corners (rounded, bevel, fancy…).
    // A Pathfinder union on a copy bakes them into real path points.
    function clipPaths(item, ctx) {
        if (!hasLiveCorners(item)) return pathsOf(item, ctx);
        var d = null, tiny = null, r = null;
        try {
            d = item.duplicate();
            try { d.graphics.everyItem().remove(); } catch (e) {}
            try { d.pageItems.everyItem().remove(); } catch (e) {}
            var gb = d.geometricBounds, cy = (gb[0] + gb[2]) / 2, cx = (gb[1] + gb[3]) / 2;
            tiny = d.parent.rectangles.add({ geometricBounds: [cy - 0.25, cx - 0.25, cy + 0.25, cx + 0.25] });
            r = d.addPath([tiny]);
            d = null; tiny = null;
            var out = pathsOf(r, ctx), keep = [];
            // Drop the helper square if it didn't merge (shape not covering its centre).
            for (var i = 0; i < out.length; i++) {
                var xs = [], ys = [];
                for (var k = 0; k < out[i].pts.length; k++) { xs.push(out[i].pts[k][0][0]); ys.push(out[i].pts[k][0][1]); }
                if (Math.max.apply(null, xs) - Math.min.apply(null, xs) > 1 || Math.max.apply(null, ys) - Math.min.apply(null, ys) > 1) keep.push(out[i]);
            }
            return keep.length ? keep : pathsOf(item, ctx);
        } catch (e) {
            return pathsOf(item, ctx);
        } finally {
            try { if (r) r.remove(); } catch (e) {}
            try { if (d) d.remove(); } catch (e) {}
            try { if (tiny) tiny.remove(); } catch (e) {}
        }
    }

    function pathsOf(item, ctx) {
        var out = [];
        var paths = item.paths.everyItem().getElements();
        for (var i = 0; i < paths.length; i++) {
            var ep = paths[i].entirePath, pts = [];
            for (var k = 0; k < ep.length; k++) {
                var q = ep[k], a, l, r;
                if (q[0] instanceof Array) { l = q[0]; a = q[1]; r = q[2]; } else { a = q; l = q; r = q; }
                pts.push([[a[0] - ctx.ox, a[1] - ctx.oy], [l[0] - ctx.ox, l[1] - ctx.oy], [r[0] - ctx.ox, r[1] - ctx.oy]]);
            }
            out.push({ closed: paths[i].pathType == PathType.CLOSED_PATH, pts: pts });
        }
        return out;
    }

    function opacityOf(item) {
        try { return item.transparencySettings.blendingSettings.opacity; } catch (e) { return 100; }
    }

    // ---------- effects ----------
    // InDesign effects become live Photoshop layer styles. Values stay in
    // points here; ps_build scales them to pixels.
    var BLEND = {};
    (function () {
        var m = { NORMAL: 'normal', MULTIPLY: 'multiply', SCREEN: 'screen', OVERLAY: 'overlay', SOFT_LIGHT: 'softLight',
                  HARD_LIGHT: 'hardLight', COLOR_DODGE: 'colorDodge', COLOR_BURN: 'colorBurn', DARKEN: 'darken',
                  LIGHTEN: 'lighten', DIFFERENCE: 'difference', EXCLUSION: 'exclusion', HUE: 'hue',
                  SATURATION: 'saturation', COLOR: 'color', LUMINOSITY: 'luminosity' };
        for (var k in m) { try { if (BlendMode[k] !== undefined) BLEND[BlendMode[k]] = m[k]; } catch (e) {} }
    })();
    function blendName(v) { return BLEND[v] || 'normal'; }
    function enumIs(v, en, key) { try { return v == en[key]; } catch (e) { return false; } }

    var OUTER_FX = { dropShadow: 1, outerGlow: 1 };

    function fxColor(e, prop) {
        var c = null;
        try { c = colorRgb(e[prop || 'effectColor']); } catch (x) {}
        return c || [0, 0, 0];
    }
    function lightAngle(e) {
        try { if (e.useGlobalLight) return doc.transparencyPreferences.globalLightAngle; } catch (x) {}
        return e.angle;
    }
    function lightAltitude(e) {
        try { if (e.useGlobalLight) return doc.transparencyPreferences.globalLightAltitude; } catch (x) {}
        return e.altitude;
    }

    // Read one transparency level (object, fill, stroke or content).
    // strip: turn the mapped effects off on the item, so a PNG export of it
    //        doesn't bake them in (and doesn't grow past the object's bounds).
    // skip:  effects already taken from another level, left untouched.
    function grabFx(item, prop, strip, skip) {
        var out = { fx: {}, n: 0, opacity: 100, blend: 'normal', unmapped: [] };
        var ts = null;
        try { ts = item[prop]; if (!ts || !ts.isValid) ts = null; } catch (e) { ts = null; }
        if (!ts) return out;
        skip = skip || {};
        try { out.opacity = ts.blendingSettings.opacity; out.blend = blendName(ts.blendingSettings.blendMode); } catch (e) {}
        function take(key, get, off) {
            if (skip[key]) return;
            try {
                var v = get();
                if (!v) return;
                out.fx[key] = v; out.n++;
                if (strip) { try { off(); } catch (e2) {} }
            } catch (e) {}
        }
        take('dropShadow', function () {
            var e = ts.dropShadowSettings;
            if (!enumIs(e.mode, ShadowMode, 'DROP')) return null;
            return { blend: blendName(e.blendMode), opacity: e.opacity, color: fxColor(e), angle: lightAngle(e),
                     distance: e.distance, size: e.size, spread: e.spread, noise: e.noise, knockout: !!e.knockedOut };
        }, function () { ts.dropShadowSettings.mode = ShadowMode.NONE; });
        take('innerShadow', function () {
            var e = ts.innerShadowSettings;
            if (!e.applied) return null;
            return { blend: blendName(e.blendMode), opacity: e.opacity, color: fxColor(e), angle: lightAngle(e),
                     distance: e.distance, size: e.size, choke: e.chokeAmount, noise: e.noise };
        }, function () { ts.innerShadowSettings.applied = false; });
        take('outerGlow', function () {
            var e = ts.outerGlowSettings;
            if (!e.applied) return null;
            return { blend: blendName(e.blendMode), opacity: e.opacity, color: fxColor(e), size: e.size,
                     spread: e.spread, noise: e.noise, precise: enumIs(e.technique, GlowTechnique, 'PRECISE') };
        }, function () { ts.outerGlowSettings.applied = false; });
        take('innerGlow', function () {
            var e = ts.innerGlowSettings;
            if (!e.applied) return null;
            return { blend: blendName(e.blendMode), opacity: e.opacity, color: fxColor(e), size: e.size,
                     choke: e.spread, noise: e.noise, precise: enumIs(e.technique, GlowTechnique, 'PRECISE'),
                     center: enumIs(e.source, InnerGlowSource, 'CENTER_SOURCED') };
        }, function () { ts.innerGlowSettings.applied = false; });
        take('bevel', function () {
            var e = ts.bevelAndEmbossSettings;
            if (!e.applied) return null;
            var style = 'innerBevel', tech = 'softMatte';
            if (enumIs(e.style, BevelAndEmbossStyle, 'OUTER_BEVEL')) style = 'outerBevel';
            else if (enumIs(e.style, BevelAndEmbossStyle, 'EMBOSS')) style = 'emboss';
            else if (enumIs(e.style, BevelAndEmbossStyle, 'PILLOW_EMBOSS')) style = 'pillowEmboss';
            if (enumIs(e.technique, BevelAndEmbossTechnique, 'CHISEL_HARD')) tech = 'preciseMatte';
            else if (enumIs(e.technique, BevelAndEmbossTechnique, 'CHISEL_SOFT')) tech = 'slopeLimitMatte';
            return { style: style, technique: tech, depth: e.depth, up: !enumIs(e.direction, BevelAndEmbossDirection, 'DOWN'),
                     size: e.size, soften: e.soften, angle: lightAngle(e), altitude: lightAltitude(e),
                     hiColor: fxColor(e, 'highlightColor'), hiBlend: blendName(e.highlightBlendMode), hiOpacity: e.highlightOpacity,
                     shColor: fxColor(e, 'shadowColor'), shBlend: blendName(e.shadowBlendMode), shOpacity: e.shadowOpacity };
        }, function () { ts.bevelAndEmbossSettings.applied = false; });
        take('satin', function () {
            var e = ts.satinSettings;
            if (!e.applied) return null;
            return { blend: blendName(e.blendMode), opacity: e.opacity, color: fxColor(e), angle: e.angle,
                     distance: e.distance, size: e.size, invert: !!e.invertEffect };
        }, function () { ts.satinSettings.applied = false; });
        // Feathers have no Photoshop layer-style equivalent.
        try { if (!enumIs(ts.featherSettings.mode, FeatherMode, 'NONE')) out.unmapped.push('basic feather'); } catch (e) {}
        try { if (ts.directionalFeatherSettings.applied) out.unmapped.push('directional feather'); } catch (e) {}
        try { if (ts.gradientFeatherSettings.applied) out.unmapped.push('gradient feather'); } catch (e) {}
        return out;
    }

    // Copy effects from b into a where a doesn't have them. keys limits which.
    function mergeFx(a, b, keys) {
        var r = {};
        for (var k in a) r[k] = a[k];
        for (var j in b) if (!r[j] && (!keys || keys[j])) r[j] = b[j];
        return r;
    }
    function pickFx(a, keys, invert) {
        var r = {};
        for (var k in a) if (!keys[k] === !!invert) r[k] = a[k];
        return r;
    }
    function hasFx(a) { for (var k in a) return true; return false; }
    function firstBlend() {
        for (var i = 0; i < arguments.length; i++) if (arguments[i] && arguments[i] !== 'normal') return arguments[i];
        return 'normal';
    }

    // Read every transparency level of an item that is about to be exported as
    // PNG, turning the mapped effects off first. Object-level opacity and blend
    // mode move to the Photoshop layer too; fill/stroke-level ones stay baked.
    function takeRasterFx(item) {
        var own = grabFx(item, 'transparencySettings', true);
        try {
            item.transparencySettings.blendingSettings.opacity = 100;
            item.transparencySettings.blendingSettings.blendMode = BlendMode.NORMAL;
        } catch (e) {}
        var fx = own.fx, unmapped = own.unmapped.slice(0);
        var levels = ['fillTransparencySettings', 'strokeTransparencySettings', 'contentTransparencySettings'];
        for (var i = 0; i < levels.length; i++) {
            var sub = grabFx(item, levels[i], true, fx);
            fx = mergeFx(fx, sub.fx);
            for (var u = 0; u < sub.unmapped.length; u++) unmapped.push(sub.unmapped[u]);
        }
        return { fx: fx, opacity: own.opacity, blend: own.blend, unmapped: unmapped };
    }

    function isStyled(item) {
        try {
            var fill = item.fillColor && item.fillColor.name !== 'None';
            var stroke = item.strokeWeight > 0 && item.strokeColor && item.strokeColor.name !== 'None';
            return fill || stroke;
        } catch (e) { return false; }
    }

    // ---------- raster ----------
    // Exports the item as PNG. Its effects, opacity and blend mode are taken
    // off first and returned on the node, so Photoshop can apply them as live
    // layer styles and the PNG matches the object's bounds exactly.
    function rasterNode(item, ctx, name, hidden, note) {
        pngCount++;
        var f = PARAMS.outDir + '/obj_' + pngCount + '.png';
        var t = takeRasterFx(item);
        item.exportFile(ExportFormat.PNG_FORMAT, new File(f), false);
        if (!new File(f).exists) throw new Error('PNG export produced no file');
        var vb = item.visibleBounds;
        return { kind: 'raster', name: name, png: f, hidden: !!hidden, note: note || '',
                 bounds: [vb[0] - ctx.oy, vb[1] - ctx.ox, vb[2] - ctx.oy, vb[3] - ctx.ox],
                 fx: t.fx, opacity: t.opacity, blend: t.blend, bakedFx: t.unmapped };
    }

    // ---------- naming ----------
    var TYPE_LABEL = { Rectangle: 'Rectangle', Oval: 'Ellipse', Polygon: 'Polygon', GraphicLine: 'Line', Group: 'Group',
                       TextFrame: 'Text', Button: 'Button', MultiStateObject: 'Object States', FormField: 'Form field' };

    // The name given in InDesign's Layers panel, if someone set one.
    function userName(item) {
        var n = '';
        try { n = String(item.name); } catch (e) {}
        return (n && n.charAt(0) !== '<') ? n : '';
    }
    function styleName(item) {
        try {
            var n = String(item.appliedObjectStyle.name);
            if (n && n.charAt(0) !== '[') return n;
        } catch (e) {}
        return '';
    }
    function swatchName(item) {
        try {
            var n = String(item.fillColor.name);
            if (n && n !== 'None' && n !== 'Paper' && n !== 'Registration') return n;
        } catch (e) {}
        return '';
    }

    // Layer name: the InDesign name if set, else type plus object style or
    // fill swatch ("Rectangle · Brand Red"), else just the type.
    function itemName(item, type) {
        var n = userName(item);
        if (n) return n;
        var base = TYPE_LABEL[type] || type;
        var extra = styleName(item) || swatchName(item);
        return extra ? base + ' \u00b7 ' + extra : base;
    }

    // Describe a folder by what's in it: its biggest text, else its first
    // image, else its first named object.
    function describeNodes(nodes) {
        var best = null, bestSize = -1, img = null, named = null;
        (function walk(list) {
            for (var i = list.length - 1; i >= 0; i--) {
                var n = list[i];
                if (n.kind === 'text') {
                    var sz = 0;
                    for (var r = 0; r < n.runs.length; r++) sz = Math.max(sz, n.runs[r].size);
                    if (sz > bestSize) { bestSize = sz; best = n.name; }
                } else if (n.kind === 'image' && !img) img = n.name;
                if (n.userNamed && !named) named = n.name;
                if (n.children) walk(n.children);
            }
        })(nodes);
        return best || img || named || '';
    }

    function folderName(item, nodes, fallback) {
        var n = userName(item) || styleName(item);
        if (n) return n;
        var d = describeNodes(nodes);
        if (!d) return fallback;
        var label = d + ' ' + fallback.toLowerCase();
        // An outer folder would get the same name as the folder it holds:
        // say what else it adds instead ("Card title group + 1 more").
        for (var i = 0; i < nodes.length; i++) {
            if (nodes[i].kind === 'group' && nodes[i].name === label) return label + ' + ' + (nodes.length - 1) + ' more';
        }
        return label;
    }

    // ---------- text ----------
    var SPECIAL = {
        EM_SPACE: ' ', EN_SPACE: ' ', FLUSH_SPACE: ' ', HAIR_SPACE: ' ', NONBREAKING_SPACE: ' ',
        FIXED_WIDTH_NONBREAKING_SPACE: ' ', THIN_SPACE: ' ', FIGURE_SPACE: ' ', PUNCTUATION_SPACE: ' ',
        SIXTH_SPACE: ' ', QUARTER_SPACE: ' ', THIRD_SPACE: ' ', EM_DASH: '—', EN_DASH: '–',
        BULLET_CHARACTER: '•', COPYRIGHT_SYMBOL: '©', REGISTERED_TRADEMARK: '®', TRADEMARK_SYMBOL: '™',
        SINGLE_LEFT_QUOTE: '‘', SINGLE_RIGHT_QUOTE: '’', DOUBLE_LEFT_QUOTE: '“', DOUBLE_RIGHT_QUOTE: '”',
        SINGLE_STRAIGHT_QUOTE: "'", DOUBLE_STRAIGHT_QUOTE: '"', ELLIPSIS_CHARACTER: '…', NONBREAKING_HYPHEN: '‑',
        PARAGRAPH_SYMBOL: '¶', SECTION_SYMBOL: '§', DEGREE_SYMBOL: '°', FORCED_LINE_BREAK: '\n',
        COLUMN_BREAK: '\r', FRAME_BREAK: '\r', PAGE_BREAK: '\r', ODD_PAGE_BREAK: '\r', EVEN_PAGE_BREAK: '\r',
        TABULATOR: '\t', RIGHT_INDENT_TAB: '\t'
    };

    function specialText(e, ctx) {
        try {
            if (e == SpecialCharacters.AUTO_PAGE_NUMBER || e == SpecialCharacters.NEXT_PAGE_NUMBER || e == SpecialCharacters.PREVIOUS_PAGE_NUMBER) return ctx.page.name;
        } catch (x) {}
        for (var k in SPECIAL) {
            try { if (SpecialCharacters[k] !== undefined && e == SpecialCharacters[k]) return SPECIAL[k]; } catch (x) {}
        }
        return '';
    }

    function cleanText(s, ctx) {
        return s.replace(/\u0018/g, ctx.page.name)
                .replace(/\n/g, '\u0003')
                .replace(/[\u0000-\u0002\u0004-\u0008\u000B\u000C\u000E-\u001F﻿￼]/g, '');
    }

    var CAPS = {}, POS = {};
    try { CAPS[Capitalization.ALL_CAPS] = 'allCaps'; CAPS[Capitalization.SMALL_CAPS] = 'smallCaps'; CAPS[Capitalization.CAP_TO_SMALL_CAP] = 'smallCaps'; } catch (e) {}
    try { POS[Position.SUPERSCRIPT] = 'superScript'; POS[Position.OT_SUPERSCRIPT] = 'superScript'; POS[Position.SUBSCRIPT] = 'subScript'; POS[Position.OT_SUBSCRIPT] = 'subScript'; } catch (e) {}

    function runStyle(r) {
        var st = {};
        var fstyle = '';
        try { fstyle = String(r.fontStyle); } catch (e) {}
        var fi = { family: 'Unknown font', style: fstyle || 'Regular', ps: '', status: 'missing' };
        try { fi = fontInfo(r.appliedFont, fstyle); } catch (e) {}
        var ps = fi.ps, fam = fi.family, sty = fi.style, status = fi.status;
        st.ps = ps; st.family = fam; st.style = sty;
        var key = ps || (fam + ' ' + sty);
        if (!fontMap[key]) fontMap[key] = { ps: ps, family: fam, style: sty, status: status };

        st.size = r.pointSize;
        var ld = r.leading;
        st.autoLeading = (ld == Leading.AUTO) || typeof ld !== 'number';
        if (!st.autoLeading) st.leading = ld;
        st.tracking = r.tracking;
        st.hScale = r.horizontalScale;
        st.vScale = r.verticalScale;
        st.baselineShift = r.baselineShift;
        st.caps = CAPS[r.capitalization] || '';
        st.position = POS[r.position] || '';
        st.underline = !!r.underline;
        st.strike = !!r.strikeThru;
        var rgb = null;
        try { rgb = tintRgb(colorRgb(r.fillColor), r.fillTint); } catch (e) {}
        st.color = rgb || [0, 0, 0];
        st.noFill = !rgb;
        return st;
    }

    var ALIGN = {};
    try {
        ALIGN[Justification.LEFT_ALIGN] = 'left'; ALIGN[Justification.CENTER_ALIGN] = 'center'; ALIGN[Justification.RIGHT_ALIGN] = 'right';
        ALIGN[Justification.LEFT_JUSTIFIED] = 'justifyLeft'; ALIGN[Justification.CENTER_JUSTIFIED] = 'justifyCenter';
        ALIGN[Justification.RIGHT_JUSTIFIED] = 'justifyRight'; ALIGN[Justification.FULLY_JUSTIFIED] = 'justifyAll';
        ALIGN[Justification.TO_BINDING_SIDE] = 'left'; ALIGN[Justification.AWAY_FROM_BINDING_SIDE] = 'right';
    } catch (e) {}

    function paraStyle(p) {
        var s = { align: ALIGN[p.justification] || 'left' };
        try { s.firstLineIndent = p.firstLineIndent; s.leftIndent = p.leftIndent; s.rightIndent = p.rightIndent; } catch (e) {}
        try { s.spaceBefore = p.spaceBefore; s.spaceAfter = p.spaceAfter; } catch (e) {}
        try { s.autoLeadingPct = p.autoLeading; } catch (e) {}
        try { s.hyphenate = !!p.hyphenation; } catch (e) {}
        // "Adobe Paragraph Composer" balances whole paragraphs, like Photoshop's every-line composer.
        try { s.everyLine = !/single/i.test(String(p.composer)); } catch (e) { s.everyLine = true; }
        return s;
    }

    function bulletText(p) {
        try {
            if (p.bulletsAndNumberingListType != ListType.NO_LIST) return p.bulletsAndNumberingResultText || '';
        } catch (e) {}
        return '';
    }

    var JUSTIFIED = {};
    try {
        JUSTIFIED[Justification.LEFT_JUSTIFIED] = 1; JUSTIFIED[Justification.CENTER_JUSTIFIED] = 1;
        JUSTIFIED[Justification.RIGHT_JUSTIFIED] = 1; JUSTIFIED[Justification.FULLY_JUSTIFIED] = 1;
    } catch (e) {}

    // Where InDesign wraps each line (story index -> text to insert). Used to
    // put soft returns at the same places so Photoshop breaks lines 1:1.
    function lineBreaks(tf) {
        var brk = {};
        var lines;
        try { lines = tf.lines.everyItem().getElements(); } catch (e) { return brk; }
        var letter = /[A-Za-z0-9\u00C0-\u024F\u0370-\u04FF]/;
        for (var i = 0; i < lines.length - 1; i++) {
            try {
                var L = lines[i], str = String(L.contents);
                if (!str.length || /[\r\n\u0003]$/.test(str)) continue;
                var next = String(lines[i + 1].contents), last = str.charAt(str.length - 1);
                var hyphen = letter.test(last) && letter.test(next.charAt(0));
                // Justified lines get a marker; textNode turns it into a soft
                // return in a "justify all" paragraph (see splitJustified).
                brk[L.index + L.length] = (hyphen ? '-' : '') + (JUSTIFIED[L.justification] ? '\uE000' : '\n');
            } catch (e) {}
        }
        return brk;
    }

    function cloneObj(o) { var r = {}; for (var k in o) r[k] = o[k]; return r; }

    // A justified paragraph with locked line breaks: soft returns only stay
    // justified in "justify all", so the lines before the last one become a
    // justify-all paragraph and the last line its own paragraph with the
    // original alignment (no extra spacing or indent between them).
    var LAST_LINE = { justifyLeft: 'left', justifyCenter: 'center', justifyRight: 'right' };
    function splitJustified(text, pst, paras) {
        var seg = text.substring(pst.from, pst.to);
        var at = seg.lastIndexOf('\uE000');
        if (at < 0) { paras.push(pst); return text; }
        var split = !!LAST_LINE[pst.align];
        var out = '';
        for (var i = 0; i < seg.length; i++) {
            var ch = seg.charAt(i);
            if (ch === '\uE000') ch = (split && i === at) ? '\r' : '\u0003';
            out += ch;
        }
        text = text.substring(0, pst.from) + out + text.substring(pst.to);
        if (!split) { paras.push(pst); return text; }
        var a = cloneObj(pst), b = cloneObj(pst);
        a.to = pst.from + at + 1; a.align = 'justifyAll'; a.spaceAfter = 0;
        b.from = a.to; b.align = LAST_LINE[pst.align]; b.firstLineIndent = 0; b.spaceBefore = 0;
        paras.push(a); paras.push(b);
        return text;
    }

    // Photoshop has no tab stops. Each tab becomes an em space tracked to the
    // exact width InDesign gives it, so columns and bullets line up 1:1.
    function applyTabs(tn, tabs) {
        if (!tabs || !tabs.length || tn.text.indexOf('\t') < 0) return;
        var k = 0, out = [], chars = tn.text.split('');
        for (var r = 0; r < tn.runs.length; r++) {
            var run = tn.runs[r], start = run.from;
            for (var i = run.from; i < run.to; i++) {
                if (chars[i] !== '\t') continue;
                var w = tabs[k++];
                if (w === null || w === undefined || !(run.size > 0)) continue;
                if (i > start) { var pre = cloneObj(run); pre.from = start; pre.to = i; out.push(pre); }
                var t = cloneObj(run); t.from = i; t.to = i + 1;
                t.tracking = Math.max(-1000, Math.min(10000, Math.round((w / run.size - (run.hScale || 100) / 100) * 1000)));
                out.push(t);
                chars[i] = '\u2003';
                start = i + 1;
            }
            if (start < run.to) { var post = cloneObj(run); post.from = start; post.to = run.to; out.push(post); }
        }
        tn.runs = out;
        tn.text = chars.join('');
    }

    function textNode(tf, ctx, hidden) {
        var txt = tf.texts[0];
        var T0 = txt.index, T1 = T0 + txt.length;
        var text = '', runs = [], paras = [];
        var brk = PARAMS.lockLines ? lineBreaks(tf) : {}, locked = false;
        var ps = txt.paragraphs.everyItem().getElements();
        for (var i = 0; i < ps.length; i++) {
            var p = ps[i];
            var pa = p.index, pb = pa + p.length;
            var a = Math.max(pa, T0), b = Math.min(pb, T1);
            if (b <= a) continue;
            var pFrom = text.length, first = true;
            var rr = p.textStyleRanges.everyItem().getElements();
            for (var k = 0; k < rr.length; k++) {
                var r = rr[k], ra = r.index, rb = ra + r.length;
                var x = Math.max(ra, a), y = Math.min(rb, b);
                if (y <= x) continue;
                var s = r.contents;
                if (typeof s !== 'string') {
                    s = specialText(s, ctx);
                    if (brk[y]) { s += brk[y]; locked = true; }
                } else {
                    var piece = '';
                    for (var q = x; q < y; q++) {
                        piece += s.charAt(q - ra);
                        if (brk[q + 1]) { piece += brk[q + 1]; locked = true; }
                    }
                    s = piece;
                }
                if (first && pa >= T0) s = bulletText(p) + s;
                first = false;
                s = cleanText(s, ctx);
                if (!s.length) continue;
                var st = runStyle(r);
                st.from = text.length; text += s; st.to = text.length;
                runs.push(st);
            }
            if (text.length > pFrom) {
                var pst = paraStyle(p);
                pst.from = pFrom; pst.to = text.length;
                text = splitJustified(text, pst, paras);
            }
        }
        if (!text.length) return null;
        var ins = tf.textFramePreferences.insetSpacing;
        if (!(ins instanceof Array)) ins = [ins, ins, ins, ins];
        var vj = 'top';
        try {
            var v = tf.textFramePreferences.verticalJustification;
            if (v == VerticalJustification.CENTER_ALIGN) vj = 'center';
            else if (v == VerticalJustification.BOTTOM_ALIGN) vj = 'bottom';
        } catch (e) {}
        var label = text.replace(/[\r\u0003\t]+/g, ' ').replace(/^\s+/, '').substr(0, 40);
        return { kind: 'text', name: label || 'Text', hidden: !!hidden, text: text, runs: runs, paras: paras,
                 corners: corners(tf, ctx), insets: ins, vjust: vj, opacity: opacityOf(tf),
                 columns: tf.textFramePreferences.textColumnCount, lockedLines: locked };
    }

    // Where InDesign actually draws the text, measured on an upright copy of
    // the frame turned into outlines. Points, relative to the frame's
    // untransformed top-left. Photoshop's text layer is shifted to match, which
    // covers vertical justification, first-baseline options and leading.
    function textInk(tf) {
        try { if (tf.previousTextFrame) return null; } catch (e) {}
        var d = null, outs = null;
        try {
            d = tf.duplicate();
            try { d.fillColor = 'None'; d.strokeWeight = 0; } catch (e) {}
            // Undo rotation/shear/flip around the centre (no translation, so it
            // can't be pushed off the pasteboard).
            var mv = d.transformValuesOf(CoordinateSpaces.PASTEBOARD_COORDINATES)[0].invertMatrix().matrixValues;
            if (Math.abs(mv[0] - 1) > 1e-6 || Math.abs(mv[1]) > 1e-6 || Math.abs(mv[2]) > 1e-6 || Math.abs(mv[3] - 1) > 1e-6) {
                var lin = app.transformationMatrices.add({ matrixValues: [mv[0], mv[1], mv[2], mv[3], 0, 0] });
                d.transform(CoordinateSpaces.PASTEBOARD_COORDINATES, AnchorPoint.CENTER_ANCHOR, lin);
            }
            var gb = d.geometricBounds;
            // Tab widths, in reading order (bullets turned into real text first
            // so their tabs are measured too).
            var tabs = [];
            try {
                try { d.texts[0].convertBulletsAndNumberingToText(); } catch (e) {}
                var cs = d.texts[0].characters.everyItem();
                var cont = cs.contents, hx = cs.horizontalOffset, bl = cs.baseline;
                for (var c = 0; c < cont.length; c++) {
                    var isTab = cont[c] === '\t';
                    try { if (cont[c] == SpecialCharacters.RIGHT_INDENT_TAB) isTab = true; } catch (e) {}
                    if (!isTab) continue;
                    tabs.push((c + 1 < cont.length && Math.abs(bl[c + 1] - bl[c]) < 0.01) ? hx[c + 1] - hx[c] : null);
                }
            } catch (e) { tabs = []; }
            outs = d.createOutlines(true);
            d = null;
            var t = Infinity, l = Infinity, b = -Infinity, r = -Infinity;
            for (var i = 0; i < outs.length; i++) {
                var ob = outs[i].geometricBounds;
                t = Math.min(t, ob[0]); l = Math.min(l, ob[1]); b = Math.max(b, ob[2]); r = Math.max(r, ob[3]);
            }
            if (t === Infinity) return null;
            return { top: t - gb[0], left: l - gb[1], bottom: b - gb[0], right: r - gb[1], tabs: tabs };
        } catch (e) {
            return null;
        } finally {
            try { if (outs) for (var k = 0; k < outs.length; k++) outs[k].remove(); } catch (e) {}
            try { if (d) d.remove(); } catch (e) {}
        }
    }

    // ---------- feathers -> layer masks ----------
    function featherKinds(item) {
        var k = { basic: false, directional: false, gradient: false };
        try { k.basic = !enumIs(item.transparencySettings.featherSettings.mode, FeatherMode, 'NONE'); } catch (e) {}
        try { k.directional = !!item.transparencySettings.directionalFeatherSettings.applied; } catch (e) {}
        try { k.gradient = !!item.transparencySettings.gradientFeatherSettings.applied; } catch (e) {}
        return k;
    }

    // The frame's shape filled black with only its feathers left on: the PNG's
    // alpha is exactly the fade InDesign applies, used as a layer mask.
    function featherMask(item, ctx, textOnly) {
        var k = featherKinds(item);
        if (!(k.gradient || (!textOnly && (k.basic || k.directional)))) return null;
        var d = item.duplicate();
        try {
            if (textOnly) {
                if (d.parentStory.id !== item.parentStory.id) d.parentStory.contents = ''; else d.contents = '';
                if (k.basic) d.transparencySettings.featherSettings.mode = FeatherMode.NONE;
                if (k.directional) d.transparencySettings.directionalFeatherSettings.applied = false;
            } else {
                try { d.graphics.everyItem().remove(); } catch (e) {}
                try { d.pageItems.everyItem().remove(); } catch (e) {}
            }
            d.fillColor = 'Black'; d.fillTint = 100; d.strokeWeight = 0;
            var n = rasterNode(d, ctx, 'mask', false);
            return { png: n.png, bounds: n.bounds };
        } catch (e) {
            warn('Could not build the feather mask for an object on page ' + ctx.page.name + ': ' + errText(e));
            return null;
        } finally {
            try { d.remove(); } catch (e) {}
        }
    }

    function textFrameNodes(tf, ctx, hidden) {
        var out = [];
        var reason = '';
        try { if (tf.texts[0].tables.length > 0) reason = 'contains a table'; } catch (e) {}
        try { if (tf.parentStory.storyPreferences.storyOrientation == StoryHorizontalOrVertical.VERTICAL) reason = 'vertical text'; } catch (e) {}
        if (reason) {
            out.push(rasterNode(tf, ctx, itemName(tf, 'TextFrame') + ' (rasterized: ' + reason + ')', hidden, reason));
            warn('A text frame on page ' + ctx.page.name + ' was rasterized because it ' + (reason === 'vertical text' ? 'uses vertical text' : 'contains a table') + '.');
            return out;
        }
        var ink = textInk(tf);
        var fk = featherKinds(tf);
        var mask = featherMask(tf, ctx, true);
        // Object-level effects apply to the whole frame; "Text"-level ones to the
        // characters only. With a filled frame the fill hides the text's own
        // object-level shadow, so those effects go on the background layer.
        var obj = grabFx(tf, 'transparencySettings', true);
        var txtLvl = grabFx(tf, 'contentTransparencySettings', false);
        try {
            tf.transparencySettings.blendingSettings.opacity = 100;
            tf.transparencySettings.blendingSettings.blendMode = BlendMode.NORMAL;
        } catch (e) {}
        var filled = false;
        try { filled = tf.fillColor && tf.fillColor.name !== 'None'; } catch (e) {}
        if (isStyled(tf)) {
            var d = tf.duplicate();
            try {
                if (d.parentStory.id !== tf.parentStory.id) d.parentStory.contents = '';
                else d.contents = '';
                var bg = rasterNode(d, ctx, 'Text frame background', hidden);
                bg.fx = mergeFx(bg.fx, obj.fx);
                bg.opacity = obj.opacity;
                bg.blend = obj.blend;
                out.push(bg);
            } catch (e) {
                warn('Could not export a text frame background on page ' + ctx.page.name + ': ' + errText(e));
            }
            try { d.remove(); } catch (e) {}
        }
        var tn = textNode(tf, ctx, hidden);
        if (tn) {
            tn.fx = filled ? txtLvl.fx : mergeFx(txtLvl.fx, obj.fx);
            tn.opacity = obj.opacity * txtLvl.opacity / 100;
            tn.blend = firstBlend(txtLvl.blend, obj.blend);
            tn.ink = ink;
            if (ink) { applyTabs(tn, ink.tabs); delete ink.tabs; }
            if (userName(tf)) { tn.name = userName(tf); tn.userNamed = true; }
            if (mask) tn.mask = mask;
            var lost = txtLvl.unmapped.slice(0);
            if (fk.basic) lost.push('basic feather');
            if (fk.directional) lost.push('directional feather');
            if (lost.length) warn('Text "' + tn.name + '" on page ' + ctx.page.name + ' uses a ' + lost.join(' and ') + ', which Photoshop text layers can\'t show. The text stays editable without it.');
            if (tn.columns > 1) warn('Text "' + tn.name + '" uses ' + tn.columns + ' columns; Photoshop puts it in a single text box.');
            out.push(tn);
        }
        return out;
    }

    // ---------- graphics ----------
    // The fill or the stroke of a frame on its own (contents removed), as PNG.
    // The frame's object-level effects are taken off; the caller assigns them.
    function framePartNode(frame, part, ctx, baseName, hidden) {
        var d = frame.duplicate();
        try {
            grabFx(d, 'transparencySettings', true);
            try { d.graphics.everyItem().remove(); } catch (e) {}
            try { d.pageItems.everyItem().remove(); } catch (e) {}
            if (part === 'fill') d.strokeWeight = 0;
            else d.fillColor = 'None';
            return rasterNode(d, ctx, baseName + ' ' + part, hidden);
        } catch (e) {
            warn('Could not export the ' + part + ' of ' + baseName + ': ' + errText(e));
            return null;
        } finally {
            try { d.remove(); } catch (e2) {}
        }
    }
    var PDF_CROP = {};
    try {
        PDF_CROP[PDFCrop.CROP_ART] = 'artBox'; PDF_CROP[PDFCrop.CROP_PDF] = 'cropBox'; PDF_CROP[PDFCrop.CROP_TRIM] = 'trimBox';
        PDF_CROP[PDFCrop.CROP_BLEED] = 'bleedBox'; PDF_CROP[PDFCrop.CROP_MEDIA] = 'mediaBox';
        PDF_CROP[PDFCrop.CROP_CONTENT_VISIBLE_LAYERS] = 'boundingBox'; PDF_CROP[PDFCrop.CROP_CONTENT_ALL_LAYERS] = 'boundingBox';
    } catch (e) {}

    // InDesign's Object Layer Options: which layers of a placed PSD/TIFF/PDF
    // are shown for this one placement. Returns the layer tree (top to bottom,
    // like Photoshop) only when something differs from the file as saved.
    function layerVisibility(g) {
        var changed = false;
        function walk(coll) {
            var out = [], items;
            try { items = coll.everyItem().getElements(); } catch (e) { return out; }
            for (var i = 0; i < items.length; i++) {
                var gl = items[i], node = { name: String(gl.name), visible: !!gl.currentVisibility };
                try { if (gl.currentVisibility != gl.originalVisibility) changed = true; } catch (e) {}
                try { if (gl.graphicLayers.length) node.children = walk(gl.graphicLayers); } catch (e) {}
                out.push(node);
            }
            return out;
        }
        var tree = [];
        try { tree = walk(g.graphicLayerOptions.graphicLayers); } catch (e) { return null; }
        return changed ? tree : null;
    }
    function visibleNames(tree) {
        var out = [];
        for (var i = 0; i < tree.length; i++) if (tree[i].visible) out.push(tree[i].name);
        return out;
    }

    function graphicFrameNodes(frame, g, ctx, type, hidden) {
        var out = [];
        var lk = null;
        try { lk = g.itemLink; if (lk && !lk.isValid) lk = null; } catch (e) { lk = null; }
        var status = lk ? linkStatusName(lk.status) : 'embedded';
        var path = lk ? linkPath(lk) : '';
        var baseName = lk ? lk.name : itemName(frame, type);
        var canLink = (status === 'ok' || status === 'modified') && PS_LINKABLE.test(path) && new File(path).exists;
        // Layers shown/hidden for this placement only (e.g. a product placed
        // twice: one copy showing just its shadow, set to Multiply).
        var layerVis = canLink ? layerVisibility(g) : null;
        if (layerVis && !/\.(psd|psb|tif|tiff)$/i.test(path)) {
            // Photoshop can't switch layers inside a placed PDF/AI/EPS, so use
            // InDesign's own render of it, which shows the right layers.
            canLink = false;
            status = 'layers';
        }

        // InDesign paints a frame's fill under its image and its stroke over it.
        var hasFill = false, hasStroke = false;
        try { hasFill = frame.fillColor && frame.fillColor.name !== 'None'; } catch (e) {}
        try { hasStroke = frame.strokeWeight > 0 && frame.strokeColor && frame.strokeColor.name !== 'None'; } catch (e) {}
        function framePart(part) { return framePartNode(frame, part, ctx, baseName, hidden); }
        // Effects: the frame's object level covers fill + image + stroke. Outer
        // effects (shadow, outer glow) go on the bottom-most layer, inner ones
        // on the image. The image's own and the frame's "Graphic" level go on
        // the image.
        var objFx = grabFx(frame, 'transparencySettings', false);
        var gFx = grabFx(g, 'transparencySettings', false);
        var cFx = grabFx(frame, 'contentTransparencySettings', false);
        var strokeNode = null, fillNode = null;
        if (canLink && hasFill) { fillNode = framePart('fill'); if (fillNode) out.push(fillNode); }
        if (canLink && hasStroke) strokeNode = framePart('stroke');
        if (fillNode) {
            fillNode.fx = mergeFx(fillNode.fx, objFx.fx, OUTER_FX);
            fillNode.opacity = objFx.opacity; fillNode.blend = objFx.blend;
        }
        if (strokeNode) { strokeNode.opacity = objFx.opacity; strokeNode.blend = objFx.blend; }

        if (canLink) {
            var imgFx = mergeFx(gFx.fx, cFx.fx);
            imgFx = fillNode ? mergeFx(imgFx, pickFx(objFx.fx, OUTER_FX, true)) : mergeFx(imgFx, objFx.fx);
            var imgMask = featherMask(frame, ctx, false);
            var lost = gFx.unmapped.concat(cFx.unmapped);
            if (lost.length) warn('"' + baseName + '" on page ' + ctx.page.name + ' uses a ' + lost.join(' and ') + ', which can\'t be applied to a placed smart object. Add a layer mask in Photoshop if you need it.');
            var node = { kind: 'image', name: baseName, path: path, hidden: !!hidden,
                         corners: corners(g, ctx), clip: clipPaths(frame, ctx),
                         opacity: objFx.opacity * gFx.opacity * cFx.opacity / 10000,
                         blend: firstBlend(gFx.blend, cFx.blend, objFx.blend), fx: imgFx };
            if (imgMask) node.mask = imgMask;
            if (userName(frame)) { node.name = userName(frame); node.userNamed = true; }
            if (layerVis) {
                node.layerVis = layerVis;
                var shown = visibleNames(layerVis);
                if (!node.userNamed && shown.length && shown.length <= 3) node.name = baseName + ' \u00b7 ' + shown.join(', ');
            }
            try {
                if (/\.(pdf|ai)$/i.test(path)) {
                    node.pdfPage = g.pdfAttributes.pageNumber;
                    node.pdfCrop = PDF_CROP[g.pdfAttributes.pdfCrop] || 'boundingBox';
                }
            } catch (e) {}
            node.fallback = rasterNode(frame, ctx, baseName + ' (rasterized)', hidden);
            out.push(node);
            if (strokeNode) out.push(strokeNode);
            return out;
        }

        // Note: ExtendScript mis-parses chained ternaries, so use if/else.
        var why = 'unsupported format';
        if (status === 'missing') why = 'missing link';
        else if (status === 'inaccessible') why = 'inaccessible link';
        else if (status === 'embedded') why = 'embedded';
        else if (status === 'layers') why = 'layer visibility set in InDesign';
        out.push(rasterNode(frame, ctx, baseName + ' (' + why + ', rasterized)', hidden, why));
        if (status === 'missing' || status === 'inaccessible') {
            warn('"' + baseName + '" on page ' + ctx.page.name + ' has a ' + why + ', so it was rasterized into a smart object.');
        } else if (status === 'layers') {
            warn('"' + baseName + '" on page ' + ctx.page.name + ' shows only some of its layers (Object Layer Options). Photoshop can\'t switch layers inside a placed ' + path.replace(/^.*\./, '').toUpperCase() + ', so it was rasterized from InDesign with the same layers shown.');
        } else if (why === 'unsupported format') {
            warn('"' + baseName + '" on page ' + ctx.page.name + ' is a format Photoshop cannot link, so it was rasterized into a smart object.');
        }
        return out;
    }

    // ---------- stacking order ----------
    // pageItems is ordered by object type (groups, rectangles, text frames…),
    // NOT by stacking order. allPageItems is in true front-to-back order but
    // also includes nested and anchored objects, so keep only direct children.
    function zOrderedChildren(container) {
        var isPage = container.constructor.name === 'Page';
        var all = container.allPageItems, out = [], seen = {};
        for (var i = 0; i < all.length; i++) {
            var it = all[i], par;
            try { par = it.parent; } catch (e) { continue; }
            var direct = isPage
                ? (par.constructor.name === 'Spread')
                : (par.constructor.name === container.constructor.name && par.id === container.id);
            if (direct && !seen[it.id]) { seen[it.id] = 1; out.push(it); }
        }
        // Safety net: anything pageItems has that allPageItems missed goes at the back.
        try {
            var pi = container.pageItems.everyItem().getElements();
            for (var k = 0; k < pi.length; k++) if (!seen[pi[k].id]) { seen[pi[k].id] = 1; out.push(pi[k]); }
        } catch (e) {}
        return out;
    }

    // ---------- items ----------
    function processItem(item, ctx) {
        var type = item.constructor.name;
        var hidden = false;
        try { if (item.locked) item.locked = false; } catch (e) {}
        try { if (!item.visible) { hidden = true; item.visible = true; } } catch (e) {}
        var name = itemName(item, type);

        if (type === 'Group') {
            var kids = zOrderedChildren(item), ch = [];
            for (var k = kids.length - 1; k >= 0; k--) pushAll(ch, safeProcess(kids[k], ctx));
            if (!ch.length) return [];
            var gfx = grabFx(item, 'transparencySettings', false);
            if (gfx.unmapped.length) warn('Group "' + folderName(item, ch, 'Group') + '" on page ' + ctx.page.name + ' uses a ' + gfx.unmapped.join(' and ') + ', which Photoshop layer styles can\'t reproduce.');
            // A group of one object needs no folder: the object takes its place.
            if (ch.length === 1 && !hasFx(gfx.fx) && gfx.blend === 'normal') {
                var only = ch[0];
                only.opacity = (only.opacity === undefined ? 100 : only.opacity) * gfx.opacity / 100;
                if (hidden) only.hidden = true;
                if (userName(item)) { only.name = userName(item); only.userNamed = true; }
                return [only];
            }
            return [{ kind: 'group', name: folderName(item, ch, 'Group'), userNamed: !!userName(item), hidden: hidden,
                      opacity: gfx.opacity, blend: gfx.blend, fx: gfx.fx, children: ch }];
        }
        if (type === 'TextFrame') return textFrameNodes(item, ctx, hidden);

        var graphics = [];
        try { graphics = item.graphics.everyItem().getElements(); } catch (e) {}
        if (graphics.length) return graphicFrameNodes(item, graphics[0], ctx, type, hidden);

        var inner = 0;
        try { inner = item.pageItems.length; } catch (e) {}
        if (inner && (type === 'Rectangle' || type === 'Oval' || type === 'Polygon')) return pastedIntoNodes(item, ctx, hidden);
        // Empty, unstyled placeholder frames draw nothing: skip them.
        if (!inner && !isStyled(item) && (type === 'Rectangle' || type === 'Oval' || type === 'Polygon')) return [];
        // Shapes, lines, buttons etc. become rasterized smart objects.
        var rn = rasterNode(item, ctx, name, hidden);
        if (userName(item)) rn.userNamed = true;
        return [rn];
    }

    // Objects pasted inside a frame: a folder masked by the frame's shape,
    // holding the frame's fill and the live contents; the stroke goes on top.
    function pastedIntoNodes(frame, ctx, hidden) {
        var type = frame.constructor.name;
        var objFx = grabFx(frame, 'transparencySettings', false);
        var hasFill = false, hasStroke = false;
        try { hasFill = frame.fillColor && frame.fillColor.name !== 'None'; } catch (e) {}
        try { hasStroke = frame.strokeWeight > 0 && frame.strokeColor && frame.strokeColor.name !== 'None'; } catch (e) {}
        var base = TYPE_LABEL[type] || type;
        var ch = [];
        if (hasFill) { var fn = framePartNode(frame, 'fill', ctx, base, false); if (fn) ch.push(fn); }
        var kids = zOrderedChildren(frame);
        for (var k = kids.length - 1; k >= 0; k--) pushAll(ch, safeProcess(kids[k], ctx));
        var strokeNode = hasStroke ? framePartNode(frame, 'stroke', ctx, base, hidden) : null;
        if (objFx.unmapped.length) warn('A frame on page ' + ctx.page.name + ' uses a ' + objFx.unmapped.join(' and ') + ', which Photoshop layer styles can\'t reproduce.');
        var out = [{ kind: 'group', name: folderName(frame, ch, 'Frame'), userNamed: !!userName(frame), hidden: hidden,
                     clip: clipPaths(frame, ctx), opacity: objFx.opacity, blend: objFx.blend, fx: objFx.fx, children: ch }];
        if (strokeNode) {
            strokeNode.opacity = objFx.opacity; strokeNode.blend = objFx.blend;
            out.push(strokeNode);
        }
        return out;
    }

    function safeProcess(item, ctx) {
        try { return processItem(item, ctx); }
        catch (e) {
            warn('Skipped an object on page ' + ctx.page.name + ': ' + errText(e));
            return [];
        }
    }

    function setPngPrefs() {
        var p = app.pngExportPreferences;
        var props = {
            exportResolution: PARAMS.dpi, transparentBackground: true, antiAlias: true,
            useDocumentBleeds: false, simulateOverprint: false, exportingSpread: false
        };
        for (var k in props) { try { p[k] = props[k]; } catch (e) {} }
        try { p.pngQuality = PNGQualityEnum.MAXIMUM; } catch (e) {}
        try { p.pngColorSpace = PNGColorSpaceEnum.RGB; } catch (e) {}
        try { p.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE; } catch (e) {}
    }

    try {
        doc = idOpen(PARAMS.docPath);
        progress('indesign', 0, 1, 'Preparing document');

        var layers = doc.layers.everyItem().getElements();
        var layerVisible = {};
        for (var i = 0; i < layers.length; i++) {
            layerVisible[layers[i].id] = layers[i].visible;
            try { layers[i].locked = false; layers[i].visible = true; } catch (e) {}
        }

        for (var r = 0; r < PARAMS.relinks.length; r++) {
            var rl = PARAMS.relinks[r];
            try {
                var lk = doc.links.itemByID(rl.id);
                lk.relink(new File(rl.path));
                try { lk.update(); } catch (e) {}
            } catch (e) { warn('Could not relink "' + rl.name + '" to ' + rl.path + ': ' + errText(e)); }
        }
        var allLinks = doc.links.everyItem().getElements();
        for (var u = 0; u < allLinks.length; u++) {
            try { if (allLinks[u].status == LinkStatus.LINK_OUT_OF_DATE) allLinks[u].update(); } catch (e) {}
        }

        setPngPrefs();
        var total = PARAMS.pageIndexes.length;
        for (var pi = 0; pi < total; pi++) {
            var page = doc.pages[PARAMS.pageIndexes[pi]];
            progress('indesign', pi, total, 'Reading page ' + page.name + ' in InDesign');

            var pb = page.bounds;
            // Bring master (parent) page items onto the page. override() can drop
            // the copy in the wrong spot, so put it back at the same position
            // relative to the page as it had on its master page.
            try {
                var mpi = page.masterPageItems;
                for (var m = mpi.length - 1; m >= 0; m--) {
                    try {
                        var src = mpi[m], mb = src.geometricBounds, mp = src.parentPage.bounds;
                        var ov = src.override(page), ob = ov.geometricBounds;
                        var dx = (mb[1] - mp[1]) - (ob[1] - pb[1]), dy = (mb[0] - mp[0]) - (ob[0] - pb[0]);
                        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) ov.move(undefined, [dx, dy]);
                    } catch (e) {}
                }
            } catch (e) {}

            var pTL = resolveSpread(page, AnchorPoint.TOP_LEFT_ANCHOR);
            var ctx = { page: page, ox: pb[1], oy: pb[0], sx: pTL[0], sy: pTL[1] };

            var items = zOrderedChildren(page); // front -> back
            var byLayer = {};
            for (var k = items.length - 1; k >= 0; k--) {
                var lid = items[k].itemLayer.id;
                (byLayer[lid] = byLayer[lid] || []).push(items[k]);
            }
            var outLayers = [];
            for (var li = layers.length - 1; li >= 0; li--) {
                var L = layers[li], arr = byLayer[L.id];
                if (!arr) continue;
                var nodes = [];
                for (var n = 0; n < arr.length; n++) pushAll(nodes, safeProcess(arr[n], ctx));
                if (nodes.length) outLayers.push({ name: L.name, visible: layerVisible[L.id], nodes: nodes });
            }
            res.pages.push({ index: PARAMS.pageIndexes[pi], name: page.name, width: pb[3] - pb[1], height: pb[2] - pb[0], layers: outLayers });
        }
        for (var key in fontMap) res.fonts.push(fontMap[key]);
        progress('indesign', total, total, 'InDesign done');
        res.ok = true;
    } catch (e) {
        res.error = errText(e);
    } finally {
        idClose(doc);
    }
    finish(res);
})();

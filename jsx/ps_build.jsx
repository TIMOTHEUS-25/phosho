// Photoshop: rebuild the InDesign manifest as a layered PSD with one
// artboard per page.
//
// The document is built at 72 ppi using pixel sizes for the target ppi
// (1 pt == 1 px at 72 ppi, which avoids Photoshop's resolution quirks with
// text). At the end it is switched to the target ppi without resampling,
// so pixel sizes stay the same and text reports the correct point sizes.
(function () {
    var res = { ok: false, warnings: [], missingFonts: [], layers: 0, debug: [] };
    var M = eval('(' + readText(PARAMS.manifestPath) + ')');
    var S = PARAMS.dpi / 72;
    var doc = null;
    var done = 0, totalNodes = 0;
    var toHide = [];

    function c(s) { return charIDToTypeID(s); }
    function s(s) { return stringIDToTypeID(s); }
    function warn(m) { res.warnings.push(m); }

    function countNodes(nodes) {
        var n = 0;
        for (var i = 0; i < nodes.length; i++) n += 1 + (nodes[i].children ? countNodes(nodes[i].children) : 0);
        return n;
    }

    function tick(msg) {
        done++;
        if (done % 3 === 0 || done === totalNodes) progress('photoshop', done, totalNodes, msg);
    }

    // ---------- Action Manager helpers ----------
    function targetLayerRef() {
        var r = new ActionReference();
        r.putEnumerated(c('Lyr '), c('Ordn'), c('Trgt'));
        return r;
    }

    function makeArtboard(name, l, t, r, b) {
        var d = new ActionDescriptor();
        var ref = new ActionReference();
        ref.putClass(s('artboardSection'));
        d.putReference(c('null'), ref);
        var u = new ActionDescriptor();
        u.putString(c('Nm  '), name);
        d.putObject(c('Usng'), s('artboardSection'), u);
        var rect = new ActionDescriptor();
        rect.putDouble(c('Top '), t);
        rect.putDouble(c('Left'), l);
        rect.putDouble(c('Btom'), b);
        rect.putDouble(c('Rght'), r);
        d.putObject(s('artboardRect'), s('classFloatRect'), rect);
        executeAction(c('Mk  '), d, DialogModes.NO);
        var ab = doc.activeLayer;
        ab.name = name;
        return ab;
    }

    function placeFile(path, pdfPage, pdfCrop) {
        var d = new ActionDescriptor();
        d.putPath(c('null'), new File(path));
        if (pdfPage) {
            var as = new ActionDescriptor();
            as.putEnumerated(c('fsel'), s('pdfSelection'), s('page'));
            as.putInteger(c('PgNm'), pdfPage);
            as.putEnumerated(c('Crop'), s('cropTo'), s(pdfCrop || 'boundingBox'));
            d.putObject(c('As  '), c('PDFG'), as);
        }
        d.putEnumerated(c('FTcs'), c('QCSt'), c('Qcsa'));
        var o = new ActionDescriptor();
        o.putUnitDouble(c('Hrzn'), c('#Pxl'), 0);
        o.putUnitDouble(c('Vrtc'), c('#Pxl'), 0);
        d.putObject(c('Ofst'), c('Ofst'), o);
        executeAction(c('Plc '), d, DialogModes.NO);
        return doc.activeLayer;
    }

    // Current quad of the active smart object: centre, width, height.
    function soQuad(layer) {
        try {
            var d = executeActionGet(targetLayerRef());
            var t = d.getObjectValue(s('smartObjectMore')).getList(s('transform'));
            var p = [];
            for (var i = 0; i < 8; i++) p.push(t.getDouble(i));
            return {
                cx: (p[0] + p[4]) / 2, cy: (p[1] + p[5]) / 2,
                w: Math.sqrt(Math.pow(p[2] - p[0], 2) + Math.pow(p[3] - p[1], 2)),
                h: Math.sqrt(Math.pow(p[6] - p[0], 2) + Math.pow(p[7] - p[1], 2))
            };
        } catch (e) {
            var b = layer.bounds;
            var l = b[0].as('px'), t2 = b[1].as('px'), r = b[2].as('px'), bt = b[3].as('px');
            return { cx: (l + r) / 2, cy: (t2 + bt) / 2, w: r - l, h: bt - t2 };
        }
    }

    // Scale + rotate around the layer centre, then move the centre to (cx, cy).
    function transformActive(dx, dy, sx, sy, angle) {
        var d = new ActionDescriptor();
        d.putReference(c('null'), targetLayerRef());
        d.putEnumerated(c('FTcs'), c('QCSt'), c('Qcsa'));
        var o = new ActionDescriptor();
        o.putUnitDouble(c('Hrzn'), c('#Pxl'), dx);
        o.putUnitDouble(c('Vrtc'), c('#Pxl'), dy);
        d.putObject(c('Ofst'), c('Ofst'), o);
        d.putUnitDouble(c('Wdth'), c('#Prc'), sx);
        d.putUnitDouble(c('Hght'), c('#Prc'), sy);
        if (Math.abs(angle) > 0.001) d.putUnitDouble(c('Angl'), c('#Ang'), angle);
        d.putEnumerated(c('Intr'), c('Intp'), s('bicubicAutomatic'));
        executeAction(c('Trnf'), d, DialogModes.NO);
    }

    // Photoshop snaps a scale+move to the pixel grid, which can leave a
    // placed layer up to ~2 px off. Read where it landed and move the rest.
    function nudgeTo(layer, cx, cy) {
        var q = soQuad(layer), dx = cx - q.cx, dy = cy - q.cy;
        if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) return;
        var d = new ActionDescriptor();
        d.putReference(c('null'), targetLayerRef());
        d.putEnumerated(c('FTcs'), c('QCSt'), c('Qcsa'));
        var o = new ActionDescriptor();
        o.putUnitDouble(c('Hrzn'), c('#Pxl'), dx);
        o.putUnitDouble(c('Vrtc'), c('#Pxl'), dy);
        d.putObject(c('Ofst'), c('Ofst'), o);
        executeAction(c('Trnf'), d, DialogModes.NO);
    }

    // One transform step on the active layer around a fixed point.
    function trnfAround(px, py, set) {
        var d = new ActionDescriptor();
        d.putReference(c('null'), targetLayerRef());
        d.putEnumerated(c('FTcs'), c('QCSt'), c('Qcsi'));
        var p = new ActionDescriptor();
        p.putUnitDouble(c('Hrzn'), c('#Pxl'), px);
        p.putUnitDouble(c('Vrtc'), c('#Pxl'), py);
        d.putObject(c('Pstn'), c('Pnt '), p);
        set(d);
        executeAction(c('Trnf'), d, DialogModes.NO);
    }

    // Frame corners (tl, tr, bl in points) -> centre, width, height measured
    // perpendicular to the top edge, rotation, horizontal skew and vertical
    // flip, so that frame = rotate(angle) * skew * flip * upright box.
    function frameGeometry(k, ox, oy) {
        var tl = [ox + k.tl[0] * S, oy + k.tl[1] * S], tr = [ox + k.tr[0] * S, oy + k.tr[1] * S], bl = [ox + k.bl[0] * S, oy + k.bl[1] * S];
        var ux = tr[0] - tl[0], uy = tr[1] - tl[1], vx = bl[0] - tl[0], vy = bl[1] - tl[1];
        var w = Math.sqrt(ux * ux + uy * uy) || 1;
        var a = Math.atan2(uy, ux), ca = Math.cos(a), sa = Math.sin(a);
        var vxr = vx * ca + vy * sa, vyr = -vx * sa + vy * ca; // left edge in the rotated frame
        var h = Math.abs(vyr) || 1;
        return {
            cx: (tr[0] + bl[0]) / 2, cy: (tr[1] + bl[1]) / 2, w: w, h: h,
            angle: a * 180 / Math.PI, flip: vyr < 0,
            skew: Math.atan(vxr / (vyr || 1)) * 180 / Math.PI
        };
    }

    // Apply flip, then skew, then rotation around the frame centre.
    function shapeActive(g, skipFlip) {
        if (g.flip && !skipFlip) trnfAround(g.cx, g.cy, function (d) {
            d.putUnitDouble(c('Wdth'), c('#Prc'), 100);
            d.putUnitDouble(c('Hght'), c('#Prc'), -100);
        });
        if (Math.abs(g.skew) > 0.01) trnfAround(g.cx, g.cy, function (d) {
            var k = new ActionDescriptor();
            k.putUnitDouble(c('Hrzn'), c('#Ang'), g.skew);
            k.putUnitDouble(c('Vrtc'), c('#Ang'), 0);
            d.putObject(c('Skew'), c('Pnt '), k);
        });
        if (Math.abs(g.angle) > 0.01) trnfAround(g.cx, g.cy, function (d) {
            d.putUnitDouble(c('Angl'), c('#Ang'), g.angle);
        });
    }

    // ---------- blend modes and layer styles ----------
    function rgbDesc(rgb) {
        var col = new ActionDescriptor();
        col.putDouble(c('Rd  '), rgb[0]);
        col.putDouble(c('Grn '), rgb[1]);
        col.putDouble(c('Bl  '), rgb[2]);
        return col;
    }

    function setBlend(layer, blend) {
        if (!blend || blend === 'normal') return;
        var d = new ActionDescriptor();
        var r = new ActionReference();
        r.putIdentifier(c('Lyr '), layer.id);
        d.putReference(c('null'), r);
        var l = new ActionDescriptor();
        l.putEnumerated(c('Md  '), c('BlnM'), s(blend));
        d.putObject(c('T   '), c('Lyr '), l);
        executeAction(c('setd'), d, DialogModes.NO);
    }

    function px(v) { return Math.max(0, (v || 0) * S); }
    function pct(v) { return Math.max(0, Math.min(100, v || 0)); }

    function applyFx(layer, fx) {
        if (!fx) return;
        var any = false;
        for (var key in fx) { any = true; break; }
        if (!any) return;
        var all = new ActionDescriptor();
        all.putUnitDouble(c('Scl '), c('#Prc'), 100);
        var e, d;
        if ((e = fx.dropShadow)) {
            d = new ActionDescriptor();
            d.putBoolean(c('enab'), true);
            d.putEnumerated(c('Md  '), c('BlnM'), s(e.blend));
            d.putObject(c('Clr '), c('RGBC'), rgbDesc(e.color));
            d.putUnitDouble(c('Opct'), c('#Prc'), pct(e.opacity));
            d.putBoolean(c('uglg'), false);
            d.putUnitDouble(c('lagl'), c('#Ang'), e.angle);
            d.putUnitDouble(c('Dstn'), c('#Pxl'), px(e.distance));
            d.putUnitDouble(c('Ckmt'), c('#Prc'), pct(e.spread));
            d.putUnitDouble(c('blur'), c('#Pxl'), px(e.size));
            d.putUnitDouble(c('Nose'), c('#Prc'), pct(e.noise));
            d.putBoolean(c('AntA'), false);
            d.putBoolean(s('layerConceals'), e.knockout !== false);
            all.putObject(c('DrSh'), c('DrSh'), d);
        }
        if ((e = fx.innerShadow)) {
            d = new ActionDescriptor();
            d.putBoolean(c('enab'), true);
            d.putEnumerated(c('Md  '), c('BlnM'), s(e.blend));
            d.putObject(c('Clr '), c('RGBC'), rgbDesc(e.color));
            d.putUnitDouble(c('Opct'), c('#Prc'), pct(e.opacity));
            d.putBoolean(c('uglg'), false);
            d.putUnitDouble(c('lagl'), c('#Ang'), e.angle);
            d.putUnitDouble(c('Dstn'), c('#Pxl'), px(e.distance));
            d.putUnitDouble(c('Ckmt'), c('#Prc'), pct(e.choke));
            d.putUnitDouble(c('blur'), c('#Pxl'), px(e.size));
            d.putUnitDouble(c('Nose'), c('#Prc'), pct(e.noise));
            d.putBoolean(c('AntA'), false);
            all.putObject(c('IrSh'), c('IrSh'), d);
        }
        if ((e = fx.outerGlow)) {
            d = new ActionDescriptor();
            d.putBoolean(c('enab'), true);
            d.putEnumerated(c('Md  '), c('BlnM'), s(e.blend));
            d.putObject(c('Clr '), c('RGBC'), rgbDesc(e.color));
            d.putUnitDouble(c('Opct'), c('#Prc'), pct(e.opacity));
            d.putEnumerated(c('GlwT'), c('BETE'), c(e.precise ? 'PrBL' : 'SfBL'));
            d.putUnitDouble(c('Ckmt'), c('#Prc'), pct(e.spread));
            d.putUnitDouble(c('blur'), c('#Pxl'), px(e.size));
            d.putUnitDouble(c('Nose'), c('#Prc'), pct(e.noise));
            d.putUnitDouble(c('ShdN'), c('#Prc'), 0);
            d.putBoolean(c('AntA'), true);
            d.putUnitDouble(c('Inpr'), c('#Prc'), 50);
            all.putObject(c('OrGl'), c('OrGl'), d);
        }
        if ((e = fx.innerGlow)) {
            d = new ActionDescriptor();
            d.putBoolean(c('enab'), true);
            d.putEnumerated(c('Md  '), c('BlnM'), s(e.blend));
            d.putObject(c('Clr '), c('RGBC'), rgbDesc(e.color));
            d.putUnitDouble(c('Opct'), c('#Prc'), pct(e.opacity));
            d.putEnumerated(c('GlwT'), c('BETE'), c(e.precise ? 'PrBL' : 'SfBL'));
            d.putUnitDouble(c('Ckmt'), c('#Prc'), pct(e.choke));
            d.putUnitDouble(c('blur'), c('#Pxl'), px(e.size));
            d.putUnitDouble(c('Nose'), c('#Prc'), pct(e.noise));
            d.putUnitDouble(c('ShdN'), c('#Prc'), 0);
            d.putBoolean(c('AntA'), true);
            d.putEnumerated(c('glwS'), c('IGSr'), c(e.center ? 'SrcC' : 'SrcE'));
            d.putUnitDouble(c('Inpr'), c('#Prc'), 50);
            all.putObject(c('IrGl'), c('IrGl'), d);
        }
        if ((e = fx.bevel)) {
            var BS = { innerBevel: 'InrB', outerBevel: 'OtrB', emboss: 'Embs', pillowEmboss: 'PlEb' };
            d = new ActionDescriptor();
            d.putBoolean(c('enab'), true);
            d.putEnumerated(c('hglM'), c('BlnM'), s(e.hiBlend));
            d.putObject(c('hglC'), c('RGBC'), rgbDesc(e.hiColor));
            d.putUnitDouble(c('hglO'), c('#Prc'), pct(e.hiOpacity));
            d.putEnumerated(c('sdwM'), c('BlnM'), s(e.shBlend));
            d.putObject(c('sdwC'), c('RGBC'), rgbDesc(e.shColor));
            d.putUnitDouble(c('sdwO'), c('#Prc'), pct(e.shOpacity));
            d.putEnumerated(c('bvlT'), c('bvlT'), s(e.technique));
            d.putEnumerated(c('bvlS'), c('BESl'), c(BS[e.style] || 'InrB'));
            d.putBoolean(c('uglg'), false);
            d.putUnitDouble(c('lagl'), c('#Ang'), e.angle);
            d.putUnitDouble(c('Lald'), c('#Ang'), e.altitude);
            d.putUnitDouble(c('srgR'), c('#Prc'), Math.max(1, Math.min(1000, e.depth || 100)));
            d.putUnitDouble(c('blur'), c('#Pxl'), px(e.size));
            d.putEnumerated(c('bvlD'), c('BESs'), c(e.up ? 'In  ' : 'Out '));
            d.putUnitDouble(c('Sftn'), c('#Pxl'), px(e.soften));
            all.putObject(c('ebbl'), c('ebbl'), d);
        }
        if ((e = fx.satin)) {
            d = new ActionDescriptor();
            d.putBoolean(c('enab'), true);
            d.putEnumerated(c('Md  '), c('BlnM'), s(e.blend));
            d.putObject(c('Clr '), c('RGBC'), rgbDesc(e.color));
            d.putBoolean(c('AntA'), true);
            d.putBoolean(c('Invr'), !!e.invert);
            d.putUnitDouble(c('Opct'), c('#Prc'), pct(e.opacity));
            d.putUnitDouble(c('lagl'), c('#Ang'), e.angle);
            d.putUnitDouble(c('Dstn'), c('#Pxl'), px(e.distance));
            d.putUnitDouble(c('blur'), c('#Pxl'), px(e.size));
            all.putObject(c('ChFX'), c('ChFX'), d);
        }
        doc.activeLayer = layer;
        var sd = new ActionDescriptor();
        var r = new ActionReference();
        r.putProperty(c('Prpr'), c('Lefx'));
        r.putEnumerated(c('Lyr '), c('Ordn'), c('Trgt'));
        sd.putReference(c('null'), r);
        sd.putObject(c('T   '), c('Lefx'), all);
        executeAction(c('setd'), sd, DialogModes.NO);
    }

    // Layer mask from a PNG's transparency (InDesign feathers).
    function addMaskFromPng(layer, m, ox, oy) {
        doc.activeLayer = layer;
        var tmp = placeRaster(m, ox, oy);
        try {
            var d = new ActionDescriptor();
            var sel = new ActionReference(); sel.putProperty(c('Chnl'), c('fsel'));
            d.putReference(c('null'), sel);
            var tr = new ActionReference(); tr.putEnumerated(c('Chnl'), c('Chnl'), c('Trsp'));
            d.putReference(c('T   '), tr);
            executeAction(c('setd'), d, DialogModes.NO);
        } finally {
            tmp.remove();
        }
        doc.activeLayer = layer;
        var mk = new ActionDescriptor();
        mk.putClass(c('Nw  '), c('Chnl'));
        var at = new ActionReference(); at.putEnumerated(c('Chnl'), c('Chnl'), c('Msk '));
        mk.putReference(c('At  '), at);
        mk.putEnumerated(c('Usng'), c('UsrM'), c('RvlS'));
        executeAction(c('Mk  '), mk, DialogModes.NO);
        try { doc.selection.deselect(); } catch (e) {}
    }

    // Opacity, blend mode and layer styles for a finished layer.
    function finishLayer(layer, n) {
        if (n.opacity !== undefined && n.opacity < 100) layer.opacity = n.opacity;
        try { setBlend(layer, n.blend); }
        catch (e) { warn('Could not set blend mode "' + n.blend + '" on "' + n.name + '": ' + errText(e)); }
        try { applyFx(layer, n.fx); }
        catch (e) { warn('Could not apply the effects of "' + n.name + '" as layer styles: ' + errText(e)); }
        if (n.mask) {
            try { addMaskFromPng(layer, n.mask, n._ox, n._oy); }
            catch (e) { warn('Could not add the feather of "' + n.name + '" as a layer mask: ' + errText(e)); }
        }
    }

    function addVectorMask(clip, ox, oy) {
        if (!clip || !clip.length) return;
        var spis = [];
        for (var i = 0; i < clip.length; i++) {
            var pts = [];
            for (var k = 0; k < clip[i].pts.length; k++) {
                var q = clip[i].pts[k];
                var pp = new PathPointInfo();
                pp.kind = PointKind.CORNERPOINT;
                pp.anchor = [ox + q[0][0] * S, oy + q[0][1] * S];
                // InDesign's "left" handle is Photoshop's "right" handle.
                pp.leftDirection = [ox + q[2][0] * S, oy + q[2][1] * S];
                pp.rightDirection = [ox + q[1][0] * S, oy + q[1][1] * S];
                pts.push(pp);
            }
            if (pts.length < 2) continue;
            var sp = new SubPathInfo();
            sp.closed = clip[i].closed;
            sp.operation = i === 0 ? ShapeOperation.SHAPEADD : ShapeOperation.SHAPEXOR;
            sp.entireSubPath = pts;
            spis.push(sp);
        }
        if (!spis.length) return;
        var pi = doc.pathItems.add('idps_clip_tmp', spis);
        try {
            pi.select();
            var d = new ActionDescriptor();
            var r1 = new ActionReference(); r1.putClass(c('Path'));
            d.putReference(c('null'), r1);
            var r2 = new ActionReference(); r2.putEnumerated(c('Path'), c('Path'), s('vectorMask'));
            d.putReference(c('At  '), r2);
            var r3 = new ActionReference(); r3.putEnumerated(c('Path'), c('Ordn'), c('Trgt'));
            d.putReference(c('Usng'), r3);
            executeAction(c('Mk  '), d, DialogModes.NO);
        } finally {
            try { pi.remove(); } catch (e) {}
        }
    }

    // ---------- text ----------
    var ALIGN_OK = { left: 1, center: 1, right: 1, justifyLeft: 1, justifyCenter: 1, justifyRight: 1, justifyAll: 1 };

    function makeText(n, ox, oy) {
        var gm = frameGeometry(n.corners, ox, oy);
        var w = gm.w, h = gm.h, cx = gm.cx, cy = gm.cy;
        var ins = n.insets;
        var bx = cx - w / 2 + ins[1] * S, by = cy - h / 2 + ins[0] * S;
        var bw = Math.max(4, w - (ins[1] + ins[3]) * S);
        // Line breaks are fixed with soft returns: give the box a little room
        // so Photoshop's slightly different spacing never adds an extra wrap.
        if (n.lockedLines) {
            var al = n.paras.length ? n.paras[0].align : 'left', same = true;
            for (var pi2 = 1; pi2 < n.paras.length; pi2++) if (n.paras[pi2].align !== al) same = false;
            var grow = Math.max(2 * S, bw * 0.04);
            if (same && al === 'left') bw += grow;
            else if (same && al === 'right') { bx -= grow; bw += grow; }
            else if (same && al === 'center') { bx -= grow / 2; bw += grow; }
        }
        var bh = Math.max(4, h - (ins[0] + ins[2]) * S);
        // Small allowance so differences in line breaking don't hide the last line.
        var maxSize = 0;
        for (var i = 0; i < n.runs.length; i++) maxSize = Math.max(maxSize, n.runs[i].size);
        var extra = maxSize * S * 0.6;
        if (n.vjust === 'bottom') by -= extra;
        else if (n.vjust === 'center') by -= extra / 2;
        bh += extra;

        var d = new ActionDescriptor();
        var ref = new ActionReference(); ref.putClass(c('TxLr'));
        d.putReference(c('null'), ref);
        var tl2 = new ActionDescriptor();
        tl2.putString(c('Txt '), n.text);
        var click = new ActionDescriptor();
        click.putUnitDouble(c('Hrzn'), c('#Prc'), bx / doc.width.as('px') * 100);
        click.putUnitDouble(c('Vrtc'), c('#Prc'), by / doc.height.as('px') * 100);
        tl2.putObject(c('TxtC'), c('Pnt '), click);
        tl2.putEnumerated(c('AntA'), c('Annt'), c('AnCr'));

        var shapes = new ActionList();
        var shp = new ActionDescriptor();
        shp.putEnumerated(c('TEXT'), c('TEXT'), s('box'));
        shp.putEnumerated(c('Ornt'), c('Ornt'), c('Hrzn'));
        var tf = new ActionDescriptor();
        tf.putDouble(s('xx'), 1); tf.putDouble(s('xy'), 0); tf.putDouble(s('yx'), 0);
        tf.putDouble(s('yy'), 1); tf.putDouble(s('tx'), 0); tf.putDouble(s('ty'), 0);
        shp.putObject(c('Trnf'), c('Trnf'), tf);
        var bnd = new ActionDescriptor();
        bnd.putUnitDouble(c('Top '), c('#Pnt'), 0);
        bnd.putUnitDouble(c('Left'), c('#Pnt'), 0);
        bnd.putUnitDouble(c('Btom'), c('#Pnt'), bh);
        bnd.putUnitDouble(c('Rght'), c('#Pnt'), bw);
        shp.putObject(s('bounds'), c('Rctn'), bnd);
        shapes.putObject(s('textShape'), shp);
        tl2.putList(s('textShape'), shapes);

        var styles = new ActionList();
        for (var r = 0; r < n.runs.length; r++) {
            var u = n.runs[r];
            var rd = new ActionDescriptor();
            rd.putInteger(c('From'), u.from);
            rd.putInteger(c('T   '), u.to);
            var ts = new ActionDescriptor();
            ts.putString(s('fontPostScriptName'), u.ps);
            ts.putString(c('FntN'), u.family);
            ts.putString(c('FntS'), u.style);
            ts.putUnitDouble(c('Sz  '), c('#Pnt'), u.size * S);
            ts.putBoolean(s('autoLeading'), !!u.autoLeading);
            if (!u.autoLeading) ts.putUnitDouble(c('Ldng'), c('#Pnt'), u.leading * S);
            ts.putInteger(c('Trck'), Math.round(u.tracking || 0));
            ts.putDouble(s('horizontalScale'), u.hScale || 100);
            ts.putDouble(s('verticalScale'), u.vScale || 100);
            if (u.baselineShift) ts.putUnitDouble(s('baselineShift'), c('#Pnt'), u.baselineShift * S);
            if (u.caps) ts.putEnumerated(s('fontCaps'), s('fontCaps'), s(u.caps));
            if (u.position) ts.putEnumerated(s('baseline'), s('baseline'), s(u.position));
            if (u.underline) ts.putEnumerated(s('underline'), s('underline'), s('underlineOnLeftInHorizontal'));
            if (u.strike) ts.putEnumerated(s('strikethrough'), s('strikethrough'), s('xHeightStrikethroughOn'));
            ts.putEnumerated(s('autoKern'), s('autoKern'), s('metricsKern'));
            var col = new ActionDescriptor();
            col.putDouble(c('Rd  '), u.color[0]);
            col.putDouble(c('Grn '), u.color[1]);
            col.putDouble(c('Bl  '), u.color[2]);
            ts.putObject(c('Clr '), c('RGBC'), col);
            rd.putObject(c('TxtS'), c('TxtS'), ts);
            styles.putObject(c('Txtt'), rd);
        }
        tl2.putList(c('Txtt'), styles);

        var pList = new ActionList();
        for (var p = 0; p < n.paras.length; p++) {
            var q = n.paras[p];
            var pd = new ActionDescriptor();
            pd.putInteger(c('From'), q.from);
            pd.putInteger(c('T   '), p === n.paras.length - 1 ? q.to + 1 : q.to);
            var ps = new ActionDescriptor();
            ps.putEnumerated(c('Algn'), c('Alg '), s(ALIGN_OK[q.align] ? q.align : 'left'));
            ps.putUnitDouble(s('firstLineIndent'), c('#Pnt'), (q.firstLineIndent || 0) * S);
            ps.putUnitDouble(s('startIndent'), c('#Pnt'), (q.leftIndent || 0) * S);
            ps.putUnitDouble(s('endIndent'), c('#Pnt'), (q.rightIndent || 0) * S);
            ps.putUnitDouble(s('spaceBefore'), c('#Pnt'), (q.spaceBefore || 0) * S);
            ps.putUnitDouble(s('spaceAfter'), c('#Pnt'), (q.spaceAfter || 0) * S);
            if (q.autoLeadingPct) ps.putDouble(s('autoLeadingPercentage'), q.autoLeadingPct / 100);
            ps.putBoolean(s('hyphenate'), !!q.hyphenate);
            ps.putBoolean(s('textEveryLineComposer'), q.everyLine !== false);
            pd.putObject(s('paragraphStyle'), s('paragraphStyle'), ps);
            pList.putObject(s('paragraphStyleRange'), pd);
        }
        tl2.putList(s('paragraphStyleRange'), pList);

        d.putObject(c('Usng'), c('TxLr'), tl2);
        executeAction(c('Mk  '), d, DialogModes.NO);
        var layer = doc.activeLayer;

        // Pin the box's top-left exactly where it belongs.
        try { layer.textItem.position = [new UnitValue(bx, 'px'), new UnitValue(by, 'px')]; } catch (e) {}
        // Then line the drawn text up with where InDesign draws it (measured
        // from outlines), still upright, before rotating/shearing.
        if (n.ink) {
            try {
                var lb = layer.bounds, inkTop = lb[1].as('px');
                var dy = (cy - h / 2 + n.ink.top * S) - inkTop;
                if (Math.abs(dy) > 0.25 && Math.abs(dy) < h) layer.translate(0, dy);
            } catch (e) {}
        }
        // Rotation, shear and flip are transforms, so the text stays editable.
        shapeActive(gm);
        return layer;
    }

    // ---------- placement ----------
    // Place a copy of the original file as an EMBEDDED smart object, never a
    // linked one, so editing the PSD can't overwrite artwork that InDesign
    // references. If Photoshop reports the file as locked (server locks, or
    // another app such as InDesign holding it open), wait and retry.
    function placeEmbeddedRobust(n, container) {
        var lastErr = null;
        for (var attempt = 0; attempt < 3; attempt++) {
            try {
                if (PARAMS.simulateLock) throw new Error('Could not complete the command because the file is locked.');
                return placeFile(n.path, n.pdfPage, n.pdfCrop);
            }
            catch (e) {
                lastErr = e;
                removeStray(container);
                if (!/lock|in use|busy/i.test(e.message)) break;
                $.sleep(1500);
            }
        }
        throw lastErr; // caller uses the InDesign preview
    }

    // Show/hide layers inside the active embedded smart object, matching
    // layers by name level by level (the nth "Shadow" matches the nth one).
    function applyLayerVisibility(tree) {
        var mainDoc = doc, missing = [];
        executeAction(s('placedLayerEditContents'), new ActionDescriptor(), DialogModes.NO);
        var inner = app.activeDocument;
        try {
            (function walk(layers, nodes) {
                var seen = {};
                for (var i = 0; i < nodes.length; i++) {
                    var nd = nodes[i], want = seen[nd.name] = (seen[nd.name] || 0) + 1, hit = null, count = 0;
                    for (var k = 0; k < layers.length && !hit; k++) if (layers[k].name === nd.name && ++count === want) hit = layers[k];
                    if (!hit) { missing.push(nd.name); continue; }
                    if (nd.children && hit.typename === 'LayerSet') walk(hit.layers, nd.children);
                    hit.visible = nd.visible;
                }
            })(inner.layers, tree);
        } finally {
            inner.close(SaveOptions.SAVECHANGES);
            app.activeDocument = mainDoc;
        }
        return missing;
    }

    function placeImage(n, ox, oy, container) {
        var gm = frameGeometry(n.corners, ox, oy);
        var layer;
        if (n.layerVis) {
            // Match InDesign's Object Layer Options inside the smart object.
            layer = placeFile(n.path);
            var missing = applyLayerVisibility(n.layerVis);
            if (missing.length) warn('In "' + n.name + '" these layers weren\'t found in the file, so their visibility could not be set: ' + missing.join(', ') + '.');
        } else {
            layer = placeEmbeddedRobust(n, container);
        }
        var q = soQuad(layer);
        transformActive(gm.cx - q.cx, gm.cy - q.cy, gm.w / q.w * 100, (gm.flip ? -1 : 1) * gm.h / q.h * 100, 0);
        shapeActive(gm, true);
        nudgeTo(doc.activeLayer, gm.cx, gm.cy);
        addVectorMask(n.clip, ox, oy);
        return doc.activeLayer;
    }

    function placeRaster(n, ox, oy) {
        var layer = placeFile(n.png);
        var q = soQuad(layer);
        var b = n.bounds;
        var cx = ox + (b[1] + b[3]) / 2 * S, cy = oy + (b[0] + b[2]) / 2 * S;
        var tw = n.pngW || (b[3] - b[1]) * S, th = n.pngH || (b[2] - b[0]) * S;
        transformActive(cx - q.cx, cy - q.cy, tw / q.w * 100, th / q.h * 100, 0);
        nudgeTo(layer, cx, cy);
        if (PARAMS.debug) {
            var q2 = soQuad(layer);
            res.debug.push(n.name + ': before ' + [q.cx, q.cy, q.w, q.h].join(',') + ' want ' + [cx, cy, tw, th].join(',') + ' got ' + [q2.cx, q2.cy, q2.w, q2.h].join(','));
        }
        return layer;
    }

    // ---------- stacking ----------
    // Photoshop drops new layers in different places depending on their type
    // (text layers in particular), so every layer is moved explicitly: directly
    // above the previous sibling, or to the top of an empty container.
    var lastIn = {};
    function placeTop(layer, container) {
        var last = lastIn[container.id];
        if (last) {
            try { layer.move(last, ElementPlacement.PLACEBEFORE); }
            catch (e) { layer.move(container, ElementPlacement.PLACEATBEGINNING); }
        } else {
            try { layer.move(container, ElementPlacement.PLACEATBEGINNING); }
            catch (e) { try { layer.move(container, ElementPlacement.INSIDE); } catch (e2) {} }
        }
        lastIn[container.id] = layer;
    }

    // Any layer a failed placement left behind directly in the container.
    function removeStray(container) {
        try {
            var a = doc.activeLayer;
            if (a !== container && a.typename === 'ArtLayer' && !isKnown(a)) a.remove();
        } catch (e) {}
        try { doc.activeLayer = container; } catch (e) {}
    }
    var known = {};
    function isKnown(layer) { return !!known[layer.id]; }

    function labelLayer(layer, colorId) {
        var d = new ActionDescriptor();
        var r = new ActionReference();
        r.putIdentifier(c('Lyr '), layer.id);
        d.putReference(c('null'), r);
        var l = new ActionDescriptor();
        l.putEnumerated(c('Clr '), c('Clr '), c(colorId));
        d.putObject(c('T   '), c('Lyr '), l);
        executeAction(c('setd'), d, DialogModes.NO);
    }

    function addNode(n, container, ox, oy, hideList) {
        var layer = null;
        if (n.kind === 'group') {
            var g = container.layerSets.add();
            g.name = n.name;
            placeTop(g, container);
            known[g.id] = 1;
            for (var i = 0; i < n.children.length; i++) addNode(n.children[i], g, ox, oy, hideList);
            tick('Building groups');
            if (n.clip) {
                try { doc.activeLayer = g; addVectorMask(n.clip, ox, oy); }
                catch (e) { warn('Could not mask folder "' + n.name + '" with its frame shape: ' + errText(e)); }
            }
            finishLayer(g, n);
            if (n.hidden) hideList.push(g);
            return;
        }
        n._ox = ox; n._oy = oy;
        doc.activeLayer = lastIn[container.id] || container;
        try {
            if (n.kind === 'text') layer = makeText(n, ox, oy);
            else if (n.kind === 'image') layer = placeImage(n, ox, oy, container);
            else layer = placeRaster(n, ox, oy);
        } catch (e) {
            removeStray(container);
            layer = null;
            if (n.kind === 'image' && n.fallback) {
                warn('Could not place "' + n.name + '" from its original file (' + errText(e).replace(/\s+/g, ' ') + '). It was rasterized into a smart object from InDesign\'s preview instead.');
                try { doc.activeLayer = lastIn[container.id] || container; layer = placeRaster(n.fallback, ox, oy); n.name = n.fallback.name; n.fx = n.fallback.fx; n.opacity = n.fallback.opacity; n.blend = n.fallback.blend; }
                catch (e2) { removeStray(container); warn('Failed to place fallback for "' + n.name + '": ' + errText(e2)); }
            } else {
                warn('Could not create layer "' + n.name + '": ' + errText(e));
            }
        }
        if (layer) {
            known[layer.id] = 1;
            placeTop(layer, container);
            layer.name = n.name;
            if (n.kind === 'text') { try { labelLayer(layer, 'Rd  '); } catch (e) {} }
            finishLayer(layer, n);
            if (n.hidden) hideList.push(layer);
            res.layers++;
        }
        tick('Building layers');
    }

    // ---------- size & save ----------
    // Image Size with resampling, by width or height (the other side follows),
    // with layer styles scaled along.
    function resampleDoc(key, px) {
        var d = new ActionDescriptor();
        d.putUnitDouble(c(key), c('#Pxl'), px);
        d.putBoolean(s('scaleStyles'), true);
        d.putBoolean(c('CnsP'), true);
        d.putEnumerated(c('Intr'), c('Intp'), s('bicubicAutomatic'));
        executeAction(c('ImgS'), d, DialogModes.NO);
    }

    function psbPath(p) { return /\.ps[db]$/i.test(p) ? p.replace(/\.ps[db]$/i, '.psb') : p + '.psb'; }

    function savePsd(out) {
        var opts = new PhotoshopSaveOptions();
        opts.layers = true;
        opts.embedColorProfile = true;
        opts.alphaChannels = true;
        doc.saveAs(new File(out), opts, false, Extension.LOWERCASE);
    }

    function savePsb(out) {
        out = psbPath(out);
        var sd = new ActionDescriptor(), so = new ActionDescriptor();
        so.putBoolean(s('maximizeCompatibility'), true);
        sd.putObject(c('As  '), c('Pht8'), so);
        sd.putPath(c('In  '), new File(out));
        sd.putBoolean(c('LwCs'), true);
        executeAction(c('save'), sd, DialogModes.NO);
        return out;
    }

    var prevUnits = app.preferences.rulerUnits, prevType = app.preferences.typeUnits, prevDialogs = app.displayDialogs;
    try {
        app.displayDialogs = DialogModes.NO;
        for (var od = 0; od < app.documents.length; od++) {
            try {
                var openName = app.documents[od].fullName.fsName;
                if (openName === new File(PARAMS.outPath).fsName || openName === new File(psbPath(PARAMS.outPath)).fsName)
                    throw new Error('"' + app.documents[od].name + '" is open in Photoshop. Close it, or choose a different file name.');
            } catch (e) { if (/is open in Photoshop/.test(e.message)) throw e; }
        }
        app.preferences.rulerUnits = Units.PIXELS;
        app.preferences.typeUnits = TypeUnits.POINTS;

        // Lay pages out in a row, wrapping if a row would exceed ~28k px.
        var gap = Math.round(60 * S);
        var maxW = 0, i;
        for (i = 0; i < M.pages.length; i++) maxW = Math.max(maxW, Math.round(M.pages[i].width * S));
        var cols = M.pages.length;
        while (cols > 1 && cols * (maxW + gap) > 28000) cols--;
        var pos = [], x = 0, y = 0, rowH = 0, W = 0, H = 0;
        for (i = 0; i < M.pages.length; i++) {
            var pw = Math.round(M.pages[i].width * S), ph = Math.round(M.pages[i].height * S);
            if (i > 0 && i % cols === 0) { x = 0; y += rowH + gap; rowH = 0; }
            pos.push([x, y, pw, ph]);
            x += pw + gap; rowH = Math.max(rowH, ph);
            W = Math.max(W, x - gap); H = Math.max(H, y + rowH);
        }
        for (i = 0; i < M.pages.length; i++) for (var L = 0; L < M.pages[i].layers.length; L++) totalNodes += countNodes(M.pages[i].layers[L].nodes);
        progress('photoshop', 0, totalNodes, 'Creating Photoshop document');

        doc = app.documents.add(new UnitValue(W, 'px'), new UnitValue(H, 'px'), 72, M.docName, NewDocumentMode.RGB, DocumentFill.TRANSPARENT, 1, BitsPerChannelType.EIGHT);
        var startLayer = doc.activeLayer;

        for (i = 0; i < M.pages.length; i++) {
            var pg = M.pages[i], P = pos[i];
            var ab = makeArtboard('Page ' + pg.name, P[0], P[1], P[0] + P[2], P[1] + P[3]);
            for (var li = 0; li < pg.layers.length; li++) {
                var lay = pg.layers[li];
                var grp;
                try { grp = ab.layerSets.add(); }
                catch (e) { grp = doc.layerSets.add(); }
                grp.name = lay.name;
                placeTop(grp, ab);
                known[grp.id] = 1;
                for (var ni = 0; ni < lay.nodes.length; ni++) addNode(lay.nodes[ni], grp, P[0], P[1], toHide);
                if (!lay.visible) toHide.push(grp);
            }
        }
        try { startLayer.remove(); } catch (e) {}
        // Selecting a layer makes it visible again, so hide everything last.
        for (i = 0; i < toHide.length; i++) { try { toHide[i].visible = false; } catch (e) {} }

        progress('photoshop', totalNodes, totalNodes, 'Checking fonts');
        var installed = {};
        try {
            for (i = 0; i < app.fonts.length; i++) installed[app.fonts[i].postScriptName] = 1;
            for (i = 0; i < M.fonts.length; i++) {
                if (!installed[M.fonts[i].ps]) res.missingFonts.push(M.fonts[i].family + ' ' + M.fonts[i].style + ' (' + M.fonts[i].ps + ')');
            }
        } catch (e) {}

        // Size: PARAMS.scale (0 < scale <= 1) shrinks the finished artwork in
        // Photoshop. The ppi drops by the same factor, so the print size and
        // text point sizes stay as in InDesign while the pixel count shrinks.
        var scale = Number(PARAMS.scale) || 1;
        if (!(scale > 0 && scale < 1)) scale = 1;
        doc.resizeImage(undefined, undefined, PARAMS.dpi * scale, ResampleMethod.NONE);
        if (scale < 1) {
            progress('photoshop', totalNodes, totalNodes, 'Resizing to ' + Math.round(scale * 1000) / 10 + '%');
            resampleDoc(PARAMS.scaleBy === 'height' ? 'Hght' : 'Wdth', Math.max(1, Math.round((PARAMS.scaleBy === 'height' ? H : W) * scale)));
        }

        progress('photoshop', totalNodes, totalNodes, 'Saving');
        var dw = doc.width.as('px'), dh = doc.height.as('px');
        var out = PARAMS.outPath;
        if (/\.psb$/i.test(out) || dw > 30000 || dh > 30000) {
            out = savePsb(out);
        } else {
            try {
                if (PARAMS.simulateSaveFail) throw new Error('Could not save as "' + new File(out).name + '" because the file is too big.');
                savePsd(out);
            } catch (e) {
                // PSD tops out at 2 GB and 30,000 px; PSB doesn't. Try that before giving up.
                try {
                    var alt = psbPath(out), base = alt.replace(/\.psb$/i, '');
                    for (var n = 2; new File(alt).exists && n < 1000; n++) alt = base + ' ' + n + '.psb'; // don't overwrite an existing PSB
                    out = savePsb(alt);
                } catch (e2) { throw new Error('Could not save the PSD (' + errText(e) + ') or a PSB instead (' + errText(e2) + ').'); }
                warn('Photoshop couldn\'t save it as a PSD (' + String(e.message || e).replace(/\s+/g, ' ') + '), so it was saved as a PSB, Photoshop\'s large-document format, instead.');
            }
        }
        res.outPath = out;
        if (!PARAMS.openWhenDone) doc.close(SaveOptions.DONOTSAVECHANGES);
        else app.bringToFront && app.bringToFront();
        res.ok = true;
    } catch (e) {
        res.error = errText(e);
    } finally {
        app.preferences.rulerUnits = prevUnits;
        app.preferences.typeUnits = prevType;
        app.displayDialogs = prevDialogs;
    }
    finish(res);
})();

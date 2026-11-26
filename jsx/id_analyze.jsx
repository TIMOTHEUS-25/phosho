// InDesign: open document, render page thumbnails, list links and fonts.
(function () {
    var res = { ok: false, pages: [], links: [], fonts: [], colors: [], warnings: [] };
    var doc = null;
    try {
        doc = idOpen(PARAMS.docPath);
        var pages = doc.pages.everyItem().getElements();
        var jp = app.jpegExportPreferences;
        try { jp.jpegExportRange = ExportRangeOrAllPages.EXPORT_RANGE; } catch (e) {}
        try { jp.exportingSpread = false; } catch (e) {}
        try { jp.jpegQuality = JPEGOptionsQuality.HIGH; } catch (e) {}
        try { jp.jpegColorSpace = JpegColorSpaceEnum.RGB; } catch (e) {}
        try { jp.antiAlias = true; } catch (e) {}
        try { jp.useDocumentBleeds = false; } catch (e) {}

        for (var i = 0; i < pages.length; i++) {
            var p = pages[i];
            var b = p.bounds;
            var w = b[3] - b[1], h = b[2] - b[0];
            progress('analyze', i, pages.length, 'Rendering page previews');
            var thumb = PARAMS.outDir + '/thumb_' + i + '.jpg';
            var ok = false;
            try {
                jp.exportResolution = Math.max(10, Math.min(150, 900 / (Math.max(w, h) / 72)));
                var attempts = ['+' + (i + 1), p.name];
                for (var a = 0; a < attempts.length && !ok; a++) {
                    try {
                        jp.pageString = attempts[a];
                        doc.exportFile(ExportFormat.JPG, new File(thumb), false);
                        ok = new File(thumb).exists;
                    } catch (e1) {}
                }
            } catch (e) {}
            var side = 'single';
            try {
                if (p.side == PageSideOptions.LEFT_HAND) side = 'left';
                else if (p.side == PageSideOptions.RIGHT_HAND) side = 'right';
            } catch (e) {}
            res.pages.push({ index: i, name: p.name, width: w, height: h, thumb: ok ? thumb : null, spread: p.parent.index, side: side });
        }

        var links = doc.links.everyItem().getElements();
        for (var k = 0; k < links.length; k++) {
            var l = links[k], pg = null;
            try { var pp = l.parent.parentPage; if (pp) pg = pp.documentOffset; } catch (e) {}
            res.links.push({ id: l.id, name: l.name, path: linkPath(l), status: linkStatusName(l.status), page: pg });
        }

        var fonts = doc.fonts.everyItem().getElements();
        for (var f = 0; f < fonts.length; f++) {
            try { res.fonts.push(fontInfo(fonts[f])); } catch (e) {}
        }
        // Document colours (named swatches and unnamed colours) with InDesign's
        // standard RGB conversion, for the colour-profile panel and editor.
        var cols = doc.colors.everyItem().getElements();
        for (var ci = 0; ci < cols.length; ci++) {
            try {
                var c = cols[ci];
                if (c.constructor.name !== 'Color' || /^(None|Paper|Registration)$/.test(c.name) || c.model == ColorModel.REGISTRATION) continue;
                // (if/else: ExtendScript misreads chained ?: on enum comparisons)
                var space = c.space, sp = 'other';
                if (space == ColorSpace.CMYK) sp = 'cmyk';
                else if (space == ColorSpace.RGB) sp = 'rgb';
                else if (space == ColorSpace.LAB) sp = 'lab';
                var v = c.colorValue, vals = [];
                for (var vi = 0; vi < v.length; vi++) vals.push(Math.round(v[vi] * 100) / 100);
                res.colors.push({ name: c.name, spot: c.model == ColorModel.SPOT, space: sp, value: vals, rgb: colorRgb(c) });
            } catch (e) {}
        }
        res.ok = true;
    } catch (e) {
        res.error = errText(e);
    } finally {
        idClose(doc);
    }
    finish(res);
})();

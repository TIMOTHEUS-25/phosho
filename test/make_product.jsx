// Photoshop: builds test/product.psd (Background, Shadow, Product layers)
// for testing InDesign's Object Layer Options (per-placement layer visibility).
var f = new File(File($.fileName).parent.fsName + '/product.psd');
var prev = app.preferences.rulerUnits; app.preferences.rulerUnits = Units.PIXELS;
var d = app.documents.add(600, 600, 300, 'product', NewDocumentMode.RGB, DocumentFill.WHITE);
function col(r, g, b) { var c = new SolidColor(); c.rgb.red = r; c.rgb.green = g; c.rgb.blue = b; return c; }
function ellipse(x1, y1, x2, y2) {
    var cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = (x2 - x1) / 2, ry = (y2 - y1) / 2, pts = [];
    for (var i = 0; i < 64; i++) { var a = i / 64 * Math.PI * 2; pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]); }
    d.selection.select(pts);
}
var bg = d.artLayers.add(); bg.name = 'Background colour'; d.selection.selectAll(); d.selection.fill(col(235, 235, 240)); d.selection.deselect();
var sh = d.artLayers.add(); sh.name = 'Shadow'; ellipse(140, 470, 470, 540); d.selection.fill(col(30, 20, 40)); d.selection.deselect(); sh.applyGaussianBlur(18);
var pr = d.artLayers.add(); pr.name = 'Product'; ellipse(170, 120, 430, 480); d.selection.fill(col(220, 40, 40)); d.selection.deselect();
d.backgroundLayer.remove();
var o = new PhotoshopSaveOptions(); o.layers = true;
d.saveAs(f, o, true); d.close(SaveOptions.DONOTSAVECHANGES);
app.preferences.rulerUnits = prev;
'ok';

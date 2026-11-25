var DIR = File($.fileName).parent.fsName;
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
var doc = app.documents.add(false);
try {
doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS; doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
var bottom = doc.layers[0]; bottom.name = 'Bottom';
var middle = doc.layers.add({ name: 'Middle' });
var top = doc.layers.add({ name: 'Top' });       // layers[0] = Top
var p = doc.pages[0];
function col(n) { var c = doc.colors.itemByName(n); if (c.isValid) return c; var v = { Black: [0,0,0], Cyan: [0,170,230], Magenta: [220,0,120], Yellow: [250,220,0] }[n]; return doc.colors.add({ name: n, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: v }); }
function rect(layer, name, y, color) { return p.rectangles.add(layer, { geometricBounds: [y, 20, y + 60, 200], name: name, fillColor: col(color), strokeWeight: 0 }); }
function text(layer, name, y) { var t = p.textFrames.add(layer, { geometricBounds: [y, 220, y + 30, 500], name: name }); t.contents = name; return t; }
rect(bottom, 'B-back', 20, 'Black'); text(bottom, 'B-text', 30); rect(bottom, 'B-front', 40, 'Cyan');
var m1 = rect(middle, 'M-1', 120, 'Magenta'); var m2 = text(middle, 'M-2', 130); var m3 = rect(middle, 'M-3', 140, 'Yellow');
var inner = p.groups.add([m2, m3]); inner.name = 'M-inner';
var outer = p.groups.add([m1, inner]); outer.name = 'M-outer';
var m4 = text(middle, 'M-4', 200);
m4.sendToBack();                                  // M-4 behind the group
text(top, 'T-front', 300); var tb = rect(top, 'T-back', 310, 'Cyan'); tb.sendToBack();
doc.save(File(DIR + '/layers.indd')); var RES = 'ok';
} catch (e) { RES = 'ERR line ' + e.line + ': ' + e.message; } finally { doc.close(SaveOptions.NO); }
RES;

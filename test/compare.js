// Renders an InDesign page and the matching PSD artboard at 100 ppi and
// writes side-by-side + difference images to test/out/compare_<name>.png.
// usage: node test/compare.js <file.indd> <file.psd> [pageIndex=0] [pageName=1]
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { findApps } = require('../src/adobe');

const [indd, psd, pageIndex = '0', pageName = String(Number(pageIndex) + 1)] = process.argv.slice(2).map((a, i) => (i < 2 ? path.resolve(a) : a));
const apps = findApps();
const RES = Number(process.env.CMP_RES || 100); // ppi of the comparison renders
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'idps-cmp-'));
const tag = path.basename(indd, '.indd') + '_p' + pageName;
const idPng = path.join(__dirname, 'out', 'cmp_' + tag + '_id.png'), psPng = path.join(__dirname, 'out', 'cmp_' + tag + '_ps.png');
const q = (s) => JSON.stringify(s);

function run(app, jsx, kind) {
  const f = path.join(tmp, kind + '.jsx');
  fs.writeFileSync(f, jsx);
  const cmd = kind === 'id'
    ? `tell application "${apps.indesign.name}" to do script (POSIX file ${q(f)}) language javascript`
    : `tell application "${apps.photoshop.name}" to do javascript (file (POSIX file ${q(f)} as text))`;
  return execFileSync('osascript', ['-e', cmd]).toString().trim();
}

console.log(run('id', `
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
var d = app.open(File(${q(indd)}), false);
try { var p = app.pngExportPreferences; p.exportResolution = ${RES}; p.pngExportRange = PNGExportRangeEnum.EXPORT_RANGE;
  p.pageString = '+' + (${Number(pageIndex)} + 1); p.transparentBackground = false; p.antiAlias = true; p.useDocumentBleeds = false;
  d.exportFile(ExportFormat.PNG_FORMAT, File(${q(idPng)}), false); } finally { d.close(SaveOptions.NO); }
'id ok';`, 'id'));

console.log(run('ps', `
function c(s){return charIDToTypeID(s)} function s(x){return stringIDToTypeID(x)}
var src = null;
for (var i = 0; i < app.documents.length; i++) { try { if (app.documents[i].fullName.fsName === ${q(psd)}) src = app.documents[i]; } catch (e) {} }
var opened = !src; if (!src) src = app.open(File(${q(psd)}));
app.activeDocument = src;
var rect = null;
for (var j = 0; j < src.layerSets.length; j++) if (src.layerSets[j].name === 'Page ${pageName}') {
  src.activeLayer = src.layerSets[j];
  var r = new ActionReference(); r.putEnumerated(c('Lyr '), c('Ordn'), c('Trgt'));
  var ab = executeActionGet(r).getObjectValue(s('artboard')).getObjectValue(s('artboardRect'));
  rect = [ab.getDouble(c('Left')), ab.getDouble(c('Top ')), ab.getDouble(c('Rght')), ab.getDouble(c('Btom'))];
}
var dup = src.duplicate('cmp', false);
if (opened) src.close(SaveOptions.DONOTSAVECHANGES);
app.activeDocument = dup;
var prev = app.preferences.rulerUnits; app.preferences.rulerUnits = Units.PIXELS;
dup.flatten();
dup.crop([UnitValue(rect[0], 'px'), UnitValue(rect[1], 'px'), UnitValue(rect[2], 'px'), UnitValue(rect[3], 'px')]);
dup.resizeImage(UnitValue(Math.round((rect[2] - rect[0]) * ${RES} / dup.resolution), 'px'), undefined, ${RES}, ResampleMethod.BICUBIC);
dup.saveAs(File(${q(psPng)}), new PNGSaveOptions(), true); dup.close(SaveOptions.DONOTSAVECHANGES);
app.preferences.rulerUnits = prev;
'ps ok';`, 'ps'));

const out = path.join(__dirname, 'out', 'compare_' + path.basename(indd, '.indd') + '_p' + pageName + '.png');
execFileSync('python3', ['-c', `
import sys
from PIL import Image, ImageChops
a = Image.open(sys.argv[1]).convert('RGB'); b = Image.open(sys.argv[2]).convert('RGB').resize(a.size)
d = ImageChops.difference(a, b).convert('L').point(lambda v: 255 if v > 40 else 0)
diff = Image.composite(Image.new('RGB', a.size, (255, 0, 160)), Image.blend(a, Image.new('RGB', a.size, 'white'), 0.75), d)
o = Image.new('RGB', (a.width * 3 + 20, a.height), 'gray'); o.paste(a, (0, 0)); o.paste(b, (a.width + 10, 0)); o.paste(diff, (a.width * 2 + 20, 0))
o.save(sys.argv[3]); print('mismatch %.2f%%' % (100.0 * sum(1 for v in d.getdata() if v) / (a.width * a.height)))
`, idPng, psPng, out], { stdio: 'inherit' });
console.log(out);

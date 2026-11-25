var doc = app.activeDocument, out = [];
function find(ls, name) { for (var i = 0; i < ls.length; i++) { if (ls[i].name === name) return ls[i]; if (ls[i].typename === 'LayerSet') { var f = find(ls[i].layers, name); if (f) return f; } } return null; }
var so = find(doc.layers, 'M-outer'); doc.activeLayer = so;
executeAction(stringIDToTypeID('placedLayerEditContents'), new ActionDescriptor(), DialogModes.NO);
var inner = app.activeDocument;
function walk(ls, ind) { for (var i = 0; i < ls.length; i++) { var l = ls[i], t = ind + l.name;
  try { var r = new ActionReference(); r.putIdentifier(charIDToTypeID('Lyr '), l.id); t += ' label=' + typeIDToStringID(executeActionGet(r).getEnumerationValue(charIDToTypeID('Clr '))); } catch (e) {}
  if (l.typename === 'ArtLayer') t += ' ' + String(l.kind).replace('LayerKind.', '');
  out.push(t); if (l.typename === 'LayerSet') walk(l.layers, ind + '  '); } }
walk(inner.layers, '  ');
inner.close(SaveOptions.DONOTSAVECHANGES); app.activeDocument = doc;
'inside M-outer:\n' + out.join('\n');

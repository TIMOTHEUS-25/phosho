// Photoshop: list the colours used by every text layer (per style run) and
// the pixel colour at the centre of each smart object layer, for the active document.
var out = [], doc = app.activeDocument;
function walk(layers) {
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i];
    if (l.typename === 'LayerSet') { walk(l.layers); continue; }
    var r = new ActionReference(); r.putIdentifier(charIDToTypeID('Lyr '), l.id);
    var d = executeActionGet(r);
    if (l.kind == LayerKind.TEXT) {
      var runs = d.getObjectValue(stringIDToTypeID('textKey')).getList(stringIDToTypeID('textStyleRange')), seen = {};
      for (var k = 0; k < runs.count; k++) {
        var ts = runs.getObjectValue(k).getObjectValue(stringIDToTypeID('textStyle'));
        if (!ts.hasKey(charIDToTypeID('Clr '))) continue;
        var c = ts.getObjectValue(charIDToTypeID('Clr '));
        seen[[Math.round(c.getDouble(charIDToTypeID('Rd  '))), Math.round(c.getDouble(charIDToTypeID('Grn '))), Math.round(c.getDouble(stringIDToTypeID('blue')))].join(',')] = 1;
      }
      var list = []; for (var key in seen) list.push(key);
      out.push('TEXT ' + l.name.substr(0, 30) + ' -> ' + list.join(' | '));
    } else {
      var b = l.bounds, x = (b[0].as('px') + b[2].as('px')) / 2, y = (b[1].as('px') + b[3].as('px')) / 2;
      var vis = []; // solo the layer so the sample is its own pixel
      try {
        var s = doc.colorSamplers.add([UnitValue(x, 'px'), UnitValue(y, 'px')]);
        var col = s.color.rgb; out.push('PIXEL ' + l.name.substr(0, 30) + ' -> ' + [Math.round(col.red), Math.round(col.green), Math.round(col.blue)].join(','));
        s.remove();
      } catch (e) { out.push('PIXEL ' + l.name + ' ERR ' + e.message); }
    }
  }
}
walk(doc.layers);
out.join('\n');

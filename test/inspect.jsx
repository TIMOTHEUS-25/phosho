var out = [];
var doc = app.activeDocument;
out.push('doc ' + doc.name + ' ' + doc.width.as('px') + 'x' + doc.height.as('px') + ' @' + doc.resolution + ' mode ' + doc.mode);
function walk(layers, ind) {
  for (var i = 0; i < layers.length; i++) {
    var l = layers[i], line = ind + (l.typename === 'LayerSet' ? '[G] ' : '') + l.name + ' vis=' + l.visible;
    try { var rr = new ActionReference(); rr.putIdentifier(charIDToTypeID('Lyr '), l.id); line += ' label=' + typeIDToStringID(executeActionGet(rr).getEnumerationValue(charIDToTypeID('Clr '))); } catch (e) {}
    try {
      var rr2 = new ActionReference(); rr2.putIdentifier(charIDToTypeID('Lyr '), l.id); var ld = executeActionGet(rr2);
      var md = typeIDToStringID(ld.getEnumerationValue(charIDToTypeID('Md  '))); if (md !== 'normal' && md !== 'passThrough') line += ' blend=' + md;
      if (l.opacity < 100) line += ' op=' + Math.round(l.opacity);
      if (ld.hasKey(stringIDToTypeID('layerEffects'))) { var fx = ld.getObjectValue(stringIDToTypeID('layerEffects')), ks = []; for (var q = 0; q < fx.count; q++) { var kk = typeIDToStringID(fx.getKey(q)); if (kk !== 'scale' && kk !== 'masterFXSwitch') ks.push(kk); } line += ' fx=' + ks.join('+'); }
      if (l.typename === 'ArtLayer' && l.kind == LayerKind.TEXT) { try { var tk = ld.getObjectValue(stringIDToTypeID('textKey')).getObjectValue(stringIDToTypeID('transform'));  } catch (e) {} }
    } catch (e) { line += ' ERR2 ' + e.message; }
    try {
      if (l.typename === 'ArtLayer') {
        line += ' kind=' + String(l.kind).replace('LayerKind.', '');
        var b = l.bounds; line += ' b=' + [b[0].as('px'), b[1].as('px'), b[2].as('px'), b[3].as('px')].join(',').replace(/(\.\d)\d+/g,'$1');
        if (l.kind == LayerKind.TEXT) { var t = l.textItem; line += ' font=' + t.font + ' size=' + t.size.as('pt').toFixed(2) + ' pos=' + t.position[0].as('px').toFixed(1)+','+t.position[1].as('px').toFixed(1) + ' w=' + t.width.as('px').toFixed(1); }
        if (l.kind == LayerKind.SMARTOBJECT) {
          var r = new ActionReference(); r.putIdentifier(charIDToTypeID('Lyr '), l.id);
          var d = executeActionGet(r).getObjectValue(stringIDToTypeID('smartObject'));
          line += ' linked=' + d.getBoolean(stringIDToTypeID('linked'));
          try { line += ' file=' + d.getPath(stringIDToTypeID('link')).fsName; } catch (e) { try { line += ' file=' + d.getString(stringIDToTypeID('fileReference')); } catch (e2) {} }
          var r2 = new ActionReference(); r2.putIdentifier(charIDToTypeID('Lyr '), l.id);
          line += ' vmask=' + executeActionGet(r2).getBoolean(stringIDToTypeID('hasVectorMask'));
        }
      }
    } catch (e) { line += ' ERR ' + e.message; }
    out.push(line);
    if (l.typename === 'LayerSet') walk(l.layers, ind + '  ');
  }
}
walk(doc.layers, '');
var png = new File(doc.path.fsName + '/preview.png');
var dup = doc.duplicate('prev', true);
dup.resizeImage(UnitValue(dup.width.as('px') / 3, 'px'), undefined, 100, ResampleMethod.BICUBIC);
var o = new PNGSaveOptions(); dup.saveAs(png, o, true); dup.close(SaveOptions.DONOTSAVECHANGES);
out.join('\n');

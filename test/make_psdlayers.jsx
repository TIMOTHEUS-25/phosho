// Builds test/psdlayers.indd: the "product with shadow" set-up. product.psd is
// placed twice at the same spot. The bottom copy shows only its Shadow layer
// and is set to Multiply; the top copy shows only the Product layer.
var DIR = File($.fileName).parent.fsName;
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
var doc = app.documents.add(false);
var RES = 'ok';
try {
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    var p = doc.pages[0];
    var bg = p.rectangles.add({ geometricBounds: [60, 60, 400, 400], fillColor: doc.colors.add({ name: 'Sand', model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: [240, 215, 160] }), strokeWeight: 0, name: 'Backdrop' });
    function place(name, show) {
        var f = p.rectangles.add({ geometricBounds: [100, 100, 244, 244], strokeWeight: 0, name: name });
        f.place(File(DIR + '/product.psd'));
        f.fit(FitOptions.CONTENT_TO_FRAME);
        // Changing a layer re-imports the image, so fetch the layers again each time.
        var names = f.graphics[0].graphicLayerOptions.graphicLayers.everyItem().name;
        for (var i = 0; i < names.length; i++) {
            f.graphics[0].graphicLayerOptions.graphicLayers.itemByName(names[i]).currentVisibility = (names[i] === show);
        }
        return f;
    }
    var shadow = place('Product shadow', 'Shadow');
    shadow.transparencySettings.blendingSettings.blendMode = BlendMode.MULTIPLY;
    place('Product', 'Product');
    // A third copy with untouched layer visibility: placed as an embedded smart object like every image.
    var plain = p.rectangles.add({ geometricBounds: [100, 260, 244, 404], strokeWeight: 0, name: 'Product as saved' });
    plain.place(File(DIR + '/product.psd')); plain.fit(FitOptions.CONTENT_TO_FRAME);
    doc.save(File(DIR + '/psdlayers.indd'));
} catch (e) { RES = 'ERR line ' + e.line + ': ' + e.message; } finally { doc.close(SaveOptions.NO); }
RES;

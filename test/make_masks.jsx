// Builds test/masks.indd: frame masks, image crops, corners, pasted-inside
// content, feathers, strokes and text placement. Used to check 1:1 accuracy.
var DIR = File($.fileName).parent.fsName;
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
var doc = app.documents.add(true); // Paste Into needs a window
var RES = 'ok';
try {
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.documentPreferences.pageWidth = 595; doc.documentPreferences.pageHeight = 842;
    var p = doc.pages[0];
    var PHOTO = File(DIR + '/photo.png');
    function col(n, v) { var c = doc.colors.itemByName(n); if (c.isValid) return c; return doc.colors.add({ name: n, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: v }); }
    var red = col('Brand Red', [220, 40, 40]), blue = col('Brand Blue', [40, 90, 210]), yel = col('Brand Yellow', [250, 210, 40]);
    function img(gb, name) {
        var f = p.rectangles.add({ geometricBounds: gb, name: name || '', strokeWeight: 0 });
        f.place(PHOTO); f.fit(FitOptions.FILL_PROPORTIONALLY);
        return f;
    }
    // 1 rounded corners
    var r1 = img([30, 30, 150, 200]);
    r1.topLeftCornerOption = r1.topRightCornerOption = r1.bottomLeftCornerOption = r1.bottomRightCornerOption = CornerOptions.ROUNDED_CORNER;
    r1.topLeftCornerRadius = r1.topRightCornerRadius = r1.bottomLeftCornerRadius = r1.bottomRightCornerRadius = 25;
    // 2 image rotated inside an upright frame
    var r2 = img([30, 220, 150, 390]);
    r2.graphics[0].rotationAngle = 30;
    // 3 image scaled + offset (cropped)
    var r3 = img([30, 410, 150, 570]);
    r3.graphics[0].horizontalScale = 160; r3.graphics[0].verticalScale = 160;
    r3.graphics[0].move(undefined, [-40, -30]);
    // 4 rotated oval
    var o4 = p.ovals.add({ geometricBounds: [180, 30, 300, 200], strokeWeight: 0 });
    o4.place(PHOTO); o4.fit(FitOptions.FILL_PROPORTIONALLY); o4.rotationAngle = 25;
    // 5 star polygon
    var s5 = p.polygons.add({ geometricBounds: [180, 230, 300, 370], strokeWeight: 0, numberOfSides: 5, insetPercentage: 50 });
    s5.place(PHOTO); s5.fit(FitOptions.FILL_PROPORTIONALLY);
    // 6 thick outside stroke + fill + image
    var r6 = img([190, 410, 290, 560]);
    r6.strokeWeight = 10; r6.strokeColor = blue; r6.strokeAlignment = StrokeAlignment.OUTSIDE_ALIGNMENT; r6.fillColor = yel;
    // 7 group pasted inside a circle
    var a = p.rectangles.add({ geometricBounds: [330, 20, 420, 140], fillColor: red, strokeWeight: 0 });
    var t = p.textFrames.add({ geometricBounds: [360, 60, 400, 220] }); t.contents = 'Pasted inside'; t.texts[0].pointSize = 18;
    var inner = p.groups.add([a, t]);
    var circ = p.ovals.add({ geometricBounds: [320, 30, 440, 170], strokeWeight: 2, strokeColor: blue, fillColor: 'None', name: '' });
    app.select(inner); app.cut(); app.select(circ); app.pasteInto();
    // 8 rotated text with insets, vertical centre
    var t8 = p.textFrames.add({ geometricBounds: [320, 230, 420, 400], fillColor: yel });
    t8.contents = 'Inset 12, centred vertically';
    t8.texts[0].pointSize = 14; t8.textFramePreferences.insetSpacing = [12, 12, 12, 12];
    t8.textFramePreferences.verticalJustification = VerticalJustification.CENTER_ALIGN;
    t8.rotationAngle = 15;
    // 9 mixed sizes, several paragraphs
    var t9 = p.textFrames.add({ geometricBounds: [320, 420, 470, 575] });
    t9.contents = 'Big heading\rSmaller body copy that wraps onto a second line.\rCaption';
    t9.paragraphs[0].pointSize = 26; t9.paragraphs[1].pointSize = 11; t9.paragraphs[2].pointSize = 8;
    t9.paragraphs[1].spaceBefore = 6;
    // 10 rotated line
    var ln = p.graphicLines.add({ strokeWeight: 5, strokeColor: red });
    ln.paths[0].entirePath = [[40, 480], [260, 520]];
    // 11 gradient feather on image
    var r11 = img([540, 30, 660, 200]);
    r11.transparencySettings.gradientFeatherSettings.applied = true;
    // 12 basic feather on image
    var r12 = img([540, 220, 660, 390]);
    r12.transparencySettings.featherSettings.mode = FeatherMode.STANDARD; r12.transparencySettings.featherSettings.width = 12;
    // 13 gradient feather on text
    var t13 = p.textFrames.add({ geometricBounds: [560, 410, 620, 575] }); t13.contents = 'Faded text';
    t13.texts[0].pointSize = 30; t13.texts[0].fillColor = blue;
    t13.transparencySettings.gradientFeatherSettings.applied = true;
    // 14 nested groups: unnamed, named, single-child
    var g1 = p.rectangles.add({ geometricBounds: [700, 30, 760, 120], fillColor: red, strokeWeight: 0 });
    var g2 = p.textFrames.add({ geometricBounds: [700, 130, 730, 300] }); g2.contents = 'Card title';
    g2.texts[0].pointSize = 16;
    var g3 = p.ovals.add({ geometricBounds: [700, 310, 760, 370], fillColor: blue, strokeWeight: 0 });
    var card = p.groups.add([g1, g2]);
    var outer = p.groups.add([card, g3]);
    var named = p.rectangles.add({ geometricBounds: [700, 400, 760, 470], fillColor: yel, strokeWeight: 0 });
    var named2 = p.rectangles.add({ geometricBounds: [700, 480, 760, 560], fillColor: blue, strokeWeight: 0 });
    var ng = p.groups.add([named, named2]); ng.name = 'Logo lockup';
    doc.save(File(DIR + '/masks.indd'));
} catch (e) { RES = 'ERR line ' + e.line + ': ' + e.message; } finally { doc.close(SaveOptions.NO); }
RES;

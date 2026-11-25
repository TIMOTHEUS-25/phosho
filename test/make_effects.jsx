// Builds test/effects.indd: rotation, shear, flip, drop shadows and other
// effects on text, images, shapes and groups.
var DIR = File($.fileName).parent.fsName;
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
var doc = app.documents.add(false);
var RES = 'ok';
try {
    doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
    doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
    doc.documentPreferences.pageWidth = 595; doc.documentPreferences.pageHeight = 842;
    var p = doc.pages[0];
    function col(n, v) { var c = doc.colors.itemByName(n); if (c.isValid) return c; return doc.colors.add({ name: n, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: v }); }
    var red = col('R', [220, 40, 40]), blue = col('B', [40, 90, 210]), yel = col('Y', [250, 210, 40]), grn = col('G', [30, 160, 90]);
    function text(name, gb, s, size) {
        var t = p.textFrames.add({ geometricBounds: gb, name: name });
        t.contents = s;
        t.texts[0].pointSize = size || 24;
        try { t.texts[0].appliedFont = app.fonts.itemByName('Helvetica\tBold'); } catch (e) {}
        return t;
    }
    function shadow(ts, dist, size, ang) {
        var d = ts.dropShadowSettings;
        d.mode = ShadowMode.DROP; d.distance = dist; d.size = size; d.useGlobalLight = false; d.angle = ang; d.opacity = 75;
        d.effectColor = 'Black';
    }
    var rot = text('Rotated shadow', [40, 40, 90, 300], 'Rotated with shadow');
    shadow(rot.transparencySettings, 6, 4, 135);
    rot.rotationAngle = 20;

    var sh = text('Sheared', [150, 40, 200, 300], 'Sheared text 20°');
    sh.shearAngle = 20;

    var fl = text('Flipped', [220, 40, 270, 300], 'Flipped vertical');
    fl.flipItem(Flip.VERTICAL);

    var gl = text('Glow text', [290, 40, 340, 300], 'Glowing text', 28);
    var g = gl.contentTransparencySettings.outerGlowSettings;
    g.applied = true; g.size = 8; g.opacity = 90; g.effectColor = yel; g.blendMode = BlendMode.NORMAL;
    gl.texts[0].fillColor = blue;

    var bx = text('Boxed', [360, 40, 420, 300], 'Text in a filled box');
    bx.fillColor = yel; bx.textFramePreferences.insetSpacing = [8, 8, 8, 8];
    shadow(bx.transparencySettings, 8, 6, 120);

    var r1 = p.rectangles.add({ geometricBounds: [40, 340, 140, 500], name: 'Shadow+glow rect', fillColor: red, strokeWeight: 0 });
    shadow(r1.transparencySettings, 10, 8, 120);
    var og = r1.transparencySettings.outerGlowSettings; og.applied = true; og.size = 12; og.effectColor = blue; og.opacity = 60;
    r1.rotationAngle = 15;

    var ov = p.ovals.add({ geometricBounds: [170, 360, 270, 480], name: 'Bevel oval', fillColor: grn, strokeWeight: 0 });
    var bv = ov.transparencySettings.bevelAndEmbossSettings; bv.applied = true; bv.size = 10; bv.depth = 200;

    var r2 = p.rectangles.add({ geometricBounds: [290, 340, 360, 500], name: 'Satin+inner glow', fillColor: blue, strokeWeight: 0 });
    var sa = r2.transparencySettings.satinSettings; sa.applied = true; sa.size = 10; sa.distance = 8;
    var ig = r2.transparencySettings.innerGlowSettings; ig.applied = true; ig.size = 10; ig.effectColor = yel;
    var is = r2.transparencySettings.innerShadowSettings; is.applied = true; is.distance = 5; is.size = 5; is.useGlobalLight = false; is.angle = 45;

    var img = p.rectangles.add({ geometricBounds: [460, 40, 600, 240], name: 'Photo frame', strokeWeight: 0 });
    img.place(File(DIR + '/photo.png'));
    img.fit(FitOptions.FILL_PROPORTIONALLY);
    shadow(img.transparencySettings, 8, 6, 120);
    img.rotationAngle = 10; img.shearAngle = 10;

    var a = p.rectangles.add({ geometricBounds: [460, 340, 520, 420], fillColor: red, strokeWeight: 0 });
    var b = p.rectangles.add({ geometricBounds: [490, 380, 560, 470], fillColor: grn, strokeWeight: 0 });
    var grp = p.groups.add([a, b]); grp.name = 'Shadow group';
    shadow(grp.transparencySettings, 8, 5, 120);

    var mul = p.rectangles.add({ geometricBounds: [500, 430, 580, 540], name: 'Multiply 60%', fillColor: yel, strokeWeight: 0 });
    mul.transparencySettings.blendingSettings.blendMode = BlendMode.MULTIPLY;
    mul.transparencySettings.blendingSettings.opacity = 60;

    var fe = p.rectangles.add({ geometricBounds: [640, 40, 740, 240], name: 'Gradient feather', fillColor: blue, strokeWeight: 0 });
    fe.transparencySettings.gradientFeatherSettings.applied = true;

    var rt = text('Rotated plain', [660, 300, 700, 560], 'Rotated -30 no effects');
    rt.rotationAngle = -30;

    doc.save(File(DIR + '/effects.indd'));
} catch (e) { RES = 'ERR line ' + e.line + ': ' + e.message; } finally { doc.close(SaveOptions.NO); }
RES;

// Builds test/sample.indd for testing the converter.
var DIR = File($.fileName).parent.fsName;
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
var doc = app.documents.add(false);
doc.documentPreferences.pageWidth = '210mm';
doc.documentPreferences.pageHeight = '297mm';
doc.documentPreferences.facingPages = false;
doc.documentPreferences.pagesPerDocument = 2;
doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;

var bg = doc.layers[0]; bg.name = 'Background';
var content = doc.layers.add({ name: 'Content' });

function rgb(name, v) { return doc.colors.add({ name: name, model: ColorModel.PROCESS, space: ColorSpace.RGB, colorValue: v }); }
var blue = rgb('Blue', [20, 80, 200]);
var red = rgb('Red', [220, 40, 40]);
var cmykGreen = doc.colors.add({ name: 'Green', model: ColorModel.PROCESS, space: ColorSpace.CMYK, colorValue: [80, 0, 100, 0] });

// Master page footer with page number
var master = doc.masterSpreads[0].pages[0];
var foot = master.textFrames.add(content, { geometricBounds: [800, 40, 820, 300] });
foot.contents = 'Footer page ';
foot.insertionPoints[-1].contents = SpecialCharacters.AUTO_PAGE_NUMBER;
foot.texts[0].appliedFont = 'Helvetica\tRegular';
foot.texts[0].pointSize = 10;

var p1 = doc.pages[0];
// background shape
p1.rectangles.add(bg, { geometricBounds: [0, 0, 160, 595.276], fillColor: blue, strokeWeight: 0 });

// headline with mixed styles
var h = p1.textFrames.add(content, { geometricBounds: [40, 40, 140, 555] });
h.contents = 'Hello Photoshop\rMixed styles in one frame: bold, red and green.';
h.parentStory.appliedFont = 'Helvetica\tRegular';
h.parentStory.pointSize = 14;
h.parentStory.fillColor = doc.swatches.itemByName('Paper');
var l1 = h.paragraphs[0];
l1.appliedFont = 'Helvetica\tBold'; l1.pointSize = 40; l1.tracking = -20;
var p2 = h.paragraphs[1];
p2.leading = 22;
var w = p2.words;
for (var i = 0; i < w.length; i++) {
    if (w[i].contents.indexOf('bold') === 0) w[i].appliedFont = 'Helvetica\tBold';
    if (w[i].contents.indexOf('red') === 0) w[i].fillColor = red;
    if (w[i].contents.indexOf('green') === 0) w[i].fillColor = cmykGreen;
}

// body text, centered, with a forced line break
var body = p1.textFrames.add(content, { geometricBounds: [190, 40, 300, 300], fillColor: doc.swatches.itemByName('Black'), fillTint: 10, strokeWeight: 1, strokeColor: red });
body.textFramePreferences.insetSpacing = [8, 8, 8, 8];
body.contents = 'Centered paragraph text\nwith a forced line break and some more words to wrap inside the box.';
body.parentStory.appliedFont = 'Georgia\tRegular';
body.parentStory.pointSize = 12;
body.parentStory.justification = Justification.CENTER_ALIGN;

// rotated text
var rot = p1.textFrames.add(content, { geometricBounds: [330, 330, 370, 560] });
rot.contents = 'Rotated 15 degrees';
rot.parentStory.appliedFont = 'Helvetica\tBold';
rot.parentStory.pointSize = 20;
rot.rotationAngle = 15;

// cropped linked image
var fr = p1.rectangles.add(content, { geometricBounds: [420, 40, 620, 300], strokeWeight: 0 });
fr.place(File(DIR + '/photo.png'));
fr.graphics[0].geometricBounds = [400, 20, 700, 470];

// rotated image in oval
var ov = p1.ovals.add(content, { geometricBounds: [420, 330, 620, 555], strokeWeight: 3, strokeColor: blue });
ov.place(File(DIR + '/photo.png'));
ov.fit(FitOptions.FILL_PROPORTIONALLY);
ov.rotationAngle = -20;

// missing link
var mf = p1.rectangles.add(content, { geometricBounds: [650, 40, 780, 170], strokeWeight: 0 });
var tmpMissing = File(DIR + '/missing_copy.png');
File(DIR + '/missing.png').copy(tmpMissing);
mf.place(tmpMissing);
mf.fit(FitOptions.PROPORTIONALLY);

// group of shapes
var g1 = p1.ovals.add(content, { geometricBounds: [650, 330, 720, 400], fillColor: red, strokeWeight: 0 });
var g2 = p1.polygons.add(content, { geometricBounds: [650, 420, 720, 490], fillColor: cmykGreen, strokeWeight: 0 });
var grp = p1.groups.add([g1, g2], content);
grp.name = 'Shape group';

// page 2
var pg2 = doc.pages[1];
var t2 = pg2.textFrames.add(content, { geometricBounds: [60, 60, 200, 535] });
t2.contents = 'Second page. Right aligned text.';
t2.parentStory.appliedFont = 'Georgia\tBold';
t2.parentStory.pointSize = 28;
t2.parentStory.justification = Justification.RIGHT_ALIGN;
var hid = pg2.rectangles.add(content, { geometricBounds: [300, 60, 400, 200], fillColor: blue, strokeWeight: 0 });
hid.visible = false;
hid.name = 'Hidden box';

doc.save(File(DIR + '/sample.indd'));
doc.close(SaveOptions.NO);
tmpMissing.remove();
'ok';

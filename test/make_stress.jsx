// Builds test/stress.indd with harder cases.
var DIR = File($.fileName).parent.fsName;
app.scriptPreferences.userInteractionLevel = UserInteractionLevels.NEVER_INTERACT;
var doc = app.documents.add(false);
doc.documentPreferences.facingPages = true;
doc.documentPreferences.pagesPerDocument = 3;
doc.documentPreferences.pageWidth = '200mm';
doc.documentPreferences.pageHeight = '250mm';
doc.viewPreferences.horizontalMeasurementUnits = MeasurementUnits.POINTS;
doc.viewPreferences.verticalMeasurementUnits = MeasurementUnits.POINTS;
doc.viewPreferences.rulerOrigin = RulerOrigin.PAGE_ORIGIN;
var L = doc.layers[0];

// A PDF to link: export the old sample's first page.
var pdfFile = File(DIR + '/linked.pdf');
var s = app.open(File(DIR + '/sample.indd'), false);
app.pdfExportPreferences.pageRange = '1';
s.exportFile(ExportFormat.PDF_TYPE, pdfFile, false);
s.close(SaveOptions.NO);

var p1 = doc.pages[0], p2 = doc.pages[1], p3 = doc.pages[2];
var lorem = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ';
var big = ''; for (var i = 0; i < 14; i++) big += lorem + (i % 3 === 2 ? '\r' : '');

// Threaded story across page 1 -> 2 (2 and 3 are a spread)
var a = p1.textFrames.add(L, { geometricBounds: [60, 40, 300, 520] });
var b = p2.textFrames.add(L, { geometricBounds: [60, 40, 300, 520] });
a.nextTextFrame = b;
a.contents = big;
a.parentStory.appliedFont = 'Georgia\tRegular';
a.parentStory.pointSize = 12;
a.parentStory.justification = Justification.LEFT_JUSTIFIED;
a.parentStory.firstLineIndent = 18;
a.parentStory.spaceAfter = 6;

// Bulleted list
var bl = p1.textFrames.add(L, { geometricBounds: [330, 40, 450, 300] });
bl.contents = 'First item\rSecond item\rThird item';
bl.parentStory.appliedFont = 'Helvetica\tRegular';
bl.parentStory.pointSize = 12;
bl.parentStory.bulletsAndNumberingListType = ListType.BULLET_LIST;

// Table
var tf = p1.textFrames.add(L, { geometricBounds: [480, 40, 600, 400] });
tf.contents = 'x';
var t = tf.texts[0].insertionPoints[0].tables.add({ bodyRowCount: 3, columnCount: 3 });
t.contents = ['A', 'B', 'C', '1', '2', '3', '4', '5', '6'];

// 2-column text, all caps, superscript
var mc = p2.textFrames.add(L, { geometricBounds: [340, 40, 520, 520] });
mc.textFramePreferences.textColumnCount = 2;
mc.contents = 'TWO COLUMN TEXT x2 ' + lorem + lorem + lorem;
mc.parentStory.appliedFont = 'Helvetica\tRegular';
mc.parentStory.pointSize = 11;
mc.parentStory.characters.itemByRange(0, 14).capitalization = Capitalization.ALL_CAPS;
mc.parentStory.characters[18].position = Position.SUPERSCRIPT;

// Linked PDF, rotated, on page 3 (right page of spread)
var pf = p3.rectangles.add(L, { geometricBounds: [60, 60, 400, 360], strokeWeight: 0 });
pf.place(pdfFile);
pf.fit(FitOptions.PROPORTIONALLY);
pf.rotationAngle = 10;

// Empty frames
p3.textFrames.add(L, { geometricBounds: [450, 60, 500, 300] });
p3.rectangles.add(L, { geometricBounds: [520, 60, 600, 300], strokeWeight: 0, fillColor: 'None' });

// Locked item + opacity
var lk = p3.textFrames.add(L, { geometricBounds: [620, 60, 680, 400] });
lk.contents = 'Locked 50% opacity';
lk.parentStory.appliedFont = 'Helvetica\tBold';
lk.parentStory.pointSize = 24;
lk.transparencySettings.blendingSettings.opacity = 50;
lk.locked = true;

doc.save(File(DIR + '/stress.indd'));
doc.close(SaveOptions.NO);
'ok';

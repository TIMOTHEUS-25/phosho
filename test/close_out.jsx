// Closes any PSD from test/out that is open in Photoshop (so tests can overwrite it).
var dir = File($.fileName).parent.fsName + '/out', n = 0;
for (var i = app.documents.length - 1; i >= 0; i--) { try { if (app.documents[i].path.fsName === dir) { app.documents[i].close(SaveOptions.DONOTSAVECHANGES); n++; } } catch (e) {} }
'closed ' + n;

// Shared helpers for InDesign + Photoshop ExtendScript.
// PARAMS is injected above this file by the app.

function J(v) {
    if (v === null || v === undefined) return 'null';
    var t = typeof v;
    if (t === 'number') return isFinite(v) ? String(v) : 'null';
    if (t === 'boolean') return v ? 'true' : 'false';
    if (t === 'string') return Jq(v);
    if (v instanceof Array) {
        var a = [];
        for (var i = 0; i < v.length; i++) a.push(J(v[i]));
        return '[' + a.join(',') + ']';
    }
    var o = [];
    for (var k in v) {
        if (!v.hasOwnProperty(k) || typeof v[k] === 'function') continue;
        o.push(Jq(k) + ':' + J(v[k]));
    }
    return '{' + o.join(',') + '}';
}

function Jq(s) {
    s = String(s);
    var out = '"';
    for (var i = 0; i < s.length; i++) {
        var c = s.charAt(i), n = s.charCodeAt(i);
        if (c === '"') out += '\\"';
        else if (c === '\\') out += '\\\\';
        else if (n < 32 || n > 126) {
            var h = n.toString(16);
            while (h.length < 4) h = '0' + h;
            out += '\\u' + h;
        } else out += c;
    }
    return out + '"';
}

function writeText(path, s) {
    var f = new File(path);
    f.encoding = 'UTF-8';
    f.lineFeed = 'Unix';
    f.open('w');
    f.write(s);
    f.close();
}

function readText(path) {
    var f = new File(path);
    f.encoding = 'UTF-8';
    f.open('r');
    var s = f.read();
    f.close();
    return s;
}

function progress(stage, done, total, msg) {
    if (!PARAMS.progressPath) return;
    try {
        writeText(PARAMS.progressPath, J({ stage: stage, done: done, total: total, msg: msg }));
    } catch (e) {}
}

function finish(obj) {
    writeText(PARAMS.resultPath, J(obj));
}

function errText(e) {
    return (e && e.message ? e.message : String(e)) + (e && e.line ? ' (line ' + e.line + ')' : '');
}

// Runs ExtendScript inside InDesign / Photoshop on macOS (AppleScript) and
// Windows (COM via PowerShell).
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const JSX_DIR = path.join(__dirname, '..', 'jsx').replace('app.asar', 'app.asar.unpacked');
const IS_MAC = process.platform === 'darwin';
const IS_WIN = process.platform === 'win32';

function findApps() {
  const found = { indesign: null, photoshop: null };
  const pick = (re, dirs) => {
    let best = null;
    for (const dir of dirs) {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { continue; }
      for (const n of names) {
        const m = n.match(re);
        if (!m) continue;
        const year = parseInt(m[1], 10) || 0;
        if (!best || year > best.year) best = { name: n, year, dir: path.join(dir, n) };
      }
    }
    return best;
  };
  if (IS_MAC) {
    found.indesign = pick(/^Adobe InDesign (\d{4})$/, ['/Applications']);
    found.photoshop = pick(/^Adobe Photoshop (\d{4})$/, ['/Applications']);
  } else if (IS_WIN) {
    const roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']]
      .filter(Boolean).map((p) => path.join(p, 'Adobe'));
    found.indesign = pick(/^Adobe InDesign (\d{4})$/, roots);
    found.photoshop = pick(/^Adobe Photoshop (\d{4})$/, roots);
  }
  return found;
}

// Escape every non-ASCII char so ExtendScript reads the file the same on any OS.
function asciiJson(v) {
  return JSON.stringify(v).replace(/[\u007f-￿]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

function buildScript(target, scriptName, params) {
  const parts = ['var PARAMS = ' + asciiJson(params) + ';', fs.readFileSync(path.join(JSX_DIR, 'lib.jsx'), 'utf8')];
  if (target === 'indesign') parts.push(fs.readFileSync(path.join(JSX_DIR, 'id_common.jsx'), 'utf8'));
  parts.push(fs.readFileSync(path.join(JSX_DIR, scriptName), 'utf8'));
  return parts.join('\n');
}

function encodedPath(p) {
  // Safe inside both AppleScript and PowerShell string literals.
  return encodeURIComponent(p.replace(/\\/g, '/')).replace(/'/g, '%27');
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.message = (stderr || err.message || '').trim();
        return reject(err);
      }
      resolve(stdout);
    });
  });
}

/**
 * Run a JSX script in the given Adobe app and return the JSON result it wrote.
 * target: 'indesign' | 'photoshop'
 */
async function runJsx(target, scriptName, params, workDir, apps) {
  const resultPath = path.join(workDir, `result_${scriptName}_${Date.now()}.json`);
  const scriptPath = path.join(workDir, `run_${scriptName}`);
  const full = { ...params, resultPath };
  fs.writeFileSync(scriptPath, buildScript(target, scriptName, full), 'utf8');
  const js = `$.evalFile(new File(decodeURIComponent('${encodedPath(scriptPath)}')))`;

  if (IS_MAC) {
    const info = apps[target];
    if (!info) throw new Error(`Adobe ${target === 'indesign' ? 'InDesign' : 'Photoshop'} was not found in /Applications.`);
    const verb = target === 'indesign' ? `do script "${js}" language javascript` : `do javascript "${js}"`;
    const as = `with timeout of 86400 seconds\ntell application "${info.name}"\n${verb}\nend tell\nend timeout`;
    await run('osascript', ['-e', as]);
  } else if (IS_WIN) {
    const jsPs = js.replace(/'/g, "''");
    const prog = target === 'indesign' ? 'InDesign.Application' : 'Photoshop.Application';
    const year = apps[target] && apps[target].year;
    // Try the generic ProgID, then the version-specific one (e.g. InDesign.Application.2027).
    const create = `$a = $null; try { $a = New-Object -ComObject ${prog} } catch {}; ` +
      (year ? `if (-not $a) { $a = New-Object -ComObject ${prog}.${year} }; ` : '') +
      `if (-not $a) { throw 'Could not start ${prog}. Is it installed?' }; `;
    const ps = create + (target === 'indesign'
      ? `[void]$a.DoScript('${jsPs}', 1246973031)`
      : `[void]$a.DoJavaScript('${jsPs}')`);
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps]);
  } else {
    throw new Error('This app runs on macOS and Windows only.');
  }

  if (!fs.existsSync(resultPath)) throw new Error(`${target} script finished without producing a result.`);
  const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
  if (!result.ok) throw new Error(result.error || `${target} script failed.`);
  return result;
}

module.exports = { findApps, runJsx, IS_MAC, IS_WIN };

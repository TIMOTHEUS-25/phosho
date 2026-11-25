const path = require('path');
const { Session } = require('../src/converter');
(async () => {
  const s = new Session(path.join(__dirname, 'psdlayers.indd'));
  await s.analyze();
  const r = await s.convert({ pageIndexes: [0], relinks: [], outPath: path.join(__dirname, 'out', 'psdlayers.psd'), dpi: 300 });
  console.log('layers', r.layers, 'warnings', r.warnings);
  if (r.debug) console.log(r.debug.join('\n'));
  if (process.env.IDPS_KEEP_TEMP) console.log('kept', s.dir); else s.dispose();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });

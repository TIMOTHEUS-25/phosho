const path = require('path');
const { Session } = require('../src/converter');
(async () => {
  const s = new Session(path.join(__dirname, 'layers.indd'));
  await s.analyze();
  const r = await s.convert({ pageIndexes: [0], relinks: [], outPath: path.join(__dirname, 'out', 'layers.psd'), dpi: 300 });
  console.log('layers', r.layers, 'warnings', r.warnings);
  s.dispose();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });

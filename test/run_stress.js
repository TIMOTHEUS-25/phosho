const path = require('path');
const { Session } = require('../src/converter');
(async () => {
  const s = new Session(path.join(__dirname, 'stress.indd'));
  const a = await s.analyze();
  console.log('pages', a.pages.map((p) => `${p.name}:${p.side}:${p.spread}`).join(' '), 'links', a.links.map((l) => l.name + ':' + l.status).join(' '));
  const pages = process.argv[2] ? process.argv[2].split(',').map(Number) : a.pages.map((p) => p.index);
  const r = await s.convert({ pageIndexes: pages, relinks: [], outPath: path.join(__dirname, 'out', 'stress.psd'), dpi: 300 });
  console.log(JSON.stringify(r, null, 1));
  if (process.env.IDPS_DEBUG) console.log((r.debug || []).join('\n'));
  s.dispose();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });

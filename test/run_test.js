const path = require('path');
const { Session } = require('../src/converter');
(async () => {
  const s = new Session(path.join(__dirname, 'sample.indd'));
  const t0 = Date.now();
  const a = await s.analyze((p) => console.log('  progress', p.msg, p.done, '/', p.total));
  console.log('ANALYZE', JSON.stringify({ pages: a.pages, links: a.links, fonts: a.fonts, apps: a.apps }, null, 1));
  console.log('took', (Date.now() - t0) / 1000, 's');
  if (process.argv[2] === 'analyze') return s.dispose();
  const r = await s.convert({
    pageIndexes: a.pages.map((p) => p.index),
    relinks: process.argv[2] === 'relink' ? a.links.filter((l) => l.status === 'missing').map((l) => ({ id: l.id, name: l.name, path: path.join(__dirname, 'missing.png') })) : [],
    outPath: path.join(__dirname, 'out', 'sample.psd'), dpi: 300, openWhenDone: true,
  }, (p) => console.log('  progress', p.stage, p.msg, p.done, '/', p.total));
  if (process.env.KEEP) console.log('DIR', s.dir); else s.dispose();
  console.log('CONVERT', JSON.stringify(r, null, 1));
  console.log('took', (Date.now() - t0) / 1000, 's');
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });

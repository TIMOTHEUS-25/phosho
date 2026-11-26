// Size option + PSB fallback on sample.indd (page 1 is A4: 2480 x 3508 px at 300 ppi).
//   node test/run_size.js            -> 50% (out/size50.psd) and 1080 px high (out/size1080h.psd)
//   IDPS_SIMULATE_SAVE_FAIL=1 node test/run_size.js fail   -> PSD save fails, must fall back to out/sizefail.psb
const path = require('path');
const { Session } = require('../src/converter');
(async () => {
  const s = new Session(path.join(__dirname, 'sample.indd'));
  const a = await s.analyze();
  const pg = a.pages[0], fullH = Math.round(pg.height * 300 / 72);
  const runs = process.argv[2] === 'fail'
    ? [{ out: 'sizefail.psd', scale: 1 }]
    : [{ out: 'size50.psd', scale: 0.5, scaleBy: 'width' }, { out: 'size1080h.psd', scale: 1080 / fullH, scaleBy: 'height' }];
  for (const r of runs) {
    const res = await s.convert({ pageIndexes: [0], relinks: [], outPath: path.join(__dirname, 'out', r.out), dpi: 300, openWhenDone: false, scale: r.scale, scaleBy: r.scaleBy });
    console.log(r.out, '->', path.basename(res.outPath), 'layers', res.layers, 'warnings', JSON.stringify(res.warnings.filter((w) => !/missing link/.test(w))));
  }
  s.dispose();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });

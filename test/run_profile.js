// Converts sample.indd with a brand colour profile (CMYK -> brand RGB).
// Check the result with: test/check_colours.jsx (run in Photoshop on out/profile.psd).
const path = require('path');
const { Session } = require('../src/converter');
const PROFILE = {
  name: 'Test CI',
  colors: [
    { name: 'Brand Green', cmyk: [80, 0, 100, 0], rgb: [0, 155, 72] },
    { name: 'Brand Black', cmyk: [0, 0, 0, 100], rgb: [29, 29, 27] },
    { name: 'Red', cmyk: null, rgb: [1, 2, 3] }, // "Red" is an RGB swatch: must NOT be remapped
    { name: 'c=100 m=90 y=10 k=0', cmyk: null, rgb: [9, 9, 9] }, // name-only row (like PANTONE rows): matches by swatch name, any case
  ],
};
(async () => {
  const s = new Session(path.join(__dirname, 'sample.indd'));
  const a = await s.analyze();
  console.log('doc colours', a.colors.map((c) => `${c.name || '(unnamed)'}:${c.space}:${c.value}`).join(' | '));
  const r = await s.convert({ pageIndexes: [0], relinks: [], outPath: path.join(__dirname, 'out', 'profile.psd'), dpi: 300, openWhenDone: false, colourProfile: PROFILE });
  console.log('layers', r.layers, 'colourProfile', JSON.stringify(r.colourProfile), 'warnings', r.warnings);
  if (process.env.IDPS_KEEP_TEMP) console.log('kept', s.dir); else s.dispose();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });

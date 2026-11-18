// Compare two mobile-audit2 logs route by route: off, cut, small (lower is better).
const fs = require('fs');
const parse = (f) => {
   const m = new Map();
   for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
      const r = l.match(/^(\S+) (\S+) docW=(\d+) off=(\d+) cut=(\d+) small=(\d+)\/(\d+) zoom=(\d+)/);
      if (r) m.set(r[1], { path: r[2], docW: +r[3], off: +r[4], cut: +r[5], small: +r[6], total: +r[7], zoom: +r[8] });
   }
   return m;
};
const [a, b] = [parse(process.argv[2]), parse(process.argv[3])];
let worse = 0, better = 0;
const rows = [];
for (const [k, x] of a) {
   const y = b.get(k);
   if (!y) { rows.push(`${k}: missing after`); continue; }
   const d = ['docW', 'off', 'cut', 'small', 'zoom'].map((f) => [f, x[f], y[f]]).filter(([, p, q]) => p !== q);
   if (!d.length) continue;
   const w = d.some(([f, p, q]) => (f === 'docW' ? q > p : q > p));
   const g = d.some(([f, p, q]) => q < p);
   if (w) worse++;
   if (g && !w) better++;
   rows.push(`${w ? 'WORSE ' : g ? 'better' : 'same  '} ${k}: ` + d.map(([f, p, q]) => `${f} ${p}->${q}`).join(', '));
}
console.log(rows.join('\n'));
console.log(`routes ${a.size}/${b.size}, better ${better}, worse ${worse}`);

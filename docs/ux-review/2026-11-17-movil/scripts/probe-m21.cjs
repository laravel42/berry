// M2.1 filter bars without fixed height. Usage: node probe-m21.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm21';
fs.mkdirSync(dir, { recursive: true });
const sizes = [[390, 844], [360, 780], [1440, 900]];
const pages = ['/berry/projects', '/berry/agents', '/berry/settings/logs'];

(async () => {
   for (const [w, h] of sizes) {
      const s = await open(w, h);
      try {
         for (const p of pages) {
            await s.go(p, 8000);
            await s.page.waitForSelector('[class*="48px"]', { timeout: 30000 }).catch(() => {});
            const r = await s.page.evaluate(() => {
               const bar = [...document.querySelectorAll('main div, div')].find(
                  (d) => /\b(min-)?h-\[48px\]/.test(d.className?.toString() || '') && /border-b/.test(d.className.toString()) && d.getBoundingClientRect().width > 300
               );
               if (!bar) return { err: 'no bar' };
               const b = bar.getBoundingClientRect();
               const br = bar.getBoundingClientRect().bottom;
               // first row-like element below the bar in document order
               const rows = [...document.querySelectorAll('tr, [role=row], [role=listitem], li, a[href]')].filter(
                  (e) => !bar.contains(e) && e.getBoundingClientRect().top >= b.top + 1 && e.getBoundingClientRect().height > 20 && e.getBoundingClientRect().left >= 0 && (bar.compareDocumentPosition(e) & 4) && !e.closest('nav,aside,header,[data-sidebar]')
               );
               const row = rows[0];
               const rr = row?.getBoundingClientRect();
               // bar content bottom: max bottom of children
               const kids = [...bar.querySelectorAll('*')].map((k) => k.getBoundingClientRect()).filter((k) => k.height);
               const cb = Math.max(...kids.map((k) => k.bottom));
               return {
                  bar: [b.top, b.bottom, b.height].map(Math.round),
                  contentBottom: Math.round(cb),
                  row: rr ? { tag: row.tagName, top: Math.round(rr.top), bottom: Math.round(rr.bottom) } : null,
                  overlapRow: rr ? cb > rr.top + 1 : null,
                  contentOverflowsBar: cb > br + 1,
               };
            });
            console.log(w, p, JSON.stringify(r));
            await s.shot(`${dir}/m21-${p.split('/').pop()}-${w}.png`);
         }
      } finally {
         await s.browser.close();
      }
   }
})();

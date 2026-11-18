// M2.5 logs rows. Usage: node probe-m25.cjs <outDir> [shot]
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm25';
const shot = process.argv[3] === 'shot';
fs.mkdirSync(dir, { recursive: true });
(async () => {
   const out = {};
   for (const [w, h] of [[390, 844], [360, 780], [820, 1000], [1440, 900]]) {
      const themes = shot && w === 390 ? ['light', 'dark'] : ['light'];
      for (const theme of themes) {
         const s = await open(w, h, theme);
         try {
            await s.go('/berry/settings/logs', 1500);
            await s.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
            await s.page.waitForTimeout(800);
            const r = await s.page.evaluate(() => {
               const vw = document.documentElement.clientWidth;
               const vis = (e) => e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
               const chk = (e) => {
                  if (!e) return null;
                  const b = e.getBoundingClientRect();
                  return { t: e.textContent.trim().slice(0, 28), inView: b.left >= -1 && b.right <= vw + 1, clipped: e.scrollWidth > e.clientWidth + 1 };
               };
               const table = document.querySelector('table');
               const tableVisible = vis(table);
               const cards = [...document.querySelectorAll('[data-log-card]')].filter(vis);
               let rows;
               if (tableVisible) {
                  rows = [...table.querySelectorAll('tbody tr')].slice(0, 3).map((tr) => {
                     const td = tr.children;
                     return { when: chk(td[0]), purpose: chk(td[1]), model: chk(td[3]), status: chk(td[7]) };
                  });
               } else {
                  rows = cards.slice(0, 3).map((c) => {
                     const f = (n) => c.querySelector(`[data-f="${n}"]`);
                     return { when: chk(f('when')), purpose: chk(f('purpose')), model: chk(f('model')), status: chk(f('status')) };
                  });
               }
               const scroller = (table || document.body).closest('.overflow-auto');
               return {
                  vw, docW: document.documentElement.scrollWidth, tableVisible, cards: cards.length,
                  tableW: table ? table.scrollWidth : null, scrollerSW: scroller ? scroller.scrollWidth : null, scrollerCW: scroller ? scroller.clientWidth : null,
                  off: window.__off().offCount, offList: window.__off().off, rows,
                  rects: tableVisible ? [...table.querySelectorAll('thead th, tbody tr:nth-child(-n+3) td')].map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10); }) : null,
               };
            });
            const key = w + (theme === 'dark' ? 'd' : '');
            out[key] = r;
            console.log(key, JSON.stringify({ ...r, rects: r.rects && r.rects.length, rows: undefined }));
            for (const x of r.rows) console.log('  ', JSON.stringify(x));
            if (shot && w === 390) await s.page.screenshot({ path: `${dir}/logs-390-${theme}.png` });
         } finally { await s.browser.close(); }
      }
   }
   fs.writeFileSync(dir + '/result.json', JSON.stringify(out, null, 1));
})();

// M2.7b project side panel. Usage: node probe-m27b.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm27b';
fs.mkdirSync(dir, { recursive: true });
const sizes = [[390, 844], [820, 1180], [1280, 900], [1440, 900]];
const state = (page) =>
   page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
      const aside = document.querySelector('aside[data-detail-sidebar]');
      const header = [...document.querySelectorAll('button')].filter((b) => /^(Insights|Properties)$/.test(b.getAttribute('aria-label') || '') && b.getBoundingClientRect().width > 0).map((b) => ({ l: b.getAttribute('aria-label'), r: r(b), p: b.getAttribute('aria-pressed') }));
      const hd = document.querySelector('[class*="h-[52px]"]'); return { header: hd ? r(hd) : null, aside: aside ? r(aside) : null, buttons: header, vw: innerWidth, off: window.__off && window.__off() };
   });
(async () => {
   for (const [w, h] of sizes) {
      const s = await open(w, h);
      try {
         await s.go('/berry/projects', 8000);
         const ph = await s.page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((x) => /\/project\/[^/]+/.test(x)));
         const base = ph.replace(/\/(overview|issues|activity)$/, '');
         await s.go(base + '/issues', 9000);
         console.log(w, 'initial', JSON.stringify(await state(s.page)));
         if (w === 390) await s.shot(`${dir}/closed.png`);
         for (const name of ['Properties', 'Properties', 'Insights', 'Insights']) {
            const b = s.page.getByRole('button', { name, exact: true }).first();
            if (!(await b.isVisible().catch(() => false))) { console.log(w, 'no button', name); continue; }
            await b.click();
            await s.page.waitForTimeout(700);
            console.log(w, 'tap', name, JSON.stringify(await state(s.page)));
            if (w === 390) await s.shot(`${dir}/tap-${name}-${Date.now() % 100000}.png`);
         }
      } finally { await s.browser.close(); }
   }
})();

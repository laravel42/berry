// M2.4 members rows. Usage: node probe-m24.cjs <outDir> [shot]
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm24';
const shot = process.argv[3] === 'shot';
fs.mkdirSync(dir, { recursive: true });
(async () => {
   const out = {};
   for (const [w, h] of [[390, 844], [360, 780], [1440, 900]]) {
      const s = await open(w, h);
      try {
         for (const p of ['members', 'join-links']) {
            await s.go('/berry/settings/' + p, 1500);
            await s.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
            await s.page.waitForTimeout(500);
            const r = await s.page.evaluate(() => {
               const lines = (e) => { if (!e) return null; const lh = parseFloat(getComputedStyle(e).lineHeight) || 16; return Math.round(e.getBoundingClientRect().height / lh); };
               const rows = [...document.querySelectorAll('.settings-surface [class*="py-3"][class*="px-4"], .settings-surface [class*="px-4"][class*="py-3.5"]')]
                  .filter((e) => e.querySelector('[data-settings-type="caption"]'));
               return {
                  rows: rows.map((row) => {
                     const name = row.querySelector('a[href*="/members/"]') || row.querySelector('.font-medium');
                     const cap = row.querySelector('[data-settings-type="caption"]');
                     const first = cap && cap.firstElementChild;
                     const emailEl = first || cap;
                     const btns = [...row.querySelectorAll('button,[role=combobox]')].map((b) => ({ label: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 24), ...window.__hit(b) }));
                     const r = row.getBoundingClientRect();
                     return {
                        name: name && name.textContent.trim().slice(0, 30), nameLines: lines(name), nameTrunc: name && name.scrollWidth > name.clientWidth + 1,
                        emailLines: lines(emailEl), emailTrunc: emailEl && emailEl.scrollWidth > emailEl.clientWidth + 1,
                        row: [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 10) / 10), btns,
                     };
                  }),
                  off: window.__off().offCount,
               };
            });
            (out[w] ||= {})[p] = r;
            console.log(w, p, 'rows', r.rows.length, 'off', r.off);
            for (const x of r.rows) console.log('  ', JSON.stringify({ n: x.name, nl: x.nameLines, nt: x.nameTrunc, el: x.emailLines, et: x.emailTrunc, row: x.row, btns: x.btns.map((b) => `${b.label}|${b.rect}|${b.inView}|${b.hittable}`) }));
            if (shot && w === 390) await s.page.screenshot({ path: `${dir}/${p}-390.png`, fullPage: true });
         }
      } finally { await s.browser.close(); }
   }
   fs.writeFileSync(dir + '/result.json', JSON.stringify(out, null, 1));
})();

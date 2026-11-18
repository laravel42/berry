// M2.2 settings stack. Usage: node probe-m22.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm22';
fs.mkdirSync(dir, { recursive: true });
const pages = 'ai connected-accounts general integrations issue-labels issue-properties join-links logs mcp members model-tiers notifications organization plugins preferences profile project-statuses quick-actions repositories runtimes security shortcuts skill-labels tokens usage'.split(' ');
const sizes = [[390, 844], [360, 780], [1440, 900]];
(async () => {
   const out = {};
   for (const [w, h] of sizes) {
      const s = await open(w, h);
      try {
         for (const p of pages) {
            try {
               await s.go('/berry/settings/' + p, 1500);
               await s.page.waitForLoadState('networkidle', { timeout: 4000 }).catch(() => {});
               await s.page.waitForTimeout(500);
               const r = await s.page.evaluate((wide) => {
                  const root = document.querySelector('.settings-surface');
                  const descs = [...(root || document).querySelectorAll('[data-settings-type="caption"], p')].filter((e) => e.getBoundingClientRect().width > 0 && e.closest('[class*="divide-y"], .settings-surface'));
                  let worst = null;
                  for (const d of descs) {
                     const r = d.getBoundingClientRect();
                     const words = (d.textContent || '').trim().split(/\s+/).filter(Boolean).length;
                     if (words < 2) continue;
                     const lh = parseFloat(getComputedStyle(d).lineHeight) || 16;
                     const lines = Math.round(r.height / lh);
                     if (!worst || r.width < worst.width) worst = { width: Math.round(r.width), words, lines, flag: words >= 4 && lines >= words * 0.6 };
                  }
                  const off = window.__off();
                  const res = { worst, off: off.offCount, offEx: off.off.slice(0, 2) };
                  if (wide) res.rows = [...(root || document).querySelectorAll('[class*="px-4"][class*="py-3.5"], [class*="min-h-[42px]"]')].map((e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10); });
                  return res;
               }, w >= 1024);
               (out[w] ||= {})[p] = r;
               console.log(w, p, JSON.stringify({ ...r, rows: r.rows?.length }));
            } catch (e) { console.log(w, p, 'ERR', e.message.slice(0, 80)); }
         }
      } finally { await s.browser.close(); }
   }
   fs.writeFileSync(dir + '/result.json', JSON.stringify(out, null, 1));
})();

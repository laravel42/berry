// M2.3 settings header. Usage: node probe-m23.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm23';
fs.mkdirSync(dir, { recursive: true });
const pages = (process.env.PAGES || 'ai connected-accounts general integrations issue-labels issue-properties join-links logs mcp members model-tiers notifications organization plugins preferences profile project-statuses quick-actions repositories runtimes security shortcuts skill-labels tokens usage').split(' ');
const sizes = process.env.W ? [[+process.env.W, 900]] : [[390, 844], [360, 780], [1440, 900]];
(async () => {
   const out = {};
   for (const [w, h] of sizes) {
      const s = await open(w, h);
      try {
         for (const p of pages) {
            try {
               await s.go('/berry/settings/' + p, 1200);
               await s.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
               const r = await s.page.evaluate(() => {
                  const h1 = document.querySelector('h1');
                  const bar = h1 && h1.parentElement.parentElement;
                  if (!bar) return { err: 'no header bar', h1: h1?.textContent };
                  const vw = document.documentElement.clientWidth;
                  const rc = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((n) => Math.round(n * 10) / 10); };
                  const items = [];
                  const clipped = [];
                  for (const e of [bar, ...bar.querySelectorAll('*')]) {
                     const b = e.getBoundingClientRect();
                     if (!b.width) continue;
                     const cs = getComputedStyle(e);
                     const own = [...e.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ');
                     if (own) items.push({ tag: e.tagName.toLowerCase(), text: own, rect: rc(e) });
                     if (b.right > vw + 1 || b.left < -1) clipped.push('overflowVp ' + e.tagName + ' ' + own);
                     if (e.scrollWidth > e.clientWidth + 1 && cs.textOverflow !== 'ellipsis' && cs.display !== 'inline') clipped.push('clip ' + e.tagName + ' ' + own + ' ' + e.scrollWidth + '>' + e.clientWidth);
                     if (cs.textOverflow === 'ellipsis' && e.scrollWidth > e.clientWidth + 1) clipped.push('ellipsized ' + own);
                  }
                  const trig = bar.querySelector('button[aria-haspopup]');
                  return { bar: rc(bar), items, clipped, selector: trig?.textContent.trim() ?? null, selRect: trig ? rc(trig) : null, docW: document.documentElement.scrollWidth, vw };
               });
               (out[w] ||= {})[p] = r;
               console.log(w, p, r.err || `${r.selector} | ${r.items.map((i) => i.text).join(' / ')} | ${r.clipped.join('; ')}`);
               if (process.env.SHOT && ['preferences', 'organization', 'repositories'].includes(p) && w === 390) await s.page.screenshot({ path: `${dir}/${p}-390.png` });
            } catch (e) { console.log(w, p, 'ERR', e.message.slice(0, 80)); }
         }
      } finally { await s.browser.close(); }
   }
   fs.writeFileSync(dir + '/result.json', JSON.stringify(out, null, 1));
})();

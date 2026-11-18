const { open } = require('./probe-lib.cjs');
const tag = process.argv[2] || 'x';
(async () => {
   for (const [w, h] of [[1440, 900], [390, 844], [360, 780], [320, 700]]) {
      const s = await open(w, h);
      await s.go('/berry/loops', 8000);
      const r = await s.page.evaluate(() => {
         const vw = document.documentElement.clientWidth;
         const dl = document.querySelector('dl');
         const sc = dl && { scrollW: dl.scrollWidth, clientW: dl.clientWidth, wrap: getComputedStyle(dl).flexWrap, ov: getComputedStyle(dl).overflowX, mask: getComputedStyle(dl).maskImage };
         const kpis = dl ? [...dl.children].map((c) => { const b = c.getBoundingClientRect(); return { t: c.textContent.trim().slice(0, 14), r: [b.left, b.top, b.right, b.bottom].map(Math.round), full: b.left >= 0 && b.right <= vw }; }) : [];
         const att = document.querySelector('#loops-attention');
         const rows = att ? [...att.parentElement.querySelectorAll('li')].map((li) => {
            const b = li.getBoundingClientRect();
            const sp = li.querySelector('a span');
            const sb = sp.getBoundingClientRect();
            return { r: [b.left, b.top, b.right, b.bottom].map(Math.round), name: sp.textContent, nameRect: [sb.left, sb.top, sb.right, sb.bottom].map(Math.round), visibleChars: sp.scrollWidth > sp.clientWidth + 1 ? 'truncated' : 'full', cw: sp.clientWidth, sw: sp.scrollWidth };
         }) : 'no attention';
         return { sc, kpis, rows };
      });
      console.log(w, JSON.stringify(r));
      if (w < 1000) console.log('off', JSON.stringify(await s.page.evaluate(() => window.__off())));
      await s.shot(`m34-${tag}-${w}.png`);
      await s.browser.close();
   }
})();

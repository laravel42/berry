const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const tag = process.argv[2] || 'run';
(async () => {
   const out = {};
   for (const [w, h] of [[1440, 900], [640, 900], [390, 844], [360, 740], [320, 640]]) {
      const s = await open(w, h);
      await s.go('/berry/cycles', 8000);
      out[w] = await s.page.evaluate(() => {
         const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10); };
         const stats = [...document.querySelectorAll('dl')].map((dl) => [...dl.children].map((c) => ({ t: c.textContent.trim().slice(0, 20), r: r(c), dt: r(c.querySelector('dt')) })));
         const sc = [...document.querySelectorAll('*')].filter((e) => { const o = getComputedStyle(e).overflowX; return (o === 'auto' || o === 'scroll') && e.scrollWidth > e.clientWidth + 1; }).map((e) => ({ tag: e.tagName, cls: String(e.className).slice(0, 40), sw: e.scrollWidth, cw: e.clientWidth }));
         const sections = [...document.querySelectorAll('section')].map((e) => ({ id: e.getAttribute('aria-labelledby'), r: r(e) }));
         const hints = document.querySelectorAll('[data-scroll-hint]').length;
         const timeline = [...document.querySelectorAll('#cycles-timeline ~ *, section[aria-labelledby=cycles-timeline] a')].map((e) => r(e));
         const rows = [...document.querySelectorAll('[role=row]')].map((e) => r(e));
         return { stats, sc, sections, hints, timeline, rows, off: window.__off() };
      });
      await s.shot(`m35-${tag}-${w}.png`);
      await s.browser.close();
   }
   fs.writeFileSync(`m35-${tag}.json`, JSON.stringify(out, null, 1));
   for (const w of Object.keys(out)) { const o = out[w]; console.log(w, 'sc', JSON.stringify(o.sc), 'hints', o.hints, 'off', o.off.offCount, o.off.docW, JSON.stringify(o.stats.map((s) => s.map((x) => x.dt)))); }
})();

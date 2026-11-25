const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const tag = process.argv[2] || 'run';
(async () => {
   const out = {};
   for (const [w, h] of [[1440, 900], [390, 844], [360, 740]]) {
      const s = await open(w, h);
      await s.go('/berry/agents', 8000);
      const hrefs = await s.page.evaluate(() => [...new Set([...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).filter((h) => /\/agents\/[^/?]+$/.test(h.split('?')[0])))].slice(0, 3));
      out[w] = { hrefs: hrefs.length, agents: [] };
      for (const [i, href] of hrefs.entries()) {
         await s.go(href, 7000);
         const info = await s.page.evaluate(() => {
            const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10); };
            const tabs = [...document.querySelectorAll('[role=tab]')];
            const list = tabs[0]?.closest('[role=tablist]');
            const scroller = list?.parentElement;
            const notes = [...document.querySelectorAll('p')].filter((p) => p.querySelector('svg') && /border-border\/70/.test(p.className)).map((p) => ({ r: r(p), sw: p.scrollWidth, cw: p.clientWidth, span: r(p.querySelector('span')), t: p.textContent.trim().slice(0, 40) }));
            const chips = [...document.querySelectorAll('span')].filter((e) => /border-status-warning\/40/.test(e.className)).map((e) => ({ r: r(e), sw: e.scrollWidth, cw: e.clientWidth }));
            const tiers = [...document.querySelectorAll('[role=radio]')].map((b) => { const sp = b.querySelector('span'); return { r: r(b), name: sp?.textContent, vis: sp ? Math.round(sp.clientWidth) : 0, full: sp ? sp.scrollWidth : 0 }; });
            const sc = scroller ? { r: r(scroller), sw: scroller.scrollWidth, cw: scroller.clientWidth, left: scroller.scrollLeft, after: getComputedStyle(scroller, '::after').width, mask: getComputedStyle(scroller).maskImage.slice(0, 40) } : null;
            return { tabs: tabs.map((t) => ({ l: t.textContent, r: r(t), sel: t.getAttribute('aria-selected') })), sc, notes, chips, tiers, off: window.__off() };
         });
         // open the General tab (tiers) if present
         info.url = href;
         out[w].agents.push(info);
         if (i === 0) await s.shot(`m38-${tag}-${w}.png`);
      }
      await s.browser.close();
   }
   fs.writeFileSync(`m38-${tag}.json`, JSON.stringify(out, null, 1));
   console.log(JSON.stringify(out).slice(0, 6000));
})();

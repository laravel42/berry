const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const tag = process.argv[2] || 'run';
(async () => {
   const out = {};
   for (const [w, h] of [[1440, 900], [390, 844], [360, 740]]) {
      const s = await open(w, h);
      await s.go('/berry/cycles', 8000);
      const href = await s.page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => /\/cycle\/[^/?]+$/.test(h)));
      if (!href) { console.log(w, 'no cycle link'); await s.shot(`m37-${tag}-${w}-list.png`); await s.browser.close(); continue; }
      await s.go(href, 8000);
      const info = await s.page.evaluate(() => {
         const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10); };
         const nav = [...document.querySelectorAll('nav')].find((n) => n.querySelector('[aria-current=page]') && n.getBoundingClientRect().left >= 0 && n.getBoundingClientRect().top < 60);
         const header = nav.parentElement;
         const spans = [...nav.querySelectorAll('[aria-current=page]')].map((e) => ({ t: e.textContent.trim().slice(0, 24), r: r(e) }));
         const ctrls = [...document.querySelectorAll('button,a[href],[role=button]')].filter((e) => e.getBoundingClientRect().width).filter((e) => !e.closest('aside[data-sidebar],[data-sidebar]'));
         const small = ctrls.map((e) => {
            const b = e.getBoundingClientRect();
            const a = getComputedStyle(e, '::after');
            let w = b.width, h = b.height;
            if (a.position === 'absolute' && a.content !== 'none') { w = parseFloat(a.width) || w; h = parseFloat(a.height) || h; }
            return { l: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30), w: Math.round(w), h: Math.round(h) };
         }).filter((x) => x.w < 24 || x.h < 24);
         const rows = [...document.querySelectorAll('li.group')].slice(0, 3).map((li) => {
            const btn = li.querySelector('button[aria-label]');
            const av = btn?.parentElement.querySelector('span[title]');
            const ln = li.querySelector("a[href*=issue]"); const tt = ln ? { w: Math.round(ln.clientWidth), chars: Math.round(ln.clientWidth / (ln.scrollWidth / ln.textContent.length)), len: ln.textContent.length } : null;
            return { tt, btn: btn && r(btn), av: av && r(av), avOp: av && getComputedStyle(av).opacity, row: r(li) };
         });
         const ov = rows.map((x) => x.btn && x.av && Math.max(0, Math.min(x.btn[2], x.av[2]) - Math.max(x.btn[0], x.av[0])) * Math.max(0, Math.min(x.btn[3], x.av[3]) - Math.max(x.btn[1], x.av[1])));
         const lines = Math.round((nav.getBoundingClientRect().height) / 20);
         return { ov, avVis: rows.map((x) => x.avOp), lines, hdrH: header.getBoundingClientRect().height, header: r(header), spans, small, rows, hdrBtns: [...header.querySelectorAll('button')].map((b) => ({ l: b.textContent.trim() || b.getAttribute('aria-label'), r: r(b) })), off: window.__off() };
      });
      out[w] = info;
      await s.shot(`m37-${tag}-${w}.png`);
      if (w < 1000 && tag !== 'before') {
         const mb = await s.page.$('button[aria-label="More actions"]');
         if (mb) { await mb.click(); await s.page.waitForTimeout(500); out[w].menu = await s.page.evaluate(() => [...document.querySelectorAll('[role=menuitem]')].map((i) => i.textContent.trim())); await s.shot(`m37-${tag}-${w}-menu.png`); }
      }
      await s.browser.close();
   }
   fs.writeFileSync(`m37-${tag}.json`, JSON.stringify(out, null, 1));
   console.log(JSON.stringify(out));
})();

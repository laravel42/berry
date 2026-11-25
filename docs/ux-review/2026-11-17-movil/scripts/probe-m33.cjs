const { open } = require('./probe-lib.cjs');
(async () => {
   for (const w of [1440, 390, 360]) {
      const s = await open(w, 844);
      await s.go('/berry/views', 8000);
      const r = await s.page.evaluate(() => {
         const rows = [...document.querySelectorAll('a[href*="/view/"]')].filter((a) => a.parentElement.querySelector('button[aria-label$="menu"]'));
         const R = (e) => e && [...Object.values(e.getBoundingClientRect().toJSON())].slice(0, 4).map((v) => Math.round(v * 10) / 10);
         return {
            n: rows.length,
            rows: rows.map((a) => {
               const nm = a.querySelector('span.font-medium');
               const own = a.lastElementChild;
               return { name: nm?.textContent, nameRect: R(nm), vis: nm?.clientWidth, full: nm?.scrollWidth, ownerRect: R(own), ownerText: own?.textContent, avatar: R(own?.querySelector('span')) };
            }),
            off: window.__off().offCount,
         };
      });
      console.log(w, JSON.stringify(r, null, 1));
      await s.page.screenshot({ path: `m33-${w}.png` });
      await s.browser?.close();
   }
})();

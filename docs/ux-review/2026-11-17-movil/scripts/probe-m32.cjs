const { open } = require('./probe-lib.cjs');
(async () => {
   for (const w of [390, 320, 1440]) {
      const s = await open(w, w > 700 ? 900 : 844);
      await s.go('/berry/runs', 8000);
      const r = await s.page.evaluate(() => {
         const cards = [...document.querySelectorAll('[data-run-card]')];
         const vis = (e) => e.getClientRects().length > 0;
         const overlap = (a, b) => { const x = a.getBoundingClientRect(), y = b.getBoundingClientRect(); return x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5; };
         let ov = 0;
         for (const c of cards) { const f = [...c.querySelectorAll('button,[data-f]')].filter(vis); for (let i = 0; i < f.length; i++) for (let j = i + 1; j < f.length; j++) if (!f[i].contains(f[j]) && !f[j].contains(f[i]) && overlap(f[i], f[j])) ov++; }
         const ths = [...document.querySelectorAll('th')].filter(vis);
         let thov = 0; for (let i = 0; i < ths.length; i++) for (let j = i + 1; j < ths.length; j++) if (overlap(ths[i], ths[j])) thov++;
         return { cards: cards.length, cardsVisible: cards.filter(vis).length, tableVisible: !!document.querySelector('table') && vis(document.querySelector('table')), rows: document.querySelectorAll('tbody tr').length, ov, thov, off: window.__off ? window.__off().length : 'n/a', sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      console.log(w, JSON.stringify(r));
      await s.browser.close();
   }
})();

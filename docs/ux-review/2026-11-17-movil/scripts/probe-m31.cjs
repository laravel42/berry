const { open } = require('./probe-lib.cjs');
(async () => {
   for (const w of [390, 360, 1440]) {
      const s = await open(w, w === 1440 ? 900 : 844);
      await s.go('/berry/tasks', 8000);
      const r = await s.page.evaluate(() => {
         const out = [];
         for (const b of document.querySelectorAll('main button[aria-haspopup="listbox"]')) {
            let row = b;
            while (row && !row.querySelector('a[href*="/issue/"]')) row = row.parentElement;
            if (!row) continue;
            const a = row.querySelector('a[href*="/issue/"]');
            const t = a.querySelector('span.truncate');
            if (!t || row.querySelectorAll('a[href*="/issue/"]').length !== 1) continue;
            const br = b.getBoundingClientRect();
            if (!br.width) continue;
            const chars = t.scrollWidth > t.clientWidth ? Math.floor((t.textContent.length * t.clientWidth) / t.scrollWidth) : t.textContent.length;
            const nameEl = b.querySelector('span:not(.relative):not(.sr-only)');
            out.push({ title: t.textContent.slice(0, 28), len: t.textContent.length, titleW: Math.round(t.getBoundingClientRect().width), chars, label: b.getAttribute('aria-label'), nameVisible: !!nameEl && getComputedStyle(nameEl).display !== 'none' && nameEl.textContent.length > 3, assignee: [br.left, br.top, br.width, br.height].map((n) => Math.round(n * 10) / 10) });
         }
         return out;
      });
      for (const x of r.slice(0, 12)) console.log(w, JSON.stringify(x));
      const off = await s.page.evaluate(() => window.__off());
      const long = r.filter((x) => x.len >= 20);
      console.log(w, 'rows', r.length, 'longTitleRows', long.length, 'min chars among long', Math.min(...long.map((x) => x.chars)), 'offCount', off.offCount, 'docW', off.docW);
      await s.shot(`probe-m31-${w}.png`);
      await s.browser.close();
   }
})();

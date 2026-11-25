// M1.8 page header, M1.9 selection checkbox on touch, M1.10 filter value panel.
// Usage: node probe-m1810.cjs <outDir> [only: m18|m19|m110]
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm1810';
const only = process.argv[3] || '';
fs.mkdirSync(dir, { recursive: true });
const sizes = [
   [390, 844],
   [360, 780],
   [1440, 900],
];

(async () => {
   for (const [w, h] of sizes) {
      const s = await open(w, h);
      const hit = (src, scope) => s.page.evaluate(([src, scope]) => window.__hitBy(src, scope), [src, scope]);
      try {
         if (!only || only === 'm18') {
            for (const [p, re] of [
               ['/berry/cycles', 'new cycle'],
               ['/berry/loops', 'new loop'],
               ['/berry/agents', 'new agent|agent catalog'],
               ['/berry/skills', 'new skill|skills catalog'],
               ['/berry/projects', 'new project'],
               ['/berry/tasks', 'new task'],
            ]) {
               await s.go(p);
               const h1 = await s.page.evaluate(() => {
                  const e = document.querySelector('main h1, h1');
                  return e ? { t: e.textContent.trim(), ...window.__hit(e) } : null;
               });
               console.log(`${w} m18 ${p}`, JSON.stringify(await hit(`^\\s*(${re})\\s*$`)), 'h1', JSON.stringify(h1));
               await s.shot(`${dir}/m18-${p.split('/').pop()}-${w}.png`);
            }
         }
         if (!only || only === 'm19') {
            await s.go('/berry/tasks');
            const box = await s.page.evaluate(() => {
               const c = document.querySelector('[aria-label="Select task"]');
               if (!c) return null;
               let op = 1;
               for (let x = c; x && x !== document.body; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
               return { opacity: Math.round(op * 100) / 100, ...window.__hit(c) };
            });
            console.log(`${w} m19 checkbox`, JSON.stringify(box));
            if (box && w < 1024) {
               const [l, t, r, b] = box.rect;
               await s.page.touchscreen.tap((l + r) / 2, (t + b) / 2);
               await s.page.waitForTimeout(1200);
               console.log(
                  `${w} m19 after tap`,
                  JSON.stringify(
                     await s.page.evaluate(() => ({
                        url: location.pathname,
                        checked: document.querySelector('[aria-label="Select task"]')?.getAttribute('data-state'),
                        bar: [...document.querySelectorAll('body *')]
                           .filter((e) => /\b1 selected\b/i.test(e.textContent || '') && e.children.length < 6)
                           .slice(0, 1)
                           .map((e) => {
                              const bar = e.closest('[role=toolbar], [data-bulk-bar], .fixed, [class*=fixed]') || e;
                              return { text: bar.textContent.trim().slice(0, 60), ...window.__hit(bar) };
                           }),
                        ...window.__off(),
                     }))
                  )
               );
               await s.shot(`${dir}/m19-selected-${w}.png`);
            }
         }
         if (!only || only === 'm110') {
            await s.go('/berry/tasks');
            await s.page.locator('button[aria-label*="ilter" i]').first().click();
            await s.page.waitForTimeout(1200);
            const status = s.page.locator('[data-radix-popper-content-wrapper]').getByText(/^Status$/).first();
            if (await status.count()) {
               await status.click();
               await s.page.waitForTimeout(1200);
               await s.clean();
               console.log(
                  `${w} m110 values`,
                  JSON.stringify(
                     await s.page.evaluate(() => {
                        const opts = [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role=option]')].filter((o) => /Backlog|Todo|In Progress|Done|Canceled|Cancelled|In Review/.test(o.textContent || ''));
                        return {
                           options: opts.slice(0, 5).map((o) => ({ t: o.textContent.trim().slice(0, 16), ...window.__hit(o) })),
                           allInView: opts.length > 0 && opts.every((o) => window.__hit(o).inView),
                           ...window.__off(),
                        };
                     })
                  )
               );
            } else console.log(`${w} m110 no Status item`);
            await s.shot(`${dir}/m110-values-${w}.png`);
         }
      } catch (e) {
         console.log(`${w} fail`, String(e).slice(0, 200));
      }
      await s.browser.close();
   }
})();

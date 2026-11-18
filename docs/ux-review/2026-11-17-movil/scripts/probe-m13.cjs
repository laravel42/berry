// M1.3: the phone menu has a Search control that opens the command palette;
// ⌘K / Ctrl+K still opens it on desktop.
// Usage: node probe-m13.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm13';
fs.mkdirSync(dir, { recursive: true });

const paletteState = (page) =>
   page.evaluate(() => {
      const input = document.querySelector('[cmdk-input], [role=dialog] input[role=combobox], [role=dialog] input');
      const d = input?.closest('[role=dialog]');
      const r = d?.getBoundingClientRect();
      return {
         open: !!input && !!d,
         dialog: r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null,
         input: input ? window.__hit(input) : null,
         focused: document.activeElement === input,
         items: d ? d.querySelectorAll('[cmdk-item], [role=option]').length : 0,
      };
   });

(async () => {
   for (const [w, h] of [
      [390, 844],
      [360, 780],
   ]) {
      const s = await open(w, h);
      try {
         await s.go('/berry/tasks');
         await s.page.locator('button[aria-controls="shell-rail"]').click();
         await s.page.waitForTimeout(800);
         const search = await s.page.evaluate(() => {
            const rail = document.getElementById('shell-rail');
            return [...rail.querySelectorAll('button,a,input')]
               .filter((e) => /search/i.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('placeholder') || ''} ${e.textContent || ''}`))
               .map((e) => ({ label: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), ...window.__hit(e) }));
         });
         console.log(`${w} menu search`, JSON.stringify(search));
         await s.shot(`${dir}/menu-${w}.png`);
         const target = search.find((x) => x.hittable);
         if (target) {
            const [l, t, r, b] = target.rect;
            await s.page.touchscreen.tap((l + r) / 2, (t + b) / 2);
            await s.page.waitForTimeout(1200);
            console.log(`${w} after tap`, JSON.stringify(await paletteState(s.page)), 'railOpen', await s.page.evaluate(() => document.querySelector('button[aria-controls="shell-rail"]')?.getAttribute('aria-expanded')));
            await s.page.keyboard.type('BER');
            await s.page.waitForTimeout(1500);
            console.log(`${w} after typing`, JSON.stringify(await paletteState(s.page)), JSON.stringify(await s.page.evaluate(() => window.__off())));
            await s.shot(`${dir}/palette-${w}.png`);
         }
      } catch (e) {
         console.log(`${w} fail`, String(e).slice(0, 200));
      }
      await s.browser.close();
   }
   const d = await open(1440, 900);
   try {
      await d.go('/berry/tasks');
      const railSearch = await d.page.evaluate(() =>
         [...document.querySelectorAll('#shell-rail button, #shell-rail a, #shell-rail input')]
            .filter((e) => /search/i.test(`${e.getAttribute('aria-label') || ''} ${e.getAttribute('placeholder') || ''} ${e.textContent || ''}`) && e.getBoundingClientRect().width > 0)
            .map((e) => (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30))
      );
      console.log('1440 visible rail search', JSON.stringify(railSearch));
      await d.page.keyboard.press('Control+k');
      await d.page.waitForTimeout(1200);
      console.log('1440 ctrl+k', JSON.stringify(await paletteState(d.page)));
      await d.shot(`${dir}/palette-1440.png`);
   } catch (e) {
      console.log('1440 fail', String(e).slice(0, 200));
   }
   await d.browser.close();
})();

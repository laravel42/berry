// Usage: node probe-m57.cjs <tag>  Table view on a phone: what a tap on a title does, and whether the task title is editable there.
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const tag = process.argv[2] || 'after';
(async () => {
   const res = {};
   for (const [w, h, th] of [[390, 844, 'light'], [360, 780, 'light'], [390, 844, 'dark'], [1440, 900, 'light']]) {
      const { browser, ctx, page, go, shot } = await open(w, h, th);
      await ctx.addInitScript(() => localStorage.setItem('view-storage', JSON.stringify({ state: { viewType: 'table' }, version: 0 })));
      const key = `${w}${th === 'dark' ? 'd' : ''}`;
      await go('/berry/tasks', 5000);
      const link = page.locator('a[href*="/issue/"]:visible').first();
      const before = await page.evaluate(() => ({ path: location.pathname, tableRows: document.querySelectorAll('[role=row],tr').length }));
      await shot(`m57/${tag}-${key}-table.png`);
      const r = { before };
      if (w < 1024) {
         const box = await link.boundingBox();
         await page.touchscreen.tap(box.x + 20, box.y + box.height / 2);
         await page.waitForTimeout(3500);
         r.afterTap = await page.evaluate(() => ({ path: location.pathname, titleButton: !!document.querySelector('[data-detail-title] button') }));
         await shot(`m57/${tag}-${key}-opened.png`);
         const tb = page.locator('[data-detail-title] button').first();
         if (await tb.count()) {
            await tb.tap();
            await page.waitForTimeout(500);
            r.editing = await page.evaluate(() => !!document.querySelector('[data-detail-title] textarea, textarea[aria-label]'));
            await shot(`m57/${tag}-${key}-editing.png`);
            await page.keyboard.press('Escape');
         }
      }
      res[key] = r;
      console.log(key, JSON.stringify(r));
      await browser.close();
   }
   fs.writeFileSync(`m57/${tag}.json`, JSON.stringify(res, null, 1));
})();

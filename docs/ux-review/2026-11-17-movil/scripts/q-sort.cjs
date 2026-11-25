const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   for (const [touch, w, h] of [[true, 390, 844], [false, 1440, 900]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
      const p = await ctx.newPage();
      for (const r of ['/berry/skills', '/berry/agents']) {
         await p.goto('http://localhost:3100' + r, { waitUntil: 'domcontentloaded', timeout: 120000 });
         await p.waitForSelector('[data-heading="label"] button', { timeout: 60000 }).catch(() => {});
         await p.waitForTimeout(1500);
         const hs = await p.$$eval('[data-heading="label"] button', (els) => els.filter((e) => e.offsetParent).map((e) => `${(e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 12)}:${Math.round(e.getBoundingClientRect().height * 10) / 10}`));
         const hh = await p.$eval('[data-heading="label"]', (e) => e.getBoundingClientRect().height).catch(() => null);
         console.log(w, r, 'row', hh, hs.join(' '));
      }
      await ctx.close();
   }
   await b.close();
})();

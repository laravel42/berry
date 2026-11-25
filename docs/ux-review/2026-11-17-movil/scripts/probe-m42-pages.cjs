const { open } = require('./probe-lib.cjs');
(async () => {
   for (const p of ['/berry/projects', '/berry/settings', '/berry/issue/BER-511']) {
      const s = await open(820, 1180);
      await s.go(p);
      const o = await s.page.evaluate(() => window.__off());
      console.log(p, JSON.stringify(o));
      await s.shot(`m42/m42-after-820-${p.split('/').pop()}.png`);
      await s.browser.close();
   }
})();

const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const BASE = process.argv[2] || 'http://localhost:3200';
(async () => {
   const b = await chromium.launch({ channel: 'chrome' });
   const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
   let log = null;
   p.on('request', (r) => { const u = r.url(); if (log && u.includes('/api/') && !u.includes('/events')) log.push(u.replace(/^https?:\/\/[^/]+/, '').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/g, ':id')); });
   await p.goto(BASE + '/berry/inbox', { waitUntil: 'load' });
   await p.waitForSelector('#shell-rail a'); await p.waitForTimeout(4000);
   for (const path of ['/berry/projects', '/berry/agents']) {
      log = [];
      await p.locator(`#shell-rail a[href="${path}"]:visible`).first().click();
      await p.waitForTimeout(2500);
      const counts = {}; for (const u of log) counts[u] = (counts[u] || 0) + 1;
      console.log(path, log.length); for (const [u, n] of Object.entries(counts)) console.log(`  ${n}x ${u.slice(0, 110)}`);
   }
   await b.close();
})();

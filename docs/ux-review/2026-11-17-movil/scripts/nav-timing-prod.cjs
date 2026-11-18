// Times client-side section switches from the rail: click -> URL, click -> page content settled.
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const BASE = 'http://localhost:3200';
const ROUTES = ['/berry/tasks', '/berry/projects', '/berry/agents', '/berry/loops', '/berry/cycles', '/berry/inbox', '/berry/tasks'];
(async () => {
   const b = await chromium.launch({ channel: 'chrome' });
   const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
   const api = [];
   p.on('requestfinished', async (r) => {
      if (!r.url().includes('/api/') || r.url().includes('/events')) return;
      const t = r.timing();
      api.push({ at: Date.now(), url: r.url().replace(BASE, '').slice(0, 70), ms: Math.round(t.responseEnd) });
   });
   await p.goto(BASE + '/berry/tasks', { waitUntil: 'load' }); await p.waitForSelector('#shell-rail a', { timeout: 60000 });
   for (const round of [1, 2]) {
      for (const path of ROUTES.slice(1)) {
         const link = p.locator(`#shell-rail a[href="${path}"]:visible`).first();
         if (!(await link.count())) { console.log(round, path, 'no rail link'); continue; }
         api.length = 0;
         const t0 = Date.now();
         await link.click();
         await p.waitForURL('**' + path, { timeout: 30000 });
         const tUrl = Date.now() - t0;
         // settled: no skeleton, no pending network for 300ms
         const quiet = async () => { let last = api.length, still = 0; while (still < 4) { await p.waitForTimeout(100); if (api.length === last) still++; else { still = 0; last = api.length; } } }; await quiet();
         await p.waitForFunction(() => !document.querySelector('main [data-slot=skeleton], main .animate-pulse'), null, { timeout: 15000 }).catch(() => {});
         const tDone = Date.now() - t0;
         const slow = api.filter((a) => a.ms > 150).map((a) => `${a.url} ${a.ms}ms`);
         console.log(`r${round} ${path.padEnd(16)} url ${String(tUrl).padStart(5)}ms  settled ${String(tDone).padStart(5)}ms  api ${api.length}${slow.length ? '  slow: ' + slow.join(', ') : ''}`);
      }
   }
   await b.close();
})();

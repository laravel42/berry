// Hard-loads each section with every API answer held 2s, and records what the canvas shows meanwhile.
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const BASE = 'http://localhost:3100';
const ROUTES = (process.argv[2] || 'projects,agents,autopilots,loops,cycles,inbox,runs,views,reviews,skills,tasks,approvals,logs,agent-catalog').split(',');
(async () => {
   const b = await chromium.launch({ channel: 'chrome' });
   const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
   const p = await ctx.newPage();
   await p.goto(BASE + '/berry/tasks', { waitUntil: 'load' });
   await p.waitForSelector('#shell-rail a', { timeout: 60000 });
   await p.route('**/api/v1/**', async (r) => { const u = r.request().url(); if (!u.includes('/events') && !u.includes('/me') && !u.includes('/session')) await new Promise((s) => setTimeout(s, 2000)); r.continue().catch(() => {}); });
   for (const name of ROUTES) {
      await p.goto(`${BASE}/berry/${name}`, { waitUntil: 'commit' });
      await p.waitForSelector('#shell-rail a', { timeout: 60000 }).catch(() => {});
      await p.waitForTimeout(700);
      const s = await p.evaluate(() => {
         const m = document.querySelector('main') || document.body;
         return { url: location.pathname, skel: m.querySelectorAll('[data-slot=skeleton]').length, text: m.innerText.trim().replace(/\s+/g, ' ').slice(0, 100) };
      });
      await p.screenshot({ path: `nav-shots/reload-${name}.png`, scale: 'css' });
      console.log(`${name.padEnd(13)} ${s.url.padEnd(20)} skel=${String(s.skel).padStart(2)} "${s.text}"`);
   }
   await b.close();
})();

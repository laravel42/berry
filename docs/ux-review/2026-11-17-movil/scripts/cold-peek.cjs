const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const BASE = 'http://localhost:3100';
const ROUTES = ['/berry/projects', '/berry/agents', '/berry/loops', '/berry/cycles', '/berry/inbox', '/berry/tasks', '/berry/my-issues', '/berry/runs', '/berry/views', '/berry/milestones'];
(async () => {
   const b = await chromium.launch({ channel: 'chrome' });
   const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
   // slow every API answer by 800ms so the in-between state is visible
   await p.route('**/api/v1/**', async (r) => { if (!r.request().url().includes('/events')) await new Promise((s) => setTimeout(s, 800)); r.continue(); });
   await p.goto(BASE + '/berry/settings', { waitUntil: 'load' });
   await p.waitForSelector('#shell-rail a', { timeout: 60000 });
   await p.waitForTimeout(3000);
   for (const path of ROUTES) {
      const name = path.split('/').pop();
      await p.evaluate((u) => { window.next?.router?.push(u); }, path);
      await p.waitForURL('**' + path, { timeout: 20000 });
      await p.waitForTimeout(250);
      const s = await p.evaluate(() => {
         const m = document.querySelector('main') || document.body;
         return { skel: m.querySelectorAll('[data-slot=skeleton],.animate-pulse').length, text: m.innerText.trim().replace(/\s+/g, ' ').slice(0, 110) };
      });
      await p.screenshot({ path: `nav-shots/cold-${name}.png` });
      console.log(`${name.padEnd(11)} skel=${s.skel} "${s.text}"`);
      await p.waitForTimeout(2000);
   }
   await b.close();
})();

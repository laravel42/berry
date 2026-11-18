const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const BASE = 'http://localhost:3201';
const ROUTES = ['/berry/projects', '/berry/agents', '/berry/loops', '/berry/cycles', '/berry/inbox', '/berry/tasks'];
(async () => {
   const b = await chromium.launch({ channel: 'chrome' });
   const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
   await p.goto(BASE + '/berry/tasks', { waitUntil: 'load' });
   await p.waitForSelector('#shell-rail a', { timeout: 60000 });
   await p.waitForTimeout(3000);
   for (const path of ROUTES) {
      const name = path.split('/').pop();
      const t0 = Date.now();
      const samples = [];
      await p.locator(`#shell-rail a[href="${path}"]:visible`).first().click({ noWaitAfter: true });
      for (const at of [60, 150, 500, 900]) {
         await p.waitForTimeout(at - (Date.now() - t0));
         const s = await p.evaluate(() => {
            const m = document.querySelector('main') || document.body;
            return { url: location.pathname, text: m.innerText.trim().replace(/\s+/g, ' ').slice(0, 60), skel: m.querySelectorAll('[data-slot=skeleton]').length, aria: document.querySelector('#shell-rail [aria-current=page]')?.textContent?.trim() };
         });
         samples.push(`${at}ms ${s.url === path ? 'NEW' : 'old'} rail=${s.aria} skel=${s.skel} "${s.text}"`);
         if (at === 500) await p.screenshot({ path: `nav-shots/${name}-500.png` });
      }
      console.log(name + '\n  ' + samples.join('\n  '));
      await p.waitForTimeout(2500);
   }
   await b.close();
})();

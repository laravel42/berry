// Integration smoke (fix/mobile + main + Next 16.4.6). Usage: node smoke-integration.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'smoke-int';
fs.mkdirSync(dir, { recursive: true });
const routes = ['/berry/tasks', '/berry/projects', '/berry/agents', '/berry/chat', '/berry/runs', '/berry/views', '/berry/settings/preferences', '/berry/settings/plugins', '/berry/settings/members', '/berry/plans', '/berry/loops', '/berry/cycles'];
(async () => {
   for (const [w, h] of [[390, 844], [1440, 900]]) {
      const s = await open(w, h);
      const errs = [];
      s.page.on('pageerror', (e) => errs.push('pageerror ' + e.message.slice(0, 120)));
      s.page.on('console', (m) => { if (m.type() === 'error') errs.push('console ' + m.text().slice(0, 120)); });
      s.page.on('response', (r) => { if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url().slice(0, 100)}`); });
      try {
         for (const r of [...routes, 'ISSUE']) {
            let path = r;
            if (r === 'ISSUE') {
               await s.go('/berry/tasks', 6000);
               path = await s.page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((x) => /\/issue\//.test(x)));
               if (!path) { console.log(w, 'no issue link'); continue; }
            }
            const before = errs.length;
            const resp = await s.page.goto('http://localhost:3100' + path, { waitUntil: 'load', timeout: 120000 }).catch((e) => ({ status: () => 'ERR ' + e.message.slice(0, 60) }));
            await s.page.waitForTimeout(4000);
            const info = await s.page.evaluate(() => ({ title: document.title, h1: document.querySelector('h1')?.textContent?.trim().slice(0, 40), off: window.__off().offCount, notFound: /could not be found|404/i.test(document.body.innerText.slice(0, 2000)) }));
            console.log(w, path, resp.status(), JSON.stringify(info), errs.slice(before).join(' | '));
            await s.shot(`${dir}/${w}-${path.replace(/\W+/g, '_')}.png`);
         }
      } finally { await s.browser.close(); }
   }
})();

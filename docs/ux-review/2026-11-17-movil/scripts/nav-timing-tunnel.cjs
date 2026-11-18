// Section switches through the public tunnel (production build), phone and desktop.
// Usage: node nav-timing-tunnel.cjs <base>
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const BASE = process.argv[2];
const PHONE = ['/berry/tasks', '/berry/projects', '/berry/agents', '/berry/inbox', '/berry/tasks'];
const DESK = ['/berry/tasks', '/berry/projects', '/berry/agents', '/berry/loops', '/berry/cycles', '/berry/inbox', '/berry/tasks'];
(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   for (const [name, opts, routes, sel] of [
      ['phone', { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }, PHONE, 'nav[aria-label="Primary"]'],
      ['desk', { viewport: { width: 1440, height: 900 } }, DESK, '#shell-rail'],
   ]) {
      const ctx = await b.newContext(opts);
      const p = await ctx.newPage();
      const api = [], bad = [];
      p.on('requestfinished', async (r) => {
         if (!r.url().includes('/api/') || r.url().includes('/events')) return;
         const t = r.timing();
         api.push({ url: r.url().replace(BASE, '').slice(0, 60), ms: Math.round(t.responseEnd) });
         const res = await r.response();
         if (res && res.status() >= 400) bad.push(`${r.method()} ${r.url().replace(BASE, '').slice(0, 60)} ${res.status()}`);
      });
      const t0 = Date.now();
      await p.goto(BASE + routes[0], { waitUntil: 'load', timeout: 60000 });
      await p.waitForSelector(`${sel} a[href="${routes[1]}"]`, { timeout: 60000 });
      console.log(`${name} first load to shell ${Date.now() - t0}ms (api ${api.length})`);
      for (const round of [1, 2]) {
         for (const path of routes.slice(1)) {
            const link = p.locator(`${sel} a[href="${path}"]:visible`).first();
            if (!(await link.count())) { console.log(name, round, path, 'no link'); continue; }
            api.length = 0;
            const s = Date.now();
            await link.click();
            await p.waitForURL('**' + path, { timeout: 30000 });
            const tUrl = Date.now() - s;
            await p.waitForFunction(() => !document.querySelector('main [data-slot=skeleton], main .animate-pulse, [aria-busy=true]'), null, { timeout: 15000 }).catch(() => {});
            const quiet = async () => { let last = api.length, still = 0; while (still < 4) { await p.waitForTimeout(100); if (api.length === last) still++; else { still = 0; last = api.length; } } };
            await quiet();
            const tDone = Date.now() - s - 400;
            const slow = api.filter((a) => a.ms > 400).map((a) => `${a.url} ${a.ms}ms`);
            console.log(`${name} r${round} ${path.padEnd(16)} url ${String(tUrl).padStart(5)}ms  settled ~${String(tDone).padStart(5)}ms  api ${api.length}${slow.length ? '  slow: ' + slow.slice(0, 3).join(', ') : ''}`);
         }
      }
      await p.screenshot({ path: `nav-shots/tunnel-${name}.png` });
      console.log(name, 'errors >=400:', bad.length ? [...new Set(bad)].join(' | ') : 'none');
      await ctx.close();
   }
   await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

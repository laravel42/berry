// Read-only look at the user's test tab on the phone (LAN origin): screenshot,
// viewport and recent console errors. Touches nothing.
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
(async () => {
   const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
   const ctx = browser.contexts()[0];
   const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http://192.168.100.6:3100'));
   if (!page) throw new Error('LAN test tab not found');
   const errs = [];
   page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
   page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 300)));
   console.log('url', page.url());
   const info = await page.evaluate(() => ({
      inner: [innerWidth, innerHeight], vv: visualViewport && [visualViewport.width, visualViewport.height, visualViewport.offsetTop],
      title: document.title, body: document.body.innerText.slice(0, 600),
      overlay: !!document.querySelector('nextjs-portal'),
   }));
   console.log(JSON.stringify(info, null, 1));
   await page.screenshot({ path: 'phone-f5/lan-now.png' });
   await page.reload({ waitUntil: 'load', timeout: 60000 });
   await new Promise((r) => setTimeout(r, 6000));
   await page.screenshot({ path: 'phone-f5/lan-reload.png' });
   console.log('after reload', page.url(), JSON.stringify(await page.evaluate(() => document.body.innerText.slice(0, 400))));
   console.log(errs.join('\n'));
   await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Through the tunnel: sign in (auto-login), read /me/settings, then PATCH it
// with the exact same values (no change) to prove writes pass the origin check.
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const BASE = process.argv[2];
(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   const p = await b.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
   await p.goto(BASE + '/berry/tasks', { waitUntil: 'load', timeout: 60000 });
   await p.waitForSelector('nav[aria-label="Primary"]', { timeout: 60000 });
   const out = await p.evaluate(async () => {
      const get = await fetch('/api/v1/me/settings', { credentials: 'include' });
      const before = await get.json();
      const theme = before.theme ?? before.themePreference;
      const body = theme !== undefined ? { [before.theme !== undefined ? 'theme' : 'themePreference']: theme } : {};
      const patch = await fetch('/api/v1/me/settings', { method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const after = await (await fetch('/api/v1/me/settings', { credentials: 'include' })).json();
      return { get: get.status, patch: patch.status, sent: body, unchanged: JSON.stringify(before) === JSON.stringify(after), keys: Object.keys(before) };
   });
   console.log(JSON.stringify(out));
   await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

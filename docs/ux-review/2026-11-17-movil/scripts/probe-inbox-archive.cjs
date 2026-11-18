// Inbox -> task notification at phone width: find what overflows horizontally.
// Usage: node probe-inbox-archive.cjs <tag> [base]
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const tag = process.argv[2] || 'now';
const BASE = process.argv[3] || 'http://localhost:3100';
const fs = require('fs');
fs.mkdirSync('inbox-archive', { recursive: true });
(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   for (const [w, h, touch] of [[390, 844, true], [360, 780, true], [820, 1180, true], [1440, 900, false]]) {
      const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 768 });
      await p.goto(BASE + '/berry/inbox', { waitUntil: 'domcontentloaded', timeout: 120000 });
      const row = p.locator('button[data-inbox-row]:visible').filter({ hasText: /BER-\d+/ }).first();
      await row.waitFor({ timeout: 60000 });
      await row.click();
      await p.waitForTimeout(3500);
      const r = await p.evaluate(() => {
         const vw = document.documentElement.clientWidth;
         const bar = [...document.querySelectorAll('button')].find((x) => /^(Archive|Unarchive)$/.test((x.textContent || '').trim()));
         const scrollers = [...document.querySelectorAll('*')].filter((e) => {
            const s = getComputedStyle(e);
            return e.scrollWidth > e.clientWidth + 1 && /(auto|scroll)/.test(s.overflowX) && e.clientWidth > 0;
         }).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).split(' ').slice(0, 4).join('.')} sw=${e.scrollWidth} cw=${e.clientWidth}`);
         const off = [...document.querySelectorAll('main *, [data-slot] *')].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.right > vw + 1; })
            .slice(0, 8).map((e) => `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}" r=${Math.round(e.getBoundingClientRect().right)}`);
         const ar = bar && bar.getBoundingClientRect();
         return { url: location.pathname + location.search, docW: document.documentElement.scrollWidth, vw, archive: ar && [Math.round(ar.left), Math.round(ar.right)], scrollers: scrollers.slice(0, 6), off };
      });
      console.log(w, JSON.stringify(r));
      await p.screenshot({ path: `inbox-archive/${tag}-${w}.png` });
      await p.close();
   }
   await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

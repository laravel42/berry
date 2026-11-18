// Comment composer at phone width: gap from the box to the bottom bar, and where
// "Draft saved" lands once something is typed (the box must not move).
// Usage: node probe-draft.cjs <tag> [base]
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const tag = process.argv[2] || 'now';
const BASE = process.argv[3] || 'http://localhost:3100';
require('fs').mkdirSync('draft', { recursive: true });
(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   for (const [w, h, touch, path] of [[390, 844, true, '/berry/inbox'], [360, 780, true, '/berry/inbox'], [1440, 900, false, '/berry/inbox']]) {
      const p = await b.newPage({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch });
      await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
      if (path.endsWith('inbox')) {
         const row = p.locator('button[data-inbox-row]:visible').filter({ hasText: /BER-\d+/ }).first();
         await row.waitFor({ timeout: 60000 });
         await row.click();
      }
      const ta = p.locator('textarea[aria-label]:visible').last();
      await ta.waitFor({ timeout: 60000 });
      await p.waitForTimeout(1500);
      const m = async () => p.evaluate(() => {
         const t = [...document.querySelectorAll('textarea[aria-label]')].filter((e) => e.offsetParent).pop();
         const box = t.closest('.rounded-lg');
         const bar = document.querySelector('nav[aria-label="Primary"]');
         const draft = [...document.querySelectorAll('span')].find((s) => s.textContent.trim() === 'Draft saved' && s.offsetParent);
         const r = (e) => e && e.getBoundingClientRect();
         const bb = r(box), nb = r(bar), dr = r(draft);
         // what sits between the box and the bottom of its sticky area
         const sticky = box.closest('.border-t') || box.parentElement;
         return {
            box: [Math.round(bb.top), Math.round(bb.bottom)],
            gapToBar: nb && nb.height ? Math.round(nb.top - bb.bottom) : null,
            gapToArea: Math.round(r(sticky).bottom - bb.bottom),
            draft: dr ? [Math.round(dr.left), Math.round(dr.top), Math.round(dr.right), Math.round(dr.bottom)] : null,
         };
      });
      const before = await m();
      await ta.click();
      await ta.fill('probe draft text');
      await p.waitForTimeout(600);
      const typed = await m();
      await p.screenshot({ path: `draft/${tag}-${w}${path.endsWith('inbox') ? '-inbox' : ''}.png` });
      await ta.fill('');
      await p.waitForTimeout(300);
      console.log(w, path, 'empty', JSON.stringify(before), 'typed', JSON.stringify(typed));
      await p.close();
   }
   await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

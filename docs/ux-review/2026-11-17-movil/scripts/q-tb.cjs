const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   for (const [w, touch] of [[390, true], [1440, false]]) {
      const p = await b.newPage({ viewport: { width: w, height: 844 }, hasTouch: touch, isMobile: touch });
      for (const r of process.argv.slice(2)) {
         await p.goto('http://localhost:3100/' + r, { waitUntil: 'domcontentloaded' });
         await p.waitForSelector('main input[placeholder]', { timeout: 60000 });
         await p.waitForTimeout(1500);
         console.log(w, r, JSON.stringify(await p.evaluate(() => {
            const i = [...document.querySelectorAll('main input[placeholder]')].find((x) => x.offsetParent);
            const bar = i.closest('.border-b') || i.parentElement.parentElement;
            const cs = (e) => { const s = getComputedStyle(e); const q = e.getBoundingClientRect(); return `${(e.getAttribute('aria-label') || e.placeholder || e.textContent || e.tagName).trim().slice(0, 14)} h=${Math.round(q.height * 10) / 10} t=${Math.round(q.top)} l=${Math.round(q.left)} w=${Math.round(q.width)} minH=${s.minHeight} H=${s.height} pad=${s.paddingTop}/${s.paddingBottom} lh=${s.lineHeight} fs=${s.fontSize}`; };
            return { bar: cs(bar), barClass: String(bar.className).slice(0, 200), input: cs(i), btns: [...bar.querySelectorAll('button')].filter((x) => x.offsetParent).map(cs) };
         }), null, 1));
      }
      await p.close();
   }
   await b.close();
})();

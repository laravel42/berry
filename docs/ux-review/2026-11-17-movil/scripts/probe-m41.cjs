// M4.1a: with the More sheet open the launcher must not sit above the veil.
// Usage: node probe-m41.cjs <outDir> <tag>   (tag: before|after)
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm41';
const tag = process.argv[3] || 'run';
fs.mkdirSync(dir, { recursive: true });
const launcher = (page) =>
   page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => /agents/i.test(b.getAttribute('aria-label') || b.textContent || '') && b.closest('.fixed')?.className.includes('z-[45]'));
      if (!btn) return { found: false };
      const r = btn.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const isLauncher = !!top && (top === btn || btn.contains(top));
      return { found: true, rect: [r.left, r.top, r.right, r.bottom].map(Math.round), launcherOnTop: isLauncher, top: (top?.getAttribute('aria-label') || top?.tagName || '').slice(0, 30) };
   });
(async () => {
   let fail = false;
   for (const [w, h] of [[390, 844], [360, 780]]) {
      for (const scheme of ['light', 'dark']) {
         const s = await open(w, h, scheme);
         await s.page.emulateMedia({ colorScheme: scheme });
         try {
            await s.go('/berry/tasks');
            const closed = await launcher(s.page);
            await s.page.locator('nav[aria-label="Primary"] button[aria-controls="shell-rail"]').tap();
            await s.page.waitForTimeout(900);
            const open_ = await launcher(s.page);
            console.log(`${w} ${scheme} closed`, JSON.stringify(closed), 'open', JSON.stringify(open_));
            if (open_.found && open_.launcherOnTop) fail = true;
            await s.shot(`${dir}/m41-${tag}-${w}-${scheme}.png`);
         } catch (e) {
            console.log(`${w} ${scheme} fail`, String(e).slice(0, 200));
            fail = true;
         }
         await s.browser.close();
      }
   }
   const d = await open(1440, 900);
   await d.go('/berry/tasks');
   console.log('1440', JSON.stringify(await launcher(d.page)));
   await d.shot(`${dir}/m41-${tag}-1440.png`);
   await d.browser.close();
   console.log(fail ? 'PROBE FAIL' : 'PROBE PASS');
})();

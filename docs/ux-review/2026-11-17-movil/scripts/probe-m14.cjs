// M1.4: the phone tab bar. Tabs reachable, page ends above the bar, More opens the
// rail, Agents opens the chat with Send above the bar. Usage: node probe-m14.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm14';
fs.mkdirSync(dir, { recursive: true });
const bar = (page) =>
   page.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Primary"]');
      const r = nav?.getBoundingClientRect();
      const main = document.querySelector('main')?.getBoundingClientRect();
      return {
         bar: r && r.height > 0 ? [r.top, r.bottom].map(Math.round) : null,
         mainBottom: main ? Math.round(main.bottom) : null,
         tabs: nav ? [...nav.querySelectorAll('a,button')].map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 18), h: Math.round(e.getBoundingClientRect().height), cur: e.getAttribute('aria-current'), hit: window.__hit(e).hittable })) : [],
         floatingMenu: !!document.querySelector('button[aria-label="Open menu"]'),
         ...window.__off(),
      };
   });
(async () => {
   for (const [w, h, scheme] of [[390, 844, 'light'], [390, 844, 'dark'], [360, 780, 'light'], [820, 1180, 'light']]) {
      const s = await open(w, h);
      await s.page.emulateMedia({ colorScheme: scheme });
      try {
         await s.go('/berry/tasks');
         console.log(`${w} ${scheme} tasks`, JSON.stringify(await bar(s.page)));
         await s.shot(`${dir}/tasks-${w}-${scheme}.png`);
         if (w === 390) {
            await s.page.locator('nav[aria-label="Primary"] button[aria-controls="shell-rail"]').tap();
            await s.page.waitForTimeout(900);
            await s.shot(`${dir}/more-${w}-${scheme}.png`);
            await s.page.keyboard.press('Escape');
            await s.page.waitForTimeout(600);
            await s.page.locator('nav[aria-label="Primary"] button[aria-expanded]').nth(0).tap();
            await s.page.waitForTimeout(1500);
            const chat = await s.page.evaluate(() => ({ send: window.__hitBy('^send$'), agent: window.__hitBy('^\s*Agent\b') }));
            console.log(`${w} ${scheme} chat`, JSON.stringify(chat).slice(0, 400));
            await s.shot(`${dir}/chat-${w}-${scheme}.png`);
         }
      } catch (e) {
         console.log(`${w} ${scheme} fail`, String(e).slice(0, 200));
      }
      await s.browser.close();
   }
   const d = await open(1440, 900);
   await d.go('/berry/tasks');
   console.log('1440', JSON.stringify(await bar(d.page)), JSON.stringify(await d.page.evaluate(() => window.__hitBy('Agents').map((x) => x.rect))));
   await d.shot(`${dir}/tasks-1440.png`);
   await d.browser.close();
})();

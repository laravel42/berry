// M4.2: shell switch at md. Usage: node probe-m42.cjs <tag>  (before|after)
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const tag = process.argv[2] || 'run';
fs.mkdirSync('m42', { recursive: true });
const measure = (page) =>
   page.evaluate(() => {
      const vis = (el) => {
         if (!el) return false;
         const s = getComputedStyle(el);
         const r = el.getBoundingClientRect();
         return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      const rr = (el) => {
         const r = el.getBoundingClientRect();
         return [r.left, r.top, r.right, r.bottom].map(Math.round);
      };
      const rail = document.getElementById('shell-rail');
      const tab = document.querySelector('nav[aria-label="Primary"]');
      const main = document.querySelector('main');
      const launcher = [...document.querySelectorAll('.fixed')].find((e) => e.className.includes?.('z-[45]'));
      const strip = [...document.querySelectorAll('[data-shell-chrome]')].filter((e) => e.id !== 'shell-rail' && vis(e)).map((e) => ({ rect: rr(e), cls: e.className.slice(0, 40) }));
      const vw = document.documentElement.clientWidth;
      return {
         rail: rail ? { pos: getComputedStyle(rail).position, vis: vis(rail), rect: rr(rail), inert: rail.inert } : null,
         tabBar: tab ? { vis: vis(tab), rect: vis(tab) ? rr(tab) : null } : null,
         launcher: launcher ? { vis: vis(launcher), rect: rr(launcher) } : null,
         strips: strip,
         main: rr(main),
         docW: document.documentElement.scrollWidth,
         vw,
         hOverflow: document.documentElement.scrollWidth > vw,
      };
   });
(async () => {
   for (const [w, h] of [[820, 1180], [768, 1024], [390, 844], [1440, 900]]) {
      for (const scheme of w === 820 ? ['light', 'dark'] : ['light']) {
         const s = await open(w, h, scheme);
         await s.page.emulateMedia({ colorScheme: scheme });
         try {
            await s.go('/berry/tasks');
            console.log(w, scheme, JSON.stringify(await measure(s.page)));
            await s.shot(`m42/m42-${tag}-${w}${scheme === 'dark' ? '-dark' : ''}.png`);
         } catch (e) {
            console.log(w, scheme, 'fail', String(e).slice(0, 200));
         }
         await s.browser.close();
      }
   }
})();

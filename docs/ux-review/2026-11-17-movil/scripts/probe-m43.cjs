// M4.3: frame gaps equal left/right on phones; safe-area in floating controls; 1440 metrics unchanged.
// Usage: node probe-m43.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm43';
fs.mkdirSync(dir, { recursive: true });
(async () => {
   for (const [w, h, theme] of [[390, 844, 'light'], [390, 844, 'dark'], [360, 780, 'light'], [1440, 900, 'light'], [1440, 900, 'dark']]) {
      const s = await open(w, h, theme);
      try {
         await s.go('/berry/tasks');
         const m = await s.page.evaluate(() => {
            const cs = getComputedStyle(document.body);
            const b = document.body.getBoundingClientRect();
            const fixed = [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).position === 'fixed' && e.getBoundingClientRect().width > 0);
            const root = getComputedStyle(document.documentElement);
            return {
               gapL: parseFloat(cs.borderLeftWidth), gapR: parseFloat(cs.borderRightWidth), gapT: parseFloat(cs.borderTopWidth), gapB: parseFloat(cs.borderBottomWidth),
               body: [b.left, b.top, b.right, b.bottom].map(Math.round),
               themeColor: [...document.querySelectorAll('meta[name=theme-color]')].map((m) => `${m.media}|${m.content}`),
               vp: document.querySelector('meta[name=viewport]')?.content,
               inset: ['--app-inset-t', '--app-inset-r', '--app-inset-b', '--app-inset-l', '--shell-launcher-b'].map((k) => `${k}=${root.getPropertyValue(k).trim()}`),
               fixedBottoms: fixed.slice(0, 10).map((e) => `${e.tagName}.${(e.className + '').slice(0, 30)} ${[...Object.values(e.getBoundingClientRect().toJSON())].slice(0, 4).map(Math.round)}`),
            };
         });
         console.log(`${w}x${h} ${theme}`, JSON.stringify(m));
         await s.shot(`${dir}/${process.argv[3] || 'x'}-${theme}-${w}.png`);
      } catch (e) { console.log(w, 'fail', String(e).slice(0, 200)); }
      await s.browser.close();
   }
})();

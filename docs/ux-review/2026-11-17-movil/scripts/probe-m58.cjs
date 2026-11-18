// Usage: node probe-m58.cjs <tag>  Sign-in page in a fresh context (no session).
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const tag = process.argv[2] || 'before';
(async () => {
   const res = {};
   for (const [w, h, th] of [[390, 844, 'light'], [360, 780, 'light'], [390, 844, 'dark'], [1440, 900, 'light']]) {
      const { browser, page, go, shot } = await open(w, h, th);
      // Anonymous without touching the shared session: answer 401 to bootstrap and dev-login in this context only.
      await page.route((u) => u.pathname.includes('bootstrap') || u.pathname.includes('dev-login'), (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"UNAUTHORIZED","message":"x"}}' }));
      await go('/sign-in', 4000);
      const key = `${w}${th === 'dark' ? 'd' : ''}`;
      res[key] = await page.evaluate(() => {
         const b = getComputedStyle(document.body);
         const svg = document.querySelector('svg[data-wordmark]');
         const r = svg?.getBoundingClientRect();
         return { path: location.pathname, bodyBorder: [b.borderTopWidth, b.borderTopColor, b.borderRightWidth, b.borderBottomWidth, b.borderLeftWidth], bodyBg: b.backgroundColor, htmlBg: getComputedStyle(document.documentElement).backgroundColor, logoColor: svg && getComputedStyle(svg).color, logoRect: r && [Math.round(r.width), Math.round(r.height)], docW: document.documentElement.scrollWidth };
      });
      await shot(`m58/${tag}-${key}.png`);
      console.log(key, JSON.stringify(res[key]));
      await browser.close();
   }
   fs.writeFileSync(`m58/${tag}.json`, JSON.stringify(res, null, 1));
})();

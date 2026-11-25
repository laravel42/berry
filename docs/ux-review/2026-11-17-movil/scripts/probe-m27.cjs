// M2.7 member profile panels + project side panel. Usage: node probe-m27.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm27';
fs.mkdirSync(dir, { recursive: true });
const sizes = [[390, 844], [820, 1180], [1440, 900]];

const panelState = (page) =>
   page.evaluate(() => {
      const asides = [...document.querySelectorAll('aside')].filter((a) => !a.closest('[data-sidebar]') && a.querySelector('*'));
      const mainAside = asides.filter((a) => getComputedStyle(a).display !== 'none' && a.getBoundingClientRect().width > 200);
      return mainAside.map((a) => ({ cls: a.className.slice(0, 40), ...window.__hit(a) }));
   });

(async () => {
   for (const [w, h] of sizes) {
      const s = await open(w, h);
      try {
         await s.go('/berry/settings/members', 8000);
         const href = await s.page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((x) => /\/(members|profiles)\/[^/]+$/.test(x.split('?')[0])));
         console.log(w, 'member href', href);
         if (href) {
            await s.go(href, 8000);
            console.log(w, 'initial', JSON.stringify(await panelState(s.page)));
            for (const name of ['Insights', 'Profile', 'Profile', 'Insights', 'Insights']) {
               await s.page.getByRole('button', { name, exact: true }).first().click().catch((e) => console.log('click fail', name));
               await s.page.waitForTimeout(800);
               console.log(w, 'tap', name, JSON.stringify(await panelState(s.page)), JSON.stringify(await s.page.evaluate(() => window.__off())));
               if (w === 390) await s.shot(`${dir}/profile-${name}-${Date.now() % 100000}.png`);
            }
         }
         // projects
         await s.go('/berry/projects', 8000);
         const ph = await s.page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((x) => /\/project\/[^/]+/.test(x)));
         console.log(w, 'project href', ph);
         if (ph) {
            const base = ph.replace(/\/(overview|issues)$/, '');
            await s.go(base + '/issues', 8000);
            console.log(w, 'project page issues', JSON.stringify(await panelState(s.page)), JSON.stringify(await s.page.evaluate(() => window.__hitBy('insight|properties|panel|details'))));
            if (w === 390) await s.shot(`${dir}/project-issues.png`);
         }
      } finally {
         await s.browser.close();
      }
   }
})();

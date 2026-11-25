// M1.5 settings add rows, M1.6 new project footer + agent panel, M1.7 views chips.
// Usage: node probe-m157.cjs <outDir> [only: m15|m16|m17]
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm157';
const only = process.argv[3] || '';
fs.mkdirSync(dir, { recursive: true });
const sizes = [
   [390, 844],
   [360, 780],
   [1440, 900],
];

(async () => {
   for (const [w, h] of sizes) {
      const s = await open(w, h);
      const hit = (src, scope) => s.page.evaluate(([src, scope]) => window.__hitBy(src, scope), [src, scope]);
      try {
         if (!only || only === 'm15') {
            await s.go('/berry/settings/members');
            await s.page.evaluate(() => {
               const b = [...document.querySelectorAll('button')].find((x) => /create link/i.test(x.textContent || ''));
               b?.scrollIntoView({ block: 'center' });
               // scrollIntoView also slides clipped (overflow:hidden) rows sideways,
               // which a finger cannot do: put every ancestor back at scrollLeft 0.
               for (let n = b?.parentElement; n; n = n.parentElement) n.scrollLeft = 0;
            });
            await s.page.waitForTimeout(400);
            console.log(`${w} m15 members`, JSON.stringify(await hit('^\\s*create link\\s*$')), JSON.stringify(await s.page.evaluate(() => window.__off())));
            await s.shot(`${dir}/m15-members-${w}.png`);
            await s.go('/berry/settings/connected-accounts');
            console.log(`${w} m15 connected`, JSON.stringify(await hit('^\\s*add\\s*$')), JSON.stringify(await s.page.evaluate(() => window.__off())));
            await s.shot(`${dir}/m15-connected-${w}.png`);
         }
         if (!only || only === 'm16') {
            await s.go('/berry/projects');
            await s.page.getByRole('button', { name: /New project/ }).first().click();
            await s.page.waitForTimeout(2500);
            await s.clean();
            console.log(`${w} m16 footer`, JSON.stringify(await hit('^\\s*create with agent\\s*$|^\\s*create project\\s*$', '[role=dialog]')));
            await s.shot(`${dir}/m16-dialog-${w}.png`);
            const agent = s.page.locator('[role=dialog] button').filter({ hasText: /^\s*Create with agent\s*$/ }).first();
            if (await agent.count()) {
               await agent.evaluate((b) => b.click());
               await s.page.waitForTimeout(2000);
               await s.clean();
               console.log(
                  `${w} m16 agent panel`,
                  JSON.stringify(
                     await s.page.evaluate(() => {
                        const p = document.querySelector('[aria-label="Project assistant"]');
                        const d = document.querySelector('[role=dialog]');
                        const pr = p?.getBoundingClientRect();
                        const dr = d?.getBoundingClientRect();
                        return {
                           panel: pr ? [pr.left, pr.top, pr.right, pr.bottom].map(Math.round) : null,
                           dialog: dr ? [dr.left, dr.top, dr.right, dr.bottom].map(Math.round) : null,
                           composer: p ? [...p.querySelectorAll('textarea')].map((t) => window.__hit(t)) : [],
                           ...window.__off(),
                        };
                     })
                  )
               );
               await s.shot(`${dir}/m16-agent-${w}.png`);
            }
         }
         if (!only || only === 'm17') {
            await s.go('/berry/views');
            console.log(
               `${w} m17 chips`,
               JSON.stringify(
                  await s.page.evaluate(() =>
                     [...document.querySelectorAll('main a, main button, main [role=tab]')]
                        .filter((e) => /^(⛔|🎯|🐞|🔥|👀)|^\s*(Manage views|New view)\s*$/u.test((e.textContent || '').trim()) && e.getBoundingClientRect().top < 220)
                        .map((e) => ({ t: (e.textContent || '').trim().slice(0, 22), ...window.__hit(e) }))
                  )
               ),
               JSON.stringify(await s.page.evaluate(() => window.__off()))
            );
            await s.shot(`${dir}/m17-views-${w}.png`);
         }
      } catch (e) {
         console.log(`${w} fail`, String(e).slice(0, 200));
      }
      await s.browser.close();
   }
})();

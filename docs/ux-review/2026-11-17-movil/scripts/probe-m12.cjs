// M1.2: every detail drawer has one visible close control below lg that returns to
// the list; desktop drawers keep what they had.
// Usage: node probe-m12.cjs <outDir> [width] [height]
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm12';
const W = Number(process.argv[3] || 390);
const H = Number(process.argv[4] || 844);
fs.mkdirSync(dir, { recursive: true });

const drawers = [
   ['issue', '/berry/tasks', { link: /\/berry\/issue\/[^/?#]+$/ }],
   ['project', '/berry/projects', { link: /\/berry\/project\/[^/]+\/overview$/ }],
   ['agent', '/berry/agents', { link: /\/berry\/agents\/(?!new)[^/?#]+$/ }],
   ['cycle', '/berry/cycles', { link: /\/berry\/cycle\/[^/?#]+$/ }],
   ['plan', '/berry/plans', { push: '/berry/plan/4daa99cf-dc9a-438d-9bb8-943e4b0a5a3b' }],
   ['skill', '/berry/skills', { push: '/berry/skills/d562ef68-afd6-4af5-af61-d512a6c80526' }],
   ['view', '/berry/views', { push: '/berry/view/3f56a9f5-c556-4ebb-a822-d8e7df31fae4' }],
   ['new-agent', '/berry/agents', { push: '/berry/agents/new' }],
];

(async () => {
   const s = await open(W, H);
   for (const [name, list, how] of drawers) {
      try {
         await s.go(list, 6000);
         if (how.link) await s.tapLink(how.link);
         else await s.push(how.push);
         const info = await s.page.evaluate(() => {
            const d = document.querySelector('[role=dialog]');
            if (!d) return { dialog: false };
            const closes = [...d.querySelectorAll('button,a')].filter((b) => {
               const r = b.getBoundingClientRect();
               return r.width > 0 && /^close\b|close$/i.test((b.getAttribute('aria-label') || b.textContent || '').trim());
            });
            return {
               dialog: true,
               width: Math.round(d.getBoundingClientRect().width),
               closes: closes.map((b) => {
                  const r = b.getBoundingClientRect();
                  return { label: b.getAttribute('aria-label') || b.textContent.trim(), size: [Math.round(r.width), Math.round(r.height)], ...window.__hit(b) };
               }),
               off: window.__off().offCount,
            };
         });
         await s.shot(`${dir}/${name}-${W}.png`);
         let after = null;
         const target = info.closes?.find((c) => c.hittable);
         if (target) {
            const [l, t, r, b] = target.rect;
            await s.page.touchscreen.tap((l + r) / 2, (t + b) / 2).catch(() => s.page.mouse.click((l + r) / 2, (t + b) / 2));
            await s.page.waitForTimeout(2500);
            after = { url: s.page.url().replace('http://localhost:3100', ''), dialogs: await s.page.locator('[role=dialog]').count() };
         }
         console.log(name, JSON.stringify({ ...info, after }));
      } catch (e) {
         console.log(name, 'fail', String(e).slice(0, 160));
      }
   }
   await s.browser.close();
})();

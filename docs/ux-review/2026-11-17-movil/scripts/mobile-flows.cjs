// Mobile interaction flows at a phone viewport (light theme). One PNG per step.
// Usage: node mobile-flows.cjs <outDir> [filter]
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const fs = require('fs');
const dir = process.argv[2];
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const BASE = 'http://localhost:3100';
const W = 390;
const H = 844;
fs.mkdirSync(dir, { recursive: true });

function overflowReport() {
   const vw = document.documentElement.clientWidth;
   const out = [];
   for (const el of document.body.querySelectorAll('*')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      const p = el.parentElement?.getBoundingClientRect();
      if (p && (p.right > vw + 1 || p.left < -1)) continue;
      if (s.position === 'fixed' && r.left >= vw) continue;
      const t = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      out.push(`${el.tagName.toLowerCase()} "${t}" L${Math.round(r.left)} R${Math.round(r.right)}`);
   }
   return out.slice(0, 10);
}

(async () => {
   const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      userAgent:
         'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
   });
   const page = await ctx.newPage();
   const go = async (path) => {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(5000);
   };
   const snap = async (name) => {
      await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove()));
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/${name}.png` });
      console.log('shot', name, JSON.stringify(await page.evaluate(overflowReport)));
   };
   const tapLink = async (re) => {
      const href = await page.evaluate(
         (src) => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => new RegExp(src).test(h.split('?')[0])),
         re.source
      );
      if (!href) throw new Error('no link ' + re);
      await page.evaluate((h) => [...document.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === h).click(), href);
      await page.waitForTimeout(5000);
   };
   const flows = {
      async menu() {
         await go('/berry/tasks');
         await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove()));
         await page.locator('button[aria-controls="shell-rail"]').click();
         await page.waitForTimeout(800);
         await snap('menu-open');
         const rail = await page.evaluate(() => {
            const r = document.getElementById('shell-rail')?.getBoundingClientRect();
            return r ? [r.left, r.right, r.width].map(Math.round) : null;
         });
         console.log('rail rect', rail);
      },
      async 'menu-settings'() {
         await go('/berry/settings/general');
         await snap('settings-closed');
         await page.locator('button[aria-controls="shell-rail"]').click();
         await page.waitForTimeout(800);
         await snap('settings-menu-open');
      },
      async 'issue-drawer'() {
         await go('/berry/tasks');
         await tapLink(/\/berry\/issue\/[^/?#]+$/);
         await snap('issue-drawer-top');
         await page.evaluate(() => {
            const d = document.querySelector('[role="dialog"]');
            d?.querySelectorAll('*').forEach((n) => {
               if (n.scrollHeight > n.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(n).overflowY)) n.scrollTop = n.scrollHeight;
            });
         });
         await page.waitForTimeout(600);
         await snap('issue-drawer-bottom');
         const box = page.locator('[role="dialog"] textarea').last();
         if (await box.count()) {
            await box.tap();
            await page.waitForTimeout(500);
            await snap('issue-drawer-composer-focus');
         }
      },
      async 'new-task'() {
         await go('/berry/tasks');
         await page.getByRole('button', { name: /New task/ }).first().tap();
         await page.waitForTimeout(2500);
         await snap('new-task-dialog');
      },
      async 'tasks-filter'() {
         await go('/berry/tasks');
         await page.locator('button[aria-label*="ilter" i]').first().tap();
         await page.waitForTimeout(1200);
         await snap('tasks-filter-open');
      },
      async 'filter-submenu'() {
         await go('/berry/tasks');
         await page.locator('button[aria-label*="ilter" i]').first().tap();
         await page.waitForTimeout(1000);
         await page.getByRole('menuitem', { name: /^Status$/ }).first().tap();
         await page.waitForTimeout(1000);
         await snap('filter-submenu');
      },
      async 'chat-send-hit'() {
         await go('/berry/projects');
         await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove()));
         await page.getByRole('button', { name: /Agents/ }).last().tap();
         await page.waitForTimeout(2500);
         const r = await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /send|submit/i.test(b.getAttribute('aria-label') || b.type || '')).map((b) => { const x = b.getBoundingClientRect(); const top = document.elementFromPoint(x.left + x.width / 2, x.top + x.height / 2); return (b.getAttribute('aria-label') || b.type) + ' [' + [x.left, x.top, x.right, x.bottom].map(Math.round) + '] top=' + (top === b || b.contains(top) ? 'self' : (top?.getAttribute('aria-label') || top?.textContent || '').trim().slice(0, 30)); }));
         console.log('chat send buttons', JSON.stringify(r));
      },
   async 'tasks-display'() {
         await go('/berry/tasks');
         const btns = page.locator('main button');
         const n = await btns.count();
         for (let i = 0; i < n; i++) {
            const name = ((await btns.nth(i).getAttribute('aria-label')) || '').toLowerCase();
            if (/display|view option|options/.test(name)) {
               await btns.nth(i).tap();
               break;
            }
         }
         await page.waitForTimeout(1200);
         await snap('tasks-display-open');
      },
      async 'tasks-board'() {
         await go('/berry/tasks');
         const board = page.locator('button[aria-label*="oard" i], [role="radio"][aria-label*="oard" i], [role="tab"][aria-label*="oard" i]').first();
         if (await board.count()) await board.tap();
         await page.waitForTimeout(2500);
         await snap('tasks-board');
      },
      async 'floating-chat'() {
         await go('/berry/projects');
         await page.getByRole('button', { name: /Agents/ }).last().tap();
         await page.waitForTimeout(2500);
         await snap('floating-chat-open');
      },
      async 'project-drawer'() {
         await go('/berry/projects');
         await tapLink(/\/berry\/project\/[^/]+\/overview$/);
         await snap('project-drawer');
      },
      async 'new-project'() {
         await go('/berry/projects');
         await page.getByRole('button', { name: /New project/ }).first().tap();
         await page.waitForTimeout(2500);
         await snap('new-project-dialog');
      },
      async 'agent-drawer'() {
         await go('/berry/agents');
         await tapLink(/\/berry\/agents\/(?!new)[^/?#]+$/);
         await snap('agent-drawer');
      },
      async 'plans-detail'() {
         await go('/berry/plans');
         const row = page.locator('main [role="button"], main li, main button').filter({ hasText: /plan|Plan/ }).first();
         if (await row.count()) await row.tap();
         await page.waitForTimeout(2500);
         await snap('plans-after-tap');
      },
      async 'skills-detail'() {
         await go('/berry/skills');
         const row = page.locator('main [role="button"], main button').nth(4);
         if (await row.count()) await row.tap();
         await page.waitForTimeout(2500);
         await snap('skills-after-tap');
      },
   };
   for (const [name, fn] of Object.entries(flows)) {
      if (only && !only.test(name)) continue;
      try {
         await fn();
      } catch (e) {
         console.log('fail', name, String(e).slice(0, 160));
      }
   }
   await browser.close();
})().catch((e) => {
   console.error(e);
   process.exit(1);
});

// Second mobile pass: re-checks the first report's blockers and covers what it
// left out (keyboard, landscape, submenus, uncovered routes, auth, states, touch).
// Usage: node mobile-validate.cjs <outDir> [sectionFilter]
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const fs = require('fs');
const dir = process.argv[2];
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const BASE = 'http://localhost:3100';
const UA =
   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
fs.mkdirSync(dir, { recursive: true });
const out = {};
const log = (k, v) => {
   out[k] = v;
   console.log(k, JSON.stringify(v).slice(0, 900));
};

// ---- in-page helpers (installed with addInitScript) ----
function installHelpers() {
   const nameOf = (n) =>
      n ? (n.getAttribute?.('aria-label') || n.textContent || n.tagName || '').trim().replace(/\s+/g, ' ').slice(0, 40) : null;
   window.__hit = (el) => {
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const inView = r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1;
      const top = cx >= 0 && cx <= vw && cy >= 0 && cy <= vh ? document.elementFromPoint(cx, cy) : null;
      const hittable = !!top && (top === el || el.contains(top));
      return { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), inView, hittable, top: hittable ? 'self' : nameOf(top) };
   };
   window.__measure = () => {
      const vw = document.documentElement.clientWidth;
      const vis = (el) => {
         const s = getComputedStyle(el);
         if (s.display === 'none' || s.visibility === 'hidden') return false;
         const r = el.getBoundingClientRect();
         return r.width > 0 && r.height > 0;
      };
      const all = [...document.body.querySelectorAll('*')].filter((el) => !el.closest('[aria-hidden="true"],nextjs-portal') && vis(el));
      const off = [];
      for (const el of all) {
         const r = el.getBoundingClientRect();
         if (r.right <= vw + 1 && r.left >= -1) continue;
         const p = el.parentElement?.getBoundingClientRect();
         if (p && (p.right > vw + 1 || p.left < -1)) continue;
         if (getComputedStyle(el).position === 'fixed' && r.left >= vw) continue;
         off.push(`${el.tagName.toLowerCase()} "${nameOf(el)?.slice(0, 24)}" L${Math.round(r.left)} R${Math.round(r.right)}`);
      }
      const inter = all.filter((el) => el.matches('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=checkbox],[role=switch],[role=menuitem],[role=combobox]'));
      const small = inter.filter((el) => {
         const r = el.getBoundingClientRect();
         return r.width < 24 || r.height < 24;
      }).length;
      // Primary-looking buttons that sit outside the viewport or under something else.
      const unreachable = inter
         .filter((el) => el.matches('button,a[href]') && (el.textContent || '').trim().length > 2)
         .map((el) => ({ el, h: window.__hit(el) }))
         .filter(({ h }) => !h.inView && (h.rect[0] < -1 || h.rect[2] > vw + 1))
         .slice(0, 6)
         .map(({ el, h }) => `${nameOf(el)} [${h.rect}]`);
      return {
         docW: document.documentElement.scrollWidth,
         vw,
         off: off.slice(0, 8),
         offCount: off.length,
         small: `${small}/${inter.length}`,
         unreachable,
         h1: [...document.querySelectorAll('h1,h2')].slice(0, 2).map((h) => h.textContent.trim().slice(0, 30)),
      };
   };
   window.__cls = 0;
   try {
      new PerformanceObserver((list) => {
         for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cls += e.value;
      }).observe({ type: 'layout-shift', buffered: true });
   } catch {}
}

async function newPage(browser, w = 390, h = 844) {
   const ctx = await browser.newContext({
      viewport: { width: w, height: h },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      userAgent: UA,
   });
   await ctx.addInitScript(installHelpers);
   const page = await ctx.newPage();
   return { ctx, page };
}
const clean = (page) => page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove())).catch(() => {});
async function go(page, path, wait = 5000) {
   await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
   await page.waitForTimeout(wait);
   await clean(page);
}
async function snap(page, name) {
   await clean(page);
   await page.waitForTimeout(250);
   await page.screenshot({ path: `${dir}/${name}.png` });
}
async function tapLink(page, re) {
   const href = await page.evaluate(
      (src) => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => new RegExp(src).test(h.split('?')[0])),
      re.source
   );
   if (!href) throw new Error('no link ' + re);
   await page.evaluate((h) => [...document.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === h).click(), href);
   await page.waitForTimeout(5000);
   await clean(page);
   return href;
}
async function hitBy(page, src, scope = 'body') {
   return page.evaluate(
      ([src, scope]) => {
         const re = new RegExp(src, 'i');
         const root = document.querySelector(scope) || document.body;
         return [...root.querySelectorAll('button,a[href],[role=button],[role=tab]')]
            .filter((b) => re.test(`${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.trim()))
            .slice(0, 6)
            .map((e) => ({ label: (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40), ...window.__hit(e) }));
      },
      [src, scope]
   );
}
const measure = (page) => page.evaluate(() => window.__measure());

const sections = {
   // ---- 1. The first report's blockers, measured again ----
   async recheck(browser) {
      const { ctx, page } = await newPage(browser);
      await go(page, '/berry/projects');
      await page.getByRole('button', { name: /Agents/ }).last().tap();
      await page.waitForTimeout(2500);
      await clean(page);
      log(
         'r1-chat-send',
         await page.evaluate(() =>
            [...document.querySelectorAll('button')]
               .filter((b) => /send/i.test(b.getAttribute('aria-label') || '') || b.type === 'submit')
               .map((b) => ({ label: b.getAttribute('aria-label') || b.type, ...window.__hit(b) }))
         )
      );
      await snap(page, 'v-r1-chat');

      await go(page, '/berry/tasks');
      const href = await tapLink(page, /\/berry\/issue\/[^/?#]+$/);
      log(
         'r2-drawer',
         await page.evaluate(() => {
            const d = document.querySelector('[role=dialog]');
            if (!d) return null;
            return {
               w: Math.round(d.getBoundingClientRect().width),
               closeish: [...d.querySelectorAll('button,a')]
                  .map((b) => b.getAttribute('aria-label') || b.textContent || '')
                  .filter((t) => /close|dismiss|back/i.test(t)),
               headerButtons: [...d.querySelectorAll('button')]
                  .filter((b) => b.getBoundingClientRect().top < 80)
                  .map((b) => (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 20)),
            };
         })
      );
      await page.goBack();
      await page.waitForTimeout(2500);
      log('r2-back-closes', { url: page.url().replace(BASE, ''), dialogs: await page.locator('[role=dialog]').count() });

      await go(page, href, 7000);
      log(
         'r2-direct-load',
         await page.evaluate(() => ({
            dialogs: document.querySelectorAll('[role=dialog]').length,
            historyLength: history.length,
            topLinks: [...document.querySelectorAll('a[href]')]
               .filter((a) => a.getBoundingClientRect().top < 90)
               .map((a) => a.getAttribute('href'))
               .slice(0, 6),
            menuButton: !!document.querySelector('button[aria-controls="shell-rail"]'),
         }))
      );
      await snap(page, 'v-r2-direct-load');

      await go(page, '/berry/tasks');
      await page.locator('button[aria-controls="shell-rail"]').click();
      await page.waitForTimeout(800);
      log(
         'r3-menu',
         await page.evaluate(() => {
            const r = document.getElementById('shell-rail');
            return {
               search: [...r.querySelectorAll('input,button,a')]
                  .filter((e) => /search|command|⌘/i.test(`${e.getAttribute('aria-label') || ''}${e.getAttribute('placeholder') || ''}${e.textContent}`))
                  .map((e) => (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30)),
               links: [...r.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')),
            };
         })
      );

      await go(page, '/berry/settings/members');
      log('r4-members-create-link', await hitBy(page, 'create link'));
      await go(page, '/berry/settings/connected-accounts');
      log('r5-connected-add', await hitBy(page, '^\\s*add\\s*$'));

      await go(page, '/berry/projects');
      await page.getByRole('button', { name: /New project/ }).first().tap();
      await page.waitForTimeout(2500);
      log('r6-new-project', await hitBy(page, 'create with agent|^create project$', '[role=dialog]'));
      await page.keyboard.press('Escape');

      await go(page, '/berry/views');
      log(
         'r7-views-chips',
         await page.evaluate(() =>
            [...document.querySelectorAll('main a, main button')]
               .filter((e) => /Open bugs|Urgent and high|Waiting for review|Blocked|My open/.test(e.textContent || ''))
               .slice(0, 10)
               .map((e) => ({ t: e.textContent.trim().slice(0, 24), ...window.__hit(e) }))
         )
      );

      for (const [p, re] of [
         ['/berry/cycles', 'new cycle'],
         ['/berry/loops', 'new loop'],
         ['/berry/agents', 'new agent'],
         ['/berry/skills', 'new skill'],
      ]) {
         await go(page, p);
         log('r8-header-' + p.split('/').pop(), await hitBy(page, re));
      }

      await go(page, '/berry/tasks');
      log(
         'r10-select-checkbox',
         await page.evaluate(() => {
            const c = document.querySelector('[aria-label="Select task"]');
            return c ? { opacity: getComputedStyle(c).opacity, ...window.__hit(c) } : null;
         })
      );
      await ctx.close();
   },

   // ---- 2. Keyboard: focus a field, then shrink the viewport by a phone keyboard ----
   async keyboard(browser) {
      const { ctx, page } = await newPage(browser);
      const KB = 844 - 336;
      const check = async (name, focusFn) => {
         try {
            await focusFn();
            await page.waitForTimeout(600);
            await page.setViewportSize({ width: 390, height: KB });
            await page.waitForTimeout(1000);
            await clean(page);
            log(
               'kb-' + name,
               await page.evaluate(() => {
                  const a = document.activeElement;
                  const r = a?.getBoundingClientRect();
                  const subs = [...document.querySelectorAll('button')]
                     .filter(
                        (b) =>
                           b.offsetParent &&
                           /send|submit|create|save|comment|post|draft/i.test(`${b.getAttribute('aria-label') || ''} ${b.textContent} ${b.type}`)
                     )
                     .slice(0, 4)
                     .map((b) => ({ l: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 24), ...window.__hit(b) }));
                  return {
                     active: a ? a.tagName + (a.getAttribute('aria-label') ? `[${a.getAttribute('aria-label')}]` : '') : null,
                     rect: r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null,
                     vh: innerHeight,
                     subs,
                  };
               })
            );
            await snap(page, 'v-kb-' + name);
         } catch (e) {
            log('kb-' + name, 'fail ' + String(e).slice(0, 160));
         }
         await page.setViewportSize({ width: 390, height: 844 });
      };
      await go(page, '/berry/tasks');
      await check('new-task', async () => {
         await page.getByRole('button', { name: /New task/ }).first().tap();
         await page.waitForTimeout(2000);
         await page.locator('[role=dialog] [contenteditable=true], [role=dialog] input, [role=dialog] textarea').first().focus();
      });
      await go(page, '/berry/tasks');
      await check('issue-comment', async () => {
         await tapLink(page, /\/berry\/issue\/[^/?#]+$/);
         const box = page.locator('[role=dialog] textarea, [role=dialog] [contenteditable=true]').last();
         await box.scrollIntoViewIfNeeded();
         await box.focus();
      });
      await go(page, '/berry/projects');
      await check('floating-chat', async () => {
         await page.getByRole('button', { name: /Agents/ }).last().tap();
         await page.waitForTimeout(2500);
         await page.locator('textarea, [contenteditable=true]').last().focus();
      });
      await go(page, '/berry/chat', 7000);
      await check('chat-page', async () => {
         await page.locator('main textarea, main [contenteditable=true]').last().focus();
      });
      await go(page, '/berry/loops/new', 6000);
      await check('new-loop', async () => {
         await page.locator('main textarea, main [contenteditable=true], main input').first().focus();
      });
      await go(page, '/berry/settings/general');
      await check('settings-name', async () => {
         await page.locator('main input').first().focus();
      });
      await ctx.close();
   },

   // ---- 3. Landscape phone (844x390, still under lg) ----
   async landscape(browser) {
      const { ctx, page } = await newPage(browser, 844, 390);
      const m = async (name) => {
         log(
            'land-' + name,
            await page.evaluate(() => {
               let best = null;
               for (const el of document.querySelectorAll('*')) {
                  const s = getComputedStyle(el);
                  if (!/(auto|scroll)/.test(s.overflowY) || el.scrollHeight <= el.clientHeight + 4) continue;
                  const r = el.getBoundingClientRect();
                  const a = r.width * el.clientHeight;
                  if (!best || a > best.a) best = { a, top: Math.round(r.top), h: el.clientHeight };
               }
               const d = document.querySelector('[role=dialog]');
               const dr = d?.getBoundingClientRect();
               return {
                  vh: innerHeight,
                  scroller: best && { top: best.top, h: best.h },
                  dialog: d ? { top: Math.round(dr.top), bottom: Math.round(dr.bottom), scrollH: d.scrollHeight, clientH: d.clientHeight } : null,
                  ...window.__measure(),
               };
            })
         );
         await snap(page, 'v-land-' + name);
      };
      for (const [n, p] of [
         ['tasks', '/berry/tasks'],
         ['projects', '/berry/projects'],
         ['settings', '/berry/settings/general'],
         ['chat', '/berry/chat'],
         ['inbox', '/berry/inbox'],
         ['cycles', '/berry/cycles'],
      ]) {
         await go(page, p);
         await m(n);
      }
      await go(page, '/berry/tasks');
      await tapLink(page, /\/berry\/issue\/[^/?#]+$/);
      await m('issue-drawer');
      await go(page, '/berry/tasks');
      await page.getByRole('button', { name: /New task/ }).first().tap();
      await page.waitForTimeout(2000);
      await m('new-task');
      await go(page, '/berry/projects');
      await page.getByRole('button', { name: /Agents/ }).last().tap();
      await page.waitForTimeout(2500);
      await m('floating-chat');
      await ctx.close();
   },

   // ---- 4. Filter submenus on touch ----
   async submenu(browser) {
      const { ctx, page } = await newPage(browser);
      await go(page, '/berry/tasks');
      await page.locator('button[aria-label*="ilter" i]').first().tap();
      await page.waitForTimeout(1200);
      const dump = () =>
         page.evaluate(() => ({
            poppers: [...document.querySelectorAll('[data-radix-popper-content-wrapper]')].map((w) => {
               const r = w.getBoundingClientRect();
               return [r.left, r.top, r.right, r.bottom].map(Math.round);
            }),
            items: [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role], [data-radix-popper-content-wrapper] button')]
               .slice(0, 16)
               .map((e) => `${e.getAttribute('role') || e.tagName}${e.getAttribute('aria-haspopup') ? '+pop' : ''}:${(e.textContent || '').trim().slice(0, 18)}`),
         }));
      log('sub-open', await dump());
      await snap(page, 'v-sub-open');
      const status = page.locator('[data-radix-popper-content-wrapper]').getByText(/^Status$/).first();
      if (await status.count()) {
         await status.tap();
         await page.waitForTimeout(1200);
         log('sub-after-tap-status', await dump());
         await snap(page, 'v-sub-status');
      } else log('sub-after-tap-status', 'no Status item');
      await ctx.close();
   },

   // ---- 5. Routes the first pass never opened ----
   async routes(browser) {
      const { ctx, page } = await newPage(browser);
      const json = {};
      page.on('response', async (r) => {
         const u = r.url();
         if (!/\/api\/v1\//.test(u) || r.request().method() !== 'GET') return;
         try {
            if ((r.headers()['content-type'] || '').includes('json')) json[u] = await r.json();
         } catch {}
      });
      const idFrom = (re) => {
         for (const [u, j] of Object.entries(json)) {
            if (!re.test(u.split('?')[0])) continue;
            const arr = Array.isArray(j) ? j : j?.nodes || j?.items || j?.data;
            if (Array.isArray(arr) && arr[0]?.id) return arr[0].id;
         }
         return null;
      };
      const audit = async (name, path) => {
         try {
            await go(page, path, 6000);
            log('route-' + name, { url: page.url().replace(BASE, ''), ...(await measure(page)) });
            await snap(page, 'v-route-' + name);
         } catch (e) {
            log('route-' + name, 'fail ' + String(e).slice(0, 140));
         }
      };
      // Soft navigation so the @drawer intercept renders the drawer, not the full page.
      const drawer = async (name, list, path) => {
         try {
            await go(page, list, 6000);
            const pushed = await page.evaluate((p) => {
               if (window.next?.router?.push) {
                  window.next.router.push(p);
                  return true;
               }
               return false;
            }, path);
            if (!pushed) await page.goto(BASE + path);
            await page.waitForTimeout(5000);
            await clean(page);
            log('drawer-' + name, {
               via: pushed ? 'push' : 'goto',
               url: page.url().replace(BASE, ''),
               dialog: await page.locator('[role=dialog]').count(),
               ...(await measure(page)),
               closeish: await page.evaluate(() =>
                  [...document.querySelectorAll('[role=dialog] button')]
                     .map((b) => b.getAttribute('aria-label') || '')
                     .filter((t) => /close/i.test(t))
               ),
            });
            await snap(page, 'v-drawer-' + name);
         } catch (e) {
            log('drawer-' + name, 'fail ' + String(e).slice(0, 140));
         }
      };
      for (const [n, p] of [
         ['dashboard', '/berry/dashboard'],
         ['approvals', '/berry/approvals'],
         ['proposals', '/berry/proposals'],
         ['goals', '/berry/goals'],
         ['milestones', '/berry/milestones'],
         ['my-issues', '/berry/my-issues'],
         ['members', '/berry/members'],
         ['runtimes', '/berry/runtimes'],
         ['logs', '/berry/logs'],
         ['autopilots', '/berry/autopilots'],
         ['agent', '/berry/agent'],
         ['plans', '/berry/plans'],
         ['skills', '/berry/skills'],
         ['views', '/berry/views'],
      ]) {
         await audit(n, p);
      }
      const plan = idFrom(/\/plans$/);
      const skill = idFrom(/\/skills$/);
      const goal = idFrom(/\/goals$/);
      const milestone = idFrom(/milestones$/);
      const view = idFrom(/\/views$/);
      const runtime = idFrom(/\/runtimes$/);
      const member = idFrom(/members$/);
      log('route-ids', { plan, skill, goal, milestone, view, runtime, member });
      if (plan) await drawer('plan', '/berry/plans', `/berry/plan/${plan}`);
      if (skill) await drawer('skill', '/berry/skills', `/berry/skills/${skill}`);
      if (view) await drawer('view', '/berry/views', `/berry/view/${view}`);
      if (milestone) await drawer('milestone', '/berry/milestones', `/berry/milestone/${milestone}/overview`);
      if (goal) await audit('goal-detail', `/berry/goal/${goal}/overview`);
      if (runtime) await audit('runtime-detail', `/berry/runtimes/${runtime}`);
      if (member) {
         await drawer('profile', '/berry/members', `/berry/profiles/${member}`);
         await audit('member-detail', `/berry/members/${member}`);
      }
      await go(page, '/berry/projects');
      const proj = await page.evaluate(() =>
         [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => /\/berry\/project\/[^/]+\/overview$/.test(h))
      );
      if (proj) {
         await drawer('project-issues', '/berry/projects', proj.replace(/overview$/, 'issues'));
         await drawer('project-activity', '/berry/projects', proj.replace(/overview$/, 'activity'));
      }
      await go(page, '/berry/loops');
      const loop = await page.evaluate(() =>
         [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => /\/berry\/(autopilot|loop)\/[^/?#]+$/.test(h))
      );
      if (loop) await audit('loop-detail-direct', loop);
      await ctx.close();
   },

   // ---- 6. Signed-out screens (dev auto-login refused) ----
   async auth(browser) {
      const { ctx, page } = await newPage(browser);
      await ctx.route('**/api/v1/auth/dev-login', (r) =>
         r.fulfill({ status: 401, contentType: 'application/json', body: '{"error":{"code":"UNAUTHENTICATED","message":"no"}}' })
      );
      for (const [n, p] of [
         ['root', '/'],
         ['login', '/login'],
         ['sign-in', '/sign-in'],
         ['reset', '/reset-password'],
         ['invite', '/invite/abc123'],
         ['join', '/join/abc123'],
         ['invitations', '/invitations'],
         ['onboarding', '/onboarding'],
         ['deep-link', '/berry/issue/BER-511'],
         ['not-found', '/this-does-not-exist'],
      ]) {
         try {
            await go(page, p, 5000);
            log('auth-' + n, {
               url: page.url().replace(BASE, ''),
               text: (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 140),
               ...(await measure(page)),
            });
            await snap(page, 'v-auth-' + n);
         } catch (e) {
            log('auth-' + n, 'fail ' + String(e).slice(0, 140));
         }
      }
      await ctx.close();
   },

   // ---- 7. Error, slow and offline states ----
   async states(browser) {
      {
         const { ctx, page } = await newPage(browser);
         await ctx.route('**/api/**', (r) => r.abort());
         await go(page, '/berry/tasks', 6000);
         log('st-unreachable', { url: page.url().replace(BASE, ''), text: (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200) });
         await snap(page, 'v-st-unreachable');
         await ctx.close();
      }
      {
         const { ctx, page } = await newPage(browser);
         await ctx.route(/\/api\/v1\/.*issues/, (r) =>
            r.request().method() === 'GET'
               ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":{"code":"INTERNAL","message":"boom"}}' })
               : r.continue()
         );
         await go(page, '/berry/tasks', 7000);
         log('st-issues-500', { text: (await page.evaluate(() => document.querySelector('main')?.innerText || document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200) });
         await snap(page, 'v-st-issues-500');
         await ctx.close();
      }
      {
         const { ctx, page } = await newPage(browser);
         for (const [n, p] of [
            ['issue', '/berry/issue/BER-99999'],
            ['project', '/berry/project/00000000-0000-0000-0000-000000000000/overview'],
            ['page', '/berry/nope'],
         ]) {
            await go(page, p, 6000);
            log('st-404-' + n, { text: (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 160), ...(await measure(page)) });
            await snap(page, 'v-st-404-' + n);
         }
         await ctx.close();
      }
      for (const slow of [false, true]) {
         const { ctx, page } = await newPage(browser);
         if (slow)
            await ctx.route('**/api/v1/**', async (r) => {
               await new Promise((res) => setTimeout(res, 2500));
               await r.continue().catch(() => {});
            });
         // Warm the route so compile time is not counted.
         await go(page, '/berry/tasks', 4000);
         const t0 = Date.now();
         await page.goto(BASE + '/berry/tasks', { waitUntil: 'domcontentloaded', timeout: 120000 });
         const tag = slow ? 'slow' : 'normal';
         const frames = [];
         for (const at of [1200, 3500, 8000]) {
            await page.waitForTimeout(Math.max(0, at - (Date.now() - t0)));
            await clean(page);
            frames.push({
               at,
               rows: await page.evaluate(() => document.querySelectorAll('a[href*="/berry/issue/"]').length),
               skeletons: await page.evaluate(() => document.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length),
            });
            await page.screenshot({ path: `${dir}/v-st-${tag}-${at}.png` });
         }
         log('st-load-' + tag, { frames, cls: await page.evaluate(() => Math.round(window.__cls * 1000) / 1000) });
         await ctx.close();
      }
      {
         const { ctx, page } = await newPage(browser);
         await go(page, '/berry/tasks');
         await ctx.setOffline(true);
         try {
            await tapLink(page, /\/berry\/issue\/[^/?#]+$/);
         } catch (e) {
            log('st-offline-nav', String(e).slice(0, 120));
         }
         await page.waitForTimeout(3000);
         log('st-offline', { url: page.url().replace(BASE, ''), text: (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200) });
         await snap(page, 'v-st-offline');
         await ctx.setOffline(false);
         await ctx.close();
      }
   },

   // ---- 8. Touch: long-press, board swipe and drag, hover-only controls ----
   async touch(browser) {
      const { ctx, page } = await newPage(browser);
      const cdp = await ctx.newCDPSession(page);
      await go(page, '/berry/tasks');
      const row = await page.evaluate(() => {
         const a = document.querySelector('a[href*="/berry/issue/"]');
         const r = a.getBoundingClientRect();
         return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [row] });
      await page.waitForTimeout(1100);
      const during = await page.evaluate(() => document.querySelectorAll('[role=menu]').length);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(900);
      log('t-longpress', { menuDuring: during, menuAfter: await page.evaluate(() => document.querySelectorAll('[role=menu]').length), url: page.url().replace(BASE, '') });
      await snap(page, 'v-t-longpress');

      const hiddenControls = (name) =>
         page.evaluate((name) => {
            const els = [...document.querySelectorAll('button,a[href],[role=button],[role=checkbox]')];
            let n = 0;
            const ex = [];
            for (const e of els) {
               const r = e.getBoundingClientRect();
               if (!r.width || !r.height) continue;
               let op = 1;
               for (let x = e; x && x !== document.body; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
               if (op < 0.05) {
                  n++;
                  if (ex.length < 6) ex.push((e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24));
               }
            }
            const tips = document.querySelectorAll('[data-slot="tooltip-trigger"]').length;
            return { name, invisibleControls: n, examples: ex, tooltipTriggers: tips };
         }, name);
      const hc = [];
      hc.push(await hiddenControls('tasks'));
      await go(page, '/berry/tasks');
      await tapLink(page, /\/berry\/issue\/[^/?#]+$/);
      hc.push(await hiddenControls('issue-drawer'));
      for (const [n, p] of [
         ['loops', '/berry/loops'],
         ['views', '/berry/views'],
         ['chat', '/berry/chat'],
      ]) {
         await go(page, p, 6000);
         hc.push(await hiddenControls(n));
      }
      await go(page, '/berry/cycles');
      try {
         await tapLink(page, /\/berry\/cycle\/[^/?#]+$/);
         hc.push(await hiddenControls('cycle-drawer'));
      } catch {}
      await go(page, '/berry/projects');
      try {
         await tapLink(page, /\/berry\/project\/[^/]+\/overview$/);
         hc.push(await hiddenControls('project-drawer'));
      } catch {}
      await go(page, '/berry/tasks');
      await page.locator('button[aria-controls="shell-rail"]').click();
      await page.waitForTimeout(800);
      hc.push(await hiddenControls('menu'));
      log('t-hover-only', hc);

      // Board: horizontal swipe and a touch drag of a card.
      await go(page, '/berry/tasks');
      const board = page.locator('button[aria-label*="oard" i], [role="radio"][aria-label*="oard" i], [role="tab"][aria-label*="oard" i]').first();
      if (await board.count()) await board.tap();
      await page.waitForTimeout(2500);
      await clean(page);
      await page.evaluate(() => {
         window.__ds = 0;
         document.addEventListener('dragstart', () => window.__ds++, true);
      });
      const sc = await page.evaluate(() => {
         let best = null;
         for (const el of document.querySelectorAll('main *')) {
            const s = getComputedStyle(el);
            if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 20 && (!best || el.scrollWidth > best.scrollWidth)) best = el;
         }
         if (!best) return null;
         best.setAttribute('data-probe-x', '1');
         const r = best.getBoundingClientRect();
         return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(r.height / 2, 300)), sw: best.scrollWidth, cw: best.clientWidth, before: best.scrollLeft };
      });
      if (sc) {
         await cdp.send('Input.synthesizeScrollGesture', { x: sc.x, y: sc.y, xDistance: -250, yDistance: 0, gestureSourceType: 'touch', speed: 800 });
         await page.waitForTimeout(800);
         sc.after = await page.evaluate(() => document.querySelector('[data-probe-x]').scrollLeft);
      }
      log('t-board-swipe', sc);
      const card = await page.evaluate(() => {
         const c = document.querySelector('[draggable="true"]');
         if (!c) return null;
         const r = c.getBoundingClientRect();
         return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      });
      if (card) {
         await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [card] });
         await page.waitForTimeout(700);
         for (let i = 1; i <= 8; i++) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: card.x + i * 30, y: card.y + i * 4 }] });
            await page.waitForTimeout(60);
         }
         await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
         await page.waitForTimeout(800);
      }
      log('t-board-drag', { card, dragstartEvents: await page.evaluate(() => window.__ds) });
      await snap(page, 'v-t-board');
      await ctx.close();
   },
};

(async () => {
   const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   for (const [name, fn] of Object.entries(sections)) {
      if (only && !only.test(name)) continue;
      try {
         await fn(browser);
      } catch (e) {
         log('fail-' + name, String(e).slice(0, 300));
      }
      fs.writeFileSync(`${dir}/validate.json`, JSON.stringify(out, null, 1));
   }
   await browser.close();
})().catch((e) => {
   console.error(e);
   process.exit(1);
});

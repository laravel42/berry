// Phase 1 on the real Android: real taps and the real keyboard on each fix.
// Usage: node phone-f1.cjs <outDir> [testFilter]
const { connect } = require('./phone-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'phone-f1';
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
fs.mkdirSync(dir, { recursive: true });
const out = {};
const log = (k, v) => {
   out[k] = v;
   console.log(k, JSON.stringify(v).slice(0, 900));
};

(async () => {
   const p = await connect();
   const { page } = p;
   await p.go('/berry/tasks');
   await p.calibrate();
   const ev = (fn, arg) => page.evaluate(fn, arg);
   const hitBy = (src, scope) => ev(([s, sc]) => window.__hitBy(s, sc), [src, scope]);
   const firstHit = async (src, scope) => (await hitBy(src, scope)).find((x) => x.hittable);
   const path = () => page.url().replace(/^https?:\/\/[^/]+/, '');
   const tabs = () =>
      ev(() => {
         const nav = document.querySelector('nav[aria-label="Primary"]');
         return nav
            ? [...nav.querySelectorAll('a,button')].map((e) => ({
                 t: (e.textContent || '').trim().slice(0, 10),
                 cur: e.getAttribute('aria-current'),
                 ...window.__hit(e),
              }))
            : null;
      });
   const tab = async (name) => {
      const all = await tabs();
      const tb = all.find((x) => x.t.startsWith(name));
      await p.tapRect(tb.rect);
      await p.wait(1500);
   };
   const closeKeyboard = async () => {
      if (p.keyboardShown()) await p.back();
   };

   const tests = {
      async 'tab-bar'() {
         await p.go('/berry/tasks');
         log('tab-bar', {
            tabs: await tabs(),
            main: await ev(() => Math.round(document.querySelector('main').getBoundingClientRect().bottom)),
            vp: await ev(() => window.__vp()),
         });
         p.screencap(`${dir}/01-tasks-bar.png`);
         await tab('Projects');
         log('tab-projects', { url: path(), cur: (await tabs()).filter((x) => x.cur).map((x) => x.t) });
         await tab('Tasks');
      },
      async 'agents-chat'() {
         await p.go('/berry/tasks');
         await tab('Agents');
         await p.wait(1000);
         const box = await ev(() => {
            const t = [...document.querySelectorAll('textarea')].pop();
            return t ? window.__hit(t) : null;
         });
         log('chat-open', { composer: box, send: await hitBy('^send$') });
         if (box) {
            await p.tapRect(box.rect);
            await p.wait(1500);
            log('chat-keyboard', { keyboard: p.keyboardShown(), vp: await ev(() => window.__vp()), send: await hitBy('^send$') });
            p.screencap(`${dir}/02-chat-keyboard.png`);
            await closeKeyboard();
         }
         await tab('Agents');
      },
      async 'palette'() {
         await p.go('/berry/tasks');
         await tab('More');
         const s = await firstHit('^search$', '#shell-rail');
         if (!s) return log('palette', 'no Search row');
         await p.tapRect(s.rect);
         await p.wait(1800);
         log('palette-keyboard', {
            keyboard: p.keyboardShown(),
            vp: await ev(() => window.__vp()),
            visibleItems: await ev(
               () => [...document.querySelectorAll('[role=dialog] [cmdk-item]')].filter((e) => window.__hit(e).inVisibleViewport).length
            ),
            hint: await ev(() =>
               [...document.querySelectorAll('[role=dialog] span')].some((e) => /new tab/i.test(e.textContent || '') && e.getBoundingClientRect().width > 0)
            ),
            kbd: await ev(() => [...document.querySelectorAll('[role=dialog] kbd')].filter((e) => e.getBoundingClientRect().width > 0).length),
         });
         p.screencap(`${dir}/03-palette-keyboard.png`);
         await closeKeyboard();
         await p.back();
      },
      async 'selection'() {
         await p.go('/berry/tasks');
         const c = await ev(() => {
            const el = document.querySelector('[aria-label="Select task"]');
            let op = 1;
            for (let x = el; x && x !== document.body; x = x.parentElement) op *= Number(getComputedStyle(x).opacity);
            return { opacity: op, ...window.__hit(el) };
         });
         await p.tapRect(c.rect);
         await p.wait(1200);
         log('selection', {
            before: c,
            url: path(),
            checked: await ev(() => document.querySelector('[aria-label="Select task"]').getAttribute('data-state')),
            bar: await ev(() =>
               ['Status', 'Priority', 'Assignee', 'AutoGate', 'Delete', 'Clear'].map((n) => {
                  const b = [...document.querySelectorAll('main button')].find((x) => (x.textContent || '').trim() === n);
                  return b ? { n, ...window.__hit(b) } : { n, missing: true };
               })
            ),
         });
         p.screencap(`${dir}/04-selection.png`);
         const clear = await firstHit('^clear$', 'main');
         if (clear) await p.tapRect(clear.rect);
      },
      async 'filter'() {
         await p.go('/berry/tasks');
         const f = await ev(() => window.__hit(document.querySelector('button[aria-label*="ilter" i]')));
         await p.tapRect(f.rect);
         await p.wait(1200);
         const st = await ev(() => {
            const e = [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role=option]')].find((o) => (o.textContent || '').trim() === 'Status');
            return e ? window.__hit(e) : null;
         });
         if (st) {
            await p.tapRect(st.rect);
            await p.wait(1200);
         }
         log(
            'filter-values',
            await ev(() =>
               [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role=option]')]
                  .filter((o) => /Backlog|Todo|In Progress|Done/.test(o.textContent || ''))
                  .map((o) => ({ t: o.textContent.trim().slice(0, 12), ...window.__hit(o) }))
            )
         );
         log('filter-back', await hitBy('^\\s*back\\s*$', '[data-radix-popper-content-wrapper]'));
         p.screencap(`${dir}/05-filter-values.png`);
         await p.back();
      },
      async 'views-bar'() {
         await p.go('/berry/views');
         log('views-bar', { manage: await hitBy('^manage views$'), more: await hitBy('^more$', 'main') });
         p.screencap(`${dir}/06-views.png`);
      },
      async 'header'() {
         await p.go('/berry/cycles');
         log('header-cycles', await hitBy('^\\s*new cycle\\s*$'));
         p.screencap(`${dir}/07-cycles.png`);
      },
      async 'more-sheet'() {
         await p.go('/berry/tasks');
         await tab('More');
         await ev(() => {
            const r = document.getElementById('shell-rail');
            const s = [...r.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(e).overflowY));
            if (s) s.scrollTop = s.scrollHeight;
         });
         await p.wait(800);
         log(
            'more-sheet',
            await ev(() =>
               ['Agent', 'Plans', 'Views', 'Runs', 'Settings'].map((n) => {
                  const a = [...document.querySelectorAll('#shell-rail a')].find((x) => (x.textContent || '').trim() === n);
                  return a ? { n, ...window.__hit(a) } : { n, missing: true };
               })
            )
         );
         p.screencap(`${dir}/08-more-sheet.png`);
         await p.back();
      },
   };

   for (const [name, fn] of Object.entries(tests)) {
      if (only && !only.test(name)) continue;
      try {
         await fn();
      } catch (e) {
         log('fail-' + name, String(e).slice(0, 300));
      }
   }
   fs.writeFileSync(`${dir}/phone.json`, JSON.stringify(out, null, 1));
   process.exit(0);
})().catch((e) => {
   console.error(String(e).slice(0, 400));
   process.exit(1);
});

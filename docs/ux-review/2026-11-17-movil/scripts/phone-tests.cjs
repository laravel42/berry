// Real-device checks on the phone: real taps, the real keyboard, long-press and drag.
// Usage: node phone-tests.cjs <outDir> [testFilter]
const { connect } = require('./phone-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'phone';
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
fs.mkdirSync(dir, { recursive: true });
const out = {};
const log = (k, v) => {
   out[k] = v;
   console.log(k, JSON.stringify(v).slice(0, 700));
};

(async () => {
   const p = await connect();
   const { page } = p;
   await p.go('/berry/tasks');
   await p.calibrate();
   const ev = (fn, arg) => page.evaluate(fn, arg);
   const hitBy = (src, scope) => ev(([s, sc]) => window.__hitBy(s, sc), [src, scope]);
   const hideKeyboard = async () => {
      if (p.keyboardShown()) await p.back();
   };
   const openLauncher = async () => {
      // A tucked launcher takes one tap to come back and another to open.
      for (let i = 0; i < 3; i++) {
         const st = await ev(() => {
            const b = [...document.querySelectorAll('button')].find((x) => /Agents/.test(x.textContent || '') && x.getBoundingClientRect().width > 0);
            return b ? { rect: window.__hit(b).rect, open: b.getAttribute('aria-expanded'), tucked: b.getAttribute('data-tucked') } : null;
         });
         if (!st || st.open === 'true') return st;
         const r = st.rect;
         // Tap inside the visible part (a tucked button is mostly off the right edge).
         await p.tap(Math.min((r[0] + r[2]) / 2, 400), (r[1] + r[3]) / 2);
         await p.wait(1200);
      }
      return null;
   };

   const tests = {
      async 'chat-keyboard'() {
         await p.go('/berry/projects');
         const st = await openLauncher();
         await p.wait(1500);
         const box = await ev(() => {
            const t = [...document.querySelectorAll('textarea')].pop();
            return t ? window.__hit(t) : null;
         });
         log('chat-before-keyboard', { launcher: st, composer: box, send: await hitBy('^send$') });
         p.screencap(`${dir}/01-chat.png`);
         if (box) {
            await p.tapRect(box.rect);
            await p.wait(1500);
            log('chat-keyboard', { keyboard: p.keyboardShown(), vp: await ev(() => window.__vp()), send: await hitBy('^send$'), agent: await hitBy('^\\s*Agent\\b') });
            p.screencap(`${dir}/02-chat-keyboard.png`);
            await hideKeyboard();
         }
      },
      async 'new-loop-keyboard'() {
         await p.go('/berry/loops/new');
         const box = await ev(() => {
            const t = document.querySelector('main textarea');
            return t ? window.__hit(t) : null;
         });
         if (box) {
            await p.tapRect(box.rect);
            await p.wait(1500);
            log('new-loop-keyboard', { keyboard: p.keyboardShown(), vp: await ev(() => window.__vp()), draft: await hitBy('^\\s*draft loop\\s*$') });
            p.screencap(`${dir}/03-new-loop-keyboard.png`);
            await hideKeyboard();
         } else log('new-loop-keyboard', 'no textarea');
      },
      async 'new-task-keyboard'() {
         await p.go('/berry/tasks');
         const nt = await hitBy('^\\s*new task\\s*$');
         const btn = nt.find((x) => x.hittable);
         if (!btn) return log('new-task-keyboard', 'no New task button');
         await p.tapRect(btn.rect);
         await p.wait(2000);
         log('new-task-open', { keyboard: p.keyboardShown(), vp: await ev(() => window.__vp()) });
         const title = await ev(() => {
            const t = document.querySelector('[role=dialog] input, [role=dialog] [contenteditable=true], [role=dialog] textarea');
            return t ? window.__hit(t) : null;
         });
         if (title) {
            await p.tapRect(title.rect);
            await p.wait(1500);
         }
         log('new-task-keyboard', { keyboard: p.keyboardShown(), vp: await ev(() => window.__vp()), create: await hitBy('^\\s*create task\\s*$', '[role=dialog]') });
         p.screencap(`${dir}/04-new-task-keyboard.png`);
         await hideKeyboard();
      },
      async 'drawer-comment-keyboard'() {
         await p.go('/berry/tasks');
         const link = await ev(() => {
            const a = [...document.querySelectorAll('main a[href]')].find((x) => x.getBoundingClientRect().top > 100 && /\/berry\/issue\/[^/?#]+$/.test(x.getAttribute('href').split('?')[0]));
            return a ? window.__hit(a) : null;
         });
         await p.tapRect(link.rect);
         await p.wait(5000);
         await p.helpers();
         const close = await hitBy('^close$', '[role=dialog]');
         log('drawer-open', { url: page.url().replace('http://localhost:3100', ''), close });
         p.screencap(`${dir}/05-drawer.png`);
         const box = await ev(() => {
            const d = document.querySelector('[role=dialog]');
            const t = [...(d?.querySelectorAll('textarea, [contenteditable=true]') || [])].pop();
            if (!t) return null;
            t.scrollIntoView({ block: 'center' });
            return true;
         });
         await p.wait(800);
         const pos = await ev(() => {
            const d = document.querySelector('[role=dialog]');
            const t = [...(d?.querySelectorAll('textarea, [contenteditable=true]') || [])].pop();
            return t ? { label: t.getAttribute('aria-label') || t.getAttribute('placeholder'), ...window.__hit(t) } : null;
         });
         if (box && pos) {
            await p.tapRect(pos.rect);
            await p.wait(1500);
            log('drawer-comment-keyboard', { field: pos.label, keyboard: p.keyboardShown(), vp: await ev(() => window.__vp()), after: await ev(() => { const a = document.activeElement; return a ? window.__hit(a) : null; }) });
            p.screencap(`${dir}/06-drawer-comment-keyboard.png`);
            await hideKeyboard();
         }
         const c = (await hitBy('^close$', '[role=dialog]')).find((x) => x.hittable);
         if (c) {
            await p.tapRect(c.rect);
            await p.wait(2500);
            log('drawer-close-tap', { url: page.url().replace('http://localhost:3100', ''), dialogs: await ev(() => document.querySelectorAll('[role=dialog]').length) });
         }
      },
      async 'long-press'() {
         await p.go('/berry/tasks');
         const row = await ev(() => {
            const a = [...document.querySelectorAll('main a[href]')].find((x) => x.getBoundingClientRect().top > 100 && /\/berry\/issue\/[^/?#]+$/.test(x.getAttribute('href').split('?')[0]));
            return a ? window.__hit(a) : null;
         });
         const [l, t, r, b] = row.rect;
         await p.longPress((l + r) / 2, (t + b) / 2, 1300);
         await p.wait(800);
         log('long-press', { url: page.url().replace('http://localhost:3100', ''), radixMenus: await ev(() => document.querySelectorAll('[role=menu]').length) });
         p.screencap(`${dir}/07-long-press.png`);
         await p.back();
         await p.wait(800);
         log('long-press-after-back', { url: page.url().replace('http://localhost:3100', '') });
      },
      async 'board'() {
         await p.go('/berry/tasks');
         const toggle = await ev(() => {
            const b = document.querySelector('button[aria-label*="oard" i], [role="radio"][aria-label*="oard" i], [role="tab"][aria-label*="oard" i]');
            return b ? window.__hit(b) : null;
         });
         if (toggle) await p.tapRect(toggle.rect);
         await p.wait(2500);
         await p.helpers();
         const info = await ev(() => {
            let best = null;
            for (const el of document.querySelectorAll('main *')) {
               const s = getComputedStyle(el);
               if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 20 && (!best || el.scrollWidth > best.scrollWidth)) best = el;
            }
            best?.setAttribute('data-probe-x', '1');
            const card = document.querySelector('[draggable="true"]');
            return { scroller: best ? window.__hit(best).rect : null, card: card ? window.__hit(card).rect : null, left: best?.scrollLeft };
         });
         p.screencap(`${dir}/08-board.png`);
         // Quick horizontal swipe on a card: should scroll the board.
         if (info.card) {
            const [l, t, r, b] = info.card;
            await p.swipe(r - 20, (t + b) / 2, l - 150 > 0 ? l : 20, (t + b) / 2, 250);
            await p.wait(800);
            const left = await ev(() => document.querySelector('[data-probe-x]')?.scrollLeft);
            log('board-swipe', { before: info.left, after: left });
            await ev(() => { const s = document.querySelector('[data-probe-x]'); if (s) s.scrollLeft = 0; });
            await p.wait(600);
            // Long-press then slow move: an HTML5 drag, if Chrome turns touch into one.
            await ev(() => { window.__drag = 0; });
            const card = await ev(() => window.__hit(document.querySelector('[draggable="true"]')).rect);
            const cx = (card[0] + card[2]) / 2;
            const cy = (card[1] + card[3]) / 2;
            await p.swipe(cx, cy, cx + 230, cy + 40, 3000);
            await p.wait(1200);
            log('board-drag', { dragstart: await ev(() => window.__drag), url: page.url().replace('http://localhost:3100', '') });
            p.screencap(`${dir}/09-board-drag.png`);
         } else log('board', info);
      },
      async 'menu-search'() {
         await p.go('/berry/tasks');
         const menu = await ev(() => window.__hit(document.querySelector('button[aria-controls="shell-rail"]')));
         await p.tapRect(menu.rect);
         await p.wait(1000);
         const search = (await hitBy('^search$', '#shell-rail')).find((x) => x.hittable);
         p.screencap(`${dir}/10-menu.png`);
         if (search) {
            await p.tapRect(search.rect);
            await p.wait(1500);
            log('menu-search', { keyboard: p.keyboardShown(), vp: await ev(() => window.__vp()), input: await ev(() => { const i = document.querySelector('[cmdk-input], [role=dialog] input'); return i ? window.__hit(i) : null; }) });
            p.screencap(`${dir}/11-palette.png`);
            await hideKeyboard();
            await p.back();
         } else log('menu-search', 'no Search row');
      },
      async 'filter-values'() {
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
         log('filter-values', await ev(() => [...document.querySelectorAll('[data-radix-popper-content-wrapper] [role=option]')].filter((o) => /Backlog|Todo/.test(o.textContent || '')).map((o) => ({ t: o.textContent.trim().slice(0, 12), ...window.__hit(o) }))));
         p.screencap(`${dir}/12-filter-values.png`);
         await p.back();
      },
      async 'text-size'() {
         await p.go('/berry/tasks', 3000);
         log('text-size', await ev(() => ({ root: getComputedStyle(document.documentElement).fontSize, body: getComputedStyle(document.body).fontSize, row: (() => { const a = document.querySelector('a[href*="/berry/issue/"]'); return a ? getComputedStyle(a).fontSize : null; })() })));
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

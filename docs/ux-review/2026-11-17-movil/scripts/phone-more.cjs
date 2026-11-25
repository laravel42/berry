// Real swipe inside the phone "More" sheet; checks the rail scrolls to Settings.
const { connect } = require('./phone-lib.cjs');
const dir = process.argv[2];
(async () => {
   const p = await connect();
   const { page } = p;
   await p.go('/berry/tasks');
   await p.calibrate();
   const ev = (fn, arg) => page.evaluate(fn, arg);
   const more = await ev(() => window.__hit([...document.querySelectorAll('nav[aria-label="Primary"] button')].pop()));
   await p.tapRect(more.rect);
   await p.wait(1200);
   const info = () =>
      ev(() => {
         const r = document.getElementById('shell-rail');
         const chain = [];
         for (const e of [r, ...r.querySelectorAll('*')]) {
            const cs = getComputedStyle(e);
            if (/(auto|scroll)/.test(cs.overflowY)) chain.push({ tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 80), sh: e.scrollHeight, ch: e.clientHeight, st: e.scrollTop });
         }
         const rr = r.getBoundingClientRect();
         const set = [...r.querySelectorAll('a')].find((a) => (a.textContent || '').trim() === 'Settings');
         return { rail: [rr.top, rr.bottom, rr.height].map(Math.round), inner: innerHeight, scrollers: chain, settings: set ? window.__hit(set) : null };
      });
   console.log('before', JSON.stringify(await info()));
   await p.swipe(150, 650, 150, 150, 500);
   await p.wait(900);
   await p.swipe(150, 650, 150, 150, 500);
   await p.wait(900);
   console.log('after', JSON.stringify(await info()));
   p.screencap(`${dir}/09-more-scrolled.png`);
   await p.back();
   process.exit(0);
})().catch((e) => {
   console.error(String(e).slice(0, 400));
   process.exit(1);
});

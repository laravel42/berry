const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const tag = process.argv[2] || 'run';
const paths = (process.argv[3] || '/berry/issue/BER-511').split(',');
(async () => {
   const out = {};
   for (const [w, h] of [[1440, 900], [390, 844], [360, 740]]) {
      for (const p of paths) {
         const s = await open(w, h);
         await s.go(p, 8000);
         const key = `${w}${p}`;
         out[key] = await s.page.evaluate(() => {
            const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map((v) => Math.round(v * 10) / 10); };
            const nav = [...document.querySelectorAll('nav')].find((n) => /BER-[0-9]+/.test(n.textContent) && n.textContent.length < 200);
            const header = nav?.closest('div.flex');
            const navLines = nav ? [...nav.querySelectorAll('span,a')].map((e) => ({ t: e.textContent.trim().slice(0, 20), r: r(e) })) : null;
            const sub = [...document.querySelectorAll('[class*=sub]')].length;
            const subHead = [...document.querySelectorAll('*')].find((e) => /^(Sub-?tasks?|Sub-?issues?)/i.test(e.firstChild?.textContent || '') && e.children.length < 4);
            const consoleBtns = window.__hitBy('console', 'body');
            const act = [...document.querySelectorAll('div')].filter((e) => /\(person\)|\(agent\)/.test(e.textContent) && e.children.length > 0 && e.textContent.length < 200 && e.getBoundingClientRect().height < 80);
            const hits = act.slice(0, 40).map((e) => window.__hit(e));
            return { header: header ? r(header) : null, navLines, subHead: subHead ? r(subHead.parentElement) : null, consoleBtns, actCount: act.length, off: window.__off(), docW: document.documentElement.scrollWidth, actRects: act.slice(0, 40).map(r), hitBad: hits.filter((x) => !x.hittable && x.inView).length };
         });
         await s.shot(`m36-${tag}-${w}${p.replace(/\W/g, '_')}.png`);
         await s.browser.close();
      }
   }
   fs.writeFileSync(`m36-${tag}.json`, JSON.stringify(out, null, 1));
   for (const k of Object.keys(out)) { const o = out[k]; console.log(k, 'hdr', JSON.stringify(o.header), 'nav', JSON.stringify(o.navLines?.map((x) => x.r[3] - x.r[1])), 'off', o.off.offCount, JSON.stringify(o.off.off.slice(0, 3)), 'console', JSON.stringify(o.consoleBtns.map((b) => b.rect.join(',') + (b.hittable ? '' : '!' + b.top))), 'acts', o.actCount, 'hitBad', o.hitBad); }
})();

// Controls that sit on one line inside the same flex row must share a height.
// For every route: find rows (a flex-row ancestor holding 2+ controls whose
// centres align) and report those mixing heights. Usage:
//   node probe-inline.cjs <tag> [widths] [route filter]    (BASE env overrides the origin)
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/mobile-audit2.cjs', 'utf8');
const pages = eval('[' + src.split('const pages = [')[1].split('];')[0] + ']');
const details = eval('[' + src.split('const details = [')[1].split('];')[0] + ']');
const tag = process.argv[2] || 'now';
const widths = (process.argv[3] || '1440,390').split(',').map(Number);
const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
const BASE = process.env.BASE || 'http://localhost:3100';
function rowsWithMixedHeights() {
   const vis = (e) => { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
   const label = (e) => (e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.innerText || e.title || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 22);
   const raw = [...document.querySelectorAll('button, a[data-slot=button], input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=file]), select, [role=combobox]')].filter(vis);
   const units = new Set();
   for (const c of raw) {
      if (c.closest('[role=menu], [role=listbox], [role=dialog] [role=option], [data-radix-popper-content-wrapper]')) continue;
      if (c.getAttribute('role') === 'checkbox' || c.dataset.slot === 'checkbox') continue;
      const g = c.closest('[role=group], [role=tablist], [role=radiogroup]');
      units.add(g && g.querySelectorAll('button, [role=tab], [role=radio]').length > 1 ? g : c);
   }
   const list = [...units].filter(vis);
   const centre = (e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; };
   const groups = new Map();
   for (const c of list) {
      let a = c.parentElement;
      for (let k = 0; a && k < 5; k++, a = a.parentElement) {
         const s = getComputedStyle(a);
         if (!/flex/.test(s.display) || s.flexDirection.startsWith('column')) continue;
         const mates = list.filter((o) => o !== c && a.contains(o) && Math.abs(centre(o) - centre(c)) <= 4);
         if (mates.length) { if (!groups.has(a)) groups.set(a, new Set()); groups.get(a).add(c); mates.forEach((m) => groups.get(a).add(m)); break; }
      }
   }
   const out = [];
   for (const [a, set] of groups) {
      const items = [...set].map((e) => ({ k: label(e), h: Math.round(e.getBoundingClientRect().height), t: Math.round(e.getBoundingClientRect().top) }));
      const hs = items.map((i) => i.h);
      if (Math.max(...hs) - Math.min(...hs) > 2) out.push({ top: Math.min(...items.map((i) => i.t)), items: items.map((i) => `${i.k}:${i.h}`) });
   }
   return out.sort((x, y) => x.top - y.top);
}
(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   const all = {};
   for (const w of widths) {
      const touch = w < 1024;
      const ctx = await b.newContext({ viewport: { width: w, height: w < 768 ? 844 : 900 }, hasTouch: touch, isMobile: touch && w < 768 });
      const p = await ctx.newPage();
      const run = async (name, go) => {
         if (only && !only.test(name)) return;
         try {
            await go();
            await p.waitForTimeout(2200);
            const r = await p.evaluate(rowsWithMixedHeights);
            all[`${name}@${w}`] = r;
            console.log(`${String(w).padStart(4)} ${name.padEnd(22)} ${r.length ? r.map((g) => `[y${g.top}] ` + g.items.join(' | ')).join('  ||  ') : 'ok'}`);
         } catch (e) { console.log(w, name, 'fail', String(e).slice(0, 90)); }
      };
      for (const [name, path] of pages) await run(name, () => p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 }));
      for (const [name, list, re] of details) {
         await run(name, async () => {
            await p.goto(BASE + list, { waitUntil: 'domcontentloaded', timeout: 120000 });
            await p.waitForTimeout(2500);
            const href = await p.evaluate((s) => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => new RegExp(s).test(h.split('?')[0])), re.source);
            if (!href) throw new Error('no detail link');
            await p.goto(BASE + href, { waitUntil: 'domcontentloaded', timeout: 120000 });
         });
      }
      await ctx.close();
   }
   fs.writeFileSync(`toolbar/inline-${tag}.json`, JSON.stringify(all, null, 1));
   await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

// Toolbar audit: for each list screen, the controls in the row(s) under the page
// header (search, filter, display, view switch, buttons): their heights, their
// vertical centres, how many visual rows they wrap into, and overflow.
// Usage: node probe-toolbar.cjs <tag> [widths] [filter]
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const tag = process.argv[2] || 'now';
const widths = (process.argv[3] || '390,360,820,1440').split(',').map(Number);
const only = process.argv[4] ? new RegExp(process.argv[4]) : null;
const BASE = process.env.BASE || 'http://localhost:3100';
const ROUTES = [
   ['tasks', '/berry/tasks'], ['my-tasks', '/berry/my-tasks'], ['projects', '/berry/projects'], ['agents', '/berry/agents'],
   ['agent-catalog', '/berry/agent-catalog'], ['skills', '/berry/skills'], ['skill-catalog', '/berry/skill-catalog'],
   ['loops', '/berry/loops'], ['cycles', '/berry/cycles'], ['runs', '/berry/runs'], ['logs', '/berry/logs'],
   ['reviews', '/berry/reviews'], ['inbox', '/berry/inbox'], ['views', '/berry/views'], ['milestones', '/berry/milestones'],
   ['integrations', '/berry/integrations'], ['members', '/berry/settings/members'], ['issue-labels', '/berry/settings/labels'],
];
(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   const all = {};
   for (const w of widths) {
      const touch = w < 1024;
      const ctx = await b.newContext({ viewport: { width: w, height: w < 768 ? 844 : 1000 }, hasTouch: touch, isMobile: touch && w < 768 });
      const p = await ctx.newPage();
      for (const [name, path] of ROUTES) {
         if (only && !only.test(name)) continue;
         try {
            await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
            await p.waitForSelector('main input, main button', { timeout: 30000 }).catch(() => {});
            await p.waitForTimeout(2000);
            const r = await p.evaluate(() => {
               const vw = document.documentElement.clientWidth;
               const main = document.querySelector('main') || document.body;
               // the first search-like input in the page, and the row it sits in
               const input = [...main.querySelectorAll('input[type=search], input[placeholder]')].find((i) => i.offsetParent && /search|filter|find/i.test(i.placeholder + ' ' + (i.getAttribute('aria-label') || '')));
               if (!input) return { none: true };
               // the toolbar: the first ancestor of the search that spans (almost) the page width
               const mw = main.getBoundingClientRect().width;
               let bar = input.parentElement;
               while (bar && bar !== main && bar.getBoundingClientRect().width < mw * 0.85) bar = bar.parentElement;
               const box = (e) => { const q = e.getBoundingClientRect(); return { t: Math.round(q.top), b: Math.round(q.bottom), l: Math.round(q.left), r: Math.round(q.right), h: Math.round(q.height * 10) / 10 }; };
               let field = input;
               for (let e = input.parentElement; e && e !== bar; e = e.parentElement) { const q = e.getBoundingClientRect(); if (q.height >= input.getBoundingClientRect().height && q.height <= 48 && q.width < mw * 0.85 && /rounded|border|bg-/.test(String(e.className))) field = e; }
               const seen = new Set();
               const ctrls = [];
               for (const c of bar.querySelectorAll('button, [role=tab], a[role=button], select, [role=combobox]')) {
                  if (!c.offsetParent || c.getBoundingClientRect().width === 0 || field.contains(c)) continue;
                  const group = c.closest('[role=group], [role=tablist], [role=radiogroup]');
                  const unit = group && bar.contains(group) ? group : c;
                  if (seen.has(unit)) continue; seen.add(unit); ctrls.push(unit);
               }
               const fb = box(field);
               const items = [{ k: 'search', ...fb }, ...ctrls.map((c) => ({ k: (c.getAttribute('aria-label') || c.textContent || c.tagName).trim().slice(0, 16), ...box(c) }))];
               const cs = items.map((i) => (i.t + i.b) / 2).sort((x, y) => x - y);
               let rows = cs.length ? 1 : 0; for (let k = 1; k < cs.length; k++) if (cs[k] - cs[k - 1] > 8) rows++;
               const tops = items.map((i) => i.t), bottoms = items.map((i) => i.b);
               const heights = [...new Set(items.map((i) => i.h))];
               const centres = items.map((i) => (i.t + i.b) / 2);
               return {
                  bar: box(bar), search: fb, inputH: Math.round(input.getBoundingClientRect().height * 10) / 10,
                  heights, rows, centreSpread: Math.round(Math.max(...centres) - Math.min(...centres)),
                  off: items.filter((i) => i.r > vw + 1 || i.l < -1).map((i) => i.k),
                  overlap: items.some((a, i) => items.some((c, j) => j > i && a.l < c.r - 1 && c.l < a.r - 1 && a.t < c.b - 1 && c.t < a.b - 1)),
                  items: items.map((i) => `${i.k}:${i.h}@${i.t}-${i.l}`).slice(0, 10),
               };
            });
            all[`${name}@${w}`] = r;
            if (!r.none) console.log(`${String(w).padStart(4)} ${name.padEnd(14)} rows=${r.rows} heights=${JSON.stringify(r.heights)} spread=${r.centreSpread} search=${r.search.h}/${r.inputH} off=${r.off.length} overlap=${r.overlap}`);
            else console.log(`${String(w).padStart(4)} ${name.padEnd(14)} (no search)`);
            await p.screenshot({ path: `toolbar/${tag}-${name}-${w}.png`, clip: { x: 0, y: 0, width: w, height: Math.min(260, w < 768 ? 844 : 1000) } });
         } catch (e) { console.log(w, name, 'fail', String(e).slice(0, 100)); }
      }
      await ctx.close();
   }
   require('fs').writeFileSync(`toolbar/${tag}.json`, JSON.stringify(all, null, 1));
   await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

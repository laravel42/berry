// Empty space left under the last thing on each Settings page once its scroll
// container is scrolled to the end. Reports the gap, the padding layers that
// make it up, and any fixed element sitting over the bottom of the viewport.
// Usage: node probe-settings-bottom.cjs [widths] [route filter]   (BASE env overrides the origin)
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/mobile-audit2.cjs', 'utf8');
const pages = eval('[' + src.split('const pages = [')[1].split('];')[0] + ']').filter(([n]) => n.startsWith('s-'));
const widths = (process.argv[2] || '1440,390').split(',').map(Number);
const only = process.argv[3] ? new RegExp(process.argv[3]) : null;
const BASE = process.env.BASE || 'http://localhost:3100';

function measure() {
   const vis = (e) => {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden') return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
   };
   const scrollers = [...document.querySelectorAll('body *')].filter((e) => {
      const s = getComputedStyle(e);
      return /auto|scroll/.test(s.overflowY) && e.clientHeight > 200 && e.scrollHeight > e.clientHeight + 1 && vis(e);
   });
   scrollers.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
   const sc = scrollers[0] || document.querySelector('.settings-surface');
   if (!sc) return { err: 'no scroller' };
   sc.scrollTop = sc.scrollHeight;
   const box = sc.getBoundingClientRect();
   let bottom = -Infinity;
   let last = '';
   for (const e of sc.querySelectorAll('*')) {
      if (!vis(e)) continue;
      // Leaves and controls carry the visible content; wrappers only add padding.
      const leaf = e.children.length === 0 || /^(BUTTON|INPUT|TEXTAREA|SELECT|svg|IMG)$/i.test(e.tagName);
      const filled = getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)';
      if (!leaf && !filled) continue;
      const r = e.getBoundingClientRect();
      if (r.bottom > bottom) { bottom = r.bottom; last = (e.innerText || e.getAttribute('aria-label') || e.tagName).trim().replace(/\s+/g, ' ').slice(0, 30); }
   }
   const pads = [];
   for (let e = sc; e && pads.length < 4; e = e.firstElementChild) {
      const pb = parseFloat(getComputedStyle(e).paddingBottom);
      if (pb) pads.push(`${e.className.toString().split(' ').find((c) => /(^|:)(pb|py|p)-/.test(c)) || e.tagName}:${pb}`);
   }
   const fixed = [...document.querySelectorAll('body *')].filter((e) => {
      const s = getComputedStyle(e);
      if (!/fixed|sticky/.test(s.position) || !vis(e)) return false;
      const r = e.getBoundingClientRect();
      return r.bottom > innerHeight - 80 && r.top > innerHeight / 2;
   }).map((e) => `${(e.getAttribute('aria-label') || e.innerText || e.tagName).trim().slice(0, 16)}@${Math.round(e.getBoundingClientRect().top)}`);
   return {
      scrolls: sc.scrollHeight > sc.clientHeight + 1,
      gap: Math.round(box.bottom - bottom),
      viewportGap: Math.round(innerHeight - bottom),
      last,
      pads: pads.join(' '),
      fixed: fixed.slice(0, 3).join(' '),
   };
}

(async () => {
   const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   for (const w of widths) {
      const touch = w < 1024;
      const ctx = await b.newContext({ viewport: { width: w, height: w < 768 ? 844 : 900 }, hasTouch: touch, isMobile: touch && w < 768 });
      const p = await ctx.newPage();
      for (const [name, path] of pages) {
         if (only && !only.test(name)) continue;
         try {
            await p.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
            await p.waitForTimeout(2200);
            const r = await p.evaluate(measure);
            console.log(`${String(w).padStart(4)} ${name.padEnd(22)} ${r.err || `gap ${String(r.gap).padStart(4)} (vp ${r.viewportGap}) scrolls=${r.scrolls ? 'y' : 'n'} pads[${r.pads}] last="${r.last}"${r.fixed ? ` fixed: ${r.fixed}` : ''}`}`);
         } catch (e) { console.log(w, name, 'fail', String(e).slice(0, 90)); }
      }
      await ctx.close();
   }
   await b.close();
})().catch((e) => { console.error(e); process.exit(1); });

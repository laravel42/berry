// Usage: node probe-m5x.cjs <52|53|54|55> <tag>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const task = process.argv[2];
const tag = process.argv[3] || 'before';
const routes = {
   52: ['/berry/reviews'],
   53: ['/berry/inbox'],
   54: ['/berry/agent-catalog'],
   55: ['/berry/agent-catalog', '/berry/skill-catalog', '/berry/integrations', '/berry/settings/model-tiers'],
};
const measure = () => {
   const out = { docW: document.documentElement.scrollWidth, small: [], cut: [], placeholders: [], h1: [], inboxRows: [] };
   const sm = {};
   for (const el of document.querySelectorAll('main *')) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const s = getComputedStyle(el);
      if (s.display === 'none') continue;
      const fs_ = parseFloat(s.fontSize);
      if (fs_ < 14) sm[fs_] = (sm[fs_] || 0) + 1;
      if (el.scrollWidth > el.clientWidth + 1 && s.overflow !== 'visible' && el.clientWidth > 0)
         out.cut.push(`${el.tagName} "${el.textContent.trim().slice(0, 30)}" ${el.scrollWidth}>${el.clientWidth}`);
      if (/break-all|anywhere/.test(s.wordBreak)) out.cut.push('wordbreak ' + el.textContent.trim().slice(0, 20));
   }
   out.small = sm;
   out.cut = out.cut.slice(0, 12);
   for (const i of document.querySelectorAll('input')) {
      const r = i.getBoundingClientRect();
      if (!r.width) continue;
      const c = document.createElement('canvas').getContext('2d');
      const s = getComputedStyle(i);
      c.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
      const w = c.measureText(i.placeholder || '').width;
      out.placeholders.push({ ph: i.placeholder, textW: Math.round(w), inputW: Math.round(i.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight)), cut: w > i.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight) });
   }
   out.h1 = [...document.querySelectorAll('h1,h2,[role=heading]')].slice(0, 4).map((h) => h.textContent.trim().slice(0, 40));
   out.inboxRows = [...document.querySelectorAll('[data-inbox-row]')].slice(0, 6).map((r) => r.innerText.replace(/\s+/g, ' ').slice(0, 80));
   out.headerText = (document.querySelector('header') || {}).innerText?.replace(/\s+/g, ' ').slice(0, 120);
   out.tiers = [...document.querySelectorAll('main *')].filter((e) => e.children.length === 0 && /^(XHigh|X|High|Medium|Low|Max)/i.test(e.textContent.trim())).slice(0, 8).map((e) => `${e.textContent.trim()}:${e.scrollWidth}/${e.clientWidth}`);
   return out;
};
(async () => {
   const cfgs = [[390, 844, 'light'], [360, 780, 'light'], [390, 844, 'dark'], [1440, 900, 'light']];
   const res = {};
   for (const [w, h, th] of cfgs) {
      const { browser, page, go, shot } = await open(w, h, th);
      for (const r of routes[task]) {
         await go(r);
         const key = `${w}${th === 'dark' ? 'd' : ''}${r.replace(/\//g, '_')}`;
         res[key] = await page.evaluate(measure);
         await shot(`m5x/m5${task}-${tag}-${key}.png`);
      }
      await browser.close();
   }
   fs.writeFileSync(`m5x/m5${task}-${tag}.json`, JSON.stringify(res, null, 1));
   console.log(JSON.stringify(res, null, 1));
})();

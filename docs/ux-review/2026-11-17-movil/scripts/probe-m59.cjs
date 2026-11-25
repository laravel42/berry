// Usage: node probe-m59.cjs <tag>   Counts controls under 24px (audit2 `small` logic) per screen.
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const tag = process.argv[2] || 'before';
const screens = [
   ['skill-catalog', '/berry/skill-catalog'],
   ['skill-labels', '/berry/settings/skill-labels'],
   ['issue-labels', '/berry/settings/issue-labels'],
   ['agent-catalog', '/berry/agent-catalog'],
   ['tasks', '/berry/tasks'],
   ['skills', '/berry/skills'],
   ['projects', '/berry/projects'],
   ['runs', '/berry/runs'],
   ['model-tiers', '/berry/settings/model-tiers'],
   ['cycle', '/berry/cycles', /\/berry\/cycle\/[^/?#]+$/],
];
const measure = () => {
   const vis = (el) => { const s = getComputedStyle(el); if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
   const all = [...document.body.querySelectorAll('*')].filter((el) => !el.closest('[data-sonner-toaster],[aria-hidden="true"]') && vis(el));
   const inter = all.filter((el) => el.matches('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=checkbox],[role=switch],[role=menuitem],[role=combobox],summary'));
   const groups = {};
   let small = 0;
   for (const el of inter) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) {
         small++;
         const cls = (typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 3).join('.');
         const k = `${el.tagName.toLowerCase()}.${cls} "${(el.getAttribute('aria-label') || el.innerText || '').trim().slice(0, 18)}" ${Math.round(r.width)}x${Math.round(r.height)}`;
         groups[k] = (groups[k] || 0) + 1;
      }
   }
   return { small, total: inter.length, top: Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 8) };
};
(async () => {
   const cfgs = [[390, 844, "light"], [1440, 900, "light"]];
   const res = {};
   for (const [w, h, th] of cfgs) {
      const { browser, page, go, shot, tapLink } = await open(w, h, th);
      for (const [name, path, re] of screens) {
         await go(path, 4500);
         if (re) { try { await tapLink(re); } catch (e) { await go(path, 6000); await tapLink(re); } }
         const key = `${name}-${w}${th === 'dark' ? 'd' : ''}`;
         res[key] = await page.evaluate(measure);
         await shot(`m59/${tag}-${key}.png`);
         console.log(key, res[key].small + '/' + res[key].total);
      }
      await browser.close();
   }
   fs.writeFileSync(`m59/${tag}.json`, JSON.stringify(res, null, 1));
})();

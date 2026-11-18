// M3.9 probe: node probe-m39.cjs <before|after>
const { open } = require('./probe-lib.cjs');
const tag = process.argv[2] || 'after';
const measure = () => {
   const lum = (c) => { const [r,g,b] = c.map((v) => { v/=255; return v<=0.03928? v/12.92 : ((v+0.055)/1.055)**2.4; }); return 0.2126*r+0.7152*g+0.0722*b; };
   const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
   const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const p = parse(getComputedStyle(e).backgroundColor); if (p.length < 4 || p[3] > 0.5) return getComputedStyle(e).backgroundColor; } return 'rgb(255,255,255)'; };
   const info = (el) => { if (!el) return null; const s = getComputedStyle(el); const bg = bgOf(el); const f = parse(s.color), b = parse(bg);
      const L1 = lum(f), L2 = lum(b); return { fs: s.fontSize, color: s.color, bg, contrast: +((Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05)).toFixed(2) }; };
   const root = document.querySelector('[data-chat-surface]') || document.querySelector('div.fixed.z-40') || document.querySelector('main');
   const scope = document.querySelector('div.fixed.z-40[class*="shell-canvas"]') || document;
   const reply = [...scope.querySelectorAll('article p')].find((p) => !p.closest('.items-end'));
   const bubble = [...scope.querySelectorAll('article.items-end > div')][0];
   const ta = scope.querySelector('textarea');
   return { root: root && info(root), reply: info(reply), bubble: info(bubble), composer: info(ta), composerWrap: ta && info(ta.closest('form') || ta.parentElement), code: info(scope.querySelector('article pre')), inlineCode: info(scope.querySelector('article code')) };
};
(async () => {
   for (const theme of ['light','dark']) for (const w of [390, 1440]) {
      const s = await open(w, w < 1000 ? 844 : 900, theme);
      const out = {};
      await s.go('/berry/chat', 8000);
      out.page = await s.page.evaluate(measure);
      await s.shot(`m39-${tag}-${theme}-${w}-page.png`);
      await s.go('/berry/tasks', 6000);
      try {
         if (w < 1000) await s.page.getByRole('button', { name: /agents/i }).last().click({ timeout: 5000 });
         else await s.page.getByRole('button', { name: /agents/i }).first().click({ timeout: 5000 });
         await s.page.waitForTimeout(2500);
         // open first agent if a list shows
         out.floating = await s.page.evaluate(measure);
      } catch (e) { out.floating = 'ERR ' + e.message.slice(0, 80); }
      await s.shot(`m39-${tag}-${theme}-${w}-float.png`);
      console.log(theme, w, JSON.stringify(out));
      await s.browser.close();
   }
})();

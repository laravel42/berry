// M2.6 hover-only controls. Usage: node probe-m26.cjs <outDir> [touch|desktop] [extra]
// Reports visible controls whose effective opacity (product up the ancestors) is 0.
// "extra" pages (M2.6b: chat, shell pins) are listed separately.
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm26';
const mode = process.argv[3] || 'both';
fs.mkdirSync(dir, { recursive: true });

const scan = () =>
   [...document.querySelectorAll('button, [role=button], a[href]')]
      .map((e) => {
         let op = 1, vis = true;
         for (let x = e; x && x !== document.documentElement; x = x.parentElement) {
            const s = getComputedStyle(x);
            op *= Number(s.opacity);
            if (s.display === 'none' || s.visibility === 'hidden') vis = false;
         }
         const r = e.getBoundingClientRect();
         if (!vis || r.width === 0 || r.height === 0 || op > 0.01) return null;
         if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight * 3) return null;
         return `${e.tagName.toLowerCase()} "${(e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`;
      })
      .filter(Boolean);

const clickFirst = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);

async function run(w, h) {
   const s = await open(w, h);
   const res = {};
   const rec = async (name) => { res[name] = await s.page.evaluate(scan); await s.shot(`${dir}/${w}-${name.replace(/\W+/g, '_')}.png`); };
   try {
      await s.go('/berry/tasks'); await rec('tasks');
      const href = await s.page.evaluate(() => { const a = [...document.querySelectorAll('main a[href*="/issue/"]')][0]; return a && a.getAttribute('href'); });
      if (href) { await s.push(href); await rec('task-drawer'); } else res['task-drawer'] = ['(no task link)'];
      await s.go('/berry/loops'); await rec('loops');
      await s.go('/berry/views'); await rec('views');
      const vh = await s.page.evaluate(() => { const a = [...document.querySelectorAll('main a[href*="/view/"]')][0]; return a && a.getAttribute('href'); });
      if (vh) { await s.push(vh); await rec('view-drawer'); } else res['view-drawer'] = ['(no view link)'];
      await s.go('/berry/cycles');
      const ch = await s.page.evaluate(() => { const a = [...document.querySelectorAll('main a[href*="/cycle/"]')][0]; return a && a.getAttribute('href'); });
      if (ch) { await s.push(ch); await rec('cycle-drawer'); } else res['cycle-drawer'] = ['(no cycle link)'];
      await s.go('/berry/projects');
      const ph = await s.page.evaluate(() => { const a = [...document.querySelectorAll('main a[href*="/project/"]')][0]; return a && a.getAttribute('href'); });
      if (ph) { await s.push(ph); await rec('project-drawer'); } else res['project-drawer'] = ['(no project link)'];
      // M2.6b hooks (reported separately)
      await s.go('/berry/chat'); await rec('EXTRA chat');
   } catch (e) { res.error = String(e).slice(0, 200); }
   await s.browser.close();
   return res;
}

(async () => {
   const out = {};
   if (mode !== 'desktop') out.touch390 = await run(390, 844);
   if (mode !== 'touch') out.desktop1440 = await run(1440, 900);
   for (const [k, v] of Object.entries(out)) for (const [p, l] of Object.entries(v)) console.log(k, p, Array.isArray(l) ? l.length : l, JSON.stringify(Array.isArray(l) ? l.slice(0, 8) : ''));
   fs.writeFileSync(`${dir}/result.json`, JSON.stringify(out, null, 1));
})();

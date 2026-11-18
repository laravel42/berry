const { open } = require('./probe-lib.cjs');
const dir = process.argv[2]; require('fs').mkdirSync(dir, { recursive: true });
const measure = () => [...document.querySelectorAll('button, span[aria-label]')]
  .filter((e) => /^(Copy|Unpin|Reorder)/i.test(e.getAttribute('aria-label') || ''))
  .map((e) => { const r = e.getBoundingClientRect(); const cx = r.left + r.width/2, cy = r.top + r.height/2;
    const hits = (h) => [[-1,-1],[1,-1],[-1,1],[1,1],[0,0]].every(([dx,dy]) => { const t = document.elementFromPoint(cx+dx*(h-0.5), cy+dy*(h-0.5)); return t && (t===e || e.contains(t)); });
    let size = 0; for (let h = 4; h <= 24; h += 1) { if (hits(h)) size = h*2; else break; }
    return `${(e.getAttribute('aria-label')||'').slice(0,26)} box ${Math.round(r.width)}x${Math.round(r.height)} hit>=${size}`; });
(async () => {
  const s = await open(390, 844);
  await s.go('/berry/chat');
  console.log('chat', JSON.stringify(await s.page.evaluate(measure), null, 1));
  await s.page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Primary"] button')].pop().click());
  await s.page.waitForTimeout(1500);
  await s.page.evaluate(() => document.querySelector('#shell-rail button[aria-label^=Unpin]')?.scrollIntoView({block:'center'})); await s.page.waitForTimeout(500); console.log('more', JSON.stringify(await s.page.evaluate(measure), null, 1));
  await s.shot(dir + '/more.png');
  await s.page.evaluate(() => document.querySelector('#shell-rail')?.scrollIntoView());
  await s.browser.close();
})();

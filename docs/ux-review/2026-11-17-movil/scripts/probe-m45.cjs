const { open } = require('./probe-lib.cjs');
const OUT = __dirname + '/m45/';
async function colOf(page, text) {
   return page.evaluate((t) => {
      const cards = [...document.querySelectorAll('[class*="board-card"]')].filter((c) => c.textContent.includes(t));
      const c = cards[0]; if (!c) return null;
      let el = c; while (el && !el.hasAttribute('data-column-tint') && el.parentElement) { el = el.parentElement; if (el.querySelector(':scope > [data-column-tint]') || el.querySelector('[data-column-tint]') && el.querySelectorAll('[data-column-tint]').length === 1) break; }
      return (el.querySelector('[data-column-tint]')?.textContent || '').trim().slice(0, 30);
   }, text);
}
async function run(path, boardBtn, label, theme) {
   const { browser, page, go, shot } = await open(390, 844, theme);
   await go(path);
   if (boardBtn) { await page.locator(boardBtn).first().tap(); await page.waitForTimeout(3000); await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove())); }
   const cardSel = '[draggable="true"]';
   const n = await page.locator(cardSel).count();
   console.log(label, theme, 'cards', n);
   const card = page.locator(cardSel).first();
   const title = (await card.locator('[role=heading]').first().innerText()).trim();
   const colsBefore = await page.evaluate(() => [...document.querySelectorAll('[data-column-tint]')].map((h) => h.textContent.trim().replace(/\s+/g, ' ')));
   console.log('title', title, 'columns', JSON.stringify(colsBefore));
   const btn = card.locator('button[aria-label="Task actions"]');
   if (await btn.count()) await btn.tap(); else await card.locator('a').first().evaluate(() => {}), await card.tap({ position: { x: 10, y: 8 } });
   await page.waitForTimeout(600);
   await page.getByRole('menuitem', { name: /Move to/ }).tap();
   await page.waitForTimeout(500);
   await shot(OUT + `${label}-390-${theme}-menu.png`);
   const items = await page.evaluate(() => [...document.querySelectorAll('[role=menuitemradio]')].map((i) => i.textContent.trim() + (i.getAttribute('aria-checked') === 'true' ? '*' : '') + (i.hasAttribute('data-disabled') ? '(d)' : '')));
   console.log('move items', JSON.stringify(items));
   if (theme === 'light') {
      const target = items.find((i) => !i.includes('*'));
      const name = target.replace(/\(d\)|\*/g, '');
      const before = await page.evaluate((t) => { const el = [...document.querySelectorAll('[data-column-tint]')]; return el.map((h) => h.textContent.trim().replace(/\s+/g, ' ')); }, title);
      await page.getByRole('menuitemradio', { name }).first().tap();
      await page.waitForTimeout(2000);
      const where = async () => page.evaluate((t) => { for (const h of document.querySelectorAll('[data-column-tint]')) { let col = h.closest('div'); while (col && !col.textContent.includes(t) && col.parentElement && col.parentElement.querySelectorAll('[data-column-tint]').length <= 1) col = col.parentElement; } 
         const out = []; document.querySelectorAll('[draggable="true"]').forEach((c) => { if (c.textContent.includes(t)) { let e = c; for (let i = 0; i < 8 && e; i++, e = e.parentElement) { const h = e.querySelector('[data-column-tint]'); if (h && e.querySelectorAll('[data-column-tint]').length === 1) { out.push(h.textContent.trim().replace(/\s+/g, ' ')); break; } } } }); return out; }, title);
      console.log('after move to', name, '=> card now in', JSON.stringify(await where()));
      await shot(OUT + `${label}-390-moved.png`);
      // move back
      const orig = items.find((i) => i.includes('(d)') || i.includes('*')).replace(/\(d\)|\*/g, '');
      const c2 = page.locator('[draggable="true"]', { hasText: title }).first();
      const b2 = c2.locator('button[aria-label="Task actions"]');
      if (await b2.count()) await b2.tap(); else await c2.tap({ position: { x: 10, y: 8 } });
      await page.waitForTimeout(600);
      await page.getByRole('menuitem', { name: /Move to/ }).tap();
      await page.waitForTimeout(400);
      await page.getByRole('menuitemradio', { name: orig }).first().tap();
      await page.waitForTimeout(2000);
      console.log('restored to', orig, '=>', JSON.stringify(await where()));
      // horizontal scroll
      const sc = await page.evaluate(() => { let best = null; for (const el of document.querySelectorAll('main *')) { const s = getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 20 && (!best || el.scrollWidth > best.scrollWidth)) best = el; } best.setAttribute('data-probe-x', '1'); const r = best.getBoundingClientRect(); return [r.bottom]; });
      const cdp = await page.context().newCDPSession(page);
      await page.evaluate(() => (document.querySelector('[data-probe-x]').scrollLeft = 0));
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y: sc[0] - 20 }] });
      for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - i * 25, y: sc[0] - 20 }] }); await page.waitForTimeout(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(800);
      console.log('scrollLeft after swipe', await page.evaluate(() => document.querySelector('[data-probe-x]').scrollLeft));
   }
   await browser.close();
}
(async () => {
   for (const theme of ['light', 'dark']) {
      await run('/berry/tasks', 'button[aria-label*="oard" i], [role="radio"][aria-label*="oard" i], [role="tab"][aria-label*="oard" i]', 'tasks', theme);
      await run('/berry/projects', 'button[aria-label*="oard" i], [role="radio"][aria-label*="oard" i], [role="tab"][aria-label*="oard" i]', 'projects', theme);
   }
   // 1440
   const { browser, go, shot } = await open(1440, 900, 'light');
   await go('/berry/tasks'); await shot(OUT + 'tasks-1440-after.png');
   await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

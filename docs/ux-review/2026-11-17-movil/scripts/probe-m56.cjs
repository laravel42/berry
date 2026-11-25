const { open } = require('./probe-lib.cjs');
const OUT = __dirname + '/m56/';
const TAG = process.argv[2] || 'after';
const measure = (page) => page.evaluate(() => {
   const vw = document.documentElement.clientWidth;
   const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width), margin: Math.round(vw - b.right) }; };
   const menus = [...document.querySelectorAll('[data-slot=context-menu-content],[data-slot=context-menu-sub-content],[data-slot=dropdown-menu-content],[data-slot=dropdown-menu-sub-content]')].filter((e) => e.getAttribute('data-state') === 'open').map((e) => ({ slot: e.dataset.slot, ...r(e) }));
   const sc = [...document.querySelectorAll('[data-slot$=-shortcut]')].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 0 && getComputedStyle(e).display !== 'none'; }).length;
   return { vw, menus, visibleShortcuts: sc };
});
async function touch(w, h, theme) {
   const { browser, page, go, shot } = await open(w, h, theme);
   await go('/berry/tasks');
   await page.evaluate(() => { const b = document.querySelector('button[aria-label="Board"]'); if (b && b.getAttribute('aria-pressed') !== 'true') b.click(); });
   await page.waitForTimeout(3000);
   await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove()));
   const card = page.locator('[draggable="true"]').first();
   await card.locator('button[aria-label="Task actions"]').tap();
   await page.waitForTimeout(600);
   console.log(w, theme, 'main', JSON.stringify(await measure(page)));
   await shot(OUT + `${TAG}-${w}-${theme}-main.png`);
   const subs = await page.locator('[role=menuitem][aria-haspopup=menu]').count();
   for (let i = 0; i < subs; i++) {
      const t = page.locator('[role=menuitem][aria-haspopup=menu]').nth(i);
      const name = (await t.innerText()).trim().split('\n')[0];
      await t.tap(); await page.waitForTimeout(500);
      console.log(w, theme, 'sub', name, JSON.stringify((await measure(page)).menus));
      if (i === 0) await shot(OUT + `${TAG}-${w}-${theme}-sub.png`);
   }
   await browser.close();
}
(async () => {
   await touch(390, 844, 'light'); await touch(390, 844, 'dark'); await touch(360, 780, 'light');
   const { browser, page, go, shot } = await open(1440, 900, 'light');
   await go('/berry/tasks');
   await page.locator('[draggable="true"]').first().click({ button: 'right', position: { x: 60, y: 30 } });
   await page.waitForTimeout(600);
   console.log(1440, 'main', JSON.stringify(await measure(page)));
   const t = page.locator('[role=menuitem][aria-haspopup=menu]').first();
   if (await t.count()) { await t.hover(); await page.waitForTimeout(600); console.log(1440, 'sub', JSON.stringify((await measure(page)).menus)); }
   await shot(OUT + `${TAG}-1440.png`);
   await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });

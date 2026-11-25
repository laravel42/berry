// M4.4: with the keyboard open (viewport 390x508), Create task / Draft loop / chat Send stay reachable.
// Usage: node probe-m44.cjs <outDir> <tag>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm44';
const tag = process.argv[3] || 'x';
fs.mkdirSync(dir, { recursive: true });
const hits = (page, src) => page.evaluate((s) => window.__hitBy(s), src);
(async () => {
   for (const theme of ['light', 'dark']) {
      const w = 390, h = 844, kb = 508;
      // new task dialog
      let s = await open(w, h, theme);
      try {
         await s.go('/berry/tasks');
         await s.page.getByRole('button', { name: /^(new|create) task$/i }).first().click().catch(() => {});
         await s.page.waitForTimeout(1500);
         const t = s.page.locator('[data-create-title]');
         await t.focus();
         await s.page.setViewportSize({ width: w, height: kb });
         await s.page.waitForTimeout(800);
         console.log(theme, 'task', JSON.stringify(await hits(s.page, '^Create task$')), 'enterKeyHint=', await t.getAttribute('enterkeyhint'), 'ac=', await t.getAttribute('autocomplete'));
         await s.shot(`${dir}/${tag}-task-${theme}.png`);
      } catch (e) { console.log('task fail', String(e).slice(0, 200)); }
      await s.browser.close();
      // new loop
      s = await open(w, h, theme);
      try {
         await s.go('/berry/loops/new');
         await s.page.locator('#loop-composer').fill('Every Monday summarise last week for the team');
         await s.page.setViewportSize({ width: w, height: kb });
         await s.page.waitForTimeout(800);
         console.log(theme, 'loop', JSON.stringify(await hits(s.page, '^Draft loop$')));
         await s.shot(`${dir}/${tag}-loop-${theme}.png`);
      } catch (e) { console.log('loop fail', String(e).slice(0, 200)); }
      await s.browser.close();
      // chats: floating + page
      s = await open(w, h, theme);
      try {
         await s.go('/berry/projects');
         await s.page.getByRole('button', { name: /Agents/ }).last().click();
         await s.page.waitForTimeout(2500);
         await s.page.locator('textarea').last().focus();
         await s.page.setViewportSize({ width: w, height: kb });
         await s.page.waitForTimeout(800);
         console.log(theme, 'floating', JSON.stringify(await hits(s.page, '^send$')));
         await s.shot(`${dir}/${tag}-float-${theme}.png`);
      } catch (e) { console.log('float fail', String(e).slice(0, 200)); }
      await s.browser.close();
      s = await open(w, h, theme);
      try {
         await s.go('/berry/chat');
         await s.page.locator('textarea').last().focus();
         await s.page.setViewportSize({ width: w, height: kb });
         await s.page.waitForTimeout(800);
         console.log(theme, 'pagechat', JSON.stringify(await hits(s.page, '^send$')));
         await s.shot(`${dir}/${tag}-chat-${theme}.png`);
      } catch (e) { console.log('chat fail', String(e).slice(0, 200)); }
      await s.browser.close();
   }
   // desktop dialog metrics
   const s = await open(1440, 900, 'light');
   await s.go('/berry/tasks');
   await s.page.getByRole('button', { name: /^(new|create) task$/i }).first().click().catch(() => {});
   await s.page.waitForTimeout(1500);
   console.log('1440 dialog', JSON.stringify(await s.page.evaluate(() => { const d = document.querySelector('[role=dialog]'); const r = d?.getBoundingClientRect(); const b = document.querySelector('[data-create-title]')?.closest('div.overflow-y-auto')?.getBoundingClientRect(); return { dlg: r && [r.left, r.top, r.right, r.bottom].map(Math.round), body: b && [b.top, b.bottom].map(Math.round) }; })));
   await s.shot(`${dir}/${tag}-task-1440.png`);
   await s.browser.close();
})();

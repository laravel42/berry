const { open } = require('./probe-lib.cjs');
(async () => {
   for (const theme of ['light', 'dark']) {
      const s = await open(390, 844, theme);
      await s.go('/berry/loops/new');
      await s.page.locator('#loop-composer').fill('Every Monday summarise last week for the team');
      await s.page.setViewportSize({ width: 390, height: 508 });
      await s.page.waitForTimeout(800);
      console.log(theme, 'loop', JSON.stringify(await s.page.evaluate(() => window.__hitBy('^Draft loop$'))));
      await s.shot(`m44/after2-loop-${theme}.png`);
      await s.browser.close();
   }
})();

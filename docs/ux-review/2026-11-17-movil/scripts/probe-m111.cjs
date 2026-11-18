// M1.11: the command palette on a phone with the keyboard up.
// The Galaxy A14 keeps the layout viewport at full height and leaves ~436 px visible
// above the keyboard, so rows below KB_TOP are hidden. Measures where the dialog sits,
// how many result rows end above KB_TOP, the new-tab hint and visible shortcut chips.
// Usage: node probe-m111.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm111';
fs.mkdirSync(dir, { recursive: true });
const KB_TOP = 436;

const state = (page) =>
   page.evaluate((kb) => {
      const input = document.querySelector('[cmdk-input]');
      const d = input?.closest('[role=dialog]');
      const box = (e) => {
         const r = e.getBoundingClientRect();
         return [r.left, r.top, r.right, r.bottom].map(Math.round);
      };
      const shown = (e) => {
         const r = e.getBoundingClientRect();
         const s = getComputedStyle(e);
         return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && Number(s.opacity) > 0;
      };
      const items = d ? [...d.querySelectorAll('[cmdk-item]')].filter(shown) : [];
      const hint = d ? [...d.querySelectorAll('span')].find((e) => /new tab/i.test(e.textContent || '') && e.children.length < 3) : null;
      const ir = input?.getBoundingClientRect();
      const hr = hint && shown(hint) ? hint.getBoundingClientRect() : null;
      return {
         open: !!d,
         dialog: d ? box(d) : null,
         input: input ? box(input) : null,
         items: items.length,
         itemsAboveKeyboard: items.filter((e) => e.getBoundingClientRect().bottom <= kb).length,
         hint: hr ? { rect: [hr.left, hr.top, hr.right, hr.bottom].map(Math.round), overInput: !!ir && hr.left < ir.right && hr.top < ir.bottom && hr.bottom > ir.top } : null,
         kbdShown: d ? [...d.querySelectorAll('kbd')].filter(shown).length : 0,
      };
   }, KB_TOP);

(async () => {
   for (const [w, h] of [
      [390, 844],
      [360, 780],
   ]) {
      const s = await open(w, h);
      try {
         await s.go('/berry/tasks');
         await s.page.locator('button[aria-controls="shell-rail"]').click();
         await s.page.waitForTimeout(800);
         const target = await s.page.evaluate(() =>
            [...document.querySelectorAll('#shell-rail button, #shell-rail a')]
               .filter((e) => /^\s*search\s*$/i.test(e.textContent || '') || /^search$/i.test(e.getAttribute('aria-label') || ''))
               .map((e) => window.__hit(e))
               .find((x) => x.hittable)
         );
         const [l, t, r, b] = target.rect;
         await s.page.touchscreen.tap((l + r) / 2, (t + b) / 2);
         await s.page.waitForTimeout(1500);
         console.log(`${w} empty`, JSON.stringify(await state(s.page)));
         await s.shot(`${dir}/palette-${w}.png`);
         await s.page.keyboard.type('a');
         await s.page.waitForTimeout(2000);
         console.log(`${w} typed`, JSON.stringify(await state(s.page)));
         await s.shot(`${dir}/palette-typed-${w}.png`);
      } catch (e) {
         console.log(`${w} fail`, String(e).slice(0, 200));
      }
      await s.browser.close();
   }
   const d = await open(1440, 900);
   try {
      await d.go('/berry/tasks');
      await d.page.keyboard.press('Control+k');
      await d.page.waitForTimeout(1500);
      console.log('1440 ctrl+k', JSON.stringify(await state(d.page)));
      await d.shot(`${dir}/palette-1440.png`);
   } catch (e) {
      console.log('1440 fail', String(e).slice(0, 200));
   }
   await d.browser.close();
})();

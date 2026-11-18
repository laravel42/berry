// M1.1: the floating chat composer (Send + Agent picker) must be tappable on a phone,
// with and without the keyboard, and the desktop window must not move.
// Usage: node probe-m11.cjs <outDir>
const { open } = require('./probe-lib.cjs');
const fs = require('fs');
const dir = process.argv[2] || 'm11';
fs.mkdirSync(dir, { recursive: true });

(async () => {
   for (const [w, h] of [
      [390, 844],
      [360, 780],
      [1440, 900],
   ]) {
      const s = await open(w, h);
      try {
         await s.go('/berry/projects');
         await s.page.getByRole('button', { name: /Agents/ }).last().click();
         await s.page.waitForTimeout(2500);
         await s.clean();
         const read = () =>
            s.page.evaluate(() => {
               const send = [...document.querySelectorAll('button')].filter((b) => /^send$/i.test(b.getAttribute('aria-label') || ''));
               const agent = [...document.querySelectorAll('button')].filter((b) => /^\s*Agent\b/.test(b.textContent || '') && b.closest('form, [data-step-body]'));
               const panel = document.querySelector('[data-step-body="prose"].fixed');
               const r = panel?.getBoundingClientRect();
               return {
                  send: send.map((b) => window.__hit(b)),
                  agentPicker: agent.slice(0, 1).map((b) => window.__hit(b)),
                  panel: r ? [r.left, r.top, r.right, r.bottom].map(Math.round) : null,
                  launcherVisible: [...document.querySelectorAll('button')].some((b) => /Agents/.test(b.textContent || '') && b.getBoundingClientRect().width > 0),
               };
            });
         console.log(`${w}x${h}`, JSON.stringify(await read()));
         await s.shot(`${dir}/chat-${w}.png`);
         if (w < 1024) {
            await s.page.locator('textarea').last().focus();
            await s.page.setViewportSize({ width: w, height: h - 336 });
            await s.page.waitForTimeout(1000);
            console.log(`${w}x${h - 336} keyboard`, JSON.stringify(await read()));
            await s.shot(`${dir}/chat-${w}-keyboard.png`);
         }
      } catch (e) {
         console.log(`${w}x${h} fail`, String(e).slice(0, 200));
      }
      await s.browser.close();
   }
})();

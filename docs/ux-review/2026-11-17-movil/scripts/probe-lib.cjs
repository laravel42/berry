// Shared helpers for the per-task mobile probes (test web server on :3100).
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const BASE = 'http://localhost:3100';
const UA =
   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

function installHelpers() {
   const nameOf = (n) =>
      n ? (n.getAttribute?.('aria-label') || n.textContent || n.tagName || '').trim().replace(/\s+/g, ' ').slice(0, 40) : null;
   window.__hit = (el) => {
      const r = el.getBoundingClientRect();
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const inView = r.left >= -1 && r.right <= vw + 1 && r.top >= -1 && r.bottom <= vh + 1;
      const top = cx >= 0 && cx <= vw && cy >= 0 && cy <= vh ? document.elementFromPoint(cx, cy) : null;
      const hittable = !!top && (top === el || el.contains(top));
      return { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), inView, hittable, top: hittable ? 'self' : nameOf(top) };
   };
   window.__hitBy = (src, scope) => {
      const re = new RegExp(src, 'i');
      const root = (scope && document.querySelector(scope)) || document.body;
      return [...root.querySelectorAll('button,a[href],[role=button],[role=tab],[role=option],[role=checkbox]')]
         .filter((b) => re.test(`${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.trim()))
         .slice(0, 8)
         .map((e) => ({ label: nameOf(e), ...window.__hit(e) }));
   };
   window.__off = () => {
      const vw = document.documentElement.clientWidth;
      const out = [];
      for (const el of document.body.querySelectorAll('*')) {
         if (el.closest('[aria-hidden="true"],nextjs-portal')) continue;
         const s = getComputedStyle(el);
         if (s.display === 'none' || s.visibility === 'hidden') continue;
         const r = el.getBoundingClientRect();
         if (!r.width || !r.height || (r.right <= vw + 1 && r.left >= -1)) continue;
         const p = el.parentElement?.getBoundingClientRect();
         if (p && (p.right > vw + 1 || p.left < -1)) continue;
         if (s.position === 'fixed' && r.left >= vw) continue;
         out.push(`${el.tagName.toLowerCase()} "${nameOf(el)?.slice(0, 24)}" L${Math.round(r.left)} R${Math.round(r.right)}`);
      }
      return { docW: document.documentElement.scrollWidth, vw, off: out.slice(0, 8), offCount: out.length };
   };
}

async function open(w = 390, h = 844, theme = 'light') {
   const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
   const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: w < 1024, hasTouch: w < 1024, userAgent: w < 1024 ? UA : undefined });
   await ctx.addInitScript(installHelpers);
   const page = await ctx.newPage();
   const clean = () => page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove())).catch(() => {});
   const go = async (path, wait = 5000) => {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForTimeout(wait);
      await clean();
      if (theme === 'dark') await page.evaluate(() => document.documentElement.classList.add('dark'));
   };
   const tapLink = async (re) => {
      const href = await page.evaluate(
         (src) => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => new RegExp(src).test(h.split('?')[0])),
         re.source
      );
      if (!href) throw new Error('no link ' + re);
      await page.evaluate((h) => [...document.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === h).click(), href);
      await page.waitForTimeout(5000);
      await clean();
      return href;
   };
   const push = async (path) => {
      await page.evaluate((p) => window.next.router.push(p), path);
      await page.waitForTimeout(5000);
      await clean();
   };
   const shot = async (file) => {
      await clean();
      await page.waitForTimeout(250);
      await page.screenshot({ path: file });
   };
   return { browser, ctx, page, go, tapLink, push, clean, shot };
}

module.exports = { open, BASE };

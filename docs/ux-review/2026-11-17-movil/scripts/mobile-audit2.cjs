// Mobile audit: every route at a phone viewport. Measures horizontal overflow,
// clipped text, small tap targets and sub-16px inputs, and shoots light|dark.
// Usage: node mobile-audit.cjs <outDir> [width] [height] [filter]
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const fs = require('fs');
const dir = process.argv[2];
const W = Number(process.argv[3] || 390);
const H = Number(process.argv[4] || 844);
const only = process.argv[5] ? new RegExp(process.argv[5]) : null;
const BASE = 'http://localhost:3100';
fs.mkdirSync(dir, { recursive: true });

const pages = [
   ['inbox', '/berry/inbox'],
   ['my-tasks', '/berry/my-tasks'],
   ['reviews', '/berry/reviews'],
   ['chat', '/berry/chat'],
   ['projects', '/berry/projects'],
   ['cycles', '/berry/cycles'],
   ['tasks', '/berry/tasks'],
   ['loops', '/berry/loops'],
   ['loops-new', '/berry/loops/new'],
   ['plans', '/berry/plans'],
   ['agents', '/berry/agents'],
   ['agents-new', '/berry/agents/new'],
   ['agent-catalog', '/berry/agent-catalog'],
   ['skills', '/berry/skills'],
   ['skill-catalog', '/berry/skill-catalog'],
   ['integrations', '/berry/integrations'],
   ['usage', '/berry/usage'],
   ['runs', '/berry/runs'],
   ['views', '/berry/views'],
   ['s-preferences', '/berry/settings/preferences'],
   ['s-notifications', '/berry/settings/notifications'],
   ['s-shortcuts', '/berry/settings/shortcuts'],
   ['s-security', '/berry/settings/security'],
   ['s-tokens', '/berry/settings/tokens'],
   ['s-connected-accounts', '/berry/settings/connected-accounts'],
   ['s-general', '/berry/settings/general'],
   ['s-members', '/berry/settings/members'],
   ['s-runtimes', '/berry/settings/runtimes'],
   ['s-model-tiers', '/berry/settings/model-tiers'],
   ['s-issue-labels', '/berry/settings/issue-labels'],
   ['s-skill-labels', '/berry/settings/skill-labels'],
   ['s-issue-properties', '/berry/settings/issue-properties'],
   ['s-quick-actions', '/berry/settings/quick-actions'],
   ['s-organization', '/berry/settings/organization'],
   ['s-repositories', '/berry/settings/repositories'],
   ['s-mcp', '/berry/settings/mcp'],
   ['s-logs', '/berry/settings/logs'],
   ['s-ai', '/berry/settings/ai'],
   ['workspaces-new', '/workspaces/new'],
];

const details = [
   ['d-issue', '/berry/tasks', /\/berry\/issue\/[^/?#]+$/],
   ['d-project', '/berry/projects', /\/berry\/project\/[^/]+\/overview$/],
   ['d-cycle', '/berry/cycles', /\/berry\/cycle\/[^/?#]+$/],
   ['d-agent', '/berry/agents', /\/berry\/agents\/(?!new)[^/?#]+$/],
   ['d-review', '/berry/reviews', /\/berry\/review\/[^/?#]+/],
   ['d-loop', '/berry/loops', /\/berry\/(loop|autopilot)\/[^/?#]+$/],
];

// Runs in the page: returns the measurements for the current screen.
function measure() {
   const vw = document.documentElement.clientWidth;
   const vis = (el) => {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
   };
   const label = (el) => {
      const t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.title || '')
         .trim()
         .replace(/\s+/g, ' ')
         .slice(0, 40);
      const cls = (typeof el.className === 'string' ? el.className : '').split(' ').slice(0, 4).join('.');
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${t ? ` "${t}"` : ''}`;
   };
   const clipper = (el) => {
      for (let n = el.parentElement; n && n !== document.body; n = n.parentElement) {
         const ox = getComputedStyle(n).overflowX;
         if (ox !== 'visible') return { el: n, mode: ox };
      }
      return null;
   };
   const all = [...document.body.querySelectorAll('*')].filter(
      (el) => !el.closest('[data-sonner-toaster],[aria-hidden="true"]') && vis(el)
   );

   // 1. Boxes past the right (or left) edge of the viewport.
   const off = [];
   for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.right <= vw + 1 && r.left >= -1) continue;
      const p = el.parentElement;
      if (p) {
         const pr = p.getBoundingClientRect();
         if (pr.right > vw + 1 || pr.left < -1) continue; // report the outermost only
      }
      const c = clipper(el);
      // Off-canvas by design: translated-out panels (the rail, a tucked button).
      if (getComputedStyle(el).position === 'fixed' && r.left >= vw) continue;
      off.push({
         el: label(el),
         right: Math.round(r.right),
         left: Math.round(r.left),
         width: Math.round(r.width),
         clip: c ? `${c.mode} by ${label(c.el)}` : 'NONE (page scrolls sideways)',
      });
   }

   // 2. Text cut without an ellipsis, and text truncated with one.
   const cut = [];
   let ellipsis = 0;
   for (const el of all) {
      if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      if (el.scrollWidth <= el.clientWidth + 1 || el.clientWidth === 0) continue;
      const s = getComputedStyle(el);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') continue;
      if (s.textOverflow === 'ellipsis') {
         ellipsis++;
         continue;
      }
      if (s.overflowX === 'hidden' || s.overflowX === 'clip') cut.push(label(el));
   }

   // 3. Tap targets.
   const interactive = all.filter((el) =>
      el.matches('a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=checkbox],[role=switch],[role=menuitem],[role=combobox],summary')
   );
   const small = [];
   for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if (r.width < 24 || r.height < 24) small.push(`${label(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
   }
   const under44 = interactive.filter((el) => {
      const r = el.getBoundingClientRect();
      return r.height < 44 && r.width < 44 ? true : r.height < 32;
   }).length;

   // 4. Inputs that make iOS zoom on focus (font-size under 16px).
   const zoomInputs = [...document.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true]')]
      .filter(vis)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map((el) => `${label(el)} ${getComputedStyle(el).fontSize}`);

   // 5. Fixed things floating over the page.
   const fixed = all
      .filter((el) => getComputedStyle(el).position === 'fixed')
      .map((el) => {
         const r = el.getBoundingClientRect();
         return `${label(el)} [${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.right)},${Math.round(r.bottom)}]`;
      })
      .slice(0, 8);

   // 6. Smallest text on screen.
   const textSizes = {};
   for (const el of all) {
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const fs = Math.round(parseFloat(getComputedStyle(el).fontSize));
      textSizes[fs] = (textSizes[fs] || 0) + 1;
   }

   return {
      url: location.pathname + location.search,
      docScrollW: document.documentElement.scrollWidth,
      bodyScrollW: document.body.scrollWidth,
      vw,
      off: off.slice(0, 15),
      offCount: off.length,
      cut: cut.slice(0, 12),
      cutCount: cut.length,
      ellipsis,
      small: small.slice(0, 15),
      smallCount: small.length,
      interactiveCount: interactive.length,
      under44,
      zoomInputs: zoomInputs.slice(0, 8),
      zoomCount: zoomInputs.length,
      fixed,
      textSizes,
      viewportMeta: document.querySelector('meta[name=viewport]')?.content ?? null,
   };
}

async function settle(page) {
   await page.waitForTimeout(4500);
   for (let i = 0; i < 10; i++) {
      const busy = await page.evaluate(
         () => document.querySelectorAll('[data-slot="skeleton"], .animate-pulse, [aria-busy="true"]').length
      );
      if (!busy) break;
      await page.waitForTimeout(1500);
   }
}

async function shoot(page, name) {
   await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove()));
   const shots = [];
   for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => document.documentElement.classList.toggle('dark', t === 'dark'), theme);
      await page.waitForTimeout(400);
      shots.push((await page.screenshot()).toString('base64'));
   }
   await page.evaluate(() => document.documentElement.classList.remove('dark'));
   const pair = await page.context().browser().newPage();
   await pair.setViewportSize({ width: W * 2 + 8, height: H });
   await pair.setContent(
      `<body style="margin:0;display:flex;gap:8px;background:#888">${shots
         .map((s) => `<img style="width:${W}px;height:${H}px;display:block" src="data:image/png;base64,${s}">`)
         .join('')}</body>`
   );
   await pair.screenshot({ path: `${dir}/${name}.png` });
   await pair.close();
}

(async () => {
   const browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
   });
   const ctx = await browser.newContext({
      viewport: { width: W, height: H },
      deviceScaleFactor: 1,
      isMobile: true,
      hasTouch: true,
      userAgent:
         'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
   });
   const page = await ctx.newPage();
   const results = {};
   const run = async (name, go) => {
      if (only && !only.test(name)) return;
      try {
         await go();
         await settle(page);
         await page.evaluate(() => document.documentElement.classList.remove('dark'));
         results[name] = await page.evaluate(measure);
         await shoot(page, name);
         const r = results[name];
         console.log(
            `${name} ${r.url} docW=${r.docScrollW} off=${r.offCount} cut=${r.cutCount} small=${r.smallCount}/${r.interactiveCount} zoom=${r.zoomCount}`
         );
      } catch (e) {
         console.log('fail', name, String(e).slice(0, 140));
      }
   };
   for (const [name, path] of pages) {
      await run(name, () => page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 }));
   }
   for (const [name, list, re] of details) {
      await run(name, async () => {
         await page.goto(BASE + list, { waitUntil: 'domcontentloaded', timeout: 120000 });
         await settle(page);
         const href = await page.evaluate(
            (src) => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => new RegExp(src).test(h.split('?')[0])),
            re.source
         );
         if (!href) throw new Error('no link');
         await page.evaluate((h) => [...document.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === h).click(), href);
      });
   }
   fs.writeFileSync(`${dir}/results.json`, JSON.stringify(results, null, 1));
   await browser.close();
})().catch((e) => {
   console.error(e);
   process.exit(1);
});

// Drive the test app on the real phone: Chrome over CDP (adb forward 9222) for
// reading the page, and `adb shell input` for real touches and the real keyboard.
// Only the tab on http://localhost:3100 is ever touched.
const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
const { execFileSync } = require('child_process');
const fs = require('fs');

const ADB = 'C:/Users/eduvc/AppData/Local/Microsoft/WinGet/Packages/Google.PlatformTools_Microsoft.Winget.Source_8wekyb3d8bbwe/platform-tools/adb.exe';
const DEV = '192.168.100.2:36177';
const BASE = 'http://localhost:3100';
const adb = (...args) => execFileSync(ADB, ['-s', DEV, ...args], { encoding: 'utf8', timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
const adbBuf = (...args) => execFileSync(ADB, ['-s', DEV, ...args], { timeout: 30000, maxBuffer: 64 * 1024 * 1024 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function helpersSource() {
   const nameOf = (n) =>
      n ? (n.getAttribute?.('aria-label') || n.textContent || n.tagName || '').trim().replace(/\s+/g, ' ').slice(0, 40) : null;
   window.__hit = (el) => {
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const vw = document.documentElement.clientWidth;
      // With the keyboard up, Chrome scrolls the visual viewport over the
      // unchanged layout viewport: what is visible is [offsetTop, offsetTop + height].
      const top0 = vv ? vv.offsetTop : 0;
      const vh = vv ? vv.height : window.innerHeight;
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const inView = r.left >= -1 && r.right <= vw + 1 && r.top >= top0 - 1 && r.bottom <= top0 + vh + 1;
      const top = cx >= 0 && cx <= vw && cy >= 0 && cy <= window.innerHeight ? document.elementFromPoint(cx, cy) : null;
      const hittable = !!top && (top === el || el.contains(top));
      return { rect: [r.left, r.top, r.right, r.bottom].map(Math.round), inVisibleViewport: inView, hittable, top: hittable ? 'self' : nameOf(top) };
   };
   window.__vp = () => ({
      inner: [window.innerWidth, window.innerHeight],
      visual: window.visualViewport ? [Math.round(visualViewport.width), Math.round(visualViewport.height), Math.round(visualViewport.offsetTop)] : null,
      dpr: window.devicePixelRatio,
      docW: document.documentElement.scrollWidth,
      active: document.activeElement ? document.activeElement.tagName + (document.activeElement.getAttribute('aria-label') ? `[${document.activeElement.getAttribute('aria-label')}]` : '') : null,
   });
   window.__hitBy = (src, scope) => {
      const re = new RegExp(src, 'i');
      const root = (scope && document.querySelector(scope)) || document.body;
      return [...root.querySelectorAll('button,a[href],[role=button],[role=tab],[role=option],[role=checkbox],textarea,input')]
         .filter((b) => re.test(`${b.getAttribute('aria-label') || ''} ${b.getAttribute('placeholder') || ''} ${b.textContent || ''}`.trim()))
         .slice(0, 6)
         .map((e) => ({ label: nameOf(e), ...window.__hit(e) }));
   };
   window.__drag = window.__drag || 0;
   if (!window.__dragHooked) {
      window.__dragHooked = true;
      document.addEventListener('dragstart', () => window.__drag++, true);
   }
}

async function connect() {
   const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
   const ctx = browser.contexts()[0];
   // Only ever pick the test app's tab; the other tabs are never read.
   let page = ctx.pages().find((p) => p.url().startsWith(BASE));
   if (!page) throw new Error('test tab not found');
   await page.bringToFront().catch(() => {});
   const helpers = async () => page.evaluate(`(${helpersSource.toString()})()`);
   const go = async (path, ms = 6000) => {
      await page.goto(BASE + path, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await wait(ms);
      await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((n) => n.remove())).catch(() => {});
      await helpers();
   };
   // Device-pixel origin of the web content, from the accessibility tree.
   let origin = null;
   const calibrate = async () => {
      adb('shell', 'uiautomator', 'dump', '/sdcard/berry-ui.xml');
      const xml = adb('shell', 'cat', '/sdcard/berry-ui.xml');
      adb('shell', 'rm', '/sdcard/berry-ui.xml');
      const m = xml.match(/class="android\.webkit\.WebView"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/) ||
         xml.match(/bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"[^>]*class="android\.webkit\.WebView"/);
      if (!m) throw new Error('webview bounds not found');
      const [x1, y1, x2, y2] = m.slice(1).map(Number);
      const css = await page.evaluate(() => [window.innerWidth, window.innerHeight]);
      origin = { x: x1, y: y1, scale: (x2 - x1) / css[0], webview: [x1, y1, x2, y2], css };
      return origin;
   };
   const toDevice = (x, y) => [Math.round(origin.x + x * origin.scale), Math.round(origin.y + y * origin.scale)];
   const tap = async (x, y) => {
      const [dx, dy] = toDevice(x, y);
      adb('shell', 'input', 'tap', String(dx), String(dy));
      await wait(900);
   };
   const tapRect = (r) => tap((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
   const longPress = async (x, y, ms = 1200) => {
      const [dx, dy] = toDevice(x, y);
      adb('shell', 'input', 'swipe', String(dx), String(dy), String(dx), String(dy), String(ms));
      await wait(900);
   };
   const swipe = async (x1, y1, x2, y2, ms = 400) => {
      const a = toDevice(x1, y1);
      const b = toDevice(x2, y2);
      adb('shell', 'input', 'swipe', String(a[0]), String(a[1]), String(b[0]), String(b[1]), String(ms));
      await wait(900);
   };
   const back = async () => {
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await wait(1200);
   };
   const screencap = (file) => fs.writeFileSync(file, adbBuf('exec-out', 'screencap', '-p'));
   const keyboardShown = () => /mInputShown=true|isInputShown=true|imeVisible=true/.test(adb('shell', 'dumpsys input_method | grep -E "mInputShown|isInputShown" ; dumpsys window InputMethod | grep -m1 -E "isVisible|imeVisible|mViewVisibility"'));
   return { browser, page, go, helpers, calibrate, tap, tapRect, longPress, swipe, back, screencap, keyboardShown, adb, wait };
}

module.exports = { connect, BASE };

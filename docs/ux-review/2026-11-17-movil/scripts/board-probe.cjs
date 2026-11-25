const { chromium } = require('E:/projects/work/berry/node_modules/.bun/playwright-core@1.65.0/node_modules/playwright-core');
(async () => {
  const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' });
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await page.goto('http://localhost:3100/berry/tasks', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(5000);
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach(n => n.remove()));
  // control: vertical swipe on the list
  const list = await page.evaluate(() => { let best=null; for (const el of document.querySelectorAll('main *')) { const s=getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 50 && (!best || el.scrollHeight > best.scrollHeight)) best = el; } best.setAttribute('data-probe-y','1'); return best.scrollTop; });
  await cdp.send('Input.synthesizeScrollGesture', { x: 200, y: 600, yDistance: -300, xDistance: 0, gestureSourceType: 'touch', speed: 800 });
  await page.waitForTimeout(800);
  console.log('list vertical', list, '->', await page.evaluate(() => document.querySelector('[data-probe-y]').scrollTop));
  await page.locator('button[aria-label*="oard" i], [role="radio"][aria-label*="oard" i], [role="tab"][aria-label*="oard" i]').first().tap();
  await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach(n => n.remove()));
  const info = await page.evaluate(() => { let best=null; for (const el of document.querySelectorAll('main *')) { const s=getComputedStyle(el); if (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 20 && (!best || el.scrollWidth > best.scrollWidth)) best = el; } best.setAttribute('data-probe-x','1'); const r = best.getBoundingClientRect();
    const head = best.querySelector('h2,h3,[class*=column] header, [class*=header]'); const hr = head?.getBoundingClientRect();
    return { r: [r.left, r.top, r.right, r.bottom].map(Math.round), touchAction: getComputedStyle(best).touchAction, head: hr ? [Math.round(hr.left + 20), Math.round(hr.top + hr.height / 2)] : null, draggables: best.querySelectorAll('[draggable=true]').length }; });
  console.log('board', JSON.stringify(info));
  for (const [label, x, y] of [['on-card', 192, 413], ['empty-bottom', 200, info.r[3] - 20], ...(info.head ? [['column-head', info.head[0], info.head[1]]] : [])]) {
    await page.evaluate(() => { document.querySelector('[data-probe-x]').scrollLeft = 0; });
    await cdp.send('Input.synthesizeScrollGesture', { x, y, xDistance: -250, yDistance: 0, gestureSourceType: 'touch', speed: 800 });
    await page.waitForTimeout(800);
    const top = await page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return (e?.closest('[draggable]') ? 'draggable ' : '') + (e?.tagName || ''); }, [x, y]);
    console.log('swipe', label, [x, y], top, '-> scrollLeft', await page.evaluate(() => document.querySelector('[data-probe-x]').scrollLeft));
  }
  // manual touch sequence on empty area
  await page.evaluate(() => { document.querySelector('[data-probe-x]').scrollLeft = 0; });
  const y = info.r[3] - 20;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 300, y }] });
  for (let i = 1; i <= 10; i++) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 300 - i * 25, y }] }); await page.waitForTimeout(16); }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(800);
  console.log('manual touch drag empty area -> scrollLeft', await page.evaluate(() => document.querySelector('[data-probe-x]').scrollLeft));
  await page.screenshot({ path: 'validate/v-t-board-probe.png' });
  await b.close();
})().catch(e => { console.error(e); process.exit(1); });

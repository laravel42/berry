const { open } = require('./probe-lib.cjs');
(async () => {
  const { browser, page, go } = await open(390, 844, 'light');
  for (const p of ['/berry/skill-catalog','/berry/settings/issue-labels','/berry/skills']) {
    await go(p, 4500);
    const r = await page.evaluate(() => [...document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=checkbox]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(r.width<24||r.height<24)}).map(e=>e.outerHTML.slice(0,260)+' '+JSON.stringify(e.getBoundingClientRect())));
    console.log(p, r);
  }
  await browser.close();
})();

const { connect } = require('./phone-lib.cjs');
(async () => { const p = await connect(); await p.go('/berry/tasks'); await p.page.evaluate(() => localStorage.setItem('view-storage', JSON.stringify({state:{viewType:'list'},version:0}))); await p.go('/berry/tasks'); await new Promise(r=>setTimeout(r,4000));
 console.log(JSON.stringify(await p.page.evaluate(() => ({ url: location.href, boxes: document.querySelectorAll('[aria-label="Select task"]').length, rows: document.querySelectorAll('main a[href*="/issue/"]').length, grid: !!document.querySelector('[data-board-column],[data-column]'), ls: Object.keys(localStorage).filter(k=>/layout|view|tasks/i.test(k)).map(k=>k+'='+localStorage.getItem(k).slice(0,80)) }))));
 process.exit(0); })();

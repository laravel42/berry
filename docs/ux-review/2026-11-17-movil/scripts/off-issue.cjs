const { open } = require('./probe-lib.cjs');
(async () => { const s = await open(390, 844); try { await s.go('/berry/issue/BER-511', 8000); console.log(JSON.stringify(await s.page.evaluate(() => window.__off()))); } finally { await s.browser.close(); } })();

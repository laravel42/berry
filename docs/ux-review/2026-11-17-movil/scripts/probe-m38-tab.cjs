const { open } = require('./probe-lib.cjs');
(async()=>{const s=await open(390,844);await s.go('/berry/agents/9a781d9e-974b-4889-bb79-751f86957686?view=overview',8000);
console.log(await s.page.evaluate(()=>{const t=document.querySelector('[role=tab][aria-selected=true]');const sc=t.closest('[role=tablist]').parentElement;return [t.textContent,sc.scrollLeft,Math.round(t.getBoundingClientRect().right),sc.clientWidth]}));
await s.shot('m38-usage-390.png');await s.browser.close()})()

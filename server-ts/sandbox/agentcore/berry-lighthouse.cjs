#!/usr/bin/env node
// berry-lighthouse <url> [--budget <file>] [--desktop] [--out <dir>]
//
// A Lighthouse audit in one command, read for an agent: the four category
// scores, the core timings, and the budget in lighthouse-budget.json (or
// --budget) checked line by line. The full JSON report is written to --out
// (./lighthouse by default) and never printed: it runs to megabytes, and
// every byte an agent reads is paid for again on each later step. The report
// is written to $TMPDIR/berry-lighthouse (--out), never into the checkout.
//
// Lighthouse 12 dropped --budget-path, so the budget file (the classic
// budget.json shape: timings, resourceSizes, resourceCounts) is checked here.
'use strict';
const { spawnSync } = require('node:child_process');
const { existsSync, mkdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

function parse(argv) {
   // Reports go outside the checkout: one left in the repository is delivered
   // with the task's change, and a report runs to megabytes.
   const options = { url: null, budget: null, desktop: false, out: join(tmpdir(), 'berry-lighthouse') };
   for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];
      if (arg === '--budget') options.budget = argv[++index];
      else if (arg === '--out') options.out = argv[++index];
      else if (arg === '--desktop') options.desktop = true;
      else if (!options.url) options.url = arg;
   }
   return options;
}

const TIMINGS = {
   'first-contentful-paint': 'first-contentful-paint',
   'largest-contentful-paint': 'largest-contentful-paint',
   'speed-index': 'speed-index',
   interactive: 'interactive',
   'total-blocking-time': 'total-blocking-time',
   'max-potential-fid': 'max-potential-fid',
   'cumulative-layout-shift': 'cumulative-layout-shift',
};

function checkBudget(file, report) {
   const lines = [];
   let failed = 0;
   const budgets = JSON.parse(readFileSync(file, 'utf8'));
   const summary = report.audits['resource-summary']?.details?.items ?? [];
   const byType = new Map(summary.map((item) => [item.resourceType, item]));
   for (const budget of Array.isArray(budgets) ? budgets : [budgets]) {
      for (const timing of budget.timings ?? []) {
         const audit = report.audits[TIMINGS[timing.metric] ?? timing.metric];
         if (!audit || typeof audit.numericValue !== 'number') {
            lines.push(`? ${timing.metric}: not measured`);
            continue;
         }
         const ok = audit.numericValue <= timing.budget;
         if (!ok) failed += 1;
         const shift = timing.metric === 'cumulative-layout-shift';
         const unit = shift ? '' : ' ms';
         const value = shift ? Math.round(audit.numericValue * 1000) / 1000 : Math.round(audit.numericValue);
         lines.push(`${ok ? 'ok  ' : 'OVER'} ${timing.metric}: ${value}${unit} (budget ${timing.budget}${unit})`);
      }
      for (const size of budget.resourceSizes ?? []) {
         const kb = (byType.get(size.resourceType)?.transferSize ?? 0) / 1024;
         const ok = kb <= size.budget;
         if (!ok) failed += 1;
         lines.push(`${ok ? 'ok  ' : 'OVER'} ${size.resourceType} size: ${kb.toFixed(1)} KB (budget ${size.budget} KB)`);
      }
      for (const count of budget.resourceCounts ?? []) {
         const n = byType.get(count.resourceType)?.requestCount ?? 0;
         const ok = n <= count.budget;
         if (!ok) failed += 1;
         lines.push(`${ok ? 'ok  ' : 'OVER'} ${count.resourceType} requests: ${n} (budget ${count.budget})`);
      }
   }
   return { lines, failed };
}

function main() {
   const options = parse(process.argv.slice(2));
   if (!options.url) {
      console.error('usage: berry-lighthouse <url> [--budget <file>] [--desktop] [--out <dir>]');
      process.exit(2);
   }
   const out = resolve(options.out);
   mkdirSync(out, { recursive: true });
   const reportPath = join(out, 'report.json');
   const args = [
      options.url,
      '--output=json',
      `--output-path=${reportPath}`,
      '--quiet',
      '--chrome-flags=--headless=new --no-sandbox --disable-dev-shm-usage',
      ...(options.desktop ? ['--preset=desktop'] : []),
   ];
   // Once more when Chrome did not come up: under the load of a busy session
   // (a server, a Playwright script) its first launch can miss the window.
   let run = spawnSync('lighthouse', args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
   if ((run.status !== 0 || !existsSync(reportPath)) && /connect to Chrome|ECONNREFUSED/i.test(run.stderr || '')) {
      run = spawnSync('lighthouse', args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
   }
   if (run.status !== 0 || !existsSync(reportPath)) {
      console.error(`Lighthouse did not finish: ${(run.stderr || '').trim().split('\n').slice(-5).join('\n')}`);
      process.exit(1);
   }
   const report = JSON.parse(readFileSync(reportPath, 'utf8'));
   console.log(`${report.finalDisplayedUrl ?? options.url} (${options.desktop ? 'desktop' : 'mobile'})`);
   for (const [id, category] of Object.entries(report.categories)) {
      console.log(`${category.title}: ${Math.round((category.score ?? 0) * 100)}`);
      void id;
   }
   for (const metric of ['first-contentful-paint', 'largest-contentful-paint', 'total-blocking-time', 'cumulative-layout-shift', 'speed-index']) {
      const audit = report.audits[metric];
      if (audit?.displayValue) console.log(`  ${audit.title}: ${audit.displayValue}`);
   }
   const budgetFile = options.budget ?? ['lighthouse-budget.json', 'budget.json'].find((name) => existsSync(name));
   let failed = 0;
   if (budgetFile) {
      const checked = checkBudget(budgetFile, report);
      failed = checked.failed;
      console.log(`\nBudget (${budgetFile}): ${failed === 0 ? 'within' : `${failed} over`}`);
      for (const line of checked.lines) console.log(`  ${line}`);
   }
   console.log(`\nFull report: ${reportPath}`);
   process.exit(failed > 0 ? 3 : 0);
}

main();

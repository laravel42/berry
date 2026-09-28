#!/usr/bin/env node
// berry-screenshots <url|folder> [out-dir] [--into-repo]: the page at phone, tablet and desktop
// widths, full height, in one command, with the console errors and failed
// requests it met. Agents were spending a dozen model calls per task finding
// Playwright and Chromium and scripting this by hand; now it is one call.
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const { target } = require('/usr/local/lib/berry/berry-serve.cjs');
const { outputDir, refusedNote } = require('/usr/local/lib/berry/berry-output.cjs');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const SIZES = [
   ['phone', 390, 844],
   ['tablet', 820, 1180],
   ['desktop', 1440, 900],
];

async function main() {
   // Outside the checkout unless --into-repo: screenshots are for looking at,
   // and a file left in the repository is delivered with the task's change.
   const args = process.argv.slice(2);
   const intoRepo = args.includes('--into-repo');
   const [url, dir] = args.filter((arg) => arg !== '--into-repo');
   if (!url) {
      console.error('usage: berry-screenshots <url|folder|file> [out-dir, default $TMPDIR/berry-screenshots] [--into-repo]');
      process.exit(2);
   }
   const { dir: out, refused } = outputDir(dir, join(tmpdir(), 'berry-screenshots'), intoRepo);
   if (refused) console.log(refusedNote(refused, out, 'the screenshots'));
   mkdirSync(out, { recursive: true });
   // A folder or file is served here for the length of the check.
   const site = await target(url);
   if (site.served) console.log(`Serving ${site.served} at ${site.url}`);
   const browser = await chromium.launch();
   const problems = new Set();
   try {
      for (const [name, width, height] of SIZES) {
         const page = await browser.newPage({ viewport: { width, height } });
         page.on('console', (message) => {
            if (message.type() === 'error') problems.add(`console: ${message.text()}`);
         });
         page.on('pageerror', (error) => problems.add(`page error: ${error.message}`));
         page.on('requestfailed', (request) => problems.add(`failed: ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`));
         page.on('response', (response) => {
            if (response.status() >= 400) problems.add(`HTTP ${response.status()}: ${response.url()}`);
         });
         await page.goto(site.url, { waitUntil: 'networkidle', timeout: 30_000 }).catch((error) => problems.add(`load: ${error.message.split('\n')[0]}`));
         const file = join(out, `${name}.png`);
         await page.screenshot({ path: file, fullPage: true });
         console.log(`${name} ${width}x${height}: ${file}`);
         await page.close();
      }
   } finally {
      await browser.close();
      await site.close();
   }
   console.log(`\nTo put them on the task: collect_file with path ${join(out, 'phone.png')} and as screenshots/phone.png (and tablet, desktop). Never base64 them.`);
   if (problems.size > 0) {
      console.log('\nProblems:');
      for (const problem of problems) console.log(`- ${problem}`);
   } else {
      console.log('\nNo console errors or failed requests.');
   }
}

main().catch((error) => {
   console.error(error instanceof Error ? error.message : String(error));
   process.exit(1);
});

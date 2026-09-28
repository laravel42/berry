#!/usr/bin/env node
// berry-screenshots <url> [out-dir]: the page at phone, tablet and desktop
// widths, full height, in one command, with the console errors and failed
// requests it met. Agents were spending a dozen model calls per task finding
// Playwright and Chromium and scripting this by hand; now it is one call.
'use strict';
const { chromium } = require('/usr/local/lib/node_modules/playwright');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');

const SIZES = [
   ['phone', 390, 844],
   ['tablet', 820, 1180],
   ['desktop', 1440, 900],
];

async function main() {
   // Outside the checkout by default: screenshots are for looking at, and a
   // file left in the repository is delivered with the task's change.
   const [url, dir = join(tmpdir(), 'berry-screenshots')] = process.argv.slice(2);
   if (!url) {
      console.error('usage: berry-screenshots <url> [out-dir, default $TMPDIR/berry-screenshots]');
      process.exit(2);
   }
   const out = resolve(dir);
   mkdirSync(out, { recursive: true });
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
         await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 }).catch((error) => problems.add(`load: ${error.message.split('\n')[0]}`));
         const file = join(out, `${name}.png`);
         await page.screenshot({ path: file, fullPage: true });
         console.log(`${name} ${width}x${height}: ${file}`);
         await page.close();
      }
   } finally {
      await browser.close();
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

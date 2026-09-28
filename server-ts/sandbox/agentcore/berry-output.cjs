// Where berry-screenshots and berry-lighthouse write what they produce.
//
// Both default outside the checkout, but agents passed one inside it (".",
// "src", "screenshot-output"), and every file left in the repository is
// delivered with the task's change: screenshots reached pull requests as the
// change itself. A folder inside a git checkout is refused for the default
// unless the command is given --into-repo, for a task that asks for the files
// in the repository.
'use strict';
const { existsSync } = require('node:fs');
const { dirname, join, resolve } = require('node:path');

/** The git checkout `dir` is inside, or null. */
function checkoutOf(dir) {
   for (let at = resolve(dir); ; at = dirname(at)) {
      if (existsSync(join(at, '.git'))) return at;
      if (dirname(at) === at) return null;
   }
}

/**
 * `{ dir, refused }`: the folder to write to, and the folder asked for when it
 * was inside a checkout and `fallback` is used instead.
 */
function outputDir(requested, fallback, intoRepo) {
   const dir = resolve(requested ?? fallback);
   if (intoRepo || requested === undefined || checkoutOf(dir) === null) return { dir, refused: null };
   return { dir: resolve(fallback), refused: dir };
}

/** What the command prints when it wrote to `fallback` instead. */
function refusedNote(refused, dir, what) {
   return `Writing ${what} to ${dir}, not ${refused}: that folder is in the repository, and files left there are delivered with the change. Pass --into-repo only when the task asks for them in the repository.`;
}

module.exports = { outputDir, refusedNote };

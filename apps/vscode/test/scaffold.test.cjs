const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const manifest = require('../package.json');

test('desktop extension entry point supports activation and deactivation', () => {
   const extension = require(path.resolve(__dirname, '..', manifest.main));
   assert.equal(typeof extension.activate, 'function');
   assert.equal(typeof extension.deactivate, 'function');
   assert.doesNotThrow(() => extension.activate());
   assert.doesNotThrow(() => extension.deactivate());
});

test('development host loads this package and builds before launch', () => {
   const launch = require('../.vscode/launch.json');
   const tasks = require('../.vscode/tasks.json');
   const config = launch.configurations[0];
   assert.equal(config.type, 'extensionHost');
   assert.deepEqual(config.args, ['--extensionDevelopmentPath=${workspaceFolder}']);
   assert.equal(tasks.tasks[0].label, config.preLaunchTask);
   assert.equal(tasks.tasks[0].command, 'pnpm build');
   assert.equal(manifest.license, 'AGPL-3.0-only');
   assert.deepEqual(manifest.extensionKind, ['ui']);
});

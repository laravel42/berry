import assert from 'node:assert/strict';
import { test } from 'node:test';

import { helpText, parseArgv, parseUpFlags } from './cli.ts';

test('no args, or host, is the stdin protocol', () => {
   assert.deepEqual(parseArgv([]), { name: 'host' });
   assert.deepEqual(parseArgv(['host']), { name: 'host' });
});

test('help and version never start the host', () => {
   assert.deepEqual(parseArgv(['--help']), { name: 'help' });
   assert.deepEqual(parseArgv(['-h']), { name: 'help' });
   assert.deepEqual(parseArgv(['help']), { name: 'help' });
   assert.deepEqual(parseArgv(['--version']), { name: 'version' });
   assert.deepEqual(parseArgv(['-v']), { name: 'version' });
   assert.deepEqual(parseArgv(['version']), { name: 'version' });
});

test('an unknown flag is help, not a host start', () => {
   assert.deepEqual(parseArgv(['serve']), { name: 'help' });
   assert.deepEqual(parseArgv(['host', 'extra']), { name: 'help' });
});

test('up needs a reachable Berry URL and a workstation token', () => {
   const token = 'berry_ws_aaaaaaaaaaaaaaaa_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
   assert.deepEqual(parseArgv(['up', '--url', 'https://berry.example', '--token', token]), {
      name: 'up',
      url: 'https://berry.example',
      token,
   });
   assert.deepEqual(parseArgv(['up']), { name: 'help' });
   assert.deepEqual(parseArgv(['up', '--url', 'https://berry.example']), { name: 'help' });
   assert.deepEqual(parseUpFlags([], { BERRY_URL: 'https://berry.example', BERRY_WORKSTATION_TOKEN: token }), {
      url: 'https://berry.example',
      token,
   });
   assert.equal(parseUpFlags(['--url', 'ftp://berry.example', '--token', token]), null);
   assert.equal(parseUpFlags(['--url', 'https://berry.example', '--token', 'berry_pat_nope']), null);
});

test('help names the companion and leaves credentials with the CLI', () => {
   const text = helpText();
   assert.match(text, /berry-bridge up/);
   assert.match(text, /stdin/);
   assert.match(text, /does not read those credential files/);
});

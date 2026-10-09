import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computerHost } from './computer-host.ts';

test('localhost and a fully qualified domain name are computers', () => {
   assert.equal(computerHost('localhost'), 'localhost');
   assert.equal(computerHost('LocalHost'), 'localhost');
   assert.equal(computerHost('cli.example.com'), 'cli.example.com');
   assert.equal(computerHost('CLI.Example.com.'), 'cli.example.com');
});

test('a CLI name, a bare hostname, and a URL are not a computer', () => {
   assert.equal(computerHost('kiro'), null);
   assert.equal(computerHost('claude'), null);
   assert.equal(computerHost('berry'), null);
   assert.equal(computerHost('https://cli.example.com'), null);
   assert.equal(computerHost('cli.example.com:443'), null);
   assert.equal(computerHost(''), null);
});

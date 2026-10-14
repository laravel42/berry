import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import {
   bridgeArchiveEntries,
   installScript,
   locateBridgeSources,
   packBridgeTarball,
   shSingle,
   workstationBerryUrl,
   workstationUpCommand,
} from './bridge-install.ts';

test('the laptop URL is the public origin, never host.docker.internal', () => {
   assert.equal(
      workstationBerryUrl({ publicUrl: 'https://berry.example/', port: 4000 }),
      'https://berry.example'
   );
   assert.equal(
      workstationBerryUrl({ publicUrl: 'http://host.docker.internal:4000', port: 4000 }),
      'http://127.0.0.1:4000'
   );
   assert.equal(workstationBerryUrl({ publicUrl: null, port: 4000 }), 'http://127.0.0.1:4000');
});

test('the pair command starts with wget of this Berry', () => {
   const command = workstationUpCommand(
      'https://berry.example/',
      'berry_ws_public_secret'
   );
   assert.equal(
      command,
      [
         "wget -qO- 'https://berry.example/install/berry-bridge'",
         '| sh -s -- up --url',
         "'https://berry.example'",
         '--token',
         "'berry_ws_public_secret'",
      ].join(' ')
   );
});

test('the install script wgets this origin and does not carry a token', () => {
   const script = installScript('https://berry.example/');
   assert.match(script, /^#!\/bin\/sh\n/);
   assert.match(script, /ORIGIN='https:\/\/berry\.example'/);
   assert.match(script, /wget -qO "\$TMP\/berry-bridge\.tgz" "\$ORIGIN\/install\/berry-bridge\.tgz"/);
   assert.equal(script.includes('berry_ws_'), false);
   assert.match(script, /wget is required/);
});

test('shSingle keeps a value inside single quotes', () => {
   assert.equal(shSingle("it's"), `'it'\\''s'`);
});

test('the monorepo has the sources the installer packs', () => {
   const sources = locateBridgeSources();
   assert.ok(sources);
   const entries = bridgeArchiveEntries(sources);
   assert.ok(entries.includes('apps/bridge/src/main.ts'));
   assert.ok(entries.includes('apps/bridge/src/companion.ts'));
   assert.ok(entries.includes('server-ts/src/agents/runtime/workstation/host.ts'));
   assert.ok(entries.includes('package.json'));
});

test('the tarball is gzip and holds the host plus the bridge', async () => {
   const sources = locateBridgeSources();
   assert.ok(sources);
   const archive = await packBridgeTarball(sources);
   assert.equal(archive[0], 0x1f);
   assert.equal(archive[1], 0x8b);
   const listed = spawnSync('tar', ['-tzf', '-'], { input: archive, encoding: 'utf8' });
   assert.equal(listed.status, 0, listed.stderr);
   assert.match(listed.stdout, /apps\/bridge\/src\/main\.ts/);
   assert.match(listed.stdout, /server-ts\/src\/agents\/runtime\/workstation\/host\.ts/);
   assert.match(listed.stdout, /package\.json/);
});

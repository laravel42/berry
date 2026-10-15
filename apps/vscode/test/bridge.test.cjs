const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bridgeCommands } = require('../dist/bridge');
function fixture(overrides = {}) {
   const commands = new Map();
   const errors = [];
   const host = {
      commands: { registerCommand(name, handler) { commands.set(name, handler); return { dispose() { commands.delete(name); } }; } },
      window: { showErrorMessage(message) { errors.push(message); } },
      env: {},
      ...overrides,
   };
   const bridge = bridgeCommands({ extensionPath: '/extension', subscriptions: [] }, host, () => ({ origin: 'https://berry.test', pat: 'berry_pat_test' }));
   return { commands, errors, bridge };
}
test('registering the bridge never spawns a CLI and stop leaves commands usable', () => {
   const { commands, bridge } = fixture();
   assert.equal(commands.size, 2);
   bridge.stop();
   assert.equal(commands.size, 2);
   bridge.disposables.forEach(entry => entry.dispose());
   assert.equal(commands.size, 0);
});
test('bridge refuses an untrusted, web, remote, or absent local folder', async () => {
   for (const overrides of [ {}, { workspace: { isTrusted: false } }, { env: { uiKind: 2 }, workspace: { isTrusted: true } }, { env: { remoteName: 'ssh-remote' }, workspace: { isTrusted: true, workspaceFolders: [{ uri: { scheme: 'file', fsPath: '/folder' } }] } }, { workspace: { isTrusted: true, workspaceFolders: [{ uri: { scheme: 'vscode-remote', fsPath: '/folder' } }] } } ]) {
      const { commands, errors } = fixture(overrides);
      await commands.get('berry.startBridge')();
      assert.equal(errors.length, 1);
   }
});

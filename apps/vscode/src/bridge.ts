import { Client, repositoryName, type Connection } from './client';
import type { Context, Host, Disposable } from './host';
declare function require(name: string): unknown;
interface Child { stdin: { end(value: string): void }; kill(signal?: string): boolean; once(event: string, listener: () => void): void }
interface Processes { spawn(command: string, args: string[], options: { stdio: string[]; env: Record<string, string>; windowsHide: boolean }): Child }
export function bridgeCommands(context: Context, host: Host, readConnection: () => Connection | undefined): { disposables: Disposable[]; stop(): void } {
   let child: Child | undefined;
   let generation = 0;
   const stop = () => { ++generation; const running = child; child = undefined; if (running) { running.kill('SIGTERM'); const timer = setTimeout(() => running.kill('SIGKILL'), 5000); running.once('exit', () => clearTimeout(timer)); } };
   const start = host.commands.registerCommand('berry.startBridge', async () => {
      stop();
      const current = generation;
      const connection = readConnection();
      if (!connection || !context.extensionPath || !host.workspace?.isTrusted || host.env.uiKind === 2) { host.window.showErrorMessage('Connect to Berry in a trusted desktop VS Code folder first.'); return; }
      const folders = host.workspace.workspaceFolders ?? [];
      if (!folders.length || folders.some(folder => folder.uri.scheme !== 'file') || host.env.remoteName) { host.window.showErrorMessage('Open a local desktop folder. Remote workspaces are not supported yet.'); return; }
      const runtimeId = await host.window.showInputBox({ ignoreFocusOut: true, title: 'Workstation subscription CLI', prompt: 'Enter kiro, claude, or codex. Sign in with the official CLI first.' });
      if (current !== generation || !runtimeId) return;
      if (!['kiro', 'claude', 'codex'].includes(runtimeId)) { host.window.showErrorMessage('Choose kiro, claude, or codex.'); return; }
      const workspaces = await new Client(connection).list<{ id: string; name: string }>('/workspaces');
      const workspaceId = await host.window.showInputBox({ ignoreFocusOut: true, title: 'Berry workspace ID', prompt: workspaces.map(workspace => workspace.name + ': ' + workspace.id).join('; '), value: workspaces.length === 1 ? workspaces[0]?.id : undefined });
      if (current !== generation || !workspaceId || !workspaces.some(workspace => workspace.id === workspaceId)) return;
      const git = host.extensions.getExtension('vscode.git');
      const repositories = git ? (await git.activate()).getAPI(1).repositories : [];
      const announced = folders.map(folder => ({ path: folder.uri.fsPath, repositories: repositories.filter(repository => repository.rootUri?.fsPath === folder.uri.fsPath).flatMap(repository => repository.state.remotes.flatMap(remote => [remote.fetchUrl, remote.pushUrl].flatMap(url => url ? (() => { const name = repositoryName(url); return name ? [name] : []; })() : []))) }));
      if (current !== generation) return;
      const crypto = require('node:crypto') as { randomUUID(): string };
      const processHost = require('node:process') as { env: Record<string, string | undefined> };
      const env: Record<string, string> = {};
      for (const name of ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TMPDIR', 'TEMP', 'TMP', 'SystemRoot', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'NODE_EXTRA_CA_CERTS', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
         const value = processHost.env[name]; if (value !== undefined) env[name] = value;
      }
      const running = (require('node:child_process') as Processes).spawn('node', [context.extensionPath + '/dist/companion-worker.mjs'], { stdio: ['pipe', 'ignore', 'ignore'], env, windowsHide: true });
      child = running;
      running.once('error', () => { if (child === running) child = undefined; host.window.showErrorMessage('Could not start the CLI bridge. Install Node.js 22 or later on PATH.'); });
      running.once('exit', () => { if (child === running) { child = undefined; host.window.showErrorMessage('The CLI bridge stopped. Check your official CLI login and Berry connection, then start it again.'); } });
      running.stdin.end(JSON.stringify({ ...connection, id: crypto.randomUUID(), runtimeId, workspaceId, folders: announced }) + '\n');
   });
   return { stop, disposables: [start, host.commands.registerCommand('berry.stopBridge', stop), { dispose: stop }, ...(host.workspace?.onDidChangeWorkspaceFolders ? [host.workspace.onDidChangeWorkspaceFolders(stop)] : [])] };
}

import { Client, normalizeOrigin, repositoryName, type Connection, type Task } from './client';
import type { Context, Host, Item } from './host';
declare function require(name: string): unknown;
const SECRET = 'berry.connection';

export function activate(context: Context, host: Host = require('vscode') as Host): void {
   const changed = new host.EventEmitter<void>();
   let items: Item[] = [{ label: 'Connect to Berry', command: { command: 'berry.connect', title: 'Connect' } }];
   let generation = 0;
   let connection: Connection | undefined;
   const publish = (next: Item[]) => { items = next; changed.fire(); };
   const refresh = async () => {
      const current = ++generation;
      publish([{ label: 'Loading Berry tasks…' }]);
      try {
         const stored = await context.secrets.get(SECRET);
         if (current !== generation) return;
         if (!stored) {
            connection = undefined;
            publish([{ label: 'Connect to Berry', command: { command: 'berry.connect', title: 'Connect' } }]);
            return;
         }
         const parsed: unknown = JSON.parse(stored);
         if (typeof parsed !== 'object' || parsed === null || !('origin' in parsed) || !('pat' in parsed) || typeof parsed.origin !== 'string' || typeof parsed.pat !== 'string') throw new Error('Reconnect to Berry.');
         const selected = { origin: normalizeOrigin(parsed.origin), pat: parsed.pat };
         connection = selected;
         const client = new Client(selected);
         const tasks = await client.tasks();
         let matching = 'No GitHub remote found; showing all my open tasks.';
         try {
            const git = host.extensions.getExtension('vscode.git');
            const api = git ? (await git.activate()).getAPI(1) : undefined;
            const remotes = new Set(api?.repositories.flatMap(repo => repo.state.remotes.flatMap(remote => [remote.fetchUrl, remote.pushUrl].filter((url): url is string => !!url).map(repositoryName).filter((name): name is string => !!name))) ?? []);
            if (remotes.size) {
               const names: string[] = [];
               for (const { id: workspaceId } of await client.list<{ id: string }>('/workspaces')) {
                  for (const project of await client.projects(workspaceId)) {
                     if (project.githubRepo && remotes.has(project.githubRepo.toLowerCase())) names.push(project.name);
                  }
               }
               matching = names.length ? 'Folder projects: ' + names.join(', ') : 'No matching Berry project; showing all my open tasks.';
            }
         } catch {
            matching = 'Repository matching unavailable; showing all my open tasks.';
         }
         if (current !== generation) return;
         publish([{ label: matching }, ...(tasks.length ? tasks.map(task => ({ label: task.identifier + ' ' + task.title, description: task.status, tooltip: task.title, command: { command: 'berry.openTask', title: 'Open task', arguments: [task, selected.origin] } })) : [{ label: 'You have no open tasks.' }])]);
      } catch (error) {
         if (current !== generation) return;
         // Do not expose remote response bodies, saved values or arbitrary exceptions.
         const message = error instanceof Error && /^(Reconnect|Cannot reach Berry|Berry request|Berry is rate|Unexpected Berry)/.test(error.message) ? error.message : 'Could not load tasks. Reconnect or Refresh.';
         publish([{ label: message, command: { command: 'berry.connect', title: 'Reconnect' } }]);
      }
   };
   context.subscriptions.push(changed, host.window.registerTreeDataProvider('berry.tasks', { onDidChangeTreeData: changed.event, getTreeItem: item => item, getChildren: () => items }));
   context.subscriptions.push(host.commands.registerCommand('berry.refresh', refresh));
   context.subscriptions.push(host.commands.registerCommand('berry.connect', async () => {
      const originInput = await host.window.showInputBox({ title: 'Connect to Berry', prompt: 'Hosted Berry HTTPS origin (for example https://berry.example)', ignoreFocusOut: true, value: connection?.origin });
      if (originInput === undefined) return;
      let origin: string;
      try { origin = normalizeOrigin(originInput); } catch { host.window.showErrorMessage('Enter an HTTPS Berry origin without a path or credentials.'); return; }
      const pat = await host.window.showInputBox({ title: 'Berry personal access token', prompt: 'Paste your Berry PAT. It will be stored in VS Code SecretStorage.', password: true, ignoreFocusOut: true });
      if (pat === undefined) return;
      if (!/^berry_pat_\S+$/.test(pat)) { host.window.showErrorMessage('Enter a Berry personal access token.'); return; }
      try {
         await new Client({ origin, pat }).get('/auth/me');
         await context.secrets.store(SECRET, JSON.stringify({ origin, pat }));
         await refresh();
      } catch { host.window.showErrorMessage('Could not connect to Berry. Check the origin, PAT and network.'); }
   }));
   context.subscriptions.push(host.commands.registerCommand('berry.disconnect', async () => {
      ++generation;
      connection = undefined;
      await context.secrets.delete(SECRET);
      await refresh();
   }));
   context.subscriptions.push(host.commands.registerCommand('berry.openTask', async (...args) => {
      const task = args[0] as Task | undefined;
      const origin = args[1];
      if (!task || typeof task.workspaceId !== 'string' || typeof task.id !== 'string' || typeof origin !== 'string' || origin !== connection?.origin) return;
      const url = origin + '/' + encodeURIComponent(task.workspaceSlug) + '/issue/' + encodeURIComponent(task.id);
      if (!await host.env.openExternal(host.Uri.parse(url))) host.window.showErrorMessage('Could not open the task in your browser.');
   }));
   context.subscriptions.push({ dispose() { ++generation; } });
   void refresh();
}
export function deactivate(): void {}

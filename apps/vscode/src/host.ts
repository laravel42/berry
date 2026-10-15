// Narrow structural boundary for the desktop VS Code APIs used by this package.
// Kept local so the companion has no runtime or shared-workspace dependencies.
export interface Disposable { dispose(): unknown }
export interface Secrets { get(key: string): PromiseLike<string | undefined>; store(key: string, value: string): PromiseLike<void>; delete(key: string): PromiseLike<void> }
export interface Context { subscriptions: Disposable[]; secrets: Secrets; extensionPath?: string }
export interface Item { label: string; description?: string; tooltip?: string; command?: { command: string; title: string; arguments?: unknown[] } }
export interface GitApi { repositories: { rootUri?: { fsPath: string }; state: { remotes: { fetchUrl?: string; pushUrl?: string }[] } }[] }
export interface Host {
   EventEmitter: new <T>() => { event: unknown; fire(value: T): void; dispose(): void };
   commands: { registerCommand(id: string, callback: (...args: unknown[]) => unknown): Disposable };
   window: {
      registerTreeDataProvider(id: string, provider: { onDidChangeTreeData: unknown; getTreeItem(item: Item): Item; getChildren(): Item[] }): Disposable;
      showInputBox(options: { title: string; prompt: string; password?: boolean; ignoreFocusOut: boolean; value?: string }): PromiseLike<string | undefined>;
      showErrorMessage(message: string): unknown;
   };
   Uri: { parse(value: string): unknown };
   env: { openExternal(uri: unknown): PromiseLike<boolean>; uiKind?: number; remoteName?: string };
   workspace?: { isTrusted: boolean; workspaceFolders?: { uri: { fsPath: string; scheme: string } }[]; onDidChangeWorkspaceFolders?(listener: () => void): Disposable };
   extensions: { getExtension(id: string): { activate(): PromiseLike<{ getAPI(version: number): GitApi }> } | undefined };
}

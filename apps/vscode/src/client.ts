export interface Connection { origin: string; pat: string }
export interface Task { id: string; title: string; identifier: string; status: string; boardId: string; workspaceId: string; workspaceSlug: string }
interface Board { id: string; workspaceId: string }
export interface Project { id: string; name: string; githubRepo: string | null }
export function normalizeOrigin(value: string): string {
   const url = new URL(value.trim());
   if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Enter an HTTPS Berry origin without a path or credentials.');
   return url.origin;
}
export function repositoryName(remote: string): string | undefined {
   const match = /^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/i.exec(remote);
   return match?.[1]?.toLowerCase();
}
export class Client {
   private connection: Connection;
   private fetcher: typeof fetch;
   constructor(connection: Connection, fetcher: typeof fetch = fetch) {
      this.connection = { ...connection, origin: normalizeOrigin(connection.origin) };
      this.fetcher = fetcher;
   }
   async get<T>(path: string, query: Record<string, string> = {}): Promise<T> {
      if (!/^\/[a-z/]+$/.test(path)) throw new Error('Invalid Berry API path.');
      const url = new URL('/api/v1' + path, this.connection.origin);
      url.search = new URLSearchParams(query).toString();
      try {
         const response = await this.fetcher(url.href, { headers: { Authorization: 'Bearer ' + this.connection.pat }, redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000) });
         if (!response.ok) {
            if (response.status === 401 || response.status === 403) throw new Error('Reconnect with a valid PAT that can read your tasks.');
            if (response.status === 429) throw new Error('Berry is rate limiting requests. Wait, then Refresh.');
            throw new Error('Berry request failed. Try Refresh.');
         }
         return await response.json() as T;
      } catch (error) {
         if (error instanceof Error && /^(Reconnect|Berry request|Berry is rate)/.test(error.message)) throw error;
         throw new Error('Cannot reach Berry. Check the origin and connection, then Refresh.');
      }
   }
   async list<T>(path: string, query: Record<string, string> = {}): Promise<T[]> {
      const nodes: T[] = [];
      const seen = new Set<string>();
      let after = '';
      for (;;) {
         const page = await this.get<{ nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor?: string } }>(path, { ...query, first: '100', ...(after ? { after } : {}) });
         if (!Array.isArray(page.nodes) || !page.pageInfo) throw new Error('Unexpected Berry response. Try Refresh.');
         nodes.push(...page.nodes);
         if (!page.pageInfo.hasNextPage) return nodes;
         const cursor = page.pageInfo.endCursor;
         if (!cursor || seen.has(cursor)) throw new Error('Unexpected Berry pagination. Try Refresh.');
         seen.add(cursor);
         after = cursor;
      }
   }
   async tasks(): Promise<Task[]> {
      const person = await this.get<{ id: string }>('/auth/me');
      const boards = await this.list<Board>('/boards');
      const workspaces = await this.list<{ id: string; slug: string }>('/workspaces');
      const tasks: Task[] = [];
      for (const board of boards) {
         const rows = await this.list<Task>('/issues', { boardId: board.id, assigneeType: 'user', assigneeId: person.id, status: 'backlog,todo,inProgress,inReview,blocked' });
         tasks.push(...rows.map(row => ({ ...row, boardId: board.id, workspaceId: board.workspaceId, workspaceSlug: workspaces.find(workspace => workspace.id === board.workspaceId)?.slug ?? board.workspaceId })));
      }
      return tasks;
   }
   async projects(workspaceId: string): Promise<Project[]> {
      return this.list<Project>('/projects', { workspaceId });
   }
}

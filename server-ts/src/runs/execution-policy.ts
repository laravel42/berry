import type { Sql } from '../db/pool.ts';
import { isApiTokenRuntime } from '../runtime/ai-runtime-catalog.ts';

/**
 * Workstation adapters the dispatcher claims, and that chat admits, when this
 * process has no native compute host. One list, so a runtime the dispatcher
 * can run is not refused at the chat door.
 */
export const WORKSTATION_RUNTIME_KEYS = ['kiro', 'claude', 'codex', 'cursor', 'kimi', 'grok', 'qoder'] as const;

const WORKSPACE_ID =
   /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface TaskExecutionPolicy {
   nativeExecution: boolean;
   workstationKeys: readonly string[];
}

let policy: TaskExecutionPolicy | null = null;

/** Set once by the composition root; null keeps isolated repository tests unrestricted. */
export function configureTaskExecution(value: TaskExecutionPolicy | null): void {
   policy = value ? { nativeExecution: value.nativeExecution, workstationKeys: [...value.workstationKeys] } : null;
}

/**
 * Subscription selection never silently becomes a native/API-billed run.
 * A native host admits native work (a null runtime), workstation CLIs, and
 * API-token runtimes that call the provider from that host. Any other key
 * is refused.
 */
export function taskExecutionAllowed(runtimeKey: string | null): boolean {
   if (!policy) return true;
   if (runtimeKey === null) return policy.nativeExecution;
   if (policy.workstationKeys.includes(runtimeKey)) return true;
   return policy.nativeExecution && isApiTokenRuntime(runtimeKey);
}

/**
 * The workspace a capability read is about.
 *
 * An explicit `workspaceId` query is that workspace, or nothing when it is
 * not an id. With no query, the caller's selected workspace is the scope.
 * A missing scope must not fall through to "any workspace".
 */
export function requestedExecutionWorkspaceId(
   request: Request,
   fallbackWorkspaceId: string | null
): string | null {
   const url = new URL(request.url, 'http://localhost');
   if (url.searchParams.has('workspaceId')) {
      const trimmed = (url.searchParams.get('workspaceId') ?? '').trim();
      return WORKSPACE_ID.test(trimmed) ? trimmed : null;
   }
   if (fallbackWorkspaceId && WORKSPACE_ID.test(fallbackWorkspaceId)) return fallbackWorkspaceId;
   return null;
}

/** True when this workspace has a connected subscription the dispatcher can run. */
export async function workspaceHasExecutableSubscription(
   sql: Sql,
   workspaceId: string,
   runtimeKeys: readonly string[]
): Promise<boolean> {
   const [row] = await sql`SELECT EXISTS (
      SELECT 1 FROM ai_runtime_connections c
      JOIN workspace_memberships m
        ON m.workspace_id = c.workspace_id AND m.user_id = c.user_id
     WHERE c.status = 'connected'
       AND c.workspace_id = ${workspaceId}
       AND c.runtime_key = ANY(${sql.array([...runtimeKeys])}::text[])
   ) AS available`;
   return row?.available === true;
}

/**
 * Native compute is a property of this process. A subscription is a property
 * of one workspace: no workspace, or another workspace's connection, is not
 * execution here.
 */
export async function agentExecutionAvailable(
   sql: Sql,
   input: { nativeExecution: boolean; workspaceId: string | null; runtimeKeys: readonly string[] }
): Promise<boolean> {
   if (input.nativeExecution) return true;
   if (!input.workspaceId) return false;
   return workspaceHasExecutableSubscription(sql, input.workspaceId, input.runtimeKeys);
}

import type { McpTransport } from '../runtime/envelope.ts';
import { apiUrlFromContainer, type PluginContainers } from './containers.ts';
import type { PluginRepository } from './repository.ts';
import type { PluginRuntimeStore } from './runtime-store.ts';

/**
 * A plugin's remote MCP server, as an agent run sees it.
 *
 * A plugin that names its tools is left out until an admin approves at least
 * one — declaring a tool is a request, not a grant. A plugin that offers
 * every tool of its MCP server is included whole, and the runtime admits
 * whatever that server lists. The bearer token is minted per call so it
 * expires with the run it was handed to; `ttlMs` should be that run's lease
 * horizon.
 */

export interface PluginMcpServer {
   name: string;
   url: string;
   transport: McpTransport;
   headers: Record<string, string>;
   /** Null offers every tool the connected MCP server lists. */
   allowedTools: string[] | null;
   installationId: string;
   /** The name a person picked in the task description. */
   title: string;
}

/** Sent on every MCP call so the plugin reads Berry's origin from the request, not from a file. */
export const API_URL_HEADER = 'Berry-Api-Url';

export async function pluginMcpServers(
   deps: { plugins: PluginRepository; runtime: PluginRuntimeStore; apiUrl?: string | null; containers?: PluginContainers | null },
   workspaceId: string,
   ttlMs: number,
   /**
    * Installations named on the task. Absent on a chat, which carries every
    * enabled plugin. An empty set is a task that named none.
    */
   installationIds?: ReadonlySet<string>
): Promise<PluginMcpServer[]> {
   const servers: PluginMcpServer[] = [];
   for (const installation of await deps.plugins.listEnabled(workspaceId)) {
      if (installationIds && !installationIds.has(installation.id.toLowerCase())) continue;
      const mcp = installation.manifest.mcp;
      if (!mcp) continue;
      let allowedTools: string[] | null;
      if (mcp.offer === 'all') {
         allowedTools = null;
      } else {
         allowedTools = mcp.tools
            .map((tool) => tool.name)
            .filter((name) => installation.approvedTools.includes(name));
         if (allowedTools.length === 0) continue;
      }
      const hosted = deps.containers
         ? await deps.containers.ensure({ key: installation.key, port: installation.manifest.port })
         : null;
      const { token } = await deps.runtime.mintToken({
         workspaceId,
         installationId: installation.id,
         scopes: installation.grantedScopes,
         ttlMs,
      });
      await deps.runtime.recordInvocation({
         workspaceId, installationId: installation.id, kind: 'mcp', trigger: 'agent-session',
         status: 'ok', httpStatus: null, durationMs: 0, error: null,
      });
      const origin = hosted ?? installation.baseUrl;
      if (!origin) continue;
      const apiUrl = hosted ? apiUrlFromContainer(deps.apiUrl) : deps.apiUrl;
      servers.push({
         name: `plugin-${installation.key}`,
         url: origin.replace(/\/+$/, '') + mcp.path,
         transport: 'streamable_http',
         headers: {
            Authorization: `Bearer ${token}`,
            ...(apiUrl ? { [API_URL_HEADER]: apiUrl } : {}),
         },
         allowedTools,
         installationId: installation.id,
         title: installation.name,
      });
   }
   return servers;
}

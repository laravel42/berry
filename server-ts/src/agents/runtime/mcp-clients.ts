import { McpClient, type McpServerConfig, type Tool } from '@strands-agents/sdk';
import type { McpServerRef } from '../../runtime/envelope.ts';

/**
 * The agent's MCP servers, as Strands clients. Runs inside the container, so
 * it imports nothing but the SDK and the envelope's types (which the image
 * ships).
 *
 * Every server's tools are prefixed with its name, so two servers exposing
 * `search` cannot collide, and `continueOnError` keeps one unreachable server
 * from failing the whole task: its tools are simply missing.
 *
 * A server with an allowlist (a plugin's, carrying its admin-approved tools)
 * is filtered twice: Strands lists only those tools to the model, and the
 * permission table admits only those names, so an unapproved tool is neither
 * offered nor callable. A server without one (the agent's own, or the
 * workspace's) was configured by an admin: every tool it lists at load is
 * admitted.
 */

export type EnvelopeMcpServerLike = McpServerRef;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function mcpServerConfigs(servers: EnvelopeMcpServerLike[]): Record<string, McpServerConfig> {
   const configs: Record<string, McpServerConfig> = {};
   for (const server of servers) {
      configs[server.name] = {
         url: server.url,
         // Strands names the transports 'streamable-http' | 'sse' | 'stdio'.
         // stdio is never offered: a workspace registers remote servers only.
         transport: server.transport === 'sse' ? 'sse' : 'streamable-http',
         headers: server.headers,
         prefix: server.name,
         continueOnError: true,
         // Strands compiles each pattern to a RegExp matched from the start of
         // the server-side name; anchoring the end too makes it an exact match.
         ...(server.allowedTools
            ? { toolFilters: { allowed: server.allowedTools.map((tool) => `^${escapeRegExp(tool)}$`) } }
            : {}),
      };
   }
   return configs;
}

/** Permission-table entries for allowlisted tools, under the agent-facing `<server>_<tool>` name. */
/**
 * The agent-facing names each loaded server listed, keyed by server name
 * (Strands names each client after its config key). A server that failed to
 * connect lists nothing, and neither does one whose listing throws.
 *
 * Each `listTools()` is a network round-trip. This is the standalone path (and
 * what the tests use); the handler never calls it, reusing the `listed` that
 * {@link registrableMcpTools} already fetched so no client is listed twice.
 */
export async function listedMcpTools(clients: McpClient[]): Promise<Record<string, string[]>> {
   const listed: Record<string, string[]> = {};
   await Promise.all(
      clients.map(async (client) => {
         const tools = await client.listTools().catch(() => []);
         listed[client.clientName] = tools.map((tool) => tool.name);
      })
   );
   return listed;
}

/**
 * Permission-table entries, under the agent-facing `<server>_<tool>` name.
 *
 * A server with an allowlist (a plugin's) admits exactly its approved tools,
 * whatever it lists. A server without one (the agent's own, or the
 * workspace's) was configured by an admin, so every tool it listed at load is
 * admitted; one that failed to load listed nothing and admits nothing.
 */
export function mcpToolPermissions(servers: EnvelopeMcpServerLike[], listed: Record<string, string[]> = {}): Record<string, null> {
   const entries: Record<string, null> = {};
   for (const server of servers) {
      if (server.allowedTools) {
         for (const tool of server.allowedTools) entries[`${server.name}_${tool}`] = null;
         continue;
      }
      const prefix = `${server.name}_`;
      for (const name of listed[server.name] ?? []) {
         if (name.startsWith(prefix)) entries[name] = null;
      }
   }
   return entries;
}

export type Warn = (message: string, fields: Record<string, unknown>) => void;

/**
 * The MCP tools the agent can register, listed once, and their names keyed by
 * server (as {@link listedMcpTools} gives them).
 *
 * Strands refuses a second tool under a name it already holds, and that
 * refusal fails the whole task. So a tool whose agent-facing name is already
 * `reserved` (a built-in or Berry tool: server 'run' listing 'command' is
 * `run_command`), or was taken by an earlier server, is dropped here with one
 * warning. The built-in and every other MCP tool are kept, and the dropped name
 * stays out of `listed`, so the permission table keeps the built-in's rule.
 */
export async function registrableMcpTools(
   clients: McpClient[],
   reserved: Iterable<string>,
   warn: Warn
): Promise<{ tools: Tool[]; listed: Record<string, string[]> }> {
   const offered = await Promise.all(
      clients.map(async (client) => ({ client, tools: await client.listTools().catch(() => []) }))
   );
   const taken = new Set(reserved);
   const tools: Tool[] = [];
   const listed: Record<string, string[]> = {};
   for (const { client, tools: serverTools } of offered) {
      const server = client.clientName;
      const prefix = `${server}_`;
      const names: string[] = [];
      for (const tool of serverTools) {
         if (taken.has(tool.name)) {
            warn('MCP tool dropped: its name clashes with a tool the run already has', {
               server,
               tool: tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name,
               name: tool.name,
            });
            continue;
         }
         taken.add(tool.name);
         tools.push(tool);
         names.push(tool.name);
      }
      listed[server] = names;
   }
   return { tools, listed };
}

/** Default bound on a single server's connect handshake, so a hung one cannot stall task start. */
export const MCP_CONNECT_TIMEOUT_MS = 15_000;

/**
 * The agent's MCP servers as connected Strands clients, each connect bounded.
 *
 * `loadServers` only constructs clients; the connect (and its network round-
 * trip) is lazy, fired by the first `listTools()`/`callTool()`. So a server
 * that accepts the socket but never answers `initialize` would otherwise hang
 * the first tool listing — and with it task start — indefinitely, because the
 * SDK's `McpClient.connect()` forwards no timeout or AbortSignal to the MCP
 * transport (verified against @strands-agents/sdk 1.18.0). We therefore connect
 * each client here under a `timeoutMs` race and drop any that do not answer in
 * time.
 *
 * Connecting eagerly also folds into one round-trip: `listTools()` reuses an
 * already-connected client rather than reconnecting.
 *
 * MCP is best-effort (see this file's header): a server we drop simply
 * contributes no tools, matching `continueOnError`. A dropped client is
 * disconnected so its half-open socket does not leak, and a warning is
 * surfaced. A run with every server unreachable proceeds toolless-of-MCP
 * rather than failing.
 */
export async function loadMcpClients(
   servers: EnvelopeMcpServerLike[],
   timeoutMs: number = MCP_CONNECT_TIMEOUT_MS,
   warn?: Warn
): Promise<McpClient[]> {
   if (servers.length === 0) return [];
   const clients = await McpClient.loadServers(mcpServerConfigs(servers));
   const connected = await Promise.all(
      clients.map(async (client) => {
         let timer: ReturnType<typeof setTimeout> | undefined;
         const timedOut = Symbol('timeout');
         const deadline = new Promise<typeof timedOut>((resolve) => {
            timer = setTimeout(() => resolve(timedOut), timeoutMs);
         });
         try {
            // connect() with continueOnError:true never throws — it swallows a
            // refused connection into a 'failed' state — so the only thing this
            // race guards against is a connect that never settles at all.
            const outcome = await Promise.race([client.connect().then(() => 'connected' as const), deadline]);
            if (outcome !== timedOut) return client;
            warn?.('MCP server dropped: it did not answer the connect handshake in time', {
               server: client.clientName,
               timeoutMs,
            });
            // Leave the hung connect running but disconnect the client so its
            // socket is closed and no unhandled rejection escapes if it later
            // settles.
            void client.disconnect().catch(() => undefined);
            return undefined;
         } finally {
            clearTimeout(timer);
         }
      })
   );
   return connected.filter((client): client is McpClient => client !== undefined);
}

import type { PluginManifest } from './manifest.ts';

export interface UpstreamTool {
   name: string;
   description: string;
}

/** The MCP URL for this manifest, using saved settings or the first server choice. */
export function mcpServerUrl(manifest: PluginManifest, config: Record<string, unknown>): string {
   const servers = manifest.mcp?.servers ?? {};
   const entries = Object.entries(servers);
   const selector = manifest.config.find((field) => field.type === 'array');
   let template: string | undefined;
   if (selector) {
      const picked = config[selector.key];
      const selected = (typeof picked === 'string' && picked.trim() !== '' ? picked : selector.options?.[0] ?? '')
         .trim()
         .toLowerCase();
      template = entries.find(([key]) => key.toLowerCase() === selected)?.[1];
   } else if (entries.length === 1) {
      template = entries[0]?.[1];
   }
   if (!template) throw new Error('This plugin does not name an MCP server.');
   return template.replace(/\{([A-Za-z0-9_-]+)\}/g, (_match, name: string) => {
      const field = manifest.config.find(
         (item) => item.type === 'string' && settingName(item.key) === settingName(name)
      );
      const raw = field ? config[field.key] : undefined;
      if (typeof raw !== 'string' || raw.trim() === '') {
         throw new Error(`Set ${field?.name ?? name} before this plugin can list its tools.`);
      }
      return encodeURIComponent(raw.trim());
   });
}

/**
 * `tools/list` on a remote MCP server. The bearer is the secret saved on an
 * installation, when there is one. The tool names are what comes back; the
 * secret does not.
 */
export async function listUpstreamMcpTools(
   url: string,
   apiKey: string,
   protocolVersion: string,
   clientName: string,
   fetchImpl: typeof fetch = fetch
): Promise<UpstreamTool[]> {
   const session = await initialize(url, apiKey, protocolVersion, clientName, fetchImpl);
   const listed = await post(url, apiKey, session, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
   }, fetchImpl);
   if (listed.status === 401 || listed.status === 403) throw authRejected(apiKey, listed);
   if (!listed.ok) throw new Error('This server did not list its tools.');
   const body = await readRpc(listed);
   const result = body && typeof body === 'object' && 'result' in body ? body.result : undefined;
   return toolsFrom(result);
}

function settingName(value: string): string {
   return value.toLowerCase().replaceAll('_', '-');
}

/** 401/403 with no saved secret, or with one the server refused. */
function authRejected(apiKey: string, response: Response): Error {
   if (apiKey === '') return new Error('This server lists its tools after an API key is saved.');
   const header = response.headers.get('www-authenticate') ?? '';
   if (/realm="OAuth"/i.test(header)) {
      return new Error('This server signs in with OAuth. An API key cannot list its tools.');
   }
   const described = /error_description="([^"]{1,160})"/.exec(header);
   const reason = described?.[1]?.trim();
   return new Error(reason
      ? `This server rejected the saved API key. ${reason}`
      : 'This server rejected the saved API key.');
}

async function initialize(
   url: string,
   apiKey: string,
   protocolVersion: string,
   clientName: string,
   fetchImpl: typeof fetch
): Promise<string | null> {
   const response = await post(url, apiKey, null, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
         protocolVersion,
         capabilities: {},
         clientInfo: { name: clientName, version: '1.0.0' },
      },
   }, fetchImpl);
   if (response.status === 401 || response.status === 403) throw authRejected(apiKey, response);
   if (!response.ok) throw new Error('This server did not list its tools.');
   const session = response.headers.get('mcp-session-id');
   await post(url, apiKey, session, { jsonrpc: '2.0', method: 'notifications/initialized' }, fetchImpl);
   return session;
}

function post(
   url: string,
   apiKey: string,
   session: string | null,
   body: unknown,
   fetchImpl: typeof fetch
): Promise<Response> {
   return fetchImpl(url, {
      method: 'POST',
      headers: {
         ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
         'content-type': 'application/json',
         accept: 'application/json, text/event-stream',
         ...(session ? { 'mcp-session-id': session } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8_000),
   });
}

async function readRpc(response: Response): Promise<{ result?: unknown } | null> {
   const text = await response.text();
   const type = response.headers.get('content-type') ?? '';
   if (type.includes('text/event-stream')) {
      const lines = text.split('\n').flatMap((line) => (line.startsWith('data: ') ? [line.slice(6)] : []));
      const last = lines.at(-1);
      if (!last) return null;
      return JSON.parse(last) as { result?: unknown };
   }
   if (text.trim() === '') return null;
   return JSON.parse(text) as { result?: unknown };
}

function toolsFrom(result: unknown): UpstreamTool[] {
   if (!result || typeof result !== 'object' || !('tools' in result)) return [];
   const tools = (result as { tools: unknown }).tools;
   if (!Array.isArray(tools)) return [];
   const listed: UpstreamTool[] = [];
   for (const tool of tools) {
      if (!tool || typeof tool !== 'object') continue;
      const name = (tool as { name?: unknown }).name;
      if (typeof name !== 'string' || name === '') continue;
      const description = (tool as { description?: unknown }).description;
      listed.push({
         name,
         description: typeof description === 'string' ? description.trim() : '',
      });
   }
   return listed;
}

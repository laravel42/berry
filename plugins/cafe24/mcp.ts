import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BerryClient } from '@berry/plugin-sdk';

interface PluginManifest {
   key: string;
   name: string;
   version: string;
   port?: number;
   config: { key: string; name?: string; type?: string; options?: string[] }[];
   mcp?: {
      path: string;
      protocolVersion?: string;
      servers?: Record<string, string>;
   };
}

/** The package file next to this module. Hosts, names and the listen port live there. */
export function readPluginManifest(): PluginManifest {
   const file = join(dirname(fileURLToPath(import.meta.url)), 'manifest.json');
   const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
   if (!parsed || typeof parsed !== 'object') throw new Error('manifest.json is not an object');
   return parsed as PluginManifest;
}

interface Rpc {
   id?: number | string;
   method?: string;
   params?: { name?: string; arguments?: Record<string, unknown>; protocolVersion?: string };
}

/**
 * The MCP endpoint an agent run calls. Berry connects with a short-lived plugin
 * token. This process connects to the MCP server named in manifest.json
 * with the bearer token saved on the installation and returns every tool that
 * server lists.
 */
export async function handleMcp(input: {
   body: string;
   authorization: string | null;
   apiUrl: string;
   fetchImpl?: typeof fetch;
}): Promise<{ status: number; body: string }> {
   const token = bearer(input.authorization);
   if (!token) return { status: 401, body: 'plugin token required' };
   let message: Rpc;
   try {
      message = JSON.parse(input.body) as Rpc;
   } catch {
      return { status: 400, body: 'invalid json' };
   }
   if (message.id === undefined) return { status: 202, body: '' };

   const manifest = readPluginManifest();
   if (message.method === 'initialize') {
      return rpc(message.id, {
         protocolVersion: message.params?.protocolVersion,
         capabilities: { tools: {} },
         serverInfo: { name: manifest.key, version: manifest.version },
      });
   }
   if (message.method !== 'tools/list' && message.method !== 'tools/call') return rpc(message.id, {});

   const fetchImpl = input.fetchImpl ?? fetch;
   const api = new BerryClient({ apiUrl: input.apiUrl, token, ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}) });
   try {
      const upstream = await callUpstream(manifest, api, input.apiUrl, message, fetchImpl);
      return rpc(message.id, upstream);
   } catch (error) {
      const text = error instanceof Error ? error.message : 'tool failed';
      if (message.method === 'tools/call') return rpc(message.id, toolText(text, true));
      return rpc(message.id, { tools: [] }, text);
   }
}

async function callUpstream(
   manifest: PluginManifest,
   api: BerryClient,
   apiUrl: string,
   message: Rpc,
   fetchImpl: typeof fetch
): Promise<unknown> {
   if (!apiUrl) throw new Error('Berry did not send its API address');
   const self = await api.self();
   const secretName = manifest.config.find((field) => field.type === 'secret')?.key;
   const apiKey = secretName ? (self.secrets[secretName] ?? '') : '';
   if (secretName && !apiKey) throw new Error(`Set ${secretName} on this plugin in Berry`);
   const url = resolveServer(manifest, self.config);
   const protocolVersion = manifest.mcp?.protocolVersion;
   if (!protocolVersion) throw new Error('manifest.json does not name an MCP protocol version');
   const session = await openSession(url, apiKey, protocolVersion, manifest, fetchImpl);
   const response = await post(url, apiKey, session, {
      jsonrpc: '2.0',
      id: message.id,
      method: message.method,
      params: message.params ?? {},
   }, fetchImpl);
   if (!response.ok) throw new Error(`${manifest.name} answered ${response.status}`);
   const body = await readRpc(response);
   if (body && typeof body === 'object' && 'result' in body) return body.result;
   throw new Error(`${manifest.name} returned no result`);
}

async function openSession(
   url: string,
   apiKey: string,
   protocolVersion: string,
   manifest: PluginManifest,
   fetchImpl: typeof fetch
): Promise<string | null> {
   const response = await post(url, apiKey, null, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
         protocolVersion,
         capabilities: {},
         clientInfo: { name: `berry-${manifest.key}`, version: manifest.version },
      },
   }, fetchImpl);
   if (!response.ok) throw new Error(`${manifest.name} answered ${response.status}`);
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
   return JSON.parse(text) as { result?: unknown };
}

function rpc(id: number | string, result: unknown, message?: string): { status: number; body: string } {
   const payload = message
      ? { jsonrpc: '2.0', id, error: { code: -32000, message } }
      : { jsonrpc: '2.0', id, result };
   return { status: 200, body: JSON.stringify(payload) };
}

function toolText(value: string, isError: boolean): { content: { type: 'text'; text: string }[]; isError?: boolean } {
   return isError ? { content: [{ type: 'text', text: value }], isError: true } : { content: [{ type: 'text', text: value }] };
}

/** The upstream URL: the selected server, or the only one, with `{placeholder}` filled from string settings. */
export function resolveServer(manifest: PluginManifest, config: Record<string, unknown>): string {
   const servers = manifest.mcp?.servers ?? {};
   const entries = Object.entries(servers);
   const selector = manifest.config.find((field) => field.type === 'array');
   let template: string | undefined;
   if (selector) {
      const selected = chosenOption(config[selector.key]);
      template = entries.find(([key]) => key.toLowerCase() === selected)?.[1];
      if (!template) {
         throw new Error(`Set ${selector.name ?? selector.key} to ${entries.map(([key]) => key).join(' or ')} on this plugin in Berry`);
      }
   } else if (entries.length === 1) {
      template = entries[0]?.[1];
   }
   if (!template) throw new Error('manifest.json does not name an MCP server');
   return template.replace(/\{([A-Za-z0-9_-]+)\}/g, (match, name: string) => {
      const field = manifest.config.find(
         (item) => item.type === 'string' && item.key.toLowerCase().replaceAll('_', '-') === name.toLowerCase().replaceAll('_', '-')
      );
      const raw = field ? config[field.key] : undefined;
      if (typeof raw !== 'string' || raw.trim() === '') {
         throw new Error(`Set ${field?.name ?? name} on this plugin in Berry`);
      }
      return encodeURIComponent(raw.trim());
   });
}

function chosenOption(value: unknown): string {
   const picked = Array.isArray(value) ? value[0] : value;
   return typeof picked === 'string' ? picked.trim().toLowerCase() : '';
}

function bearer(header: string | null): string | null {
   if (!header?.startsWith('Bearer berry_plg_')) return null;
   const token = header.slice('Bearer '.length);
   return token.includes(' ') ? null : token;
}

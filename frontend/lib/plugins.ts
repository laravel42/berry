import { z } from 'zod';
import { apiFetch } from './api';

/**
 * Workspace plugins, as `/api/v1/plugins/{workspaceId}` serves them.
 * Secret values are write-only: the server says whether one is set, never what it is.
 */

const configValueSchema = z.union([z.string(), z.number(), z.boolean()]);

const configFieldSchema = z.object({
   key: z.string(),
   name: z.string().optional(),
   label: z.string(),
   type: z.enum(['string', 'number', 'boolean', 'array']),
   options: z.array(z.string()).optional(),
   required: z.boolean(),
});

const installationSchema = z.object({
   id: z.string(),
   workspaceId: z.string(),
   key: z.string(),
   name: z.string(),
   version: z.string(),
   description: z.string(),
   source: z.enum(['url', 'upload']),
   sourceUrl: z.string().nullable(),
   baseUrl: z.string().nullable(),
   enabled: z.boolean(),
   config: z.record(z.string(), configValueSchema),
   configFields: z.array(configFieldSchema),
   secrets: z.array(
      z.object({
         name: z.string(),
         title: z.string().optional(),
         description: z.string(),
         set: z.boolean(),
      })
   ),
   scopes: z.array(z.string()),
   hooks: z.array(
      z.object({
         key: z.string(),
         trigger: z.enum(['event', 'schedule']),
         events: z.array(z.string()).optional(),
         everyMinutes: z.number().optional(),
      })
   ),
   surfaces: z.array(z.object({ key: z.string(), title: z.string() })),
   mcpOffer: z.enum(['declared', 'all']).default('declared'),
   mcpTools: z.array(
      z.object({ name: z.string(), description: z.string(), approved: z.boolean() })
   ),
   installedBy: z.string(),
   createdAt: z.string(),
   updatedAt: z.string(),
});

const previewSchema = z.object({
   key: z.string(),
   name: z.string(),
   version: z.string(),
   description: z.string(),
   baseUrl: z.string().nullable(),
   scopes: z.array(z.string()),
   config: z.array(configFieldSchema),
   secrets: z.array(
      z.object({ name: z.string(), title: z.string().optional(), description: z.string() })
   ),
   events: z.array(z.string()),
   schedules: z.array(z.object({ key: z.string(), everyMinutes: z.number() })),
   surfaces: z.array(z.object({ key: z.string(), title: z.string() })),
   mcpOffer: z.enum(['declared', 'all']).default('declared'),
   mcpTools: z.array(z.string()),
   files: z.array(z.object({ path: z.string(), size: z.number() })),
});

const invocationSchema = z.object({
   id: z.string(),
   kind: z.enum(['event', 'schedule', 'surface', 'mcp']),
   trigger: z.string(),
   status: z.enum(['ok', 'error']),
   httpStatus: z.number().nullable(),
   durationMs: z.number(),
   error: z.string().nullable(),
   createdAt: z.string(),
});

const storedValueSchema = z.object({ key: z.string(), value: z.unknown(), updatedAt: z.string() });

export type PluginConfigValue = z.infer<typeof configValueSchema>;
export type PluginConfigField = z.infer<typeof configFieldSchema>;
export type PluginInstallation = z.infer<typeof installationSchema>;
export type PluginPreview = z.infer<typeof previewSchema>;
export type PluginInvocation = z.infer<typeof invocationSchema>;
export type PluginStoredValue = z.infer<typeof storedValueSchema>;
export type PluginSource = { url: string } | { package: unknown };

const base = (workspaceId: string) => `/api/v1/plugins/${encodeURIComponent(workspaceId)}`;
const one = (workspaceId: string, id: string) =>
   `${base(workspaceId)}/installations/${encodeURIComponent(id)}`;

function parse<T extends z.ZodTypeAny>(schema: T, json: unknown, what: string): z.infer<T> {
   const parsed = schema.safeParse(json);
   if (!parsed.success) throw new Error(`${what} response was not recognized`);
   return parsed.data;
}

export interface CatalogPlugin {
   preview: PluginPreview;
   package: unknown;
}

/**
 * A tool description a person can read.
 *
 * Some servers, PostHog's `exec` among them, put an agent prompt in the
 * description ("SKILLS FIRST…"). That prompt stays with the agent. The
 * settings list gets one plain sentence, or a short stand-in when the text
 * is instructions rather than a summary.
 */
export function toolSummary(description: string): string {
   const plain = description
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/[*_`#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
   if (plain === '') return '';
   if (/skills first|before answering any|authoritative source of/i.test(plain)) {
      return 'Runs a skill on this server.';
   }
   const sentence = plain.split(/(?<=[.!?])\s/)[0] ?? plain;
   if (sentence.length <= 180) return sentence;
   return `${sentence.slice(0, 177).trimEnd()}…`;
}

export async function loadPluginTools(
   workspaceId: string,
   key: string
): Promise<{ name: string; description: string }[]> {
   return parse(
      z.object({
         tools: z.array(z.object({ name: z.string(), description: z.string() })),
      }),
      await apiFetch(`${base(workspaceId)}/catalog/${encodeURIComponent(key)}/tools`),
      'Plugin tools'
   ).tools;
}

export async function loadPluginCatalog(workspaceId: string): Promise<CatalogPlugin[]> {
   return parse(
      z.object({
         nodes: z.array(z.object({ preview: previewSchema, package: z.unknown() })),
      }),
      await apiFetch(`${base(workspaceId)}/catalog`),
      'Plugin catalog'
   ).nodes;
}

/**
 * Plugin attachments live on the description as mention links so a run can
 * read them. The task editor does not show those links.
 */
const PLUGIN_MENTION =
   /\[@[^\]\n]{1,100}\]\(mention:\/\/plugin\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\)/gi;

export function pluginMentionTokens(body: string): string[] {
   return [...body.matchAll(PLUGIN_MENTION)].map((match) => match[0]);
}

export function stripPluginMentions(body: string): string {
   return body
      .replace(PLUGIN_MENTION, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
}

/** Puts the stored plugin mentions back after an edit of the visible text. */
export function keepPluginMentions(visible: string, stored: string): string {
   const body = visible.trim();
   const seen = new Set<string>();
   const links = pluginMentionTokens(stored).filter((token) => {
      const key = token.toLowerCase();
      if (body.toLowerCase().includes(token.toLowerCase()) || seen.has(key)) return false;
      seen.add(key);
      return true;
   });
   if (links.length === 0) return body;
   return body ? `${body}\n\n${links.join(' ')}` : links.join(' ');
}

export async function loadPlugins(workspaceId: string): Promise<PluginInstallation[]> {
   return parse(
      z.object({ nodes: z.array(installationSchema) }),
      await apiFetch(`${base(workspaceId)}/installations`),
      'Plugins'
   ).nodes;
}

export async function previewPlugin(
   workspaceId: string,
   source: PluginSource
): Promise<PluginPreview> {
   return parse(
      previewSchema,
      await apiFetch(`${base(workspaceId)}/preview`, {
         method: 'POST',
         body: JSON.stringify(source),
      }),
      'Preview'
   );
}

export async function installPlugin(
   workspaceId: string,
   source: PluginSource,
   config: Record<string, PluginConfigValue>
): Promise<{ installation: PluginInstallation; signingSecret: string }> {
   return parse(
      z.object({ installation: installationSchema, signingSecret: z.string() }),
      await apiFetch(`${base(workspaceId)}/installations`, {
         method: 'POST',
         body: JSON.stringify({ ...source, config }),
      }),
      'Plugin'
   );
}

export async function loadPlugin(
   workspaceId: string,
   id: string
): Promise<PluginInstallation & { files: { path: string; size: number }[] }> {
   return parse(
      installationSchema.extend({
         files: z.array(z.object({ path: z.string(), size: z.number() })),
      }),
      await apiFetch(one(workspaceId, id)),
      'Plugin'
   );
}

export async function updatePlugin(
   workspaceId: string,
   id: string,
   patch: { enabled?: boolean; config?: Record<string, PluginConfigValue>; baseUrl?: string }
): Promise<PluginInstallation> {
   return parse(
      installationSchema,
      await apiFetch(one(workspaceId, id), { method: 'PATCH', body: JSON.stringify(patch) }),
      'Plugin'
   );
}

export async function uninstallPlugin(workspaceId: string, id: string): Promise<void> {
   await apiFetch(one(workspaceId, id), { method: 'DELETE' });
}

export async function setPluginSecret(
   workspaceId: string,
   id: string,
   name: string,
   value: string
): Promise<void> {
   await apiFetch(`${one(workspaceId, id)}/secrets/${encodeURIComponent(name)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
   });
}

export async function deletePluginSecret(
   workspaceId: string,
   id: string,
   name: string
): Promise<void> {
   await apiFetch(`${one(workspaceId, id)}/secrets/${encodeURIComponent(name)}`, {
      method: 'DELETE',
   });
}

export async function setPluginTool(
   workspaceId: string,
   id: string,
   tool: string,
   approved: boolean
): Promise<PluginInstallation> {
   return parse(
      installationSchema,
      await apiFetch(`${one(workspaceId, id)}/tools/${encodeURIComponent(tool)}`, {
         method: 'PUT',
         body: JSON.stringify({ approved }),
      }),
      'Plugin'
   );
}

export async function loadPluginInvocations(
   workspaceId: string,
   id: string
): Promise<PluginInvocation[]> {
   return parse(
      z.object({ nodes: z.array(invocationSchema) }),
      await apiFetch(`${one(workspaceId, id)}/invocations?first=50`),
      'Invocations'
   ).nodes;
}

export async function loadPluginStorage(
   workspaceId: string,
   id: string
): Promise<PluginStoredValue[]> {
   return parse(
      z.object({ nodes: z.array(storedValueSchema) }),
      await apiFetch(`${one(workspaceId, id)}/storage?first=50`),
      'Storage'
   ).nodes;
}

export async function launchPluginSurface(
   workspaceId: string,
   id: string,
   surface: string
): Promise<{ url: string; expiresAt: string }> {
   return parse(
      z.object({ url: z.string(), expiresAt: z.string() }),
      await apiFetch(`${one(workspaceId, id)}/surfaces/${encodeURIComponent(surface)}/launch`, {
         method: 'POST',
      }),
      'Surface'
   );
}

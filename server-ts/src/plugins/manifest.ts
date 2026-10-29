import { z } from 'zod';
import { API_SCOPES } from '../public-api/scopes.ts';
import { InvalidPluginInput, zodFields, type PluginFieldError } from './errors.ts';

/**
 * The plugin package: a manifest describing what the plugin asks for, plus a
 * few text files shown in the install preview. Berry never serves the files
 * as pages — surfaces are the plugin's own https URLs, loaded in an iframe.
 */

const KEY = /^[a-z0-9][a-z0-9-]{1,62}$/;
const SHORT_KEY = /^[a-z0-9][a-z0-9-]{0,62}$/;
const FILE_PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;

const pathSchema = z
   .string()
   .regex(/^\/[A-Za-z0-9._~/-]{0,200}$/, 'Path must start with / and use URL-safe characters.')
   .refine((path) => !path.split('/').includes('..'), 'Path must not contain "..".');

function isHttpUrl(value: string, allowSearch: boolean): boolean {
   try {
      const url = new URL(value);
      return (
         (url.protocol === 'https:' || url.protocol === 'http:') &&
         url.username === '' &&
         url.password === '' &&
         (allowSearch || url.search === '') &&
         url.hash === ''
      );
   } catch {
      return false;
   }
}

const baseUrlSchema = z
   .string()
   .max(500)
   .refine((value) => isHttpUrl(value, false), 'Base URL must be an http(s) URL without credentials, query or fragment.');

/** An upstream MCP address. A query is how some servers pick a tool catalog. */
const mcpServerUrlSchema = z
   .string()
   .max(500)
   .refine((value) => isHttpUrl(value, true), 'MCP server URL must be an http(s) URL without credentials or a fragment.');

const configFieldSchema = z
   .object({
      key: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/),
      /** Short title in settings. `label` is the longer description. */
      name: z.string().trim().min(1).max(80).optional(),
      label: z.string().trim().min(1).max(200),
      /**
       * `array` offers `options` and stores the one option the admin picks.
       * `secret` is sealed and is not a setting edited in the clear.
       */
      type: z.enum(['string', 'number', 'boolean', 'secret', 'array']),
      options: z.array(z.string().trim().min(1).max(80)).min(1).max(20).optional(),
      required: z.boolean().default(false),
   })
   .strict();

const hookSchema = z.discriminatedUnion('trigger', [
   z
      .object({
         key: z.string().regex(SHORT_KEY),
         trigger: z.literal('event'),
         events: z.array(z.string().regex(/^[a-z]+(\.[a-z_]+)+$/)).min(1).max(20),
         path: pathSchema,
      })
      .strict(),
   z
      .object({
         key: z.string().regex(SHORT_KEY),
         trigger: z.literal('schedule'),
         everyMinutes: z.number().int().min(5).max(10080),
         path: pathSchema,
      })
      .strict(),
]);

export const pluginManifestSchema = z
   .object({
      schemaVersion: z.literal(1),
      key: z.string().regex(KEY),
      name: z.string().trim().min(1).max(80),
      version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
      description: z.string().max(500).default(''),
      /**
       * Where Berry calls the plugin. Omitted when Berry starts the plugin
       * in a container and nothing else is called at a public URL.
       */
      baseUrl: baseUrlSchema.optional(),
      /** Listen port inside a container. Omitted when Berry assigns one at start. */
      port: z.number().int().min(1).max(65535).optional(),
      scopes: z.array(z.enum(API_SCOPES)).max(API_SCOPES.length).default([]),
      config: z.array(configFieldSchema).max(50).default([]),
      secrets: z
         .array(
            z
               .object({
                  name: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
                  description: z.string().max(200).default(''),
               })
               .strict()
         )
         .max(20)
         .default([]),
      hooks: z.array(hookSchema).max(20).default([]),
      surfaces: z
         .array(
            z
               .object({
                  key: z.string().regex(SHORT_KEY),
                  title: z.string().trim().min(1).max(60),
                  path: pathSchema,
               })
               .strict()
         )
         .max(10)
         .default([]),
      mcp: z
         .object({
            path: pathSchema,
            /**
             * `declared` names each tool in `tools`, and an admin approves
             * them one by one. `all` connects the plugin to its MCP server
             * and offers every tool that server lists.
             */
            offer: z.enum(['declared', 'all']).default('declared'),
            protocolVersion: z.string().trim().min(1).max(32).optional(),
            /**
             * `oauth` starts the MCP authorization-code + PKCE flow. `bearer`
             * is a sealed API key the admin pastes.
             */
            auth: z.enum(['bearer', 'oauth']).default('bearer'),
            /** Scopes requested when `auth` is `oauth`. The person still consents. */
            scopes: z
               .array(
                  z
                     .string()
                     .refine(
                        (value) =>
                           /^[A-Za-z][A-Za-z0-9:._-]{0,79}$/.test(value) ||
                           /^https:\/\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]{1,200}$/.test(value),
                        'Scope must be a short token or an https URL.'
                     )
               )
               .max(40)
               .optional(),
            /** Extra authorize query fields this authorization server needs. */
            authorize: z.record(z.string().regex(/^[a-z_]{1,40}$/), z.string().trim().min(1).max(200)).optional(),
            servers: z.record(z.string().regex(SHORT_KEY), mcpServerUrlSchema).optional(),
            tools: z
               .array(
                  z
                     .object({
                        name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
                        description: z.string().max(500).default(''),
                     })
                     .strict()
               )
               .max(50)
               .default([]),
         })
         .strict()
         .optional(),
   })
   .strict()
   .superRefine((manifest, ctx) => {
      const unique = (values: string[], path: (index: number) => (string | number)[]) => {
         const seen = new Set<string>();
         values.forEach((value, index) => {
            if (seen.has(value)) ctx.addIssue({ code: 'custom', message: 'Must be unique.', path: path(index) });
            seen.add(value);
         });
      };
      unique(manifest.config.map((f) => f.key), (i) => ['config', i, 'key']);
      unique(manifest.secrets.map((s) => s.name), (i) => ['secrets', i, 'name']);
      const secretKeys = new Set(manifest.config.filter((field) => field.type === 'secret').map((field) => field.key));
      manifest.secrets.forEach((secret, index) => {
         if (secretKeys.has(secret.name)) {
            ctx.addIssue({ code: 'custom', message: 'Already declared as a config secret.', path: ['secrets', index, 'name'] });
         }
      });
      unique(manifest.hooks.map((h) => h.key), (i) => ['hooks', i, 'key']);
      unique(manifest.surfaces.map((s) => s.key), (i) => ['surfaces', i, 'key']);
      unique((manifest.mcp?.tools ?? []).map((t) => t.name), (i) => ['mcp', 'tools', i, 'name']);
      manifest.config.forEach((field, index) => {
         if (field.type === 'array') {
            if (field.options === undefined) {
               ctx.addIssue({ code: 'custom', message: 'List the options.', path: ['config', index, 'options'] });
            } else {
               unique(field.options, (optionIndex) => ['config', index, 'options', optionIndex]);
            }
         } else if (field.options !== undefined) {
            ctx.addIssue({ code: 'custom', message: 'Options belong on an array field.', path: ['config', index, 'options'] });
         }
      });
      if (manifest.mcp && manifest.mcp.offer === 'declared' && manifest.mcp.tools.length === 0) {
         ctx.addIssue({ code: 'custom', message: 'Name the tools, or offer every tool the MCP server lists.', path: ['mcp', 'tools'] });
      }
   });

export type PluginManifest = z.infer<typeof pluginManifestSchema>;

export const pluginPackageSchema = z
   .object({
      manifest: pluginManifestSchema,
      files: z
         .array(
            z
               .object({
                  path: z
                     .string()
                     .max(200)
                     .regex(FILE_PATH)
                     .refine((p) => !p.split('/').some((s) => s === '..' || s === '.'), 'Invalid path.'),
                  content: z.string().max(262_144),
               })
               .strict()
         )
         .max(50)
         .default([]),
   })
   .strict()
   .superRefine((pkg, ctx) => {
      const total = pkg.files.reduce((sum, file) => sum + Buffer.byteLength(file.content, 'utf8'), 0);
      if (total > 1_000_000) ctx.addIssue({ code: 'custom', message: 'Files exceed 1 MB in total.', path: ['files'] });
      const seen = new Set<string>();
      pkg.files.forEach((file, index) => {
         if (seen.has(file.path)) ctx.addIssue({ code: 'custom', message: 'Must be unique.', path: ['files', index, 'path'] });
         seen.add(file.path);
      });
   });

export type PluginPackage = z.infer<typeof pluginPackageSchema>;
export type PluginConfigValue = string | number | boolean;

/** Config entries of type `secret`, plus any names still declared on `secrets`. */
export function declaredSecrets(manifest: PluginManifest): { name: string; title: string; description: string }[] {
   const fromConfig = manifest.config
      .filter((field) => field.type === 'secret')
      .map((field) => ({ name: field.key, title: field.name ?? field.key, description: field.label }));
   const named = new Set(fromConfig.map((secret) => secret.name));
   return [
      ...fromConfig,
      ...manifest.secrets
         .filter((secret) => !named.has(secret.name))
         .map((secret) => ({ name: secret.name, title: secret.name, description: secret.description })),
   ];
}

/** Settings an admin edits in the clear. Secret fields are stored separately. */
export function settingsFields(manifest: PluginManifest): PluginManifest['config'] {
   return manifest.config.filter((field) => field.type !== 'secret');
}
export type PluginConfig = Record<string, PluginConfigValue>;

export function parsePackage(value: unknown, options?: { container?: boolean }): PluginPackage {
   const parsed = pluginPackageSchema.safeParse(value);
   if (!parsed.success) throw new InvalidPluginInput(zodFields(parsed.error));
   const manifest = parsed.data.manifest;
   const hosted = options?.container === true || manifest.port !== undefined;
   const needsBaseUrl =
      manifest.hooks.length > 0 || manifest.surfaces.length > 0 || (manifest.mcp !== undefined && !hosted);
   if (needsBaseUrl && manifest.baseUrl === undefined) {
      throw new InvalidPluginInput([{
         path: '/manifest/baseUrl',
         message: 'Base URL is required unless Berry reaches this plugin through its container.',
      }]);
   }
   return parsed.data;
}

/** Config must name only declared keys, with the declared type; required keys must be present. */
export function validateConfig(manifest: PluginManifest, value: unknown): PluginConfig {
   if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new InvalidPluginInput([{ path: '/config', message: 'Config must be an object.' }]);
   }
   const input = value as Record<string, unknown>;
   const fields: PluginFieldError[] = [];
   const config: PluginConfig = {};
   const declared = new Map(manifest.config.map((field) => [field.key, field]));
   for (const key of Object.keys(input)) {
      const field = declared.get(key);
      if (!field) fields.push({ path: `/config/${key}`, message: 'The plugin does not declare this setting.' });
      else if (field.type === 'secret') fields.push({ path: `/config/${key}`, message: 'Save this as a secret.' });
   }
   for (const field of manifest.config) {
      if (field.type === 'secret') continue;
      const entry = input[field.key];
      if (entry === undefined || entry === null || entry === '') {
         if (field.required) fields.push({ path: `/config/${field.key}`, message: `${field.label} is required.` });
         continue;
      }
      const choices = field.type === 'array' ? (field.options ?? []) : [];
      const typeOk =
         (field.type === 'string' && typeof entry === 'string' && entry.length <= 2000) ||
         (field.type === 'number' && typeof entry === 'number' && Number.isFinite(entry)) ||
         (field.type === 'boolean' && typeof entry === 'boolean') ||
         (field.type === 'array' && typeof entry === 'string' && choices.includes(entry));
      if (!typeOk) {
         const message =
            field.type === 'array'
               ? `${field.label} must be ${choices.join(' or ')}.`
               : `${field.label} must be a ${field.type}.`;
         fields.push({ path: `/config/${field.key}`, message });
         continue;
      }
      config[field.key] = entry as PluginConfigValue;
   }
   if (fields.length > 0) throw new InvalidPluginInput(fields);
   return config;
}

export interface PluginPreview {
   key: string;
   name: string;
   version: string;
   description: string;
   baseUrl: string | null;
   scopes: string[];
   config: PluginManifest['config'];
   secrets: { name: string; title: string; description: string }[];
   events: string[];
   schedules: { key: string; everyMinutes: number }[];
   surfaces: { key: string; title: string }[];
   mcpOffer: 'declared' | 'all';
   mcpAuth: 'bearer' | 'oauth';
   available: boolean;
   mcpTools: string[];
   files: { path: string; size: number }[];
}

/** The same check the manifest uses for `baseUrl`. An installation may change it later. */
export function parsePluginBaseUrl(value: string): string {
   const parsed = baseUrlSchema.safeParse(value);
   if (!parsed.success) {
      throw new InvalidPluginInput([{ path: '/baseUrl', message: 'Base URL must be an http(s) URL without credentials, query or fragment.' }]);
   }
   return parsed.data;
}

export function mcpAuthMode(manifest: PluginManifest): 'bearer' | 'oauth' {
   return manifest.mcp?.auth ?? 'bearer';
}

/** Catalog hosts that work with no OAuth and no pasted secret. */
const OPEN_CATALOG_KEYS = new Set(['firecrawl', 'openai-docs']);

/** Connect-ready, or an open MCP host. Everything else stays listed last. */
export function pluginCatalogAvailable(manifest: PluginManifest): boolean {
   return mcpAuthMode(manifest) === 'oauth' || OPEN_CATALOG_KEYS.has(manifest.key);
}

/** Space-separated scopes requested at authorize time. The person still consents. */
export function oauthScopeList(manifest: PluginManifest): string {
   return (manifest.mcp?.scopes ?? []).join(' ');
}

export function oauthAuthorizeParams(manifest: PluginManifest): Record<string, string> {
   return { ...(manifest.mcp?.authorize ?? {}) };
}

export function oauthTokenSecretName(manifest: PluginManifest): string | null {
   const secrets = declaredSecrets(manifest);
   return secrets.find((secret) => secret.name === 'API_KEY')?.name ?? secrets[0]?.name ?? null;
}

export function oauthClientId(config: Record<string, unknown>): string {
   const value = config.CLIENT_ID;
   return typeof value === 'string' ? value.trim() : '';
}

export function oauthClientSecretName(manifest: PluginManifest): string | null {
   return declaredSecrets(manifest).some((secret) => secret.name === 'CLIENT_SECRET')
      ? 'CLIENT_SECRET'
      : null;
}

export function oauthRefreshSecretName(manifest: PluginManifest): string | null {
   return declaredSecrets(manifest).some((secret) => secret.name === 'REFRESH_TOKEN')
      ? 'REFRESH_TOKEN'
      : null;
}

export function describePackage(pkg: PluginPackage): PluginPreview {
   const { manifest } = pkg;
   const events = new Set<string>();
   const schedules: { key: string; everyMinutes: number }[] = [];
   for (const hook of manifest.hooks) {
      if (hook.trigger === 'event') for (const event of hook.events) events.add(event);
      else schedules.push({ key: hook.key, everyMinutes: hook.everyMinutes });
   }
   return {
      key: manifest.key,
      name: manifest.name,
      version: manifest.version,
      description: manifest.description,
      baseUrl: manifest.baseUrl ?? null,
      scopes: [...manifest.scopes],
      config: settingsFields(manifest),
      secrets: declaredSecrets(manifest),
      events: [...events].sort(),
      schedules,
      surfaces: manifest.surfaces.map((s) => ({ key: s.key, title: s.title })),
      mcpOffer: manifest.mcp?.offer ?? 'declared',
      mcpAuth: mcpAuthMode(manifest),
      available: pluginCatalogAvailable(manifest),
      mcpTools: (manifest.mcp?.tools ?? []).map((t) => t.name),
      files: pkg.files.map((f) => ({ path: f.path, size: Buffer.byteLength(f.content, 'utf8') })),
   };
}

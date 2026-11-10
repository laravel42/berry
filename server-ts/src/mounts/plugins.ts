import { Hono } from 'hono';
import { z } from 'zod';
import type { SessionService } from '../auth/sessions.ts';
import type { Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { decodeTimeCursor, encodeCursor, parsePageQuery } from '../http/cursor.ts';
import { ApiError } from '../http/errors.ts';
import { readJson } from '../http/json-body.ts';
import type { Mount } from '../http/registry.ts';
import { requireSession } from '../auth/middleware.ts';
import { Forbidden, NotFound, toApiError } from '../identity/errors.ts';
import { allows, type Permission } from '../identity/roles.ts';
import { InvalidPluginInput, PluginAlreadyInstalled, PluginUnreachable } from '../plugins/errors.ts';
import { resolveWorkspaceContext, scopedDb, type ScopedDb } from '../identity/workspace-context.ts';
import { bundledPluginPackages } from '../plugins/catalog.ts';
import { listUpstreamMcpTools, mcpServerUrl } from '../plugins/upstream-tools.ts';
import { loadPackage, type PackageSource } from '../plugins/loader.ts';
import {
   declaredSecrets,
   describePackage,
   mcpAuthMode,
   pluginCatalogAvailable,
   oauthAuthorizeParams,
   oauthClientId,
   oauthClientSecretName,
   oauthRefreshSecretName,
   oauthScopeList,
   oauthTokenSecretName,
   settingsFields,
} from '../plugins/manifest.ts';
import {
   buildAuthorizeUrl,
   exchangeMcpCode,
   McpOAuthFailed,
   resolveMcpOAuthClient,
   startMcpAuthorize,
   type McpOAuthClient,
} from '../plugins/mcp-oauth.ts';
import type { PluginNetwork } from '../plugins/net.ts';
import {
   PluginAuthorizationNotPending,
   type PluginOAuthStateStore,
} from '../plugins/oauth-states.ts';
import type { PluginInstallation, PluginRepository } from '../plugins/repository.ts';
import type { PluginRuntimeStore } from '../plugins/runtime-store.ts';
import { pathId, type ScopedVariables } from './shared.ts';

/**
 * `/api/v1/plugins/:workspaceId/*` — installing and running plugins.
 *
 * Its own prefix rather than a sub-route of `/api/v1/workspaces`, because the
 * registry refuses overlapping prefixes. The workspace gate is the same one
 * `workspace-reads` uses: membership before any handler runs, and the
 * permission each write needs checked inside `ScopedDb.mutate`.
 */

export const SURFACE_TOKEN_TTL_MS = 15 * 60_000;

export interface PluginMountOptions {
   sessions: SessionService;
   sql: Sql;
   /** Null without INTEGRATION_ENCRYPTION_KEY: nothing can seal a plugin's secrets. */
   plugins: PluginRepository | null;
   runtime: PluginRuntimeStore;
   network: PluginNetwork;
   /** Where a plugin reaches `/v1`. BERRY_PUBLIC_URL. */
   publicUrl: string | null;
   /** Browser origin after an OAuth callback. BERRY_APP_URL or the auth base. */
   appUrl?: string | null;
   workspaceSlug?: (workspaceId: string) => Promise<string | null>;
   oauthStates?: PluginOAuthStateStore | null;
   /** Registered client for MCP hosts that do not advertise DCR. */
   oauthClient?: McpOAuthClient | null;
   fetchImpl?: typeof fetch;
   clock?: () => Date;
}

const sourceFields = {
   url: z.url().max(500).optional(),
   package: z.unknown().optional(),
};
const oneSource = (value: { url?: string | undefined; package?: unknown }) =>
   (value.url === undefined) !== (value.package === undefined);
const previewSchema = z.object(sourceFields).strict().refine(oneSource, 'Give either url or package.');
const installSchema = z
   .object({ ...sourceFields, config: z.record(z.string(), z.unknown()).optional() })
   .strict()
   .refine(oneSource, 'Give either url or package.');
const patchSchema = z
   .object({
      enabled: z.boolean().optional(),
      config: z.record(z.string(), z.unknown()).optional(),
      baseUrl: z.string().min(1).max(500).optional(),
   })
   .strict();
const secretSchema = z.object({ value: z.string().min(1).max(4096) }).strict();
const toolSchema = z.object({ approved: z.boolean() }).strict();

export function pluginMounts(options: PluginMountOptions): Mount[] {
   return [{ prefix: '/api/v1/plugins', handler: pluginRoutes(options) }];
}

function pluginRoutes(options: PluginMountOptions): Hono<{ Variables: ScopedVariables }> {
   const route = new Hono<{ Variables: ScopedVariables }>();
   // Sessionless: the provider returns the browser here. The hashed state is
   // the authorisation. `oauth` is not a workspace id, so the scope gate skips it.
   route.get('/oauth/callback', (context) => handlePluginOAuthCallback(context, options));
   mountPluginWorkspaceScope(route, { sessions: options.sessions, sql: options.sql });
   const clock = options.clock ?? (() => new Date());
   const repo = (): PluginRepository => {
      if (!options.plugins) {
         throw new ApiError(412, 'PLUGINS_NOT_CONFIGURED', 'Plugins need INTEGRATION_ENCRYPTION_KEY to hold their secrets.');
      }
      return options.plugins;
   };
   const id = (raw: string | undefined) => pathId(raw, 'Plugin');

   route.post('/:workspaceId/preview', async (context) => {
      requirePermission(context.get('scoped'), 'settings.write');
      const body = await readJson(context, previewSchema, 2_000_000);
      const loaded = await loadPackage(options.network, toSource(body)).catch(mapPluginError);
      return json(describePackage(loaded.pkg));
   });

   route.get('/:workspaceId/catalog', async () => {
      const packages = await bundledPluginPackages();
      packages.sort((left, right) => {
         const leftOpen = pluginCatalogAvailable(left.manifest) ? 0 : 1;
         const rightOpen = pluginCatalogAvailable(right.manifest) ? 0 : 1;
         if (leftOpen !== rightOpen) return leftOpen - rightOpen;
         return left.manifest.name.localeCompare(right.manifest.name);
      });
      return json({
         nodes: packages.map((pkg) => ({ preview: describePackage(pkg), package: pkg })),
      });
   });

   route.get('/:workspaceId/catalog/:key/tools', async (context) => {
      const scoped = context.get('scoped');
      requirePermission(scoped, 'settings.write');
      const key = context.req.param('key') ?? '';
      const packages = await bundledPluginPackages();
      const pkg = packages.find((item) => item.manifest.key === key);
      if (!pkg?.manifest.mcp) throw new ApiError(404, 'NOT_FOUND', 'This plugin has no MCP server.');
      if (pkg.manifest.mcp.offer === 'declared') {
         return json({
            tools: pkg.manifest.mcp.tools.map((tool) => ({ name: tool.name, description: tool.description })),
         });
      }
      let config: Record<string, unknown> = {};
      let apiKey = '';
      if (options.plugins) {
         const installed = (await options.plugins.list(scoped.ctx.workspaceId)).find((item) => item.key === key);
         if (installed) {
            config = installed.config;
            const secrets = await options.plugins.openSecrets(scoped.ctx.workspaceId, installed.id);
            apiKey = declaredSecrets(pkg.manifest)
               .map((secret) => secrets[secret.name] ?? '')
               .find((value) => value !== '') ?? '';
         }
      }
      let url: string;
      try {
         url = mcpServerUrl(pkg.manifest, config);
      } catch (error) {
         const message = error instanceof Error ? error.message : 'This plugin cannot list its tools.';
         throw new ApiError(422, 'VALIDATION_FAILED', message);
      }
      if (mcpAuthMode(pkg.manifest) === 'oauth' && apiKey === '') {
         throw new ApiError(422, 'PLUGIN_OAUTH_REQUIRED', 'Connect this plugin to list its tools.');
      }
      try {
         const tools = await listUpstreamMcpTools(
            url,
            apiKey,
            pkg.manifest.mcp.protocolVersion ?? '2025-03-26',
            `berry-${pkg.manifest.key}`
         );
         return json({ tools });
      } catch (error) {
         const message = error instanceof Error ? error.message : 'This server did not list its tools.';
         throw new ApiError(502, 'PLUGIN_UNREACHABLE', message);
      }
   });

   route.get('/:workspaceId/installations', async (context) => {
      const found = await repo().list(context.get('scoped').ctx.workspaceId);
      return json({ nodes: found.map(serializeInstallation) });
   });

   route.post('/:workspaceId/installations', async (context) => {
      const scoped = context.get('scoped');
      requirePermission(scoped, 'settings.write');
      const body = await readJson(context, installSchema, 2_000_000);
      const loaded = await loadPackage(options.network, toSource(body)).catch(mapPluginError);
      if (!pluginCatalogAvailable(loaded.pkg.manifest)) {
         throw new ApiError(422, 'PLUGIN_UNAVAILABLE', 'This plugin is not available yet.');
      }
      const { installation, signingSecret } = await scoped
         .mutate('settings.write', (tx, ctx) =>
            repo().install(tx, {
               workspaceId: ctx.workspaceId,
               installedBy: ctx.userId,
               pkg: loaded.pkg,
               source: loaded.source,
               sourceUrl: loaded.sourceUrl,
               config: body.config ?? {},
            })
         )
         .catch(mapPluginError);
      const response = json({ installation: serializeInstallation(installation), signingSecret }, 201);
      response.headers.set('Cache-Control', 'no-store');
      return response;
   });

   route.get('/:workspaceId/installations/:id', async (context) => {
      const workspaceId = context.get('scoped').ctx.workspaceId;
      const installationId = id(context.req.param('id'));
      const installation = await repo().get(workspaceId, installationId).catch(mapPluginError);
      const files = await repo().files(workspaceId, installationId);
      return json({ ...serializeInstallation(installation), files });
   });

   route.patch('/:workspaceId/installations/:id', async (context) => {
      const scoped = context.get('scoped');
      const installationId = id(context.req.param('id'));
      const body = await readJson(context, patchSchema);
      const updated = await scoped
         .mutate('settings.write', (tx, ctx) =>
            repo().update(tx, ctx.workspaceId, installationId, {
               ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
               ...(body.config !== undefined ? { config: body.config } : {}),
               ...(body.baseUrl !== undefined ? { baseUrl: body.baseUrl } : {}),
            })
         , { table: 'plugin_installations', id: installationId })
         .catch(mapPluginError);
      return json(serializeInstallation(updated));
   });

   route.delete('/:workspaceId/installations/:id', async (context) => {
      const installationId = id(context.req.param('id'));
      await context
         .get('scoped')
         .mutate('settings.write', (tx, ctx) => repo().uninstall(tx, ctx.workspaceId, installationId), { table: 'plugin_installations', id: installationId })
         .catch(mapPluginError);
      return new Response(null, { status: 204 });
   });

   route.put('/:workspaceId/installations/:id/secrets/:name', async (context) => {
      const installationId = id(context.req.param('id'));
      const name = context.req.param('name');
      const body = await readJson(context, secretSchema);
      await context
         .get('scoped')
         .mutate('settings.write', (tx, ctx) => repo().setSecret(tx, ctx.workspaceId, installationId, name, body.value), { table: 'plugin_installations', id: installationId })
         .catch(mapPluginError);
      const response = new Response(null, { status: 204 });
      response.headers.set('Cache-Control', 'no-store');
      return response;
   });

   route.delete('/:workspaceId/installations/:id/secrets/:name', async (context) => {
      const installationId = id(context.req.param('id'));
      const name = context.req.param('name');
      await context
         .get('scoped')
         .mutate('settings.write', (tx, ctx) => repo().deleteSecret(tx, ctx.workspaceId, installationId, name), { table: 'plugin_installations', id: installationId })
         .catch(mapPluginError);
      return new Response(null, { status: 204 });
   });

   route.post('/:workspaceId/installations/:id/oauth', async (context) => {
      const scoped = context.get('scoped');
      requirePermission(scoped, 'settings.write');
      const installation = await repo().get(scoped.ctx.workspaceId, id(context.req.param('id'))).catch(mapPluginError);
      if (mcpAuthMode(installation.manifest) !== 'oauth') {
         throw new ApiError(422, 'PLUGIN_OAUTH_UNSUPPORTED', 'This plugin signs in with an API key.');
      }
      const publicUrl = pluginOAuthPublicOrigin(options.publicUrl, context.req.url);
      if (!publicUrl) {
         throw new ApiError(503, 'PLUGIN_OAUTH_NOT_CONFIGURED', 'This deployment has no public URL for the OAuth callback.');
      }
      const states = options.oauthStates;
      if (!states) {
         throw new ApiError(412, 'PLUGINS_NOT_CONFIGURED', 'Plugins need INTEGRATION_ENCRYPTION_KEY to hold their secrets.');
      }
      let serverUrl: string;
      try {
         serverUrl = mcpServerUrl(installation.manifest, installation.config);
      } catch (error) {
         const message = error instanceof Error ? error.message : 'This plugin cannot start OAuth.';
         throw new ApiError(422, 'VALIDATION_FAILED', message);
      }
      const redirectUri = pluginOAuthCallbackUri(publicUrl);
      const secrets = await repo().openSecrets(scoped.ctx.workspaceId, installation.id);
      const client = registeredMcpOAuthClient(options, installation, secrets);
      try {
         const pending = await startMcpAuthorize({
            serverUrl,
            redirectUri,
            clientName: 'Berry',
            scope: oauthScopeList(installation.manifest),
            ...(client ? { clientId: client.clientId } : {}),
            ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
         });
         await states.sweep();
         const { state } = await states.start({
            workspaceId: scoped.ctx.workspaceId,
            userId: scoped.ctx.userId,
            installationId: installation.id,
            redirectUri,
            tokenEndpoint: pending.tokenEndpoint,
            clientId: pending.clientId,
            codeVerifier: pending.codeVerifier,
         });
         const extra = oauthAuthorizeParams(installation.manifest);
         return json({
            authorizeUrl: buildAuthorizeUrl({
               authorizationEndpoint: pending.authorizationEndpoint,
               clientId: pending.clientId,
               redirectUri,
               state,
               challenge: pending.challenge,
               scope: oauthScopeList(installation.manifest),
               resource: serverUrl,
               ...(Object.keys(extra).length > 0 ? { extra } : {}),
            }),
         });
      } catch (error) {
         if (error instanceof McpOAuthFailed) {
            const missingClient = error.message.includes('has no OAuth client');
            throw new ApiError(
               missingClient ? 503 : 502,
               missingClient ? 'PLUGIN_OAUTH_NOT_CONFIGURED' : 'PLUGIN_OAUTH_FAILED',
               error.message
            );
         }
         throw error;
      }
   });

   route.put('/:workspaceId/installations/:id/tools/:tool', async (context) => {
      const scoped = context.get('scoped');
      const installationId = id(context.req.param('id'));
      const tool = context.req.param('tool');
      const body = await readJson(context, toolSchema);
      await scoped
         .mutate('settings.write', (tx, ctx) =>
            repo().setToolApproval(tx, ctx.workspaceId, installationId, tool, body.approved, ctx.userId)
         , { table: 'plugin_installations', id: installationId })
         .catch(mapPluginError);
      return json(serializeInstallation(await repo().get(scoped.ctx.workspaceId, installationId)));
   });

   route.get('/:workspaceId/installations/:id/storage', async (context) => {
      const scoped = context.get('scoped');
      requirePermission(scoped, 'settings.read');
      const installationId = id(context.req.param('id'));
      await repo().get(scoped.ctx.workspaceId, installationId).catch(mapPluginError);
      const { first, after } = parsePageQuery(new URL(context.req.url));
      const found = await options.runtime.listValues(installationId, {
         prefix: '',
         after: after === '' ? null : after,
         limit: first + 1,
      });
      const nodes = found.slice(0, first);
      return json({ nodes, pageInfo: { hasNextPage: found.length > first, endCursor: nodes.at(-1)?.key ?? null } });
   });

   route.get('/:workspaceId/installations/:id/invocations', async (context) => {
      const scoped = context.get('scoped');
      requirePermission(scoped, 'settings.read');
      const installationId = id(context.req.param('id'));
      await repo().get(scoped.ctx.workspaceId, installationId).catch(mapPluginError);
      const scope = `plugins.invocations.${installationId}`;
      const { first, after } = parsePageQuery(new URL(context.req.url));
      const cursor = after === '' ? null : decodeTimeCursor(after, scope);
      const found = await options.runtime.listInvocations(scoped.ctx.workspaceId, installationId, cursor, first + 1);
      const nodes = found.slice(0, first);
      const last = nodes.at(-1);
      return json({
         nodes,
         pageInfo: {
            hasNextPage: found.length > first,
            endCursor: last ? encodeCursor(scope, { createdAt: last.createdAt, id: last.id }) : null,
         },
      });
   });

   route.post('/:workspaceId/installations/:id/surfaces/:surface/launch', async (context) => {
      const workspaceId = context.get('scoped').ctx.workspaceId;
      const installationId = id(context.req.param('id'));
      const installation = await repo().get(workspaceId, installationId).catch(mapPluginError);
      const surface = installation.manifest.surfaces.find((s) => s.key === context.req.param('surface'));
      if (!surface) throw ApiError.notFound('Surface');
      if (!installation.enabled) throw new ApiError(409, 'PLUGIN_DISABLED', 'This plugin is disabled.');
      if (!installation.baseUrl) throw new ApiError(422, 'VALIDATION_FAILED', 'This plugin has no address.');
      const base = installation.baseUrl.replace(/\/+$/, '');
      const started = clock().getTime();
      // The token acts as the installer, but the person opening the page may
      // hold less. Never hand a viewer a token that can write what they cannot.
      const role = context.get('scoped').ctx.role;
      const scopes = installation.grantedScopes.filter((scope) => {
         if (scope === 'issues:write' || scope === 'storage:write') return allows(role, 'product.write');
         if (scope === 'comments:write') return allows(role, 'comments.write');
         return true;
      });
      const { token, expiresAt } = await options.runtime.mintToken({
         workspaceId,
         installationId,
         scopes,
         ttlMs: SURFACE_TOKEN_TTL_MS,
      });
      await options.runtime.recordInvocation({
         workspaceId, installationId, kind: 'surface', trigger: surface.key,
         status: 'ok', httpStatus: null, durationMs: clock().getTime() - started, error: null,
      });
      // The fragment never reaches a server log: the browser keeps it.
      const fragment = new URLSearchParams({
         token,
         expiresAt,
         apiUrl: options.publicUrl ?? '',
         workspaceId,
         installationId,
      });
      return json({ url: `${base}${surface.path}#${fragment.toString()}`, expiresAt });
   });

   return route;
}

function toSource(body: { url?: string | undefined; package?: unknown }): PackageSource {
   return body.url !== undefined ? { url: body.url } : { package: body.package };
}

function requirePermission(scoped: ScopedDb, permission: Permission): void {
   if (!allows(scoped.ctx.role, permission)) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
   }
}

function mountPluginWorkspaceScope(
   route: Hono<{ Variables: ScopedVariables }>,
   options: { sessions: SessionService; sql: Sql }
): void {
   route.use('/:workspaceId/*', async (context, next) => {
      if (context.req.param('workspaceId') === 'oauth') return next();
      return requireSession(options.sessions)(context as never, next);
   });
   route.use('/:workspaceId/*', async (context, next) => {
      if (context.req.param('workspaceId') === 'oauth') return next();
      const workspaceId = pathId(context.req.param('workspaceId'), 'Workspace');
      try {
         const ctx = await resolveWorkspaceContext(
            options.sql,
            context.get('user').id,
            workspaceId,
            'product.read'
         );
         context.set('scoped', scopedDb(options.sql, ctx));
      } catch (error) {
         throw toApiError(error, 'Workspace');
      }
      await next();
   });
}

function pluginOAuthPublicOrigin(publicUrl: string | null | undefined, requestUrl: string): string {
   const configured = (publicUrl ?? '').replace(/\/+$/, '');
   if (configured) return configured;
   try {
      const origin = new URL(requestUrl).origin;
      return origin === 'null' ? '' : origin;
   } catch {
      return '';
   }
}

function pluginOAuthCallbackUri(publicUrl: string): string {
   return `${publicUrl.replace(/\/+$/, '')}/api/v1/plugins/oauth/callback`;
}

function registeredMcpOAuthClient(
   options: PluginMountOptions,
   installation: PluginInstallation,
   secrets: Record<string, string>
): McpOAuthClient | null {
   const secretName = oauthClientSecretName(installation.manifest);
   return resolveMcpOAuthClient({
      ...(options.oauthClient ? { deployment: options.oauthClient } : {}),
      clientId: oauthClientId(installation.config),
      ...(secretName && secrets[secretName] ? { clientSecret: secrets[secretName] } : {}),
   });
}

function redirectTo(location: string): Response {
   return new Response(null, { status: 302, headers: { location } });
}

function pluginConnectLanding(
   origin: string,
   slug: string | null,
   plugin: string,
   status: string,
   reason?: string
): string {
   const path = slug ? `/${slug}/integrations` : '/';
   const query = new URLSearchParams({ plugin, status });
   if (reason) query.set('reason', reason);
   return origin ? `${origin.replace(/\/+$/, '')}${path}?${query}` : `${path}?${query}`;
}

async function handlePluginOAuthCallback(
   context: { req: { url: string } },
   options: PluginMountOptions
): Promise<Response> {
   const url = new URL(context.req.url);
   const origin = (options.appUrl || options.publicUrl || '').replace(/\/+$/, '');
   const land = async (
      workspaceId: string | null,
      plugin: string,
      status: string,
      reason?: string
   ): Promise<Response> => {
      const slug =
         workspaceId && options.workspaceSlug
            ? await options.workspaceSlug(workspaceId).catch(() => null)
            : null;
      return redirectTo(pluginConnectLanding(origin, slug, plugin, status, reason));
   };
   const state = url.searchParams.get('state') ?? '';
   if (state === '' || !options.oauthStates || !options.plugins) {
      return land(null, '', 'error', 'missing');
   }
   let pending;
   try {
      pending = await options.oauthStates.consume(state);
   } catch (error) {
      if (error instanceof PluginAuthorizationNotPending) {
         return land(null, '', 'error', 'expired');
      }
      throw error;
   }
   let installation: PluginInstallation;
   try {
      installation = await options.plugins.get(pending.workspaceId, pending.installationId);
   } catch {
      return land(pending.workspaceId, '', 'error', 'missing');
   }
   if (url.searchParams.get('error')) {
      return land(pending.workspaceId, installation.key, 'error', 'denied');
   }
   const code = url.searchParams.get('code') ?? '';
   if (code === '') {
      return land(pending.workspaceId, installation.key, 'error', 'denied');
   }
   try {
      await resolveWorkspaceContext(options.sql, pending.userId, pending.workspaceId, 'settings.write');
   } catch {
      return land(pending.workspaceId, installation.key, 'error', 'forbidden');
   }
   const secretName = oauthTokenSecretName(installation.manifest);
   if (mcpAuthMode(installation.manifest) !== 'oauth' || !secretName) {
      return land(pending.workspaceId, installation.key, 'error', 'unsupported');
   }
   try {
      const secrets = await options.plugins.openSecrets(pending.workspaceId, pending.installationId);
      const client = registeredMcpOAuthClient(options, installation, secrets);
      const token = await exchangeMcpCode({
         tokenEndpoint: pending.tokenEndpoint,
         clientId: pending.clientId,
         code,
         redirectUri: pending.redirectUri,
         codeVerifier: pending.codeVerifier,
         ...(client?.clientSecret ? { clientSecret: client.clientSecret } : {}),
         ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
      const plugins = options.plugins;
      const refreshName = oauthRefreshSecretName(installation.manifest);
      await options.sql.begin(async (tx) => {
         await plugins.setSecret(tx, pending.workspaceId, pending.installationId, secretName, token.accessToken);
         if (refreshName && token.refreshToken) {
            await plugins.setSecret(tx, pending.workspaceId, pending.installationId, refreshName, token.refreshToken);
         }
      });
   } catch (error) {
      if (error instanceof McpOAuthFailed) {
         return land(pending.workspaceId, installation.key, 'error', 'exchange');
      }
      return land(pending.workspaceId, installation.key, 'error', 'save');
   }
   return land(pending.workspaceId, installation.key, 'connected');
}

function mapPluginError(error: unknown): never {
   if (error instanceof InvalidPluginInput) {
      throw new ApiError(422, 'VALIDATION_FAILED', error.fields[0]?.message ?? 'The plugin input is invalid.', {
         fields: error.fields,
      });
   }
   if (error instanceof PluginUnreachable) throw new ApiError(502, 'PLUGIN_UNREACHABLE', error.message);
   if (error instanceof PluginAlreadyInstalled) {
      throw new ApiError(409, 'PLUGIN_ALREADY_INSTALLED', 'A plugin with this key is already installed here.');
   }
   if (error instanceof NotFound) throw ApiError.notFound('Plugin');
   if (error instanceof Forbidden) {
      throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action.');
   }
   throw error;
}

export function serializeInstallation(installation: PluginInstallation): Record<string, unknown> {
   const { manifest } = installation;
   return {
      id: installation.id,
      workspaceId: installation.workspaceId,
      key: installation.key,
      name: installation.name,
      version: installation.version,
      description: installation.description,
      source: installation.source,
      sourceUrl: installation.sourceUrl,
      baseUrl: installation.baseUrl,
      enabled: installation.enabled,
      config: installation.config,
      configFields: settingsFields(manifest),
      secrets: declaredSecrets(manifest).map((s) => ({
         name: s.name,
         title: s.title,
         description: s.description,
         set: installation.secretNames.includes(s.name),
      })),
      scopes: installation.grantedScopes,
      hooks: manifest.hooks.map((h) =>
         h.trigger === 'event'
            ? { key: h.key, trigger: 'event', events: h.events }
            : { key: h.key, trigger: 'schedule', everyMinutes: h.everyMinutes }
      ),
      surfaces: manifest.surfaces.map((s) => ({ key: s.key, title: s.title })),
      mcpOffer: manifest.mcp?.offer ?? 'declared',
      mcpAuth: mcpAuthMode(manifest),
      mcpTools: (manifest.mcp?.tools ?? []).map((t) => ({
         name: t.name,
         description: t.description,
         approved: installation.approvedTools.includes(t.name),
      })),
      installedBy: installation.installedBy,
      createdAt: installation.createdAt,
      updatedAt: installation.updatedAt,
   };
}

/**
 * What Berry can connect to, and what each connection lets an agent do.
 *
 * Each integration is one file in `catalog/`, and every file has the same
 * shape. `include` is how this build brings that integration in:
 *
 *   - `built-in` — the tools run inside the product. Nothing to configure,
 *     nothing to connect.
 *   - `oauth` — authorized through this deployment's own OAuth App, or
 *     (for GitHub) a person's sign-in token. Provider client secrets stay
 *     in Berry, sealed.
 *
 * A file cannot invent another way. The loader refuses an `include` this
 * process does not implement, so a catalogue entry cannot offer a Connect
 * button the build cannot carry out.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

export type ToolEffect = 'read' | 'write' | 'external_side_effect' | 'destructive';

/** The ways this build knows how to include an integration. */
export const INCLUSION_METHODS = ['built-in', 'oauth'] as const;
export type InclusionMethod = (typeof INCLUSION_METHODS)[number];

export interface ProviderTool {
   name: string;
   description: string;
   effect: ToolEffect;
   /** Whether reaching for it needs a person to say yes first. */
   requiresApproval: boolean;
   enabledByDefault: boolean;
}

export interface ProviderDefinition {
   id: string;
   name: string;
   description: string;
   /** How this build includes the integration. */
   include: InclusionMethod;
   /** The scopes Berry asks for. Shown before Connect, not after. */
   scopes: string[];
   tools: ProviderTool[];
}

const toolSchema = z
   .object({
      name: z.string().min(1),
      description: z.string().min(1),
      effect: z.enum(['read', 'write', 'external_side_effect', 'destructive']),
      requiresApproval: z.boolean(),
      enabledByDefault: z.boolean(),
   })
   .strict();

const integrationSchema = z
   .object({
      id: z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
      name: z.string().min(1),
      description: z.string().min(1),
      include: z.enum(INCLUSION_METHODS),
      scopes: z.array(z.string().min(1)),
      tools: z.array(toolSchema).min(1),
   })
   .strict();

/** Berry's own provider: its tools run inside the product and need no connection. */
export const BUILT_IN_PROVIDER = 'berry';

const catalogDirectory = join(dirname(fileURLToPath(import.meta.url)), 'catalog');

function loadCatalog(): readonly ProviderDefinition[] {
   const files = readdirSync(catalogDirectory)
      .filter((name) => name.endsWith('.json'))
      .sort();
   if (files.length === 0) {
      throw new Error(`No integration files in ${catalogDirectory}`);
   }
   const seen = new Set<string>();
   const providers: ProviderDefinition[] = [];
   for (const file of files) {
      const path = join(catalogDirectory, file);
      let json: unknown;
      try {
         json = JSON.parse(readFileSync(path, 'utf8'));
      } catch (cause) {
         const message = cause instanceof Error ? cause.message : 'could not be read';
         throw new Error(`${file} ${message}`);
      }
      const parsed = integrationSchema.safeParse(json);
      if (!parsed.success) {
         const reason = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || 'file'}: ${issue.message}`)
            .join('; ');
         throw new Error(`${file} does not match the integration shape: ${reason}`);
      }
      const provider = parsed.data;
      if (file !== `${provider.id}.json`) {
         throw new Error(`${file} must be named ${provider.id}.json`);
      }
      if (seen.has(provider.id)) throw new Error(`${file} repeats ${provider.id}`);
      seen.add(provider.id);
      for (const tool of provider.tools) {
         if (!tool.name.startsWith(`${provider.id}.`)) {
            throw new Error(`${file} tool ${tool.name} must start with ${provider.id}.`);
         }
      }
      providers.push(provider);
   }
   if (!seen.has(BUILT_IN_PROVIDER)) {
      throw new Error('The berry integration file is missing');
   }
   return providers;
}

export const PROVIDERS: readonly ProviderDefinition[] = loadCatalog();

export function findProvider(id: string): ProviderDefinition | undefined {
   return PROVIDERS.find((provider) => provider.id === id);
}

/**
 * Whether a provider needs a connection at all.
 *
 * A built-in integration does not. Treating Berry as unconnected would show a
 * Connect button for the product the person is already using.
 */
export function needsConnection(id: string): boolean {
   return findProvider(id)?.include !== 'built-in';
}

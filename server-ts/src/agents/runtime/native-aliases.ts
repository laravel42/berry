import { SANDBOX_COMMANDS } from '../sandbox-commands.ts';
import { CLAUDE_ALIAS_DICTIONARY } from './alias-dictionaries/claude.ts';
import { CODEX_ALIAS_DICTIONARY } from './alias-dictionaries/codex.ts';
import { CURSOR_ALIAS_DICTIONARY } from './alias-dictionaries/cursor.ts';
import { GROK_ALIAS_DICTIONARY } from './alias-dictionaries/grok.ts';
import { KIMI_ALIAS_DICTIONARY } from './alias-dictionaries/kimi.ts';
import { KIRO_ALIAS_DICTIONARY } from './alias-dictionaries/kiro.ts';
import { QODER_ALIAS_DICTIONARY } from './alias-dictionaries/qoder.ts';
import type { AliasRoute } from './alias-dictionaries/route.ts';
import { TOOL_PERMISSIONS } from './plugins/permissions.ts';

/**
 * Native names a subscription runtime may call, from its alias dictionary.
 *
 * Every alias is routed: Berry's MCP server registers the native name, and a
 * call to it runs the Berry tool its route names. An alias is offered when
 * that Berry tool is on the run, the name is certain, and the name is not
 * already a Berry tool's. The runtime's own tool of that name stays off; an
 * adapter refuses it. An unknown runtime has no dictionary, so no aliases.
 */

export interface AliasDictionaryEntry {
   readonly names: readonly string[];
   readonly admits: readonly string[];
   readonly route?: AliasRoute;
   readonly description: string;
   readonly notes?: string;
   readonly uncertain?: boolean;
}

export interface NativeAlias {
   name: string;
   berry: string[];
   description: string;
}

export interface RoutedAlias extends NativeAlias {
   route: AliasRoute;
}

export const NO_NATIVE_ALIASES = 'No native aliases are supported.';

/** The Berry tools a route may call. The alias is offered when the first it needs is on the run. */
export const ROUTE_DELEGATES: Readonly<Record<AliasRoute, readonly string[]>> = {
   read: ['read_repository_file', 'read_file'],
   list: ['browse_repository'],
   glob: ['browse_repository'],
   grep: ['run_command'],
   write: ['write_file'],
   replace: ['edit_file'],
   delete: ['delete_file'],
   shell: ['run_command'],
   fetch: ['fetch_url'],
   patch: ['write_file', 'edit_file', 'delete_file', 'move_file'],
};

/** A route is callable when this Berry tool, or for `read` either reader, is on the run. */
const ROUTE_REQUIRES: Readonly<Record<AliasRoute, readonly string[]>> = {
   read: ['read_repository_file', 'read_file'],
   list: ['browse_repository'],
   glob: ['browse_repository'],
   grep: ['run_command'],
   write: ['write_file'],
   replace: ['edit_file'],
   delete: ['delete_file'],
   shell: ['run_command'],
   fetch: ['fetch_url'],
   patch: ['write_file'],
};

const DICTIONARIES: Readonly<Record<string, readonly AliasDictionaryEntry[]>> = {
   kiro: KIRO_ALIAS_DICTIONARY,
   claude: CLAUDE_ALIAS_DICTIONARY,
   codex: CODEX_ALIAS_DICTIONARY,
   cursor: CURSOR_ALIAS_DICTIONARY,
   grok: GROK_ALIAS_DICTIONARY,
   kimi: KIMI_ALIAS_DICTIONARY,
   qoder: QODER_ALIAS_DICTIONARY,
};

export function dictionaryFor(runtimeId: string | null | undefined): readonly AliasDictionaryEntry[] | null {
   if (!runtimeId) return null;
   return DICTIONARIES[runtimeId] ?? null;
}

/**
 * The aliases Berry's MCP server registers for this runtime, given the tools
 * on the run. Each certain name of a routed entry, once, skipping a name that
 * is already a Berry tool or a tool on this run.
 */
export function routedAliases(runtimeId: string | null | undefined, available: ReadonlySet<string>): RoutedAlias[] {
   const dictionary = dictionaryFor(runtimeId);
   if (!dictionary) return [];
   const taken = new Set([...Object.keys(TOOL_PERMISSIONS), ...available]);
   const aliases: RoutedAlias[] = [];
   for (const entry of dictionary) {
      const route = entry.route;
      if (!route) continue;
      if (!ROUTE_REQUIRES[route].some((name) => available.has(name))) continue;
      const berry = ROUTE_DELEGATES[route].filter((name) => available.has(name));
      for (const name of certainNames(entry)) {
         if (taken.has(name)) continue;
         taken.add(name);
         aliases.push({ name, route, berry, description: entry.description });
      }
   }
   return aliases;
}

/** Every name in this runtime's dictionary: what its own tools may be called. */
export function nativeToolNames(runtimeId: string | null | undefined): ReadonlySet<string> {
   return new Set((dictionaryFor(runtimeId) ?? []).flatMap((entry) => entry.names));
}

/** Aliases this session can call, plus sandbox programs that are not one of them. */
export function nativeAliasInventory(
   runtimeId: string | null | undefined,
   admitted: ReadonlySet<string>
): { aliases: NativeAlias[]; commands: string[]; nativeAliases?: string } {
   if (!dictionaryFor(runtimeId)) {
      return { aliases: [], commands: [...SANDBOX_COMMANDS], nativeAliases: NO_NATIVE_ALIASES };
   }
   const aliases = routedAliases(runtimeId, admitted).map(({ name, berry, description }) => ({ name, berry, description }));
   const aliasNames = new Set(aliases.map((alias) => alias.name));
   return {
      aliases,
      commands: SANDBOX_COMMANDS.filter((command) => !aliasNames.has(command)),
   };
}

/**
 * Names the dictionary stands behind.
 *
 * `uncertain: true`, a note that opens with "Uncertain.", or a note that
 * names a specific identifier as uncertain, drops those names. The other
 * names on the same entry stay.
 */
export function certainNames(entry: AliasDictionaryEntry): string[] {
   if (entry.uncertain === true) return [];
   const notes = entry.notes ?? '';
   if (/^\s*uncertain\s*\./i.test(notes)) return [];
   const dropped = new Set<string>();
   for (const match of notes.matchAll(/`([^`]+)` is uncertain/gi)) {
      const name = match[1];
      if (name) dropped.add(name);
   }
   for (const match of notes.matchAll(/uncertain:\s*([^.\n]*)/gi)) {
      for (const part of (match[1] ?? '').split(',')) {
         const name = part.trim();
         if (name !== '') dropped.add(name);
      }
   }
   return entry.names.filter((name) => !dropped.has(name));
}

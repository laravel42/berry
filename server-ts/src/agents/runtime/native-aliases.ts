import { SANDBOX_COMMANDS } from '../sandbox-commands.ts';
import { CLAUDE_ALIAS_DICTIONARY } from './alias-dictionaries/claude.ts';
import { CODEX_ALIAS_DICTIONARY } from './alias-dictionaries/codex.ts';
import { CURSOR_ALIAS_DICTIONARY } from './alias-dictionaries/cursor.ts';
import { GROK_ALIAS_DICTIONARY } from './alias-dictionaries/grok.ts';
import { KIMI_ALIAS_DICTIONARY } from './alias-dictionaries/kimi.ts';
import { KIRO_ALIAS_DICTIONARY } from './alias-dictionaries/kiro.ts';
import { QODER_ALIAS_DICTIONARY } from './alias-dictionaries/qoder.ts';

/**
 * Native names this runtime may call, from the standalone alias dictionaries.
 *
 * A name is supported when its entry's Berry tools intersect the tools on
 * this run and the dictionary does not mark that name uncertain. An unknown
 * runtime has no dictionary, so it has no aliases. Sandbox programs that are
 * also one of those aliases are left out of `commands`.
 */

export interface AliasDictionaryEntry {
   readonly names: readonly string[];
   readonly admits: readonly string[];
   readonly description: string;
   readonly notes?: string;
   readonly uncertain?: boolean;
}

export interface NativeAlias {
   name: string;
   berry: string[];
   description: string;
}

export const NO_NATIVE_ALIASES = 'No native aliases are supported.';

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

/** Native aliases whose Berry tool is on this run, plus sandbox programs that are not those aliases. */
export function nativeAliasInventory(
   runtimeId: string | null | undefined,
   admitted: ReadonlySet<string>
): { aliases: NativeAlias[]; commands: string[]; nativeAliases?: string } {
   const dictionary = dictionaryFor(runtimeId);
   if (!dictionary) {
      return { aliases: [], commands: [...SANDBOX_COMMANDS], nativeAliases: NO_NATIVE_ALIASES };
   }
   const aliases: NativeAlias[] = [];
   const aliasNames = new Set<string>();
   for (const entry of dictionary) {
      const berry = entry.admits.filter((name) => admitted.has(name));
      if (berry.length === 0) continue;
      for (const name of certainNames(entry)) {
         if (aliasNames.has(name)) continue;
         aliasNames.add(name);
         aliases.push({ name, berry, description: entry.description });
      }
   }
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

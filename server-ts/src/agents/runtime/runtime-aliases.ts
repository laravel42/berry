import { tool, type Tool, type ToolContext } from '@strands-agents/sdk';
import { z } from 'zod';
import { shellQuote } from '../checkout.ts';
import { insideDirectory } from '../workspace-files.ts';
import type { AliasRoute } from './alias-dictionaries/route.ts';
import { parsePatch, patchTools, planPatch } from './apply-patch.ts';
import { MAX_COMMAND_TIMEOUT_MINUTES } from './command-tool.ts';
import { nativeToolNames, ROUTE_DELEGATES, routedAliases } from './native-aliases.ts';

/**
 * A subscription runtime's native tool names, served by Berry.
 *
 * Each alias in the runtime's dictionary is registered on Berry's MCP server
 * under the native name, and a call to it is translated into the Berry tool
 * its route names. That tool is looked up among the tools already on the
 * session, so an alias reaches nothing the role could not call by Berry's
 * name, and the Berry tool's own permission check still decides. The ledger
 * records the Berry tool, not the alias.
 */

type Translated = { name: string; input: unknown } | { error: string };

/** What each route reads from a call, since an alias takes any object. */
const ROUTE_INPUT: Readonly<Record<AliasRoute, string>> = {
   read: 'Input: `path`.',
   list: 'Input: `path` (default the checkout root), optional `depth` 1-6.',
   glob: 'Input: `pattern`, optional `path` it is relative to.',
   grep: 'Input: `pattern` (an extended regular expression), optional `path`, `glob` and `-i`.',
   write: 'Input: `path` and the whole file in `content`.',
   replace: 'Input: `path`, `old_string` (text that occurs once) and `new_string`.',
   delete: 'Input: `path`.',
   shell: 'Input: `command` (a string or an argv array), optional `cwd` and `timeout_ms`. Nothing runs in the background.',
   fetch: 'Input: `url`.',
   patch: 'Input: `input`, the whole patch from `*** Begin Patch` to `*** End Patch`. Every file is checked first; nothing is written if any part does not apply.',
};

/** The session's tools plus the aliases this runtime's dictionary routes to them. */
export function withRuntimeAliases(runtimeId: string | null | undefined, tools: readonly Tool[]): Tool[] {
   const available = new Set(tools.map((entry) => entry.name));
   const byName = new Map(tools.map((entry) => [entry.name, entry]));
   const aliases = routedAliases(runtimeId, available).map((alias) =>
      tool({
         name: alias.name,
         description: `${alias.description} Berry runs it as ${alias.berry.join(' or ')}. ${ROUTE_INPUT[alias.route]}`,
         inputSchema: z.record(z.string(), z.unknown()),
         callback: async (input: unknown, context?: ToolContext) => {
            if (alias.route === 'patch') return applyPatch(byName, available, input, context);
            if (alias.route === 'glob') return glob(byName, input, context);
            const translated = translate(alias.route, alias.name, input, available);
            if ('error' in translated) return { error: translated.error };
            const target = byName.get(translated.name);
            if (!target) return { error: `${translated.name} is not on this run` };
            return invokeTool(target, translated.input, context);
         },
      })
   );
   return [...tools, ...aliases];
}

/**
 * Runtimes whose own tools are all off, so a bare name in their stream is a
 * call to Berry's MCP server: Claude runs with `--tools ''` (and Berry runs
 * the calls it writes as text), Codex with its shell and apply_patch removed.
 * Elsewhere a bare native name may be the runtime's own tool, and only a
 * Berry-qualified name is recorded as the Berry tool an alias ran.
 */
const BARE_NAMES_ARE_BERRY: ReadonlySet<string> = new Set(['claude', 'codex']);

/**
 * The name the ledger records for a tool call: the Berry tool an alias runs,
 * with any Berry server qualifier removed. `available` picks the reader a
 * read alias uses; a patch is recorded as the tools it calls.
 */
export function ledgerToolName(
   runtimeId: string | null | undefined,
   name: string,
   input?: unknown,
   available?: ReadonlySet<string>
): string {
   const bare = stripBerryQualifier(name);
   if (bare === name && !BARE_NAMES_ARE_BERRY.has(runtimeId ?? '')) return bare;
   const route = routeOf(runtimeId, bare);
   if (!route) return bare;
   if (route === 'patch') {
      const tools = patchTools(patchText(input) ?? '');
      return tools.length > 0 ? tools.join('+') : 'apply_patch';
   }
   if (route === 'write' && isReplaceCommand(input)) return 'edit_file';
   const delegates = ROUTE_DELEGATES[route];
   return (available ? delegates.find((entry) => available.has(entry)) : undefined) ?? delegates[0] ?? bare;
}

/**
 * A runtime's own tool, as opposed to a Berry tool of the same name. A
 * permission prompt for a bare native name is refused even when Berry serves
 * an alias of it, because the prompt may be for the runtime's own tool.
 */
export function isNativeToolName(runtimeId: string | null | undefined, name: string): boolean {
   return nativeToolNames(runtimeId).has(name);
}

/**
 * MCP clients name a server's tool in several forms: `mcp__berry__x`,
 * `berry__x`, `@berry/x`, `berry/x`, `berry.x`, `berry:x`. Strip the Berry
 * qualifier; a name with another server's qualifier is left unchanged.
 */
export function stripBerryQualifier(name: string): string {
   for (const prefix of ['mcp__berry__', '@berry/', 'berry__', 'berry/', 'berry.', 'berry:']) {
      if (name.startsWith(prefix)) return name.slice(prefix.length);
   }
   return name;
}

/** Whether a name carries a Berry server qualifier. */
export function hasBerryQualifier(name: string): boolean {
   return stripBerryQualifier(name) !== name;
}

/**
 * The tool name in an ACP `tool_call` update or permission request: the MCP
 * identity when the agent sends one, else the call's name, else its title.
 * The title is display text, so it is used only when it is a bare tool name
 * (optionally Berry-qualified), never a sentence. A Berry tool keeps a
 * `berry/` qualifier so `ledgerToolName` can tell it from a native name.
 */
export function acpToolName(update: unknown): string | null {
   if (!update || typeof update !== 'object') return null;
   const record = update as {
      name?: unknown;
      title?: unknown;
      toolCall?: { name?: unknown; title?: unknown };
      _meta?: {
         mcpTool?: { identity?: { serverName?: unknown; toolName?: unknown } };
         kiro?: { mcpTool?: { identity?: { serverName?: unknown; toolName?: unknown } } };
      };
   };
   const identity = record._meta?.mcpTool?.identity ?? record._meta?.kiro?.mcpTool?.identity;
   if (identity && typeof identity.toolName === 'string' && identity.toolName !== '') {
      return `${String(identity.serverName)}/${identity.toolName}`;
   }
   for (const value of [record.toolCall?.name, record.name]) {
      if (typeof value === 'string' && value !== '') return value;
   }
   for (const value of [record.toolCall?.title, record.title]) {
      if (typeof value !== 'string') continue;
      const berry = /(?:^|[^A-Za-z0-9_])(?:mcp__berry__|@berry\/|berry__|berry[/.:])([A-Za-z0-9_-]+)/.exec(value);
      if (berry?.[1]) return `berry/${berry[1]}`;
      if (/^[A-Za-z0-9_@/.:-]+$/.test(value)) return value;
   }
   return null;
}

function routeOf(runtimeId: string | null | undefined, name: string): AliasRoute | null {
   const all = new Set(Object.values(ROUTE_DELEGATES).flat());
   const alias = routedAliases(runtimeId, all).find((entry) => entry.name === name);
   return alias?.route ?? null;
}

function translate(route: AliasRoute, alias: string, input: unknown, available: ReadonlySet<string>): Translated {
   switch (route) {
      case 'read':
         return translateRead(alias, input, available);
      case 'list':
         return translateList(input);
      case 'grep':
         return translateGrep(alias, input);
      case 'write':
         return isReplaceCommand(input) ? translateReplace(alias, input) : translateWrite(alias, input);
      case 'replace':
         return translateReplace(alias, input);
      case 'delete': {
         const path = stringField(input, PATH_KEYS);
         return path === null ? { error: `${alias} needs a path` } : { name: 'delete_file', input: { path } };
      }
      case 'shell':
         return translateShell(alias, input);
      case 'fetch': {
         const url = stringField(input, ['url', 'uri']);
         return url === null ? { error: `${alias} needs a url` } : { name: 'fetch_url', input: { url } };
      }
      default:
         return { error: `${alias} is not routed` };
   }
}

const PATH_KEYS = ['path', 'file_path', 'filePath', 'target_file', 'targetFile', 'target', 'file', 'notebook_path'] as const;

function translateRead(alias: string, input: unknown, available: ReadonlySet<string>): Translated {
   const path = stringField(input, PATH_KEYS);
   if (path === null) return { error: `${alias} needs a path` };
   if (available.has('read_repository_file')) return { name: 'read_repository_file', input: { path } };
   if (available.has('read_file')) return { name: 'read_file', input: { path } };
   return { error: `${alias} needs read_repository_file or read_file on this run` };
}

function translateList(input: unknown): Translated {
   const path = stringField(input, ['path', 'directory', 'dir', 'target_directory', 'relative_workspace_path']) ?? '.';
   const depth = asRecord(input).depth;
   return {
      name: 'browse_repository',
      input: { path, ...(typeof depth === 'number' && Number.isInteger(depth) && depth >= 1 && depth <= 6 ? { depth } : {}) },
   };
}

function translateGrep(alias: string, input: unknown): Translated {
   const pattern = stringField(input, ['pattern', 'query', 'regex']);
   if (pattern === null) return { error: `${alias} needs a pattern` };
   const path = stringField(input, ['path', 'directory', 'target_directory']) ?? '.';
   if (path !== '.' && insideDirectory(path) === null) return { error: `${path} is outside the workspace` };
   const record = asRecord(input);
   const flags = ['-n', '-R', '-E'];
   if (record['-i'] === true || record.case_insensitive === true || record.ignore_case === true || record.ignoreCase === true) flags.push('-i');
   const include = stringField(input, ['glob', 'include', 'path_glob']);
   const includes = include === null ? '' : ` --include=${shellQuote(include.replace(/^\*\*\//, ''))}`;
   const skip = ' --exclude-dir=.git --exclude-dir=node_modules';
   return {
      name: 'run_command',
      input: { command: `grep ${flags.join(' ')}${skip}${includes} -- ${shellQuote(pattern)} ${shellQuote(path)}` },
   };
}

function isReplaceCommand(input: unknown): boolean {
   const command = stringField(input, ['command']);
   return command === 'str_replace' || command === 'replace';
}

function translateWrite(alias: string, input: unknown): Translated {
   const command = stringField(input, ['command', 'mode']);
   if (command !== null && command !== 'create' && command !== 'overwrite' && command !== 'write') {
      return { error: `${alias} ${command} is not served; write the whole file, or use edit_file for one span` };
   }
   if (asRecord(input).append === true) return { error: `${alias} cannot append; write the whole file, or use edit_file for one span` };
   const path = stringField(input, PATH_KEYS);
   const content = textField(input, ['content', 'contents', 'file_text', 'fileText', 'text', 'code']);
   if (path === null || content === null) return { error: `${alias} needs a path and the file text` };
   return { name: 'write_file', input: { path, content } };
}

function translateReplace(alias: string, input: unknown): Translated {
   const record = asRecord(input);
   if (record.replace_all === true || record.replaceAll === true) {
      return { error: `${alias} with replace_all is not served; send one span that matches once, or write the whole file` };
   }
   const path = stringField(input, PATH_KEYS);
   const old = textField(input, ['old_string', 'old_str', 'oldStr', 'old', 'oldText', 'search']);
   const replacement = textField(input, ['new_string', 'new_str', 'newStr', 'new', 'newText', 'replace']);
   if (path === null || old === null || replacement === null) return { error: `${alias} needs a path, the old text and the new text` };
   return { name: 'edit_file', input: { path, old, new: replacement } };
}

function translateShell(alias: string, input: unknown): Translated {
   const record = asRecord(input);
   let command = stringField(input, ['command', 'cmd', 'script']);
   const argv = Array.isArray(record.command) ? record.command : Array.isArray(record.cmd) ? record.cmd : null;
   if (command === null && argv && argv.every((part): part is string => typeof part === 'string') && argv.length > 0) {
      const [program, flag, script] = argv;
      command =
         argv.length === 3 && /(^|\/)(ba|z)?sh$/.test(program ?? '') && (flag === '-c' || flag === '-lc') && script !== undefined
            ? script
            : argv.map((part) => shellQuote(part)).join(' ');
   }
   if (command === null) return { error: `${alias} needs a command` };
   if (record.run_in_background === true) {
      return { error: `${alias} cannot run in the background here; a command ends with the call that started it` };
   }
   const cwd = stringField(input, ['cwd', 'workdir', 'working_directory', 'directory']);
   const timeoutMs =
      typeof record.timeout_ms === 'number' ? record.timeout_ms : typeof record.timeout === 'number' ? record.timeout : null;
   const timeoutMinutes =
      timeoutMs === null || timeoutMs <= 0 ? null : Math.min(MAX_COMMAND_TIMEOUT_MINUTES, Math.max(1, Math.ceil(timeoutMs / 60_000)));
   return {
      name: 'run_command',
      input: { command, ...(cwd === null ? {} : { cwd }), ...(timeoutMinutes === null ? {} : { timeoutMinutes }) },
   };
}

/** A file listing under the pattern's fixed directories, filtered to the files the pattern matches. */
async function glob(byName: ReadonlyMap<string, Tool>, input: unknown, context?: ToolContext): Promise<unknown> {
   const browse = byName.get('browse_repository');
   if (!browse) return { error: 'browse_repository is not on this run' };
   const pattern = stringField(input, ['pattern', 'glob', 'glob_pattern', 'query']);
   if (pattern === null) return { error: 'a glob needs a pattern' };
   const base = (stringField(input, ['path', 'directory', 'target_directory']) ?? '.').replace(/\/+$/, '');
   const full = base === '.' || base === '' ? pattern.replace(/^\.\/+/, '') : `${base}/${pattern.replace(/^\.\/+/, '')}`;
   const segments = full.split('/');
   const fixed: string[] = [];
   for (const segment of segments.slice(0, -1)) {
      if (/[*?[{]/.test(segment)) break;
      fixed.push(segment);
   }
   const root = fixed.length === 0 ? '.' : fixed.join('/');
   const listed = await invokeTool(browse, { path: root, depth: 6 }, context);
   const record = asRecord(listed);
   if (!Array.isArray(record.entries)) return listed;
   const matcher = globPattern(full);
   const files = record.entries.flatMap((entry) => {
      const item = asRecord(entry);
      return item.type === 'file' && typeof item.path === 'string' && matcher.test(item.path.replace(/^\.\//, '')) ? [item.path] : [];
   });
   return { pattern: full, files, truncated: record.truncated === true };
}

function globPattern(pattern: string): RegExp {
   let source = '';
   for (let i = 0; i < pattern.length; i += 1) {
      const char = pattern[i]!;
      if (char === '*' && pattern[i + 1] === '*') {
         const slash = pattern[i + 2] === '/';
         source += slash ? '(?:.*/)?' : '.*';
         i += slash ? 2 : 1;
      } else if (char === '*') source += '[^/]*';
      else if (char === '?') source += '[^/]';
      else if (char === '{') {
         const close = pattern.indexOf('}', i);
         if (close === -1) source += '\\{';
         else {
            source += `(?:${pattern
               .slice(i + 1, close)
               .split(',')
               .map((part) => part.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*'))
               .join('|')})`;
            i = close;
         }
      } else source += char.replace(/[.+^$()|[\]\\]/g, '\\$&');
   }
   return new RegExp(`^${source}$`);
}

function patchText(input: unknown): string | null {
   if (typeof input === 'string') return input;
   return textField(input, ['input', 'patch', 'content', 'diff']);
}

/** Codex's apply_patch: checked whole, then applied through Berry's file tools. */
async function applyPatch(
   byName: ReadonlyMap<string, Tool>,
   available: ReadonlySet<string>,
   input: unknown,
   context?: ToolContext
): Promise<unknown> {
   const text = patchText(input);
   if (text === null) return { error: 'apply_patch needs the patch text in `input`' };
   const parsed = parsePatch(text);
   if ('error' in parsed) return { error: `patch not applied: ${parsed.error}` };
   let planned: Awaited<ReturnType<typeof planPatch>>;
   try {
      planned = await planPatch(parsed.operations, (path) => readText(byName, path, context), available);
   } catch (cause) {
      return { error: `patch not applied: ${cause instanceof Error ? cause.message : String(cause)}` };
   }
   if ('error' in planned) return { error: `patch not applied: ${planned.error}` };
   const applied: Array<{ tool: string; path: string }> = [];
   for (const step of planned.steps) {
      const target = byName.get(step.tool);
      if (!target) return { error: `${step.tool} is not on this run`, applied };
      const result = asRecord(await invokeTool(target, step.input, context));
      if (typeof result.error === 'string' || result.found === false) {
         const detail = typeof result.error === 'string' ? result.error : 'the file was not found';
         return {
            error: `the patch stopped at ${step.tool} on ${step.path}: ${detail}. The changes listed in applied were made; the rest were not.`,
            applied,
         };
      }
      applied.push({ tool: step.tool, path: step.path });
   }
   return { applied: true, changes: applied };
}

/** A file's text for a patch to check: the checkout when the run has one, else the task's saved copy. */
async function readText(byName: ReadonlyMap<string, Tool>, path: string, context?: ToolContext): Promise<string | null> {
   const repository = byName.get('read_repository_file');
   if (repository) {
      const result = asRecord(await invokeTool(repository, { path }, context));
      if (result.found === true && typeof result.content === 'string') return result.content;
      if (result.found === true) throw new Error(`${path}: ${typeof result.error === 'string' ? result.error : 'could not be read'}`);
      const error = typeof result.error === 'string' ? result.error : '';
      if (!error.includes('no repository checkout')) return null;
   }
   const saved = byName.get('read_file');
   if (!saved) return null;
   let content = '';
   let from: number | undefined;
   for (let page = 0; page < 64; page += 1) {
      const result = asRecord(await invokeTool(saved, from === undefined ? { path } : { path, from }, context));
      if (result.found === false) return page === 0 ? null : content;
      if (typeof result.error === 'string') throw new Error(`${path}: ${result.error}`);
      if (typeof result.content !== 'string') return page === 0 ? null : content;
      content += result.content;
      if (result.truncated !== true || typeof result.nextFrom !== 'number') return content;
      from = result.nextFrom;
   }
   throw new Error(`${path} is too long to patch`);
}

function stringField(input: unknown, keys: readonly string[]): string | null {
   const record = asRecord(input);
   for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
   }
   return null;
}

/** Like stringField, but an empty string is a value: file text and replacements may be empty. */
function textField(input: unknown, keys: readonly string[]): string | null {
   const record = asRecord(input);
   for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string') return value;
   }
   return null;
}

function asRecord(input: unknown): Record<string, unknown> {
   if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
   return input as Record<string, unknown>;
}

async function invokeTool(target: Tool, input: unknown, context?: ToolContext): Promise<unknown> {
   const invoke = (target as unknown as { invoke?: (value: unknown, toolContext?: ToolContext) => Promise<unknown> }).invoke;
   if (typeof invoke === 'function') return invoke.call(target, input, context);
   if (!context) return { error: 'no tool context' };
   const stream = target.stream(context);
   let next = await stream.next();
   while (!next.done) next = await stream.next();
   return next.value;
}

import { tool, type Tool, type ToolContext } from '@strands-agents/sdk';
import { z } from 'zod';
import { shellQuote } from '../checkout.ts';
import { insideDirectory } from '../workspace-files.ts';
import { runtimeToolNote } from './tool-note.ts';

/**
 * Kiro CLI V3 built-ins, and the Berry tool each one stands for.
 *
 * The model only sees Kiro's own names (`fs_write`, `execute_bash`, …).
 * Berry's names are not in that function list. Each built-in is allowed
 * when the Berry tool it stands for is already on the run, and the session
 * also offers the built-in name as a tool that calls that Berry tool.
 *
 * Names are the V3 function ids, the short profile aliases, and the V2 ids
 * the CLI still accepts. `subagent`, `skill` and `power` are not here:
 * those leave the role contract.
 */

interface KiroTool {
   /** Every name Kiro uses for this built-in. The first is the one the session registers. */
   names: readonly string[];
   /** The native call is allowed when any of these Berry tools is on the run. */
   admits: readonly string[];
   /**
    * Berry tools the session alias can call. Absent when Kiro runs the
    * built-in itself and there is nothing in Berry to delegate to.
    */
   delegate?: readonly string[];
   description: string;
   translate?: (input: unknown, available: ReadonlySet<string>) => Translated;
}

type Translated = { name: string; input: unknown } | { error: string };

const READ = ['read_repository_file', 'read_file'] as const;
const LIST = ['browse_repository', 'list_files', 'read_file'] as const;

export const KIRO_TOOLS: readonly KiroTool[] = [
   {
      names: ['read', 'read_file', 'fs_read', 'readFile'],
      admits: READ,
      delegate: READ,
      description: 'Read a file in the checkout. Alias of read_repository_file.',
      translate: (input, available) => translateRead(input, available),
   },
   {
      names: ['read_files'],
      admits: READ,
      delegate: READ,
      description: 'Read several files in the checkout. Alias of read_repository_file.',
      translate: (input, available) => translateRead(input, available),
   },
   {
      names: ['list_directory', 'glob', 'listDirectory'],
      admits: LIST,
      delegate: ['browse_repository'],
      description: 'List the checkout. Alias of browse_repository.',
      translate: (input, available) => translateList(input, available),
   },
   {
      names: ['file_search', 'fileSearch'],
      admits: LIST,
      delegate: ['browse_repository'],
      description: 'Find a path in the checkout. Alias of browse_repository.',
      translate: (input, available) => translateList(input, available),
   },
   {
      names: ['grep', 'grep_search', 'grepSearch'],
      admits: ['run_command', ...READ],
      delegate: ['run_command'],
      description: 'Search file contents. Alias of run_command.',
      translate: (input, available) => translateGrep(input, available),
   },
   {
      names: ['code'],
      admits: READ,
      description: 'Code intelligence over the checkout. Allowed with read_repository_file.',
   },
   {
      names: ['fs_write', 'write', 'fsWrite', 'writeFile'],
      admits: ['write_file', 'edit_file'],
      delegate: ['write_file', 'edit_file'],
      description: 'Create or replace a file. Alias of write_file; a str_replace command is edit_file.',
      translate: (input, available) => translateWrite(input, available),
   },
   {
      names: ['str_replace'],
      admits: ['edit_file', 'write_file'],
      delegate: ['edit_file'],
      description: 'Replace one exact span. Alias of edit_file.',
      translate: (input, available) => translateReplace(input, available),
   },
   {
      names: ['delete_file'],
      admits: ['write_file', 'run_command'],
      delegate: ['run_command'],
      description: 'Delete a file in the checkout. Alias of run_command.',
      translate: (input, available) => translateDelete(input, available),
   },
   {
      names: ['execute_bash', 'shell'],
      admits: ['run_command'],
      delegate: ['run_command'],
      description: 'Run a command. Alias of run_command.',
      translate: (input, available) => translateShell(input, available),
   },
   {
      names: ['control_bash_process'],
      admits: ['run_command'],
      delegate: ['run_command'],
      description: 'Stop a command this run started. Alias of run_command.',
      translate: (input, available) => translateControl(input, available),
   },
   {
      names: ['web_fetch', 'webFetch'],
      admits: ['fetch_url'],
      delegate: ['fetch_url'],
      description: 'Read a public page. Alias of fetch_url.',
      translate: (input, available) => translateFetch(input, available),
   },
   {
      names: ['web_search', 'webSearch'],
      admits: ['fetch_url'],
      description: 'Search the web. Allowed with fetch_url.',
   },
   {
      names: ['knowledge'],
      admits: READ,
      description: 'Search this session\'s index. Allowed with read_repository_file.',
   },
   {
      names: ['todo'],
      admits: READ,
      description: 'Track work inside this session. Allowed with read_repository_file.',
   },
];

/** Capability names Kiro sends on `session/request_permission`, and the built-ins they cover. */
const CAPABILITY_TOOLS: Readonly<Record<string, readonly string[]>> = {
   fs_read: ['read', 'read_files', 'list_directory', 'file_search', 'grep', 'code', 'knowledge', 'todo'],
   fs_write: ['fs_write', 'str_replace', 'delete_file'],
   filesystem: ['read', 'fs_write', 'str_replace', 'delete_file'],
   shell: ['execute_bash', 'control_bash_process'],
   web_fetch: ['web_fetch'],
   web_search: ['web_search'],
};

const BY_NAME = new Map<string, KiroTool>();
for (const entry of KIRO_TOOLS) {
   for (const name of entry.names) BY_NAME.set(name, entry);
}

/** Built-in names the session should register, skipping any name Berry already offers. */
export function withKiroAliases(tools: readonly Tool[]): Tool[] {
   const available = new Set(tools.map((entry) => entry.name));
   const byName = new Map(tools.map((entry) => [entry.name, entry]));
   const aliases: Tool[] = [];
   for (const entry of KIRO_TOOLS) {
      if (!entry.translate || !entry.delegate) continue;
      if (!entry.delegate.some((name) => available.has(name))) continue;
      const registered = entry.names[0];
      if (!registered || available.has(registered)) continue;
      const translate = entry.translate;
      aliases.push(
         tool({
            name: registered,
            description: entry.description,
            inputSchema: z.record(z.string(), z.unknown()),
            callback: async (input: unknown, context?: ToolContext) => {
               if (registered === 'read_files') return readMany(byName, input, context);
               const translated = translate(input, available);
               if ('error' in translated) return { error: translated.error };
               const target = byName.get(translated.name);
               if (!target) return { error: `${translated.name} is not on this run` };
               return invokeTool(target, translated.input, context);
            },
         })
      );
      available.add(registered);
   }
   return [...tools, ...aliases];
}

/**
 * Whether this permission request may run.
 *
 * A Berry MCP tool is allowed when its name is on the run. A Kiro built-in
 * is allowed when the Berry tool it aliases is on the run. Anything else,
 * including a subagent or a power, is refused.
 */
export function kiroCallAllowed(params: unknown, allowed: ReadonlySet<string>): boolean {
   const berry = berryMcpTool(params);
   if (berry !== null) return allowed.has(berry) || aliasAdmitted(berry, allowed);
   const native = nativeTool(params, allowed);
   return native !== null;
}

/**
 * The Kiro prompt uses the same list as every other runtime.
 *
 * Which built-ins this run may call is the alias group `list_run_tools`
 * returns. Permission checks stay in `kiroCallAllowed`.
 */
export function kiroAgentNote(_allowed: ReadonlySet<string>): string {
   const note = runtimeToolNote('list_run_tools');
   return note.endsWith('\n') ? `${note.slice(0, -1)} Do not delegate to a subagent.\n` : `${note} Do not delegate to a subagent.\n`;
}

function aliasAdmitted(name: string, allowed: ReadonlySet<string>): boolean {
   const entry = BY_NAME.get(name);
   if (!entry) return false;
   return entry.admits.some((tool) => allowed.has(tool));
}

function berryMcpTool(params: unknown): string | null {
   if (!params || typeof params !== 'object') return null;
   const meta = (params as { _meta?: { kiro?: { mcpTool?: { identity?: { serverName?: unknown; toolName?: unknown } } } } })
      ._meta?.kiro?.mcpTool?.identity;
   if (!meta || meta.serverName !== 'berry' || typeof meta.toolName !== 'string' || meta.toolName === '') return null;
   return meta.toolName;
}

function nativeTool(params: unknown, allowed: ReadonlySet<string>): string | null {
   if (!params || typeof params !== 'object') return null;
   const record = params as {
      toolCall?: { name?: unknown; title?: unknown };
      _meta?: { kiro?: { consent?: { capability?: unknown } } };
   };
   const capability = record._meta?.kiro?.consent?.capability;
   if (typeof capability === 'string' && capability !== '') {
      const covered = CAPABILITY_TOOLS[capability];
      if (!covered) return null;
      return covered.find((name) => aliasAdmitted(name, allowed)) ?? null;
   }
   const name = record.toolCall?.name;
   if (typeof name === 'string' && aliasAdmitted(name, allowed)) return name;
   const title = record.toolCall?.title;
   if (typeof title === 'string' && aliasAdmitted(title, allowed)) return title;
   return null;
}

function translateRead(input: unknown, available: ReadonlySet<string>): Translated {
   const path = stringField(input, ['path', 'file_path', 'filePath', 'target']);
   if (path === null) return { error: 'read needs a path' };
   if (available.has('read_repository_file')) return { name: 'read_repository_file', input: { path } };
   if (available.has('read_file')) return { name: 'read_file', input: { path } };
   return { error: 'read is not on this run' };
}

async function readMany(byName: ReadonlyMap<string, Tool>, input: unknown, context?: ToolContext): Promise<unknown> {
   const record = asRecord(input);
   const listed = record.paths ?? record.files ?? record.file_paths;
   const paths = Array.isArray(listed) ? listed.filter((entry): entry is string => typeof entry === 'string' && entry !== '') : [];
   const single = stringField(input, ['path', 'file_path', 'filePath']);
   const targets = paths.length > 0 ? paths : single === null ? [] : [single];
   if (targets.length === 0) return { error: 'read_files needs paths' };
   const tool = byName.get('read_repository_file') ?? byName.get('read_file');
   if (!tool) return { error: 'read is not on this run' };
   const files = [];
   for (const path of targets) {
      files.push({ path, result: await invokeTool(tool, { path }, context) });
   }
   return { files };
}

function translateList(input: unknown, available: ReadonlySet<string>): Translated {
   if (!available.has('browse_repository')) return { error: 'list_directory needs browse_repository on this run' };
   const path = stringField(input, ['path', 'directory', 'glob', 'pattern', 'query']) ?? '.';
   const depth = asRecord(input).depth;
   return {
      name: 'browse_repository',
      input: { path, ...(typeof depth === 'number' ? { depth } : {}) },
   };
}

function translateGrep(input: unknown, available: ReadonlySet<string>): Translated {
   if (!available.has('run_command')) return { error: 'grep needs run_command on this run' };
   const pattern = stringField(input, ['pattern', 'query', 'regex']);
   if (pattern === null) return { error: 'grep needs a pattern' };
   const path = stringField(input, ['path', 'path_glob', 'glob']) ?? '.';
   if (path !== '.' && insideDirectory(path) === null) return { error: `${path} is outside the workspace` };
   return { name: 'run_command', input: { command: `grep -n -R -- ${shellQuote(pattern)} ${shellQuote(path)}` } };
}

function translateWrite(input: unknown, available: ReadonlySet<string>): Translated {
   const command = stringField(input, ['command']) ?? 'create';
   if (command === 'str_replace' || command === 'replace') return translateReplace(input, available);
   if (command !== 'create') return { error: `fs_write ${command} is not aliased; use str_replace or execute_bash` };
   const path = stringField(input, ['path', 'file_path', 'filePath']);
   const content = stringField(input, ['content', 'text', 'file_text', 'fileText']);
   if (path === null || content === null) return { error: 'fs_write needs a path and file text' };
   if (!available.has('write_file')) return { error: 'fs_write needs write_file on this run' };
   return { name: 'write_file', input: { path, content } };
}

function translateReplace(input: unknown, available: ReadonlySet<string>): Translated {
   const path = stringField(input, ['path', 'file_path', 'filePath']);
   const old = stringField(input, ['old_str', 'oldStr', 'old']);
   const replacement = stringField(input, ['new_str', 'newStr', 'new', 'file_text', 'fileText']);
   if (path === null || old === null || replacement === null) return { error: 'str_replace needs path, old_str and new_str' };
   if (!available.has('edit_file')) return { error: 'str_replace needs edit_file on this run' };
   return { name: 'edit_file', input: { path, old, new: replacement } };
}

function translateDelete(input: unknown, available: ReadonlySet<string>): Translated {
   if (!available.has('run_command')) return { error: 'delete_file needs run_command on this run' };
   const path = stringField(input, ['path', 'file_path', 'filePath']);
   if (path === null) return { error: 'delete_file needs a path' };
   const relative = insideDirectory(path);
   if (relative === null) return { error: `${path} is outside the workspace` };
   return { name: 'run_command', input: { command: `rm -f -- ${shellQuote(relative)}` } };
}

function translateShell(input: unknown, available: ReadonlySet<string>): Translated {
   if (!available.has('run_command')) return { error: 'execute_bash needs run_command on this run' };
   const command = stringField(input, ['command', 'cmd']);
   if (command === null) return { error: 'execute_bash needs a command' };
   const cwd = stringField(input, ['cwd']);
   return { name: 'run_command', input: cwd === null ? { command } : { command, cwd } };
}

function translateControl(input: unknown, available: ReadonlySet<string>): Translated {
   if (!available.has('run_command')) return { error: 'control_bash_process needs run_command on this run' };
   const record = asRecord(input);
   const pid = record.pid ?? record.process_id ?? record.processId;
   const action = stringField(input, ['action']) ?? 'kill';
   if (action !== 'kill' && action !== 'terminate') return { error: 'control_bash_process can only stop a process' };
   if ((typeof pid !== 'number' && typeof pid !== 'string') || !/^\d+$/.test(String(pid))) {
      return { error: 'control_bash_process needs a numeric pid' };
   }
   return { name: 'run_command', input: { command: `kill ${pid}` } };
}

function translateFetch(input: unknown, available: ReadonlySet<string>): Translated {
   if (!available.has('fetch_url')) return { error: 'web_fetch needs fetch_url on this run' };
   const url = stringField(input, ['url']);
   if (url === null) return { error: 'web_fetch needs a url' };
   return { name: 'fetch_url', input: { url } };
}

function stringField(input: unknown, keys: readonly string[]): string | null {
   const record = asRecord(input);
   for (const key of keys) {
      const value = record[key];
      if (typeof value === 'string' && value !== '') return value;
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

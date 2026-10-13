/**
 * Kiro native tool names and the Berry tools each one may alias.
 *
 * Standalone. Nothing in the server imports this module.
 *
 * Pages read 2026-10-12:
 * - https://kiro.dev/docs/tools/
 * - https://kiro.dev/docs/cli/v3/new-features
 * - https://kiro.dev/docs/cli/v3/agent-config
 * - https://kiro.dev/docs/cli/v3/migration-guide
 * - https://kiro.dev/docs/cli/v3/permissions
 * - https://kiro.dev/docs/cli/v3/hooks-migration
 * - https://kiro.dev/docs/reference/built-in-tools/ (CLI 2.x identifiers)
 * - https://kiro.dev/docs/custom-agents/configuration-reference/
 * - https://kiro.dev/docs/permissions/
 *
 * Context7 library `/websites/kiro_dev_cli` was queried the same day. Its
 * indexed copies of the V3 pages still describe an older tag table
 * (`read_files` on `read`, `control_bash_process` on `shell`, a `todo_list`
 * tag). Where that index disagrees with the live catalog, this file follows
 * the live pages and marks the unconfirmed name uncertain.
 *
 * `names` lists the V3 runtime id, the short profile alias, and CLI 2.x ids
 * that refer to the same tool. A category tag or permission capability that
 * shares a string with a tool is on that tool's entry; the note says so.
 * Tags and capabilities that are not a function id are their own entries.
 */

type BerryToolName =
   | 'read_repository_file'
   | 'read_file'
   | 'browse_repository'
   | 'list_files'
   | 'write_file'
   | 'edit_file'
   | 'run_command'
   | 'fetch_url';

interface KiroAliasEntry {
   readonly names: readonly string[];
   readonly admits: readonly BerryToolName[];
   readonly description: string;
   readonly source: string;
   readonly notes?: string;
}

const TOOLS = 'https://kiro.dev/docs/tools/';
const MIGRATION = 'https://kiro.dev/docs/cli/v3/migration-guide';
const REFERENCE = 'https://kiro.dev/docs/reference/built-in-tools/';
const PERMISSIONS = 'https://kiro.dev/docs/permissions/';
const AGENT_CONFIG = 'https://kiro.dev/docs/cli/v3/agent-config';

const READ = ['read_repository_file', 'read_file'] as const satisfies readonly BerryToolName[];
const LIST = ['browse_repository', 'list_files'] as const satisfies readonly BerryToolName[];

export const KIRO_ALIAS_DICTIONARY: readonly KiroAliasEntry[] = [
   {
      names: ['read_file', 'read', 'fs_read', 'fsRead', 'readFile'],
      admits: READ,
      description: 'Read a single file.',
      source: TOOLS,
      notes:
         'V3 runtime id is read_file. The catalog says to call it once per file. `read` is the CLI 2.x tool name and the V3 category tag (also list_directory, file_search, grep_search, code, tool_search, introspect). `fs_read` and `fsRead` are CLI 2.x profile names; `fs_read` is also the fs_read permission capability, and the catalog says it is not a V3 hook or runtime id. `readFile` is uncertain: Berry\'s adapter accepts it, and an older Context7 index listed it, but the live catalog and migration guide do not.',
   },
   {
      names: ['read_files'],
      admits: READ,
      description: 'Read several files.',
      source: 'adapter',
      notes:
         'Uncertain. Berry\'s adapter accepts read_files, and an older Context7 index put it on the read tag. The live English catalog does not list it and says to call read_file once per file. Kiro runs it itself if the CLI still exposes it.',
   },
   {
      names: ['list_directory', 'listDirectory'],
      admits: LIST,
      description: 'List a directory.',
      source: TOOLS,
      notes:
         'V3 runtime id is list_directory, under the read tag, capability fs_read. `listDirectory` is uncertain: Berry\'s adapter accepts it, and an older Context7 index mapped it to glob, but the live catalog and migration guide do not name it. The live migration maps the CLI 2.x name glob to file_search, not to list_directory.',
   },
   {
      names: ['file_search', 'glob', 'fileSearch'],
      admits: LIST,
      description: 'Find paths by glob.',
      source: TOOLS,
      notes:
         'V3 runtime id is file_search. CLI 2.x name is glob (hook matchers and the 2.x reference). Capability fs_read, tag read. `fileSearch` is uncertain: Berry\'s adapter accepts it, and an older Context7 index listed it, but the live catalog does not.',
   },
   {
      names: ['grep_search', 'grep', 'grepSearch'],
      admits: ['run_command'],
      description: 'Search file contents with a regular expression.',
      source: TOOLS,
      notes:
         'V3 runtime id is grep_search. CLI 2.x name is grep. Capability fs_read, tag read. Berry has no content-search tool; the adapter runs a workspace grep through run_command. `grepSearch` is uncertain: Berry\'s adapter accepts it, and an older Context7 index listed it, but the live catalog does not.',
   },
   {
      names: ['code'],
      admits: [],
      description: 'Tree-sitter and LSP code intelligence: symbols, references, and pattern search.',
      source: TOOLS,
      notes:
         'CLI only. Tag read, and the write tag also lists code. Capability fs_read. Kiro runs it itself. The IDE equivalent named in the catalog is read_code.',
   },
   {
      names: ['read_code'],
      admits: [],
      description: 'Editor AST analysis and semantic rename.',
      source: TOOLS,
      notes: 'IDE only. Kiro runs it itself. CLI V3 exposes code instead.',
   },
   {
      names: ['fs_write', 'write', 'fsWrite', 'writeFile'],
      admits: ['write_file'],
      description: 'Create or overwrite a file.',
      source: TOOLS,
      notes:
         'V3 runtime id is fs_write. CLI 2.x name is write. `write` is also the V3 category tag (fs_write, fs_append, str_replace, delete_file, and code). `fs_write` is also the fs_write permission capability. `fsWrite` is a CLI 2.x profile name. `writeFile` is uncertain: Berry\'s adapter accepts it, and an older Context7 index listed it, but the live catalog and migration guide do not. A str_replace command inside this tool is the separate str_replace entry.',
   },
   {
      names: ['fs_append'],
      admits: [],
      description: 'Append to an existing file.',
      source: TOOLS,
      notes: 'Tag write, capability fs_write. Kiro runs it itself. Berry write_file replaces a file and does not append.',
   },
   {
      names: ['str_replace'],
      admits: ['edit_file'],
      description: 'Replace one exact span in a file.',
      source: TOOLS,
      notes: 'Tag write, capability fs_write.',
   },
   {
      names: ['delete_file'],
      admits: ['run_command'],
      description: 'Delete a file.',
      source: TOOLS,
      notes: 'Tag write, capability fs_write. Berry has no delete tool; the adapter removes the path with rm through run_command.',
   },
   {
      names: ['execute_bash', 'execute_pwsh', 'shell', 'execute_cmd', 'executeCmd'],
      admits: ['run_command'],
      description: 'Run a shell command.',
      source: TOOLS,
      notes:
         'V3 runtime id is execute_bash, or execute_pwsh on Windows. CLI 2.x names are shell, execute_cmd, and executeCmd. `shell` is also the V3 category tag and the shell permission capability. CLI V3 can start a background command on execute_bash with run_in_background; it does not register the IDE process-control tools.',
   },
   {
      names: ['control_bash_process', 'control_pwsh_process'],
      admits: [],
      description: 'Start or stop a long-running background process.',
      source: TOOLS,
      notes:
         'IDE only. The catalog says CLI V3 does not register these tools. Kiro runs them itself on the IDE. Berry\'s adapter only translates a kill of control_bash_process into run_command, which is not this tool. An older Context7 index listed control_bash_process on the CLI shell tag.',
   },
   {
      names: ['get_process_output'],
      admits: [],
      description: 'Read output from a background process.',
      source: TOOLS,
      notes: 'IDE only. CLI V3 does not register it. Kiro runs it itself on the IDE.',
   },
   {
      names: ['list_processes'],
      admits: [],
      description: 'List running background processes.',
      source: TOOLS,
      notes: 'IDE only. CLI V3 does not register it. Kiro runs it itself on the IDE.',
   },
   {
      names: ['web_fetch', 'webFetch'],
      admits: ['fetch_url'],
      description: 'Fetch text from a URL.',
      source: TOOLS,
      notes:
         'V3 runtime id is web_fetch. It is also the web_fetch permission capability, under the web tag. `webFetch` is uncertain: Berry\'s adapter accepts it, and an older Context7 index listed it, but the live catalog does not.',
   },
   {
      names: ['remote_web_search', 'web_search', 'webSearch'],
      admits: [],
      description: 'Search the web.',
      source: TOOLS,
      notes:
         'V3 runtime id is remote_web_search, displayed as web_search. `web_search` is the CLI 2.x tool name, the profile selector that maps to the web tag, and the web_search permission capability. Kiro runs the search itself. `webSearch` is uncertain: Berry\'s adapter accepts it, and an older Context7 index listed it, but the live catalog does not.',
   },
   {
      names: ['invoke_sub_agent', 'subagent', 'use_subagent', 'agent_crew'],
      admits: [],
      description: 'Delegate a task to an agent in its own context.',
      source: TOOLS,
      notes:
         'V3 runtime id is invoke_sub_agent. Some built-ins are selected by that id directly. `subagent` is the V3 category tag, the subagent permission capability, and the CLI 2.x tool name (alias use_subagent). Per-agent dispatch tools display as subagent/<name>. `agent_crew` is a CLI 2.x profile name that migrates to the subagent tag. Kiro runs delegation itself.',
   },
   {
      names: ['disclose_context'],
      admits: [],
      description: 'Activate skills or steering into the session context.',
      source: TOOLS,
      notes: 'Kiro runs it itself. The skill permission capability is separate and is not this function id.',
   },
   {
      names: ['introspect'],
      admits: [],
      description: 'Answer questions about Kiro from its own documentation.',
      source: TOOLS,
      notes: 'Tag read, capability fs_read. Kiro runs it itself.',
   },
   {
      names: ['knowledge'],
      admits: [],
      description: 'Search indexed knowledge bases.',
      source: TOOLS,
      notes:
         'Experimental, CLI only. Direct tool id in the tools field, not a category tag. The migration guide says knowledge has no per-tool permission capability. Kiro runs it itself.',
   },
   {
      names: ['tool_search'],
      admits: [],
      description: 'Find and activate MCP tools on demand.',
      source: TOOLS,
      notes: 'CLI only, under the read tag. Kiro runs it itself. This is not a Berry tool.',
   },
   {
      names: ['createHook'],
      admits: [],
      description: 'Create an agent hook from chat.',
      source: TOOLS,
      notes: 'IDE and CLI. Kiro runs it itself.',
   },
   {
      names: ['kiro_powers'],
      admits: [],
      description: 'List, activate, and use installed powers.',
      source: TOOLS,
      notes: 'IDE and web. The surface table does not mark it for CLI. Kiro runs it itself where it is registered. The power permission capability is a separate name.',
   },
   {
      names: ['todo', 'task', 'todo_list'],
      admits: [],
      description: 'Track tasks inside a CLI 2.x session.',
      source: MIGRATION,
      notes:
         'Not a V3 built-in. The catalog lists task with aliases todo and todo_list as CLI 2.x only. /upgrade-agent rewrites those names to todo_list, and that selector matches nothing on CLI V3. Berry\'s adapter still lists todo. Kiro ran it itself on CLI 2.x.',
   },
   {
      names: ['session'],
      admits: [],
      description: 'Override CLI settings for the current session.',
      source: REFERENCE,
      notes: 'CLI 2.x only. The V3 catalog says it is not a V3 built-in. Kiro ran it itself on CLI 2.x.',
   },
   {
      names: ['thinking'],
      admits: [],
      description: 'Internal step-by-step reasoning for a complex task.',
      source: REFERENCE,
      notes: 'Experimental, CLI 2.x only. Not a V3 built-in. Kiro ran it itself on CLI 2.x.',
   },
   {
      names: ['use_aws', 'aws'],
      admits: [],
      description: 'Call AWS from the CLI 2.x structured AWS tool.',
      source: MIGRATION,
      notes: 'Not a V3 built-in. Internal name use_aws, preferred alias aws. V3 expects an AWS MCP server. Kiro ran it itself on CLI 2.x.',
   },
   {
      names: ['delegate'],
      admits: [],
      description: 'Hand a task to a background agent.',
      source: REFERENCE,
      notes: 'CLI 2.x only. V3 uses sub-agents instead. Kiro ran it itself on CLI 2.x.',
   },
   {
      names: ['goal'],
      admits: [],
      description: 'Report that a /goal loop is complete.',
      source: REFERENCE,
      notes: 'CLI 2.x only. The 2.x reference says CLI V3 /goal does not use this tool. Kiro ran it itself on CLI 2.x.',
   },
   {
      names: ['report'],
      admits: [],
      description: 'Open a browser to a pre-filled issue report.',
      source: REFERENCE,
      notes:
         'Uncertain. The CLI 2.x reference documents report and says it is trusted by default. The V3 catalog does not list it as a current tool or as a legacy-only tool. Kiro runs it itself if the surface still exposes it.',
   },
   {
      names: ['@builtin', '@mcp', '*'],
      admits: [],
      description: 'Profile selectors for every built-in, every MCP tool, or both.',
      source: AGENT_CONFIG,
      notes: 'Visibility selectors in the tools field, not functions. Kiro does not run these names. @builtin is not the builtin meta-capability.',
   },
   {
      names: ['mcp', 'skill', 'power', 'context', 'diagnostics', 'sandbox_network', 'all', 'builtin', 'filesystem'],
      admits: [],
      description: 'Permission capabilities that are not V3 function ids.',
      source: PERMISSIONS,
      notes:
         'Used in permissions rules, not as tools the model invokes. all, builtin, and filesystem are meta-capabilities (filesystem is fs_read plus fs_write). fs_read, fs_write, shell, web_fetch, web_search, and subagent are also capabilities; those strings are on the tool entries above. Kiro does not run these capability names.',
   },
];

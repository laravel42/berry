/**
 * Cursor Agent CLI native tools, and the Berry tools each one may stand for.
 *
 * Scraped 2026-10-12. Doc pages:
 * - https://cursor.com/docs/cli/reference/permissions
 * - https://cursor.com/docs/hooks
 * - https://cursor.com/docs/reference/third-party-hooks
 * - https://cursor.com/docs/cli/changelog
 * - https://cursor.com/docs/sdk/typescript
 * - https://cursor.com/docs/agent/security/run-modes
 * - https://cursor.com/docs/agent/tools
 *
 * Context7: /websites/cursor_cli and /websites/cursor (same permission and
 * hook pages). Names the docs do not print are checked against cursor-agent
 * 2026.10.01 tool-call protobufs and marked uncertain in `notes`.
 *
 * Berry's Cursor adapter allows Read and Mcp and denies Write, Delete, and
 * Shell. This dictionary only records the native names. It does not grant them.
 */

interface CursorAliasEntry {
   /** Every documented name for this native tool. The first is the hook or permission token. */
   names: readonly string[];
   /** Berry tools this native tool may stand for. Empty when none is faithful. */
   admits: readonly string[];
   description: string;
   source: string;
   notes?: string;
}

export const CURSOR_ALIAS_DICTIONARY: readonly CursorAliasEntry[] = [
   {
      names: ['Shell', 'shell', 'Bash'],
      admits: ['run_command'],
      description: 'Run a shell command. Alias of run_command.',
      source: 'https://cursor.com/docs/cli/reference/permissions',
      notes:
         'Uncertain: Bash. Hook matchers and the changelog call the tool Shell. The third-party hook table maps Claude Bash to Shell, and cursor-agent 2026.10.01 accepts a Bash() permission token as Shell.',
   },
   {
      names: ['Read', 'read', 'ReadFile'],
      admits: ['read_repository_file', 'read_file'],
      description: 'Read a file. Alias of read_repository_file.',
      source: 'https://cursor.com/docs/cli/reference/permissions',
      notes:
         'Uncertain: ReadFile. Auto-review docs name a classifier call ReadFile. The CLI permission token and tool-call protobuf use Read.',
   },
   {
      names: ['Write', 'write'],
      admits: ['write_file', 'edit_file'],
      description: 'Create or overwrite a file. Alias of write_file. The hook table also maps an edit onto Write.',
      source: 'https://cursor.com/docs/reference/third-party-hooks',
      notes:
         'The third-party hook table maps both Claude Write and Claude Edit to Cursor Write. The SDK also lists a separate edit tool.',
   },
   {
      names: ['Edit', 'edit'],
      admits: ['edit_file'],
      description: 'Edit an existing file. Alias of edit_file.',
      source: 'https://cursor.com/docs/sdk/typescript',
      notes:
         'The SDK lists edit as its own public tool name, and cursor-agent 2026.10.01 has an Edit tool call. Hook matchers do not list Edit; they map Claude Edit to Write.',
   },
   {
      names: ['Delete'],
      admits: [],
      description: 'Delete a file.',
      source: 'https://cursor.com/docs/hooks',
      notes:
         'Hooks list Delete as a preToolUse tool type. Berry has no delete tool. run_command can remove a file, but that is Shell, a different native tool. The CLI permissions page does not document a Delete() token; the adapter still denies Delete(**).',
   },
   {
      names: ['Grep', 'grep'],
      admits: ['run_command'],
      description: 'Search file contents. Alias of run_command.',
      source: 'https://cursor.com/docs/cli/changelog',
      notes: 'Berry has no content-search tool. The faithful stand-in is run_command running grep.',
   },
   {
      names: ['Glob', 'glob'],
      admits: ['browse_repository', 'list_files'],
      description: 'Find files by name. Alias of browse_repository.',
      source: 'https://cursor.com/docs/cli/changelog',
      notes:
         'The changelog and the SDK name Glob. The third-party hook table maps Claude Glob to no Cursor tool.',
   },
   {
      names: ['Ls', 'ls', 'ListDir'],
      admits: ['browse_repository', 'list_files'],
      description: 'List a directory. Alias of browse_repository.',
      source: 'https://cursor.com/docs/sdk/typescript',
      notes:
         'Uncertain: ListDir. Auto-review docs name a classifier call ListDir. The SDK public name is ls, and the CLI tool-call protobuf is Ls.',
   },
   {
      names: ['WebSearch', 'webSearch'],
      admits: [],
      description: 'Search the web.',
      source: 'https://cursor.com/docs/reference/third-party-hooks',
      notes:
         'fetch_url reads one URL. It does not run a search. The changelog exposes this as auto-accepted web search, and the CLI parses a WebSearch() permission token.',
   },
   {
      names: ['WebFetch'],
      admits: ['fetch_url'],
      description: 'Fetch a URL. Alias of fetch_url.',
      source: 'https://cursor.com/docs/cli/reference/permissions',
   },
   {
      names: ['Fetch'],
      admits: ['fetch_url'],
      description: 'Fetch a page.',
      source: 'https://cursor.com/docs/cli/changelog',
      notes:
         'Uncertain. The changelog says Auto-review checks Fetch calls, and the CLI protobuf has a Fetch tool call separate from WebFetch. The permissions page only documents WebFetch.',
   },
   {
      names: ['Mcp', 'mcp'],
      admits: [],
      description: 'Call a tool on an MCP server.',
      source: 'https://cursor.com/docs/cli/reference/permissions',
      notes:
         'Mcp(server:tool) is a permission class, not one Berry tool. The adapter allows Mcp(berry:*), so each Berry tool keeps its own name on that server.',
   },
   {
      names: ['Task', 'task', 'Agent'],
      admits: [],
      description: 'Spawn a subagent.',
      source: 'https://cursor.com/docs/hooks',
      notes:
         'Uncertain: Agent. Hook matchers, the changelog, and the CLI protobuf call this Task. The SDK subagent section also calls the spawn tool Agent. No Berry tool in the alias set spawns a subagent.',
   },
   {
      names: ['SemSearch', 'semSearch'],
      admits: [],
      description: 'Search the codebase by meaning.',
      source: 'https://cursor.com/docs/sdk/typescript',
      notes:
         'The SDK lists semSearch on the built-in tool-call union. Berry has no semantic-search tool. browse_repository and Grep are different tools.',
   },
   {
      names: ['GenerateImage'],
      admits: [],
      description: 'Generate an image.',
      source: 'https://cursor.com/docs/agent/tools',
      notes:
         'Uncertain. The agent tools page describes image generation and does not print this identifier. cursor-agent 2026.10.01 has a GenerateImage tool call and a GenerateImage() permission token. Berry has no image tool.',
   },
   {
      names: ['AskQuestion'],
      admits: [],
      description: 'Ask the user a question.',
      source: 'https://cursor.com/docs/agent/tools',
      notes:
         'Uncertain. The agent tools page describes asking questions and does not print this identifier. cursor-agent 2026.10.01 has an AskQuestion tool call. Berry has no matching tool.',
   },
   {
      names: ['Browser'],
      admits: [],
      description: 'Control a browser.',
      source: 'https://cursor.com/docs/agent/security/run-modes',
      notes:
         'Uncertain. Run Modes names Browser tools as a protection category, and the agent tools page describes browser control, without one tool identifier. The CLI protobuf has no Browser tool call.',
   },
];

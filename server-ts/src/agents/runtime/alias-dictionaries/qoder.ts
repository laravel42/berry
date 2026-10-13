/**
 * Qoder CLI built-in tools the model can call, scraped 2026-10-12.
 *
 * Pages:
 * - https://docs.qoder.com/cli/sdk/references-typescript
 * - https://docs.qoder.com/cli/sdk/references-python
 * - https://docs.qoder.com/cli/sdk/tools
 * - https://docs.qoder.com/cli/sdk/skills
 * - https://docs.qoder.com/cli/tools
 * - https://docs.qoder.com/cli/permissions
 *
 * Names are the runtime tool names from the TypeScript SDK reference
 * built-in tool table, plus Skill from the skills guide. This file is a
 * standalone dictionary. Nothing in the server imports it.
 */

export interface QoderAliasEntry {
   /** Runtime names the model can call. The first name is the documented one. */
   readonly names: readonly string[];
   /** Berry tools this call faithfully stands for. Empty when none do. */
   readonly admits: readonly string[];
   readonly description: string;
   readonly source: string;
   readonly notes?: string;
   /** Set when the docs do not confirm this name on the built-in tool table. */
   readonly uncertain?: boolean;
}

const TYPESCRIPT_TOOLS = 'https://docs.qoder.com/cli/sdk/references-typescript';
const SKILLS = 'https://docs.qoder.com/cli/sdk/skills';

const READ = ['read_repository_file', 'read_file'] as const;
const LIST = ['browse_repository', 'list_files'] as const;

export const QODER_ALIAS_DICTIONARY: readonly QoderAliasEntry[] = [
   {
      names: ['Bash'],
      admits: ['run_command'],
      description: 'Execute a shell command.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['Read'],
      admits: READ,
      description: 'Read a file in the workspace.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The same tool also returns images, notebook cells, and PDF pages when the CLI supports those formats.',
   },
   {
      names: ['Edit'],
      admits: ['edit_file'],
      description: 'Edit a file by replacing an exact string.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['Write'],
      admits: ['write_file'],
      description: 'Create a file or overwrite its contents.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['Glob'],
      admits: LIST,
      description: 'Find files by name pattern.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['Grep'],
      admits: ['run_command'],
      description: 'Search file contents by regular expression.',
      source: TYPESCRIPT_TOOLS,
      notes: 'Berry has no content-search tool. The faithful stand-in is a search command.',
   },
   {
      names: ['WebFetch'],
      admits: ['fetch_url'],
      description: 'Fetch a URL and process the page.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The CLI can run a follow-up model call to summarize the fetched page. fetch_url returns the page.',
   },
   {
      names: ['WebSearch'],
      admits: [],
      description: 'Search the web.',
      source: TYPESCRIPT_TOOLS,
      notes: 'A search is not a fetch of one URL.',
   },
   {
      names: ['Agent'],
      admits: [],
      description: 'Invoke a subagent.',
      source: TYPESCRIPT_TOOLS,
      notes: 'Delegation leaves the role contract. There is no Berry subagent tool.',
   },
   {
      names: ['AskUserQuestion'],
      admits: [],
      description: 'Ask the user a question and wait for the answer.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['NotebookEdit'],
      admits: [],
      description: 'Edit notebook cells.',
      source: TYPESCRIPT_TOOLS,
      notes: 'Cell insert, replace, and delete are not an exact text edit of a source file.',
   },
   {
      names: ['TaskCreate'],
      admits: [],
      description: 'Create a persistent task in the session.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The Python SDK reference built-in table does not list this name. The TypeScript reference does.',
   },
   {
      names: ['TaskGet'],
      admits: [],
      description: 'Retrieve one persistent task.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The Python SDK reference built-in table does not list this name. The TypeScript reference does.',
   },
   {
      names: ['TaskUpdate'],
      admits: [],
      description: 'Update a persistent task, including status and dependencies.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The Python SDK reference built-in table does not list this name. The TypeScript reference does.',
   },
   {
      names: ['TaskList'],
      admits: [],
      description: 'List persistent tasks.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The Python SDK reference built-in table does not list this name. The TypeScript reference does.',
   },
   {
      names: ['TaskOutput'],
      admits: [],
      description: 'Send output to a background task.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['TaskStop'],
      admits: [],
      description: 'Stop a background task.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The call names a task id. It does not run a shell command.',
   },
   {
      names: ['Monitor'],
      admits: ['run_command'],
      description: 'Run a long-lived command and deliver its output as task notifications.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The Python SDK reference built-in table does not list this name. The TypeScript reference does. The command itself is run_command; the notification stream has no Berry tool.',
   },
   {
      names: ['ExitPlanMode'],
      admits: [],
      description: 'Leave Plan mode after the plan is accepted.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['EnterWorktree'],
      admits: [],
      description: 'Enter a git worktree for this session.',
      source: TYPESCRIPT_TOOLS,
      notes: 'Switching the session worktree is not a checkout command.',
   },
   {
      names: ['ExitWorktree'],
      admits: [],
      description: 'Leave the session worktree, keeping or removing it.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['Config'],
      admits: [],
      description: 'Read or write Qoder CLI configuration.',
      source: TYPESCRIPT_TOOLS,
      notes: 'This is CLI settings, not a file in the checkout.',
   },
   {
      names: ['TodoWrite'],
      admits: [],
      description: 'Write the session todo list.',
      source: TYPESCRIPT_TOOLS,
      notes: 'The TypeScript reference says this replaces the persistent Task tools when QODER_FEATURE_TASKS=false. The Python reference lists it as managing todo items, without that condition.',
   },
   {
      names: ['ListMcpResources'],
      admits: [],
      description: 'List resources on an MCP server.',
      source: TYPESCRIPT_TOOLS,
   },
   {
      names: ['ReadMcpResource'],
      admits: [],
      description: 'Read one MCP resource.',
      source: TYPESCRIPT_TOOLS,
      notes: 'An MCP resource is not a checkout file.',
   },
   {
      names: ['Mcp'],
      admits: [],
      description: 'Call an MCP tool by server and tool name.',
      source: TYPESCRIPT_TOOLS,
      notes: 'This is the generic MCP caller. It is not one of the Berry checkout tools.',
   },
   {
      names: ['Skill'],
      admits: [],
      description: 'Load a skill into the session.',
      source: SKILLS,
      uncertain: true,
      notes: 'Uncertain. The skills guide names Skill as the tool the model invokes, including Skill(name) allowlist entries. The built-in tool tables on the TypeScript and Python SDK references do not list it.',
   },
];

/**
 * Grok Build CLI built-ins, and the Berry tool each one stands for.
 *
 * Scraped 2026-10-12 from the xAI grok-build tree (Context7 `/xai-org/grok-build`
 * and the pages below). The first name in `names` is the one the model is
 * documented to call. Later names are spellings that show up as a filter id,
 * a display label, or a name Berry strips with `--disallowed-tools`. Those
 * are called out in `notes` as uncertain.
 *
 * Permission prefixes are not tool calls. `GROK_DENY_RULES` (`Write`, `Edit`,
 * `Bash`) and the other `--allow` / `--deny` prefixes (`Read`, `Grep`, `Glob`,
 * `WebFetch`, `WebSearch`, `MCPTool`) gate a call. `Agent` and `Agent(type)`
 * are `--disallowed-tools` controls that block subagent spawning. None of
 * those are entries here.
 *
 * Docs:
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/README.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/01-getting-started.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/05-configuration.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/14-headless-mode.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/16-subagents.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/19-plan-mode.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/20-background-tasks.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/22-permissions-and-safety.md
 * - https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-test-support/src/tools.rs
 *
 * Berry's adapter (`adapters/grok.ts`) also strips `write_file`, `create_file`,
 * `edit_file`, `apply_patch`, and `delete_file`. The test-support map does not
 * offer those strings. They stay here so a call under one of those names is
 * still classified, and each is marked uncertain.
 */

import type { AliasRoute } from './route.ts';

export interface GrokAliasEntry {
   readonly names: readonly string[];
   readonly admits: readonly string[];
   /** How Berry serves this name on its MCP server. Absent when the runtime runs it itself. */
   readonly route?: AliasRoute;
   readonly description: string;
   readonly source: string;
   readonly notes?: string;
}

export const GROK_ALIAS_DICTIONARY: readonly GrokAliasEntry[] = [
   {
      names: ['read_file'],
      route: 'read',
      admits: ['read_repository_file'],
      description: 'Read a file in the checkout, with line numbers. Alias of read_repository_file.',
      source: 'user-guide/01-getting-started.md; shell README built-in tools; tools.rs Read',
   },
   {
      names: ['list_dir'],
      route: 'list',
      admits: ['browse_repository'],
      description: 'List a directory in the checkout. Alias of browse_repository.',
      source: 'user-guide/01-getting-started.md; shell README; tools.rs List',
   },
   {
      names: ['grep', 'grep_search'],
      route: 'grep',
      admits: ['run_command'],
      description: 'Regex search across the checkout (ripgrep). Alias of run_command.',
      source: 'user-guide/01-getting-started.md; user-guide/22-permissions-and-safety.md; tools.rs Grep',
      notes: 'Uncertain: grep_search. The shell README built-in table and an agent-profile example spell the search tool grep_search. The getting-started guide, the permission read-only list, and tools.rs spell it grep.',
   },
   {
      names: ['search_replace', 'edit_file', 'apply_patch'],
      route: 'replace',
      admits: ['edit_file'],
      description: 'Make a precise edit to a file. Alias of edit_file.',
      source: 'user-guide/01-getting-started.md; shell README; tools.rs Edit',
      notes: 'Uncertain: edit_file, apply_patch. Berry strips both with --disallowed-tools. tools.rs offers this tool as search_replace, and the hooks doc maps Claude Edit, Write, and MultiEdit onto search_replace.',
   },
   {
      names: ['write', 'write_file', 'create_file'],
      route: 'write',
      admits: ['write_file'],
      description: 'Create or replace a file. Alias of write_file.',
      source: 'tools.rs Write; session/goal_role_tools.rs write fallback',
      notes: 'Uncertain: write_file, create_file. Berry strips both. tools.rs offers the Write tool as write, and the goal-role fallback name is write.',
   },
   {
      names: ['delete_file'],
      route: 'delete',
      admits: ['delete_file'],
      description: 'Remove one file. Alias of delete_file.',
      source: 'adapters/grok.ts GROK_DISALLOWED_TOOLS; tools.rs Delete',
      notes: 'Uncertain: delete_file. tools.rs says Grok Build does not offer a delete tool (that variant has no Grok Build name; the daemon worker is the one that removes a file). Berry still strips delete_file.',
   },
   {
      names: ['run_terminal_command', 'run_terminal_cmd', 'bash'],
      route: 'shell',
      admits: ['run_command'],
      description: 'Run a shell command. Alias of run_command.',
      source: 'user-guide/01-getting-started.md; user-guide/20-background-tasks.md; tools.rs Shell',
      notes: 'Uncertain: run_terminal_cmd, bash. The user guide and tools.rs name the model call run_terminal_command. The shell README filter table uses run_terminal_cmd as the --tools id and bash as the display name. Berry strips both run_terminal_cmd and run_terminal_command.',
   },
   {
      names: ['web_fetch'],
      route: 'fetch',
      admits: ['fetch_url'],
      description: 'Fetch a URL and return its content as markdown. Alias of fetch_url.',
      source: 'shell README web_fetch section; user-guide/01-getting-started.md; tools.rs WebFetch',
      notes: 'Off unless GROK_WEB_FETCH=1. A default documentation-domain allowlist applies when no custom allowed_domains is set.',
   },
   {
      names: ['web_search'],
      admits: [],
      description: 'Search the web.',
      source: 'user-guide/01-getting-started.md; shell README; tools.rs WebSearch',
      notes: 'No Berry web-search tool. fetch_url reads one URL and is not this call.',
   },
   {
      names: ['todo_write'],
      admits: [],
      description: 'Create and manage a task list for this session.',
      source: 'user-guide/01-getting-started.md; shell README; tools.rs Todo',
      notes: 'Session task list. No Berry tool tracks it.',
   },
   {
      names: ['spawn_subagent', 'task', 'Task'],
      admits: [],
      description: 'Start a child agent session.',
      source: 'user-guide/01-getting-started.md; user-guide/16-subagents.md; tools.rs Task',
      notes: 'Uncertain: task, Task. tools.rs says Grok Build spells the spawn tool spawn_subagent and the daemon worker spells it Task. The shell README filter table and built-in table use task. Needs --subagents. Agent in --disallowed-tools blocks spawning and is not itself a call.',
   },
   {
      names: ['send_subagent_message'],
      admits: [],
      description: 'Send a message to a subagent.',
      source: 'tools.rs SendMessage',
      notes: 'No Berry tool talks to a child session.',
   },
   {
      names: ['kill_command_or_subagent', 'kill_task'],
      admits: [],
      description: 'Stop a background command or subagent.',
      source: 'user-guide/20-background-tasks.md; tools.rs KillTask',
      notes: 'Uncertain: kill_task. The background-tasks guide names kill_command_or_subagent. The shell README built-in table uses kill_task. Stopping a process is not a Berry run_command.',
   },
   {
      names: ['get_command_or_subagent_output', 'get_task_output', 'wait_commands_or_subagents'],
      admits: [],
      description: 'Read output and status from a background command or subagent.',
      source: 'user-guide/20-background-tasks.md; user-guide/22-permissions-and-safety.md; tools.rs TaskOutput',
      notes: 'Uncertain: get_task_output, wait_commands_or_subagents. The background-tasks guide names get_command_or_subagent_output. The shell README built-in table uses get_task_output. The permission read-only list also names wait_commands_or_subagents, which tools.rs does not offer.',
   },
   {
      names: ['monitor'],
      admits: ['run_command'],
      description: 'Run a shell command and stream each output line back. Alias of run_command.',
      source: 'user-guide/20-background-tasks.md; tools.rs Monitor',
   },
   {
      names: ['memory_search'],
      admits: [],
      description: 'Search cross-session memory.',
      source: 'user-guide/01-getting-started.md; shell README; tools.rs MemorySearch',
      notes: 'Requires memory to be enabled. No Berry memory store.',
   },
   {
      names: ['memory_get'],
      admits: [],
      description: 'Read a memory file by path.',
      source: 'shell README built-in tools; tools.rs MemoryGet',
      notes: 'A memory file, not a checkout file. Requires memory to be enabled.',
   },
   {
      names: ['search_tool'],
      admits: [],
      description: 'Discover MCP integration tools.',
      source: 'shell README built-in tools; user-guide/16-subagents.md; tools.rs SearchTool',
      notes: 'MCP discovery. Berry tools are already on the run and are not found through this call.',
   },
   {
      names: ['use_tool'],
      admits: [],
      description: 'Call an MCP tool discovered with search_tool.',
      source: 'shell README built-in tools; tools.rs USE_TOOL_NAME',
      notes: 'Dispatches server__tool. It is not a Berry tool by itself.',
   },
   {
      names: ['lsp'],
      admits: [],
      description: 'Query a language server.',
      source: 'shell README LSP section; tools.rs Lsp',
      notes: 'Present when lsp_tools is on and a server config starts. No Berry code-intelligence tool.',
   },
   {
      names: ['skill'],
      admits: [],
      description: 'Invoke a skill package.',
      source: 'tools.rs Skill; user-guide/22-permissions-and-safety.md (invoking skills)',
      notes: 'The permission guide lists invoking skills as read-only and does not print this function name. tools.rs offers it as skill. read_skill is not one of the Berry tools this dictionary may admit.',
   },
   {
      names: ['enter_plan_mode'],
      admits: [],
      description: 'Enter plan mode.',
      source: 'user-guide/19-plan-mode.md; tools.rs EnterPlanMode',
      notes: 'Needs approval before plan mode activates. No Berry plan-mode tool.',
   },
   {
      names: ['exit_plan_mode'],
      admits: [],
      description: 'Leave plan mode and present the plan.',
      source: 'user-guide/19-plan-mode.md; tools.rs ExitPlanMode',
      notes: 'No Berry plan-mode tool.',
   },
   {
      names: ['ask_user_question'],
      admits: [],
      description: 'Ask the user a structured question.',
      source: 'tools.rs Question; user-guide/19-plan-mode.md',
      notes: 'No Berry tool prompts the user. Subagents do not receive this tool.',
   },
   {
      names: ['image_gen'],
      admits: [],
      description: 'Generate an image.',
      source: 'tools.rs ImageGen; user-guide/05-configuration.md media generation caps',
      notes: 'The slash command is /imagine. tools.rs offers the model tool as image_gen. No Berry image tool.',
   },
   {
      names: ['reference_to_video'],
      admits: [],
      description: 'Generate a video from reference images or voices.',
      source: 'tools.rs ReferenceToVideo',
      notes: 'The slash command is /imagine-video. tools.rs offers the model tool as reference_to_video. The daemon worker toolset has no video tool. No Berry video tool.',
   },
   {
      names: ['scheduler_create'],
      admits: [],
      description: 'Schedule a prompt to run later or on an interval.',
      source: 'user-guide/20-background-tasks.md; tools.rs SchedulerCreate',
      notes: 'Each fire runs in a detached subagent. No Berry scheduler.',
   },
   {
      names: ['scheduler_list'],
      admits: [],
      description: 'List scheduled tasks.',
      source: 'user-guide/20-background-tasks.md; tools.rs SchedulerList',
      notes: 'No Berry scheduler.',
   },
   {
      names: ['scheduler_delete'],
      admits: [],
      description: 'Cancel a scheduled task.',
      source: 'user-guide/20-background-tasks.md; tools.rs SchedulerDelete',
      notes: 'No Berry scheduler.',
   },
   {
      names: ['workflow'],
      admits: [],
      description: 'Run a saved workflow script.',
      source: 'user-guide/05-configuration.md; tools.rs Workflow',
      notes: 'On by default (GROK_WORKFLOWS). Host-owned .rhai workflows. No Berry workflow tool.',
   },
   {
      names: ['update_goal'],
      admits: [],
      description: 'Update goal mode when background workflows are off.',
      source: 'user-guide/05-configuration.md',
      notes: 'Legacy model-facing tool. With workflows enabled, the host engine drives /goal instead. No Berry goal tool.',
   },
];

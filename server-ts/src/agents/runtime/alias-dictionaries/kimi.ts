/**
 * Kimi Code CLI built-in tools, and the Berry tool each one may stand for.
 *
 * Read on 2026-10-12:
 * - https://moonshotai.github.io/kimi-code/en/reference/tools
 * - https://github.com/moonshotai/kimi-code/blob/main/docs/en/reference/tools.md
 * - https://moonshotai.github.io/kimi-code/en/customization/agents
 * - https://moonshotai.github.io/kimi-cli/en/customization/agents
 *
 * Names are the exact built-in ids from the current tools reference. That
 * agents page says matching is case-sensitive, so a lowercase spelling is
 * not the same tool. The older agents page still lists Shell, ReadFile,
 * WriteFile, StrReplaceFile, SetTodoList, and SearchWeb. Whether the
 * current CLI accepts those names is uncertain, so they are not registered
 * here. This file does not record tool parameters.
 *
 * admits is empty when no Berry tool is a faithful implementation.
 */

import type { AliasRoute } from './route.ts';

const TOOLS = 'https://moonshotai.github.io/kimi-code/en/reference/tools';

export interface KimiAlias {
   /** Exact built-in ids the model can call. The first is the documented name. */
   names: readonly string[];
   /** Berry tools this call may stand for. Empty when none is faithful. */
   admits: readonly string[];
   /** How Berry serves this name on its MCP server. Absent when the runtime runs it itself. */
   route?: AliasRoute;
   description: string;
   source: string;
   notes?: string;
}

export const KIMI_ALIAS_DICTIONARY: readonly KimiAlias[] = [
   {
      names: ['Read'],
      route: 'read',
      admits: ['read_repository_file', 'read_file'],
      description: 'Read a text file. Alias of read_repository_file.',
      source: TOOLS,
      notes: 'Uncertain legacy name: ReadFile, from the older Kimi CLI agents page.',
   },
   {
      names: ['Write'],
      route: 'write',
      admits: ['write_file'],
      description: 'Create or overwrite a file, including append. Alias of write_file.',
      source: TOOLS,
      notes: 'Uncertain legacy name: WriteFile, from the older Kimi CLI agents page.',
   },
   {
      names: ['Edit'],
      route: 'replace',
      admits: ['edit_file'],
      description: 'Replace one exact span, or every span when replace_all is set. Alias of edit_file.',
      source: TOOLS,
      notes: 'Uncertain legacy name: StrReplaceFile, from the older Kimi CLI agents page.',
   },
   {
      names: ['Grep'],
      admits: [],
      description: 'Search file contents with ripgrep.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This is content search, not a file listing and not a shell command.',
   },
   {
      names: ['Glob'],
      route: 'glob',
      admits: ['browse_repository', 'list_files'],
      description: 'Find files by glob pattern. Alias of browse_repository.',
      source: TOOLS,
   },
   {
      names: ['ReadMediaFile'],
      admits: [],
      description: 'Send an image or video to the model.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This is multimodal input, not a text file read.',
   },
   {
      names: ['Bash'],
      route: 'shell',
      admits: ['run_command'],
      description: 'Run a shell command, in the foreground or the background. Alias of run_command.',
      source: TOOLS,
      notes: 'Uncertain legacy name: Shell, from the older Kimi CLI agents page.',
   },
   {
      names: ['WebSearch'],
      admits: [],
      description: 'Search the web.',
      source: TOOLS,
      notes: 'No faithful Berry tool. A search is not a fetch of one URL. The tool is omitted unless the host injects a search implementation. Uncertain legacy name: SearchWeb, from the older Kimi CLI agents page.',
   },
   {
      names: ['FetchURL'],
      route: 'fetch',
      admits: ['fetch_url'],
      description: 'Fetch one URL and return its text. Alias of fetch_url.',
      source: TOOLS,
      notes: 'Omitted unless the host injects a fetch implementation.',
   },
   {
      names: ['EnterPlanMode'],
      admits: [],
      description: 'Enter plan mode, which limits writes to the plan file.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This changes the session mode.',
   },
   {
      names: ['ExitPlanMode'],
      admits: [],
      description: 'Leave plan mode and submit the plan for approval.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This submits a plan, not a file edit.',
   },
   {
      names: ['TodoList'],
      admits: [],
      description: 'Read or replace this session\'s to-do list.',
      source: TOOLS,
      notes: 'No faithful Berry tool. Session task state stays inside the CLI. Uncertain legacy name: SetTodoList, from the older Kimi CLI agents page.',
   },
   {
      names: ['Agent'],
      admits: [],
      description: 'Spawn or resume a sub-agent.',
      source: TOOLS,
      notes: 'No faithful Berry tool. Delegation leaves this run\'s tool contract.',
   },
   {
      names: ['AgentSwarm'],
      admits: [],
      description: 'Launch or resume a group of sub-agents from one template.',
      source: TOOLS,
      notes: 'No faithful Berry tool. Delegation leaves this run\'s tool contract.',
   },
   {
      names: ['AskUserQuestion'],
      admits: [],
      description: 'Ask the user a structured question.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This waits on the person, not on a repository or a URL.',
   },
   {
      names: ['NotifyUser'],
      admits: [],
      description: 'Post a short progress update without ending the turn.',
      source: TOOLS,
      notes: 'No faithful Berry tool. Experimental and off by default, so a session may not be given this tool.',
   },
   {
      names: ['Skill'],
      admits: [],
      description: 'Invoke a registered inline skill.',
      source: TOOLS,
      notes: 'No faithful Berry tool. A skill can run outside this run\'s tool contract.',
   },
   {
      names: ['TaskList'],
      admits: [],
      description: 'List background tasks started by Bash, Agent, or AskUserQuestion.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This reads CLI task state, not the repository.',
   },
   {
      names: ['TaskOutput'],
      admits: [],
      description: 'Read the current output of one background task.',
      source: TOOLS,
      notes: 'No faithful Berry tool. The saved log can later be read with Read, but this call is not a file read.',
   },
   {
      names: ['TaskStop'],
      admits: [],
      description: 'Stop one background task.',
      source: TOOLS,
      notes: 'No faithful Berry tool. Stopping a CLI task by id is not a shell command.',
   },
   {
      names: ['WaitFor'],
      admits: [],
      description: 'Wait until a background task finishes or the timeout elapses.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This suspends the turn.',
   },
   {
      names: ['CronCreate'],
      admits: [],
      description: 'Schedule a prompt to run again in this session.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This arms a session timer.',
   },
   {
      names: ['CronList'],
      admits: [],
      description: 'List scheduled prompts for this session.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This reads session timers.',
   },
   {
      names: ['CronDelete'],
      admits: [],
      description: 'Cancel one scheduled prompt.',
      source: TOOLS,
      notes: 'No faithful Berry tool. This cancels a session timer.',
   },
];

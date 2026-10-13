/**
 * Claude Code built-in tools, and the Berry tool each one stands for.
 *
 * Scraped 2026-10-12. Doc pages:
 * - https://code.claude.com/docs/en/tools-reference
 * - https://code.claude.com/docs/en/agent-sdk/agent-loop
 * - https://code.claude.com/docs/en/agent-sdk/subagents
 * - https://code.claude.com/docs/en/plugin-evals
 * - https://code.claude.com/docs/en/errors
 * - https://code.claude.com/docs/en/cli-reference
 *
 * Context7: /websites/code_claude (official docs). The tools-reference table
 * is the name list. The errors page says tool names are case-sensitive
 * (`read` is rejected; `Read` is the tool), so lowercase spellings are not
 * aliases.
 *
 * Berry's Claude adapter passes `--tools ''`, which removes built-in tools,
 * and allows only `mcp__berry__<name>`. This file does not change that.
 *
 * `admits` is empty when no Berry tool does the same job. Berry tools a
 * native tool may stand for: read_repository_file, read_file,
 * browse_repository, list_files, write_file, edit_file, run_command,
 * fetch_url.
 */

const TOOLS = 'https://code.claude.com/docs/en/tools-reference';
const SUBAGENTS = 'https://code.claude.com/docs/en/agent-sdk/subagents';
const EVALS = 'https://code.claude.com/docs/en/plugin-evals';

export interface ClaudeAlias {
   /** Every documented name for this built-in. The first is the current tool_use name. */
   names: readonly string[];
   /** Berry tools this call faithfully stands for. */
   admits: readonly string[];
   description: string;
   source: string;
   notes?: string;
}

export const CLAUDE_ALIAS_DICTIONARY: readonly ClaudeAlias[] = [
   {
      names: ['Agent', 'Task'],
      admits: [],
      description: 'Spawns a subagent, or a teammate when the call carries a name.',
      source: SUBAGENTS,
      notes: 'No Berry tool spawns an agent. Current tool_use blocks say Agent. system:init still lists Task, and tool_use blocks before v2.1.63 said Task.',
   },
   {
      names: ['Artifact'],
      admits: [],
      description: 'Publishes an HTML or Markdown file as a private page on claude.ai.',
      source: TOOLS,
      notes: 'No Berry tool publishes a claude.ai artifact.',
   },
   {
      names: ['AskUserQuestion'],
      admits: [],
      description: 'Asks the person multiple-choice questions and waits for an answer.',
      source: TOOLS,
      notes: 'No Berry tool asks the person a question from the model.',
   },
   {
      names: ['Bash'],
      admits: ['run_command'],
      description: 'Runs a shell command in the session environment.',
      source: TOOLS,
   },
   {
      names: ['CronCreate'],
      admits: [],
      description: 'Schedules a recurring or one-shot prompt in the current session.',
      source: TOOLS,
      notes: 'No Berry tool schedules a session prompt.',
   },
   {
      names: ['CronDelete'],
      admits: [],
      description: 'Cancels a scheduled task by id.',
      source: TOOLS,
      notes: 'No Berry tool cancels a Claude session schedule.',
   },
   {
      names: ['CronList'],
      admits: [],
      description: 'Lists scheduled tasks in the session.',
      source: TOOLS,
      notes: 'No Berry tool lists Claude session schedules.',
   },
   {
      names: ['Edit'],
      admits: ['edit_file'],
      description: 'Replaces one exact span in a file.',
      source: TOOLS,
   },
   {
      names: ['EndConversation'],
      admits: [],
      description: 'Ends the session after sustained abuse or an explicit demonstration request.',
      source: TOOLS,
      notes: 'No Berry tool ends the model session. Requires Claude Code v2.1.213 or later, and a non-interactive run does not include it.',
   },
   {
      names: ['EnterPlanMode'],
      admits: [],
      description: 'Switches the session into plan mode.',
      source: TOOLS,
      notes: 'No Berry tool switches plan mode.',
   },
   {
      names: ['EnterWorktree'],
      admits: [],
      description: 'Creates a git worktree and switches the session into it, or enters an existing one.',
      source: TOOLS,
      notes: 'No Berry tool creates or enters a git worktree.',
   },
   {
      names: ['ExitPlanMode'],
      admits: [],
      description: 'Presents a plan for approval and leaves plan mode.',
      source: TOOLS,
      notes: 'No Berry tool approves a plan or leaves plan mode.',
   },
   {
      names: ['ExitWorktree'],
      admits: [],
      description: 'Leaves a worktree session and returns to the original directory.',
      source: TOOLS,
      notes: 'No Berry tool leaves a git worktree.',
   },
   {
      names: ['Glob'],
      admits: ['browse_repository', 'list_files'],
      description: 'Finds files by name pattern.',
      source: TOOLS,
      notes: 'Absent by default on macOS, Linux, and WSL; Claude then searches with Bash. Naming Glob or Grep in --tools or --allowedTools brings both back.',
   },
   {
      names: ['Grep'],
      admits: ['run_command'],
      description: 'Searches file contents with a regex.',
      source: TOOLS,
      notes: 'Berry has no content-search tool, so the stand-in is a search command. Absent by default on macOS, Linux, and WSL under the same conditions as Glob.',
   },
   {
      names: ['ListAgents'],
      admits: [],
      description: 'Lists agents this session can message with SendMessage.',
      source: TOOLS,
      notes: 'No Berry tool lists other Claude sessions or teammates. Requires Claude Code v2.1.224 or later, and only when cross-session messaging is enabled.',
   },
   {
      names: ['ListMcpResourcesTool'],
      admits: [],
      description: 'Lists resources exposed by connected MCP servers.',
      source: TOOLS,
      notes: 'No Berry tool lists MCP resources.',
   },
   {
      names: ['LSP'],
      admits: [],
      description: 'Code intelligence from a language server: definitions, references, and diagnostics.',
      source: TOOLS,
      notes: 'No Berry tool talks to a language server. A Read path rule also covers LSP, which is a permission rule, not an alias of reading a file.',
   },
   {
      names: ['Monitor'],
      admits: ['run_command'],
      description: 'Runs a command in the background and feeds each output line back.',
      source: TOOLS,
      notes: 'The command form is a shell command and uses Bash permission rules. A WebSocket source has no Berry tool.',
   },
   {
      names: ['NotebookEdit'],
      admits: [],
      description: 'Replaces, inserts, or deletes one Jupyter notebook cell by cell id.',
      source: TOOLS,
      notes: 'edit_file replaces an exact text span and does not edit notebook cells. An Edit path rule also covers this tool.',
   },
   {
      names: ['NotebookRead'],
      admits: ['read_repository_file', 'read_file'],
      description: 'Reads a Jupyter notebook.',
      source: EVALS,
      notes: 'Uncertain. Plugin evals list it as a read-only built-in next to Read. The tools-reference table does not name it. Read already returns notebook cells.',
   },
   {
      names: ['PowerShell'],
      admits: ['run_command'],
      description: 'Runs a PowerShell command.',
      source: TOOLS,
      notes: 'On by default for Windows. Opt-in on Linux, macOS, and WSL via CLAUDE_CODE_USE_POWERSHELL_TOOL=1.',
   },
   {
      names: ['PushNotification'],
      admits: [],
      description: 'Sends a desktop notification, and a phone push when Remote Control is connected.',
      source: TOOLS,
      notes: 'No Berry tool sends a desktop or phone notification.',
   },
   {
      names: ['Read'],
      admits: ['read_repository_file', 'read_file'],
      description: 'Reads a file. Images, PDFs, and notebooks come back in their own forms.',
      source: TOOLS,
      notes: 'A directory read is refused; listing is a shell command. Text file reads are the Berry alias.',
   },
   {
      names: ['ReadMcpResourceTool'],
      admits: [],
      description: 'Reads one MCP resource by URI.',
      source: TOOLS,
      notes: 'An MCP resource is not a repository file.',
   },
   {
      names: ['RemoteTrigger'],
      admits: [],
      description: 'Creates, updates, runs, and lists Routines on claude.ai.',
      source: TOOLS,
      notes: 'No Berry tool manages claude.ai Routines.',
   },
   {
      names: ['ReportFindings'],
      admits: [],
      description: 'Reports code-review findings as a structured list for Claude Code to render.',
      source: TOOLS,
      notes: 'No Berry tool renders Claude Code review findings.',
   },
   {
      names: ['ScheduleWakeup'],
      admits: [],
      description: 'Reschedules or stops the next iteration of a self-paced /loop.',
      source: TOOLS,
      notes: 'No Berry tool schedules a Claude /loop wakeup.',
   },
   {
      names: ['SendFeedback'],
      admits: [],
      description: 'Drafts a Claude Code feedback report and queues it locally for the person to send.',
      source: TOOLS,
      notes: 'No Berry tool files Claude Code product feedback. Requires Claude Code v2.1.238 or later.',
   },
   {
      names: ['SendMessage'],
      admits: [],
      description: 'Sends a message to a teammate, a subagent, or another Claude Code session.',
      source: TOOLS,
      notes: 'No Berry tool messages another Claude session. Cross-session messaging requires Claude Code v2.1.224 or later.',
   },
   {
      names: ['SendUserFile'],
      admits: [],
      description: 'Sends session files to the person, when a Remote Control client or a cloud session is connected.',
      source: TOOLS,
      notes: 'No Berry tool delivers a file to the person\'s device.',
   },
   {
      names: ['ShareOnboardingGuide'],
      admits: [],
      description: 'Uploads ONBOARDING.md and returns a share link.',
      source: TOOLS,
      notes: 'No Berry tool shares an onboarding guide on claude.ai.',
   },
   {
      names: ['Skill'],
      admits: [],
      description: 'Runs a skill in the main conversation.',
      source: TOOLS,
      notes: 'No Berry tool in the alias set runs a Claude skill. Berry reads skills with read_skill, which is a different call.',
   },
   {
      names: ['SubagentHandback'],
      admits: [],
      description: 'Delivers a local subagent\'s final report for the auto-mode classifier to review.',
      source: TOOLS,
      notes: 'No Berry tool delivers a subagent report. Requires Claude Code v2.1.271 or later, and only in auto mode.',
   },
   {
      names: ['TaskCreate'],
      admits: [],
      description: 'Creates a task on the session task list.',
      source: TOOLS,
      notes: 'The session checklist is not a Berry issue. Provided by default only on older models, unless the session opts in.',
   },
   {
      names: ['TaskGet'],
      admits: [],
      description: 'Reads one task from the session task list.',
      source: TOOLS,
      notes: 'No Berry tool reads Claude\'s session task list.',
   },
   {
      names: ['TaskList'],
      admits: [],
      description: 'Lists tasks on the session task list.',
      source: TOOLS,
      notes: 'No Berry tool lists Claude\'s session task list.',
   },
   {
      names: ['TaskOutput'],
      admits: [],
      description: 'Reads output from a background task.',
      source: TOOLS,
      notes: 'Deprecated in favor of Read on the task output file. That file is session output, not a repository read.',
   },
   {
      names: ['TaskStop'],
      admits: [],
      description: 'Stops a background task, teammate, or named background agent.',
      source: TOOLS,
      notes: 'No Berry tool stops a Claude background task.',
   },
   {
      names: ['TaskUpdate'],
      admits: [],
      description: 'Updates or deletes a task on the session task list.',
      source: TOOLS,
      notes: 'No Berry tool updates Claude\'s session task list.',
   },
   {
      names: ['TodoWrite'],
      admits: [],
      description: 'Manages the legacy session checklist.',
      source: TOOLS,
      notes: 'Disabled by default in favor of TaskCreate, TaskGet, TaskList, and TaskUpdate. Set CLAUDE_CODE_ENABLE_TASKS=0 to bring it back. No Berry tool keeps that checklist.',
   },
   {
      names: ['ToolSearch'],
      admits: [],
      description: 'Searches for and loads deferred tools when tool search is enabled.',
      source: TOOLS,
      notes: 'No Berry tool loads deferred Claude tools.',
   },
   {
      names: ['WaitForMcpServers'],
      admits: [],
      description: 'Waits for MCP servers that are still connecting.',
      source: TOOLS,
      notes: 'No Berry tool waits on MCP server startup. Present only when tool search is disabled.',
   },
   {
      names: ['WebFetch'],
      admits: ['fetch_url'],
      description: 'Fetches a URL and returns extracted page content.',
      source: TOOLS,
      notes: 'The documented tool runs an extraction prompt over the page, so the result can omit text. fetch_url is the page fetch.',
   },
   {
      names: ['WebSearch'],
      admits: [],
      description: 'Searches the web and returns titles and URLs.',
      source: TOOLS,
      notes: 'It does not fetch result pages. Berry has no web search tool. Reading a result is a later WebFetch.',
   },
   {
      names: ['Workflow'],
      admits: [],
      description: 'Runs a script that orchestrates many subagents and returns one result.',
      source: TOOLS,
      notes: 'No Berry tool runs a Claude dynamic workflow.',
   },
   {
      names: ['Write'],
      admits: ['write_file'],
      description: 'Creates a file or overwrites one with the full contents.',
      source: TOOLS,
   },
];

/**
 * Codex CLI native tools for exec and the app-server, as of 2026-10-12.
 *
 * Context7 library: /openai/codex
 * Doc pages:
 * - https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/spec_plan.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/shell_spec.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/apply_patch_spec.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/plan_spec.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/mcp_resource_spec.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/view_image_spec.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/code_mode/execute_spec.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/code-mode-protocol/src/lib.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/ext/web-search/src/tool.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/ext/image-generation/imagegen_description.md
 * - https://github.com/openai/codex/blob/main/codex-rs/rollout-trace/src/tool_dispatch.rs
 * - https://github.com/openai/codex/blob/main/codex-rs/protocol/src/openai_models.rs
 *
 * The registered shell function is exec_command. shell, local_shell, and
 * shell_command are dispatch aliases of that function. There is no built-in
 * read, list, or grep tool. A name marked uncertain in notes was not found
 * as a registered function.
 */

export interface CodexAliasEntry {
   /** Registered function name first, then aliases. */
   names: readonly string[];
   /** Berry tools this native tool faithfully stands for. */
   admits: readonly string[];
   description: string;
   source: string;
   notes?: string;
}

const SHELL_SPEC = 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/shell_spec.rs';
const SPEC_PLAN = 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/spec_plan.rs';
const MULTI_AGENT = 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/multi_agents_spec.rs';

export const CODEX_ALIAS_DICTIONARY: readonly CodexAliasEntry[] = [
   {
      names: ['exec_command', 'shell', 'local_shell', 'shell_command'],
      admits: ['run_command'],
      description: 'Runs a command in a PTY and returns output or a session id.',
      source: SHELL_SPEC,
      notes: 'shell, local_shell, and shell_command are rollout-dispatch aliases. The registered spec name is exec_command. Config shell_type values default, local, and shell_command select unified exec; they are not extra functions.',
   },
   {
      names: ['write_stdin'],
      admits: [],
      description: 'Writes characters to an existing unified exec session and returns recent output.',
      source: SHELL_SPEC,
      notes: 'Registered only when unified exec is on. Continues an exec_command session. Berry has no tool that writes stdin to a live process.',
   },
   {
      names: ['apply_patch'],
      admits: ['write_file', 'edit_file'],
      description: 'Edits files with a freeform patch. The patch can add, update, delete, or move a file.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/apply_patch_spec.rs',
      notes: 'write_file and edit_file cover creating and changing file contents. The patch grammar also deletes and renames files.',
   },
   {
      names: ['update_plan'],
      admits: [],
      description: 'Updates the task plan.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/plan_spec.rs',
      notes: 'Session plan state. No Berry tool stores that plan.',
   },
   {
      names: ['view_image'],
      admits: [],
      description: 'Views a local image file from the filesystem.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/view_image_spec.rs',
      notes: 'Returns image data for visual inspection. read_repository_file and read_file do not view images.',
   },
   {
      names: ['list_mcp_resources'],
      admits: [],
      description: 'Lists resources provided by MCP servers.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/mcp_resource_spec.rs',
      notes: 'MCP server resources, not the task checkout.',
   },
   {
      names: ['list_mcp_resource_templates'],
      admits: [],
      description: 'Lists parameterized resource templates provided by MCP servers.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/mcp_resource_spec.rs',
      notes: 'MCP resource templates, not the task checkout.',
   },
   {
      names: ['read_mcp_resource'],
      admits: [],
      description: 'Reads one resource from an MCP server.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/mcp_resource_spec.rs',
      notes: 'Reads an MCP resource. read_repository_file and read_file read the checkout.',
   },
   {
      names: ['request_permissions'],
      admits: [],
      description: 'Asks the user for extra filesystem or network permissions and waits for a grant.',
      source: SHELL_SPEC,
      notes: 'Approval of a permission profile. No Berry tool grants sandbox permissions.',
   },
   {
      names: ['request_user_input'],
      admits: [],
      description: 'Asks the user one to three short questions and waits for the response.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/request_user_input_spec.rs',
      notes: 'Blocks on a person. No Berry tool does that.',
   },
   {
      names: ['request_user_input_async', 'send_user_message_async'],
      admits: [],
      description: 'Requests user input without the synchronous request_user_input call.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/request_user_input_async.rs',
      notes: 'uncertain: send_user_message_async. The registered function is request_user_input_async. send_user_message_async is a previous model-catalog name that still enables this handler; this scrape did not find it registered as its own function.',
   },
   {
      names: ['send_message_to_user_async'],
      admits: [],
      description: 'Sends a concise message that needs the user during ongoing work and returns without waiting.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/send_message_to_user_async.rs',
      notes: 'A user-visible message, not a repository or command tool.',
   },
   {
      names: ['wait_for_environment'],
      admits: [],
      description: 'Waits for a selected execution environment marked starting to become available.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/wait_for_environment.rs',
      notes: 'Codex environment readiness. No Berry tool waits on an execution environment.',
   },
   {
      names: ['new_context'],
      admits: [],
      description: 'Starts a new context window. Does not clear environment state.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/new_context_window_spec.rs',
      notes: 'Context-window control. No Berry tool resets model context.',
   },
   {
      names: ['get_context_remaining'],
      admits: [],
      description: 'Reports the remaining tokens in the current context window.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/get_context_remaining_spec.rs',
      notes: 'Token-budget status. No Berry tool reports context remaining.',
   },
   {
      names: ['clock.curr_time', 'curr_time'],
      admits: [],
      description: 'Returns the current time in UTC. The function name is curr_time in the clock namespace.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/current_time.rs',
      notes: 'Clock read. Model catalogs also mention the name clock for this capability. No Berry tool returns the clock.',
   },
   {
      names: ['clock.sleep', 'sleep'],
      admits: [],
      description: 'Pauses until the duration elapses or new input arrives for the active turn.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/sleep.rs',
      notes: 'The function name is sleep in the clock namespace. No Berry tool sleeps a turn.',
   },
   {
      names: ['tool_search'],
      admits: [],
      description: 'Searches deferred tool metadata and exposes matching tools for the next model call.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/tools/src/tool_discovery.rs',
      notes: 'Discovers Codex tools. It does not search the checkout.',
   },
   {
      names: ['list_available_plugins_to_install'],
      admits: [],
      description: 'Lists plugins and connectors that can be requested for install.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/tools/src/tool_discovery.rs',
      notes: 'Plugin catalog. No Berry tool installs Codex plugins.',
   },
   {
      names: ['request_plugin_install'],
      admits: [],
      description: 'Asks to install a plugin or connector the user explicitly requested.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/handlers/request_plugin_install_spec.rs',
      notes: 'Install request. No Berry tool installs Codex plugins.',
   },
   {
      names: ['test_sync_tool'],
      admits: [],
      description: 'Test-only sync tool, registered when the model catalog lists test_sync_tool.',
      source: SPEC_PLAN,
      notes: 'Experimental catalog tool. No Berry equivalent.',
   },
   {
      names: ['exec'],
      admits: [],
      description: 'Runs JavaScript in a code-mode cell to compose other tool calls. No Node, filesystem, or network.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/code-mode-protocol/src/lib.rs',
      notes: 'Code-mode cell, not a shell. The registered name is exec. It is not exec_command.',
   },
   {
      names: ['wait'],
      admits: [],
      description: 'Resumes a running code-mode exec cell, or stops it.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/code-mode-protocol/src/description.rs',
      notes: 'Code-mode cell control. No Berry tool resumes a JavaScript cell.',
   },
   {
      names: ['web_search', 'web_search_preview'],
      admits: [],
      description: 'Hosted web search tool. web_search_preview is a rollout-dispatch alias.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/tools/src/tool_spec.rs',
      notes: 'Search results, not a fetch of one URL. Used when standalone web search is off.',
   },
   {
      names: ['web.run', 'run'],
      admits: [],
      description: 'Standalone internet tool in the web namespace. It can search, open a page, click, and take a screenshot.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/ext/web-search/src/tool.rs',
      notes: 'The open command can load a page, and the tool also searches and drives a browser. fetch_url does not cover that surface. The bare name run is the function inside the web namespace.',
   },
   {
      names: ['image_gen.imagegen', 'imagegen', 'image_generation', 'image_query'],
      admits: [],
      description: 'Generates an image from a description or edits an existing image.',
      source: 'https://github.com/openai/codex/blob/main/codex-rs/ext/image-generation/imagegen_description.md',
      notes: 'image_generation and image_query are rollout-dispatch aliases of imagegen. image_query is also a command inside web.run, which is a different tool. No Berry tool generates images.',
   },
   {
      names: ['multi_agent_v1.spawn_agent', 'spawn_agent'],
      admits: [],
      description: 'Spawns a sub-agent. v1 registers it in the multi_agent_v1 namespace.',
      source: MULTI_AGENT,
      notes: 'Codex sub-agent spawn. v2 can place the same function name in a configured namespace. No admitted Berry tool spawns a Codex agent.',
   },
   {
      names: ['multi_agent_v1.send_input', 'send_input'],
      admits: [],
      description: 'Sends a message to an existing v1 agent.',
      source: MULTI_AGENT,
      notes: 'v1 collaboration tool in the multi_agent_v1 namespace. No Berry tool messages a Codex sub-agent.',
   },
   {
      names: ['multi_agent_v1.resume_agent', 'resume_agent'],
      admits: [],
      description: 'Resumes a previously closed v1 agent.',
      source: MULTI_AGENT,
      notes: 'v1 collaboration tool. No Berry tool resumes a Codex agent.',
   },
   {
      names: ['multi_agent_v1.wait_agent', 'wait_agent'],
      admits: [],
      description: 'Waits for a spawned agent. v1 waits for a final status; v2 waits for a mailbox update.',
      source: MULTI_AGENT,
      notes: 'Same function name in v1 (multi_agent_v1 namespace) and v2 (configured namespace). No Berry tool waits on a Codex agent.',
   },
   {
      names: ['multi_agent_v1.close_agent', 'close_agent'],
      admits: [],
      description: 'Closes a v1 agent and its open descendants.',
      source: MULTI_AGENT,
      notes: 'v1 collaboration tool. Rollout dispatch also classifies interrupt_agent as this kind. They are separate functions.',
   },
   {
      names: ['send_message'],
      admits: [],
      description: 'Sends a message to an existing v2 agent and does not start a new turn.',
      source: MULTI_AGENT,
      notes: 'v2 collaboration tool. The namespace is configured. No Berry tool messages a Codex agent.',
   },
   {
      names: ['followup_task', 'assign_task'],
      admits: [],
      description: 'Sends a follow-up task to an existing v2 agent and starts a turn when it is idle.',
      source: MULTI_AGENT,
      notes: 'assign_task is a rollout-dispatch alias of followup_task. No Berry tool assigns a Codex sub-agent task.',
   },
   {
      names: ['interrupt_agent'],
      admits: [],
      description: 'Interrupts a v2 agent\'s current turn and leaves the agent available.',
      source: MULTI_AGENT,
      notes: 'v2 collaboration tool. No Berry tool interrupts a Codex agent.',
   },
   {
      names: ['list_agents'],
      admits: [],
      description: 'Lists live agents in the current root thread tree.',
      source: MULTI_AGENT,
      notes: 'v2 collaboration tool. No Berry tool lists Codex sub-agents.',
   },
];

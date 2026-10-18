import { randomBytes } from 'node:crypto';

/**
 * The sandbox tools a Daytona MCP client already calls, answered by a Berry
 * runtime session container. Names, required arguments and result text match
 * that client. A session is the container the router starts for one id.
 */

export interface ExecResult {
   stdout: string;
   stderr: string;
   exitCode: number;
}

export interface SandboxHost {
   running(id: string): Promise<boolean>;
   /** Start the session. `idleMs` of 0 is never reaped for idleness. */
   start(id: string, idleMs: number): Promise<void>;
   destroy(id: string): Promise<void>;
   exec(id: string, argv: string[], stdin?: string): Promise<ExecResult>;
   /** A URL on the host that reaches `port` inside the session, when one is published. */
   previewUrl(id: string, port: number): Promise<string | null>;
}

export interface ToolContent {
   type: 'text' | 'image';
   text?: string;
   data?: string;
   mimeType?: string;
}

interface ToolResult {
   content: ToolContent[];
   isError: boolean;
}

type Args = Record<string, unknown>;

interface ToolSpec {
   name: string;
   description: string;
   inputSchema: { type: 'object'; properties: Record<string, { type: string; description: string }>; required?: string[] };
}

/** Names the Daytona MCP server exposes. `mcp_auth` is the client connection, not a sandbox tool. */
const DAYTONA_TOOLS = new Set([
   'computer_use_accessibility_find',
   'computer_use_accessibility_focus',
   'computer_use_accessibility_invoke',
   'computer_use_accessibility_set_value',
   'computer_use_accessibility_tree',
   'computer_use_display_info',
   'computer_use_keyboard_hotkey',
   'computer_use_keyboard_press',
   'computer_use_keyboard_type',
   'computer_use_mouse_click',
   'computer_use_mouse_drag',
   'computer_use_mouse_move',
   'computer_use_mouse_position',
   'computer_use_mouse_scroll',
   'computer_use_recording_delete',
   'computer_use_recording_get',
   'computer_use_recording_list',
   'computer_use_recording_start',
   'computer_use_recording_stop',
   'computer_use_screenshot',
   'computer_use_screenshot_compressed',
   'computer_use_screenshot_compressed_region',
   'computer_use_screenshot_region',
   'computer_use_start',
   'computer_use_status',
   'computer_use_stop',
   'computer_use_windows',
   'create_folder',
   'create_sandbox',
   'delete_file',
   'destroy_sandbox',
   'execute_command',
   'file_download',
   'file_upload',
   'get_file_info',
   'git_clone',
   'list_files',
   'move_file',
   'preview_link',
]);

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const bool = (value: unknown): boolean | undefined => (typeof value === 'boolean' ? value : undefined);

function text(body: string, isError = false): ToolResult {
   return { content: [{ type: 'text', text: body }], isError };
}

function prop(type: string, description: string): { type: string; description: string } {
   return { type, description };
}

const ID = prop('string', 'ID of the sandbox.');

export function sessionToolCatalog(): ToolSpec[] {
   return [
      tool('create_sandbox', 'Create a new runtime session.', {
         id: prop('string', 'If a sandbox ID is provided it is first checked if it exists and is running, if so, the existing sandbox will be used. Leave it empty to create a new sandbox.'),
         name: prop('string', 'Name of the sandbox. If not provided, the sandbox ID will be used as the name.'),
         target: prop('string', 'Target region of the sandbox.'),
         snapshot: prop('string', 'Snapshot of the sandbox. Cannot be specified when using a build info entry.'),
         user: prop('string', 'User associated with the sandbox.'),
         env: prop('object', 'Environment variables for the sandbox.'),
         labels: prop('object', 'Labels for the sandbox.'),
         public: prop('boolean', 'Whether the sandbox http preview is publicly accessible.'),
         cpu: prop('number', 'CPU cores allocated to the sandbox. Cannot specify sandbox resources when using a snapshot.'),
         gpu: prop('number', 'GPU units allocated to the sandbox. Cannot specify sandbox resources when using a snapshot.'),
         memory: prop('number', 'Memory allocated to the sandbox in GB. Cannot specify sandbox resources when using a snapshot.'),
         disk: prop('number', 'Disk space allocated to the sandbox in GB. Cannot specify sandbox resources when using a snapshot.'),
         autoStopInterval: prop('number', 'Auto-stop interval in minutes (0 means disabled) for the sandbox.'),
         ttlMinutes: prop('number', 'Maximum time to live in minutes since creation (0 means disabled).'),
         queueTimeout: prop('number', 'Minutes to wait for the session container to start.'),
         autoPauseInterval: prop('number', 'Auto-pause interval in minutes. Mutually exclusive with autoStopInterval.'),
         autoArchiveInterval: prop('number', 'Auto-archive interval in minutes.'),
         autoDeleteInterval: prop('number', 'Auto-delete interval in minutes (negative means disabled, 0 means delete on stop).'),
         volumes: prop('array', 'Volumes to attach to the sandbox.'),
         buildInfo: prop('object', 'Build information for the sandbox.'),
         networkBlockAll: prop('boolean', 'Whether to block all network access to the sandbox.'),
         kvm: prop('boolean', 'Expose KVM inside the sandbox.'),
         networkAllowList: prop('string', 'Comma-separated allowed IPv4 CIDRs. Cannot be combined with domainAllowList.'),
         domainAllowList: prop('string', 'Comma-separated allowed domains. Cannot be combined with networkAllowList.'),
      }),
      tool('destroy_sandbox', 'Destroy a runtime session.', { id: prop('string', 'ID of the sandbox to destroy.') }, ['id']),
      tool('execute_command', 'Execute shell commands in the runtime session. Returns full stdout and stderr output with exit codes. Commands run as the session user from its workspace and can install packages, modify files, and interact with running services.', {
         command: prop('string', 'Command to execute.'),
         id: prop('string', 'ID of the sandbox to execute the command in.'),
      }, ['command', 'id']),
      tool('create_folder', 'Create a new folder in the runtime session.', {
         folderPath: prop('string', 'Path to the folder to create.'),
         mode: prop('string', 'Mode of the folder to create (defaults to 0755).'),
         id: prop('string', 'ID of the sandbox to create the folder in.'),
      }, ['folderPath', 'id']),
      tool('delete_file', 'Delete a file or directory in the runtime session.', {
         filePath: prop('string', 'Path to the file or directory to delete.'),
         id: prop('string', 'ID of the sandbox to delete the file in.'),
      }, ['filePath', 'id']),
      tool('list_files', 'List files in a directory in the runtime session.', {
         path: prop('string', 'Path to the directory to list files from (defaults to current directory).'),
         id: prop('string', 'ID of the sandbox to list the files from.'),
      }, ['id']),
      tool('get_file_info', 'Get information about a file in the runtime session.', {
         filePath: prop('string', 'Path to the file to get information about.'),
         id: prop('string', 'ID of the sandbox to get the file information from.'),
      }, ['filePath', 'id']),
      tool('move_file', 'Move or rename a file in the runtime session.', {
         sourcePath: prop('string', 'Source path of the file to move.'),
         destPath: prop('string', 'Destination path where to move the file.'),
         id: prop('string', 'ID of the sandbox to move the file in.'),
      }, ['sourcePath', 'destPath', 'id']),
      tool('file_upload', 'Upload a file to the runtime session from text or base64-encoded content. Creates parent directories and verifies the write.', {
         filePath: prop('string', 'Path to the file to upload.'),
         content: prop('string', 'Content of the file to upload.'),
         encoding: prop('string', 'Encoding of the file to upload.'),
         overwrite: prop('boolean', 'Overwrite the file if it already exists.'),
         id: prop('string', 'ID of the sandbox to upload the file to.'),
      }, ['filePath', 'content', 'encoding', 'overwrite', 'id']),
      tool('file_download', 'Download a file from the runtime session. Text comes back as text. Images come back as base64.', {
         filePath: prop('string', 'Path to the file to download.'),
         id: prop('string', 'ID of the sandbox to download the file from.'),
      }, ['filePath', 'id']),
      tool('git_clone', 'Clone a Git repository into the runtime session.', {
         url: prop('string', 'URL of the Git repository to clone.'),
         path: prop('string', 'Directory to clone the repository into (defaults to current directory).'),
         branch: prop('string', 'Branch to clone.'),
         commitId: prop('string', 'Commit ID to clone.'),
         username: prop('string', 'Username to clone the repository with.'),
         password: prop('string', 'Password to clone the repository with.'),
         id: prop('string', 'ID of the sandbox to clone the repository in.'),
      }, ['url', 'id']),
      tool('preview_link', 'Generate an accessible preview URL for a web application running in the runtime session. When checkServer is set, confirms something is listening before returning the URL.', {
         port: prop('number', 'Port to expose.'),
         description: prop('string', 'Description of the service.'),
         checkServer: prop('boolean', 'Check if a server is running on the specified port.'),
         id: prop('string', 'ID of the sandbox to generate the preview link for.'),
      }, ['port', 'description', 'checkServer', 'id']),
      tool('computer_use_start', 'Start the computer-use desktop in the runtime session (Xvfb and a window manager). Call this before mouse, keyboard, or screenshot tools.', { id: ID }, ['id']),
      tool('computer_use_stop', 'Stop the computer-use desktop in the runtime session.', { id: ID }, ['id']),
      tool('computer_use_status', 'Get the status of computer-use processes in the runtime session.', { id: ID }, ['id']),
      tool('computer_use_windows', 'List open windows in the runtime session desktop.', { id: ID }, ['id']),
      tool('computer_use_display_info', 'Get display information for the runtime session desktop.', { id: ID }, ['id']),
      tool('computer_use_screenshot', 'Take a full-screen screenshot of the runtime session desktop. Call computer_use_start first.', {
         id: ID,
         showCursor: prop('boolean', 'Include the mouse cursor in the screenshot.'),
      }, ['id']),
      tool('computer_use_screenshot_region', 'Take a region screenshot of the runtime session desktop.', {
         id: ID, x: prop('number', 'Left coordinate of the region.'), y: prop('number', 'Top coordinate of the region.'),
         width: prop('number', 'Width of the region in pixels.'), height: prop('number', 'Height of the region in pixels.'),
         showCursor: prop('boolean', 'Include the mouse cursor in the screenshot.'),
      }, ['id', 'x', 'y', 'width', 'height']),
      tool('computer_use_mouse_move', 'Move the mouse cursor in the runtime session desktop.', {
         id: ID, x: prop('number', 'Target X coordinate.'), y: prop('number', 'Target Y coordinate.'),
      }, ['id', 'x', 'y']),
      tool('computer_use_mouse_click', 'Click the mouse in the runtime session desktop.', {
         id: ID, x: prop('number', 'X coordinate.'), y: prop('number', 'Y coordinate.'),
         button: prop('string', 'Mouse button: left, right, or middle. Defaults to left.'),
         double: prop('boolean', 'Perform a double click.'),
      }, ['id', 'x', 'y']),
      tool('computer_use_mouse_drag', 'Drag the mouse in the runtime session desktop.', {
         id: ID, startX: prop('number', 'Start X coordinate.'), startY: prop('number', 'Start Y coordinate.'),
         endX: prop('number', 'End X coordinate.'), endY: prop('number', 'End Y coordinate.'),
         button: prop('string', 'Mouse button: left, right, or middle. Defaults to left.'),
      }, ['id', 'startX', 'startY', 'endX', 'endY']),
      tool('computer_use_mouse_scroll', 'Scroll the mouse wheel in the runtime session desktop.', {
         id: ID, x: prop('number', 'X coordinate.'), y: prop('number', 'Y coordinate.'),
         direction: prop('string', 'Scroll direction: up or down.'),
         amount: prop('number', 'Scroll amount. Defaults to 3.'),
      }, ['id', 'x', 'y', 'direction']),
      tool('computer_use_mouse_position', 'Get the current mouse cursor position in the runtime session desktop.', { id: ID }, ['id']),
      tool('computer_use_keyboard_type', 'Type text in the runtime session desktop.', {
         id: ID, text: prop('string', 'Text to type.'), delay: prop('number', 'Delay in milliseconds between keystrokes.'),
      }, ['id', 'text']),
      tool('computer_use_keyboard_press', 'Press a key in the runtime session desktop.', {
         id: ID, key: prop('string', 'Key to press.'), modifiers: prop('array', 'Modifier keys: ctrl, alt, shift, cmd.'),
      }, ['id', 'key']),
      tool('computer_use_keyboard_hotkey', 'Press a hotkey in the runtime session desktop.', {
         id: ID, hotkey: prop('string', 'Hotkey combination (e.g. ctrl+c, alt+tab).'),
      }, ['id', 'hotkey']),
      tool('computer_use_recording_start', 'Start a screen recording of the runtime session desktop.', {
         id: ID, label: prop('string', 'Optional label for the recording.'),
      }, ['id']),
      tool('computer_use_recording_stop', 'Stop an active screen recording.', {
         id: ID, recordingId: prop('string', 'ID of the recording to stop.'),
      }, ['id', 'recordingId']),
      tool('computer_use_recording_list', 'List screen recordings in the runtime session.', { id: ID }, ['id']),
      tool('computer_use_recording_get', 'Get metadata for a screen recording.', {
         id: ID, recordingId: prop('string', 'ID of the recording.'),
      }, ['id', 'recordingId']),
      tool('computer_use_recording_delete', 'Delete a screen recording.', {
         id: ID, recordingId: prop('string', 'ID of the recording to delete.'),
      }, ['id', 'recordingId']),
      tool('computer_use_accessibility_tree', 'Fetch the accessibility tree from the runtime session desktop.', { id: ID }, ['id']),
      tool('computer_use_accessibility_find', 'Find accessibility nodes in the runtime session desktop.', { id: ID }, ['id']),
      tool('computer_use_accessibility_focus', 'Move keyboard focus to an accessibility node.', {
         id: ID, node_id: prop('string', 'Accessibility node ID.'),
      }, ['id', 'node_id']),
      tool('computer_use_accessibility_invoke', 'Invoke an action on an accessibility node.', {
         id: ID, node_id: prop('string', 'Accessibility node ID.'), action: prop('string', 'Action to invoke.'),
      }, ['id', 'node_id']),
      tool('computer_use_accessibility_set_value', 'Set the value of an accessibility node.', {
         id: ID, node_id: prop('string', 'Accessibility node ID.'), value: prop('string', 'Value to set on the node.'),
      }, ['id', 'node_id', 'value']),
   ].filter((entry) => DAYTONA_TOOLS.has(entry.name));
}

function tool(
   name: string,
   description: string,
   properties: ToolSpec['inputSchema']['properties'],
   required?: string[]
): ToolSpec {
   return { name, description, inputSchema: { type: 'object', properties, ...(required ? { required } : {}) } };
}

export async function handleSessionMcp(message: unknown, host: SandboxHost): Promise<unknown | null> {
   if (!message || typeof message !== 'object') return null;
   const call = message as { id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown; protocolVersion?: unknown } };
   if (call.id === undefined) return null;
   const id = call.id;
   if (call.method === 'initialize') {
      return rpc(id, {
         protocolVersion: call.params?.protocolVersion === '2024-11-05' ? '2024-11-05' : '2025-03-26',
         capabilities: { tools: {} },
         serverInfo: { name: 'berry-runtime-sessions', version: '1' },
      });
   }
   if (call.method === 'tools/list') return rpc(id, { tools: sessionToolCatalog() });
   if (call.method === 'tools/call') {
      const name = typeof call.params?.name === 'string' ? call.params.name : '';
      const args = call.params?.arguments && typeof call.params.arguments === 'object' ? (call.params.arguments as Args) : {};
      const result = await callSessionTool(host, name, args);
      return rpc(id, result);
   }
   return rpc(id, { content: [{ type: 'text', text: `unknown method ${String(call.method)}` }], isError: true });
}

function rpc(id: unknown, result: unknown): unknown {
   return { jsonrpc: '2.0', id, result };
}

export async function callSessionTool(host: SandboxHost, name: string, args: Args): Promise<ToolResult> {
   if (!DAYTONA_TOOLS.has(name)) return text(`unknown tool ${name}`, true);
   try {
      switch (name) {
         case 'create_sandbox':
            return createSandbox(host, args);
         case 'destroy_sandbox':
            return destroySandbox(host, args);
         case 'execute_command':
            return executeCommand(host, args);
         case 'create_folder':
            return createFolder(host, args);
         case 'delete_file':
            return removePath(host, args);
         case 'list_files':
            return listFiles(host, args);
         case 'get_file_info':
            return fileInfo(host, args);
         case 'move_file':
            return moveFile(host, args);
         case 'file_upload':
            return uploadFile(host, args);
         case 'file_download':
            return downloadFile(host, args);
         case 'git_clone':
            return gitClone(host, args);
         case 'preview_link':
            return previewLink(host, args);
         default:
            if (name.startsWith('computer_use_') && DAYTONA_TOOLS.has(name)) return computerUse(host, name, args);
            return text(`unknown tool ${name}`, true);
      }
   } catch (error) {
      return text(error instanceof Error ? error.message : 'the session tool failed', true);
   }
}

export function newSandboxId(): string {
   return `s${randomBytes(16).toString('hex')}`;
}

async function createSandbox(host: SandboxHost, args: Args): Promise<ToolResult> {
   const plan = createPlan(args);
   if ('error' in plan) return text(plan.error, true);
   const requested = str(args.id);
   if (requested) {
      if (!(await host.running(requested))) return text(`sandbox ${requested} not found or not running`, true);
      return text(`Reusing existing sandbox ${requested}`);
   }
   let failure = 'Failed to create sandbox';
   for (let attempt = 0; attempt < 3; attempt += 1) {
      const id = newSandboxId();
      try {
         await host.start(id, plan.idleMs);
         return text(`Created new sandbox ${id}`);
      } catch (error) {
         failure = error instanceof Error ? error.message : failure;
      }
   }
   return text(failure, true);
}

/** The checks the create call makes before a container is started. `idleMs` is how long it may sit unused. */
export function createPlan(args: Args): { error: string } | { idleMs: number } {
   const build = args.buildInfo != null && typeof args.buildInfo === 'object';
   const snapshot = str(args.snapshot);
   if (build && snapshot) return { error: 'cannot specify a snapshot when using a build info entry' };
   const resources = ['cpu', 'gpu', 'memory', 'disk'].some((key) => args[key] != null);
   if (!build && resources) return { error: 'cannot specify sandbox resources when using a snapshot' };
   if (build) return { error: 'this runtime session host does not build images' };
   if (snapshot) return { error: 'this runtime session host uses its runtime image and does not accept a snapshot' };
   const pause = num(args.autoPauseInterval);
   const stop = num(args.autoStopInterval) ?? 15;
   const ttl = num(args.ttlMinutes);
   const queue = num(args.queueTimeout);
   const deleteAfter = num(args.autoDeleteInterval);
   if (pause !== undefined && pause < 0) return { error: 'autoPauseInterval must be a non-negative integer' };
   if (stop < 0) return { error: 'autoStopInterval must be a non-negative integer' };
   if (ttl !== undefined && ttl < 0) return { error: 'ttlMinutes must be a non-negative integer' };
   if (queue !== undefined && queue < 1) return { error: 'queueTimeout must be a positive integer' };
   if (pause !== undefined && pause > 0 && stop > 0) {
      return { error: 'autoStopInterval and autoPauseInterval are mutually exclusive. Set at most one of them to a non-zero value' };
   }
   if (pause !== undefined && pause > 0 && deleteAfter === 0) {
      return { error: 'ephemeral sandboxes cannot have auto-pause enabled. Set autoPauseInterval to 0' };
   }
   if (pause !== undefined && pause > 0) return { error: 'this runtime session host does not pause sandboxes' };
   if (bool(args.kvm) === true) return { error: 'this runtime session host does not expose KVM' };
   if (bool(args.networkBlockAll) === true) return { error: 'this runtime session host does not block the sandbox network' };
   const network = str(args.networkAllowList);
   const domain = str(args.domainAllowList);
   if (network && domain) {
      return { error: 'networkAllowList and domainAllowList are mutually exclusive and cannot be set at the same time. Provide only one of them' };
   }
   if (network || domain) return { error: 'this runtime session host does not apply network allow lists' };
   return { idleMs: stop === 0 ? 0 : stop * 60_000 };
}

async function destroySandbox(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = str(args.id);
   if (!id) return text('sandbox ID is required', true);
   if (!(await host.running(id))) return text(`sandbox ${id} not found or not running`, true);
   let failure = `Failed to destroy sandbox ${id}`;
   for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
         await host.destroy(id);
         return text(`Destroyed sandbox with ID ${id}`);
      } catch (error) {
         failure = error instanceof Error ? error.message : failure;
      }
   }
   return text(failure, true);
}

async function executeCommand(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const command = str(args.command);
   if (!command) return text('Command must be a non-empty string', true);
   const result = await host.exec(id, ['/bin/sh', '-c', command]);
   if (result.exitCode !== 0 && result.stdout === '' && /no such container|cannot run a command/i.test(result.stderr)) {
      return text(`Failed to connect to sandbox toolbox: ${result.stderr.trim()}`, true);
   }
   return text(JSON.stringify({ stdout: result.stdout.trim(), stderr: result.stderr.trim(), exitCode: result.exitCode }, null, 2));
}

async function createFolder(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const folder = str(args.folderPath);
   if (!folder) return text('folderPath parameter is required', true);
   const mode = str(args.mode) || '0755';
   const result = await node(host, id, FOLDER, [folder, mode]);
   if (result.exitCode !== 0) return text(`Failed to create folder: ${result.stderr.trim() || result.stdout.trim()}`, true);
   return text(`Created folder: ${folder}`);
}

async function removePath(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const file = str(args.filePath);
   if (!file) return text('filePath parameter is required', true);
   const result = await node(host, id, REMOVE, [file]);
   if (result.exitCode !== 0) return text(`Failed to delete file: ${result.stderr.trim() || result.stdout.trim()}`, true);
   return text(`Deleted file: ${file}`);
}

async function listFiles(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const dir = str(args.path) || '.';
   const result = await node(host, id, LIST, [dir]);
   if (result.exitCode !== 0) return text(`Failed to list files: ${result.stderr.trim() || result.stdout.trim()}`, true);
   return text(result.stdout);
}

async function fileInfo(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const file = str(args.filePath);
   if (!file) return text('filePath parameter is required', true);
   const result = await node(host, id, INFO, [file]);
   if (result.exitCode !== 0) return text(`Failed to get file info: ${result.stderr.trim() || result.stdout.trim()}`, true);
   return text(result.stdout);
}

async function moveFile(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const source = str(args.sourcePath);
   const dest = str(args.destPath);
   if (!source) return text('sourcePath parameter is required', true);
   if (!dest) return text('destPath parameter is required', true);
   const result = await node(host, id, MOVE, [source, dest]);
   if (result.exitCode !== 0) return text(`Failed to move file: ${result.stderr.trim() || result.stdout.trim()}`, true);
   return text(`Moved file from ${source} to ${dest}`);
}

async function uploadFile(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const file = str(args.filePath);
   if (!file) return text('filePath parameter is required', true);
   if (typeof args.content !== 'string' || args.content === '') return text('content parameter is required', true);
   const encoding = str(args.encoding) || 'text';
   if (encoding !== 'text' && encoding !== 'base64') return text('encoding must be text or base64', true);
   if (encoding === 'base64' && !/^[A-Za-z0-9+/]*={0,2}$/.test(args.content.replace(/\s/g, ''))) {
      return text('invalid base64 encoding', true);
   }
   if (encoding === 'base64') {
      try {
         Buffer.from(args.content, 'base64');
      } catch {
         return text('invalid base64 encoding', true);
      }
   }
   const result = await node(host, id, UPLOAD, [file, encoding, bool(args.overwrite) ? '1' : '0'], args.content);
   if (result.exitCode !== 0) return text(result.stderr.trim() || 'Failed to upload file', true);
   return text(`File uploaded successfully: ${file}`);
}

async function downloadFile(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const file = str(args.filePath);
   if (!file) return text('filePath parameter is required', true);
   const result = await node(host, id, DOWNLOAD, [file]);
   if (result.exitCode !== 0) return text(`Failed to download file: ${result.stderr.trim() || result.stdout.trim()}`, true);
   const image = /\.(png|jpe?g|gif)$/i.exec(file);
   if (image) {
      const mime = image[1]?.toLowerCase() === 'png' ? 'image/png' : image[1]?.toLowerCase() === 'gif' ? 'image/gif' : 'image/jpeg';
      return { content: [{ type: 'image', mimeType: mime, data: result.stdout.trim() }], isError: false };
   }
   return text(result.stdout);
}

async function gitClone(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const url = str(args.url);
   if (!url) return text('url parameter is required', true);
   let remote = url;
   const username = str(args.username);
   const password = str(args.password);
   if (username || password) {
      try {
         const parsed = new URL(url);
         if (username) parsed.username = username;
         if (password) parsed.password = password;
         remote = parsed.toString();
      } catch {
         return text('url parameter is required', true);
      }
   }
   const dest = str(args.path) || '.';
   const argv = ['git', 'clone'];
   const branch = str(args.branch);
   if (branch) argv.push('--branch', branch);
   argv.push(remote, dest);
   const cloned = await host.exec(id, argv);
   if (cloned.exitCode !== 0) return text(`Failed to clone repository: ${cloned.stderr.trim() || cloned.stdout.trim()}`, true);
   const commit = str(args.commitId);
   if (commit) {
      const checked = await host.exec(id, ['git', '-C', dest, 'checkout', commit]);
      if (checked.exitCode !== 0) return text(`Failed to clone repository: ${checked.stderr.trim() || checked.stdout.trim()}`, true);
   }
   return text(`Cloned repository: ${url} to ${dest}`);
}

async function previewLink(host: SandboxHost, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   const port = num(args.port);
   if (port === undefined) return text('port parameter is required', true);
   if (bool(args.checkServer)) {
      const probe = await host.exec(id, ['/bin/sh', '-c', `curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:${port} --max-time 2 || echo error`]);
      const response = probe.stdout.trim();
      if (response === 'error' || response.startsWith('0')) {
         const processes = await host.exec(id, ['/bin/sh', '-c', `ps aux | grep ':${port}' | grep -v grep || echo 'No process found'`]);
         return text(`no server detected on port ${port}. Process info: ${processes.stdout.trim()}`, true);
      }
   }
   const url = await host.previewUrl(id, port);
   if (!url) return text(`no preview URL for port ${port}. This session publishes 8080.`, true);
   return text(`Preview link generated: ${url}`);
}

async function computerUse(host: SandboxHost, name: string, args: Args): Promise<ToolResult> {
   const id = await requireRunning(host, args.id);
   if (typeof id !== 'string') return id;
   if (name.startsWith('computer_use_accessibility_')) {
      return text('the accessibility bridge is not available in this runtime session', true);
   }
   const script = computerScript(name, args);
   if (!script) return text(`unknown tool ${name}`, true);
   const result = await host.exec(id, ['/bin/sh', '-c', script]);
   if (result.exitCode !== 0) return text(result.stderr.trim() || result.stdout.trim() || `Failed to ${name.replaceAll('_', ' ')}`, true);
   if (name.includes('screenshot')) {
      return { content: [{ type: 'image', mimeType: 'image/png', data: result.stdout.trim() }], isError: false };
   }
   return text(result.stdout.trim() || 'ok');
}

function computerScript(name: string, args: Args): string | null {
   const display = 'DISPLAY=:99';
   switch (name) {
      case 'computer_use_start':
         return 'command -v Xvfb >/dev/null || { echo "Xvfb is not installed in this runtime image" >&2; exit 127; }\n' +
            'pgrep -f "Xvfb :99" >/dev/null || setsid Xvfb :99 -screen 0 1280x800x24 -ac >/tmp/berry-xvfb.log 2>&1 < /dev/null &\n' +
            'command -v openbox >/dev/null && pgrep -x openbox >/dev/null || setsid env DISPLAY=:99 openbox >/tmp/berry-openbox.log 2>&1 < /dev/null &\n' +
            'sleep 0.2; echo \'{"status":"started","display":":99"}\'';
      case 'computer_use_stop':
         return 'pkill -f "Xvfb :99" || true; pkill -x openbox || true; echo \'{"status":"stopped"}\'';
      case 'computer_use_status':
         return 'if pgrep -f "Xvfb :99" >/dev/null; then echo \'{"status":"started","display":":99"}\'; else echo \'{"status":"stopped"}\'; fi';
      case 'computer_use_display_info':
         return `${display} xdpyinfo | awk '/dimensions/{print}'`;
      case 'computer_use_windows':
         return `${display} xwininfo -root -tree`;
      case 'computer_use_screenshot':
         return `${display} scrot -o /tmp/berry-shot.png && base64 -w0 /tmp/berry-shot.png`;
      case 'computer_use_screenshot_region':
         return `${display} scrot -a ${Math.floor(num(args.x) ?? 0)},${Math.floor(num(args.y) ?? 0)},${Math.floor(num(args.width) ?? 1)},${Math.floor(num(args.height) ?? 1)} -o /tmp/berry-shot.png && base64 -w0 /tmp/berry-shot.png`;
      case 'computer_use_mouse_move':
         return `${display} xdotool mousemove ${Math.floor(num(args.x) ?? 0)} ${Math.floor(num(args.y) ?? 0)}`;
      case 'computer_use_mouse_click': {
         const button = str(args.button) === 'right' ? 3 : str(args.button) === 'middle' ? 2 : 1;
         const times = bool(args.double) ? '--repeat 2 --delay 50' : '';
         return `${display} xdotool mousemove ${Math.floor(num(args.x) ?? 0)} ${Math.floor(num(args.y) ?? 0)} click ${times} ${button}`;
      }
      case 'computer_use_mouse_drag': {
         const button = str(args.button) === 'right' ? 3 : str(args.button) === 'middle' ? 2 : 1;
         return `${display} xdotool mousemove ${Math.floor(num(args.startX) ?? 0)} ${Math.floor(num(args.startY) ?? 0)} mousedown ${button} mousemove ${Math.floor(num(args.endX) ?? 0)} ${Math.floor(num(args.endY) ?? 0)} mouseup ${button}`;
      }
      case 'computer_use_mouse_scroll': {
         const amount = Math.floor(num(args.amount) ?? 3);
         const dir = str(args.direction) === 'up' ? 4 : 5;
         return `${display} xdotool mousemove ${Math.floor(num(args.x) ?? 0)} ${Math.floor(num(args.y) ?? 0)} click --repeat ${amount} ${dir}`;
      }
      case 'computer_use_mouse_position':
         return `${display} xdotool getmouselocation --shell`;
      case 'computer_use_keyboard_type':
         return `${display} xdotool type --delay ${Math.floor(num(args.delay) ?? 12)} -- ${shellQuote(typeof args.text === 'string' ? args.text : '')}`;
      case 'computer_use_keyboard_press':
         return `${display} xdotool key ${shellQuote(str(args.key))}`;
      case 'computer_use_keyboard_hotkey':
         return `${display} xdotool key ${shellQuote(str(args.hotkey))}`;
      case 'computer_use_recording_start': {
         const label = str(args.label).replace(/[^A-Za-z0-9_-]/g, '') || 'screen';
         return `id=$(date +%s)-${label}; setsid ${display} ffmpeg -y -f x11grab -video_size 1280x800 -i :99 /tmp/berry-rec-$id.mp4 >/tmp/berry-rec-$id.log 2>&1 < /dev/null & echo $!; echo $id > /tmp/berry-rec-last; echo "{\\"id\\":\\"$id\\",\\"status\\":\\"recording\\"}"`;
      }
      case 'computer_use_recording_stop':
         return `id=${shellQuote(str(args.recordingId))}; pkill -f "berry-rec-$id.mp4" || true; echo "{\\"id\\":$id,\\"status\\":\\"stopped\\",\\"path\\":\\"/tmp/berry-rec-$id.mp4\\"}"`;
      case 'computer_use_recording_list':
         return 'ls -1 /tmp/berry-rec-*.mp4 2>/dev/null || true';
      case 'computer_use_recording_get':
         return `id=${shellQuote(str(args.recordingId))}; ls -l /tmp/berry-rec-$id.mp4`;
      case 'computer_use_recording_delete':
         return `id=${shellQuote(str(args.recordingId))}; rm -f /tmp/berry-rec-$id.mp4 /tmp/berry-rec-$id.log; echo deleted`;
      default:
         return null;
   }
}

async function requireRunning(host: SandboxHost, value: unknown): Promise<string | ToolResult> {
   const id = str(value);
   if (!id) return text('Sandbox ID is required', true);
   if (!(await host.running(id))) return text(`Sandbox ${id} is not started`, true);
   return id;
}

function node(host: SandboxHost, id: string, source: string, argv: string[], stdin?: string): Promise<ExecResult> {
   return host.exec(id, ['node', '-e', source, ...argv], stdin);
}

function shellQuote(value: string): string {
   return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

const STAT = `
const fs = require('fs');
const path = require('path');
function info(full) {
  const st = fs.lstatSync(full);
  return {
    name: path.basename(full),
    path: full,
    isDir: st.isDirectory(),
    size: st.size,
    mode: (st.mode & 0o777).toString(8).padStart(4, '0'),
    permissions: (st.mode & 0o777).toString(8),
    modTime: st.mtime.toString(),
    modifiedAt: st.mtime.toISOString(),
    owner: String(st.uid),
    group: String(st.gid),
  };
}
`;

const LIST = `${STAT}
const dir = process.argv[1];
const names = fs.readdirSync(dir);
process.stdout.write(JSON.stringify(names.map((name) => info(path.join(dir, name))), null, 2));
`;

const INFO = `${STAT}
process.stdout.write(JSON.stringify(info(process.argv[1]), null, 2));
`;

const FOLDER = `
const fs = require('fs');
fs.mkdirSync(process.argv[1], { recursive: true, mode: parseInt(process.argv[2], 8) });
`;

const REMOVE = `
const fs = require('fs');
fs.rmSync(process.argv[1], { recursive: true });
`;

const MOVE = `
const fs = require('fs');
fs.renameSync(process.argv[1], process.argv[2]);
`;

const UPLOAD = `
const fs = require('fs');
const path = require('path');
const dest = process.argv[1];
const encoding = process.argv[2];
const overwrite = process.argv[3] === '1';
if (!overwrite && fs.existsSync(dest)) {
  console.error("file '" + dest + "' already exists and overwrite=false");
  process.exit(2);
}
fs.mkdirSync(path.dirname(dest), { recursive: true });
const chunks = [];
process.stdin.on('data', (chunk) => chunks.push(chunk));
process.stdin.on('end', () => {
  const raw = Buffer.concat(chunks);
  const body = encoding === 'base64' ? Buffer.from(raw.toString('utf8'), 'base64') : raw;
  fs.writeFileSync(dest, body);
});
`;

const DOWNLOAD = `
const fs = require('fs');
const file = process.argv[1];
if (/\\.(png|jpe?g|gif)$/i.test(file)) process.stdout.write(fs.readFileSync(file).toString('base64'));
else process.stdout.write(fs.readFileSync(file));
`;

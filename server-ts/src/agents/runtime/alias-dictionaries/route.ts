/**
 * How a native name is served on Berry's MCP server.
 *
 * An entry with a route is registered under its certain names, and the call
 * is translated into the Berry tool the route names. An entry without one is
 * documentation: the runtime's own tool, which Berry neither offers nor runs.
 *
 * - read: read_repository_file, or read_file when the run has no checkout
 * - list: browse_repository at a path
 * - glob: browse_repository under the pattern's fixed prefix
 * - grep: a grep through run_command
 * - write: write_file (a str_replace command inside it is edit_file)
 * - replace: edit_file
 * - delete: delete_file
 * - shell: run_command
 * - fetch: fetch_url
 * - patch: Codex's apply_patch, applied through write_file, edit_file, delete_file and move_file
 */
export type AliasRoute = 'read' | 'list' | 'glob' | 'grep' | 'write' | 'replace' | 'delete' | 'shell' | 'fetch' | 'patch';

/**
 * Berry's file tools, called by these names on every runtime.
 *
 * A native file tool this runtime supports is an alias of one of these.
 * `list_run_tools` names it. A role that does not have one is still refused
 * by the permission check; this list does not grant it.
 */
export function berryFileToolsContract(): string {
   return (
      '\n\nFiles\n' +
      'Call these by these names. A native file tool this runtime supports is an alias of one of these, and list_run_tools names it. ' +
      'A tool this role does not have is refused, and that refusal is the answer.\n' +
      '- list_files: the files saved on a task. Defaults to this task. Pass `task` to list a parent or a task this one depends on.\n' +
      '- read_file: one of those files, by `path`. A long file returns `nextFrom`; pass that as `from` only if you need the rest.\n' +
      '- write_file: write text into the checkout at a relative path such as src/maze.ts. The next command sees it there. Subdirectories are created. Use it to create a file or replace it entirely.\n' +
      '- edit_file: change part of a file already in the checkout. Pass `path`, `old` (the exact text to replace, including spaces and line breaks, matching once) and `new` (what replaces it). Do not send the whole file. If `old` is missing or matches more than once, read the file and send a longer span.\n' +
      '- collect_file: save a file a command produced (a clip, a build, an archive) onto the task, by its path in the workspace. The workspace is gone when the run ends, and only a collected file survives it.\n' +
      '- attach_file: attach a binary, as base64, only when you have no workspace. A file already in the workspace goes on the task with collect_file.\n' +
      '- read_skill: open a skill named in this task, by `name`.\n' +
      '- browse_repository and read_repository_file: read the repository when you have no shell. Neither writes.\n' +
      '- check_page: the page at phone, tablet and desktop, with the console errors it met. check_performance: its scores and budget. Both serve a folder for you. Do not start a web server.\n'
   );
}

/**
 * Programs the runtime image puts on PATH.
 *
 * Every agent runtime — the AgentCore image and each subscription CLI — runs
 * commands in that same sandbox, through `run_command`. The task prompt names
 * them, and `list_run_tools` repeats the ones that are not native aliases.
 * A role that has no `run_command` is still refused by the permission check;
 * this list does not grant the tool.
 *
 * Kept in step with `server-ts/sandbox/agentcore/Dockerfile`. The POSIX tools
 * are the ones Debian's slim image already carries; the rest are installed
 * there on purpose. `SANDBOX_COMMANDS` is that same list, in the same order.
 */
export const SANDBOX_COMMANDS: readonly string[] = [
   'git',
   'node',
   'npm',
   'npx',
   'pnpm',
   'yarn',
   'bun',
   'bunx',
   'nvm',
   'python',
   'python3',
   'pip',
   'make',
   'gcc',
   'g++',
   'tar',
   'unzip',
   'file',
   'curl',
   'ps',
   'pkill',
   'ffmpeg',
   'playwright',
   'chromium',
   'berry-screenshots',
   'berry-lighthouse',
   'expo',
   'bash',
   'ls',
   'cat',
   'cp',
   'mv',
   'rm',
   'mkdir',
   'ln',
   'chmod',
   'touch',
   'pwd',
   'test',
   'printf',
   'echo',
   'env',
   'head',
   'tail',
   'grep',
   'sed',
   'awk',
   'find',
   'xargs',
   'sort',
   'uniq',
   'wc',
   'diff',
   'tr',
   'cut',
   'tee',
   'basename',
   'dirname',
   'readlink',
   'stat',
   'uname',
   'date',
   'id',
   'sleep',
];

export function sandboxCommandsContract(): string {
   return (
      '\n\nCommands in the sandbox\n' +
      'Every runtime uses this same sandbox. Run a command with run_command. ' +
      'Call list_run_tools to list the native aliases this runtime supports and these programs. ' +
      'Do not call tool_load, tool_call, or a powers interface.\n' +
      'These programs are on PATH:\n' +
      '- Version control: git\n' +
      '- Node: node, npm, npx, pnpm, yarn, bun, bunx, nvm\n' +
      '- Python: python, python3, pip\n' +
      '- Build: make, gcc, g++\n' +
      '- Archives and inspection: tar, unzip, file\n' +
      '- Network: curl\n' +
      '- Processes: ps, pkill\n' +
      '- Media: ffmpeg\n' +
      '- Pages: playwright (require(\'playwright\') in a CommonJS script; Chromium is already on PLAYWRIGHT_BROWSERS_PATH), chromium, berry-screenshots, berry-lighthouse, expo\n' +
      '- Shell and files, the POSIX tools the image carries: bash, ls, cat, cp, mv, rm, mkdir, ln, chmod, touch, pwd, test, printf, echo, env, head, tail, grep, sed, awk, find, xargs, sort, uniq, wc, diff, tr, cut, tee, basename, dirname, readlink, stat, uname, date, id, sleep\n' +
      'A program that is not named here is not part of the sandbox. Do not apt-get install, do not install a browser, and do not search the filesystem for Playwright or Chromium.\n'
   );
}

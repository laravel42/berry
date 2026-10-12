// Runs one executable from the desktop main process. The command is an
// argv program, never a shell line, so a page cannot sneak in pipes or
// substitution.

import { spawn } from 'node:child_process';
import path from 'node:path';

const MAX_COMMAND = 4096;
const MAX_ARGS = 64;
const MAX_ARG = 32_768;
const MAX_OUTPUT = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 10 * 60_000;

export class CliRejected extends Error {
   constructor(message: string) {
      super(message);
      this.name = 'CliRejected';
    }
}

export type CliRequest = {
   command: string;
   args?: readonly string[];
   cwd?: string;
   timeoutMs?: number;
   env?: Readonly<Record<string, string>>;
};

export type CliResult = {
   code: number | null;
   signal: NodeJS.Signals | null;
   stdout: string;
   stderr: string;
   timedOut: boolean;
   truncated: boolean;
};

export function cliRequestFrom(value: unknown): CliRequest {
   if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new CliRejected('CLI request must be an object.');
   }
   const record = value as Record<string, unknown>;
   if (typeof record.command !== 'string') throw new CliRejected('Command must be a string.');
   const request: CliRequest = { command: record.command };
   if (record.args !== undefined) {
      if (!Array.isArray(record.args) || record.args.some((arg) => typeof arg !== 'string')) {
         throw new CliRejected('Arguments must be strings.');
      }
      request.args = record.args as string[];
   }
   if (record.cwd !== undefined) {
      if (typeof record.cwd !== 'string') throw new CliRejected('Working directory must be a string.');
      request.cwd = record.cwd;
   }
   if (record.timeoutMs !== undefined) {
      if (typeof record.timeoutMs !== 'number' || !Number.isFinite(record.timeoutMs)) {
         throw new CliRejected('Timeout must be a number of milliseconds.');
      }
      request.timeoutMs = record.timeoutMs;
   }
   if (record.env !== undefined) {
      if (record.env === null || typeof record.env !== 'object' || Array.isArray(record.env)) {
         throw new CliRejected('Environment overrides must be an object.');
      }
      const env: Record<string, string> = {};
      for (const [key, item] of Object.entries(record.env)) {
         if (typeof item !== 'string') throw new CliRejected('Environment values must be strings.');
         env[key] = item;
      }
      request.env = env;
   }
   return request;
}

function assertCommand(command: string): string {
   const trimmed = command.trim();
   if (trimmed.length === 0 || trimmed.length > MAX_COMMAND) {
      throw new CliRejected('Command must be a single executable.');
   }
   if (/[\0\r\n\s;&|`$<>]/.test(trimmed)) {
      throw new CliRejected('Command must be an executable name, not a shell line.');
   }
   const hasSeparator = trimmed.includes('/') || trimmed.includes('\\');
   if (hasSeparator && !path.isAbsolute(trimmed)) {
      throw new CliRejected('A path command must be absolute.');
   }
   return trimmed;
}

function assertArgs(args: readonly string[]): string[] {
   if (args.length > MAX_ARGS) throw new CliRejected('Too many arguments.');
   return args.map((arg) => {
      if (arg.includes('\0') || arg.length > MAX_ARG) throw new CliRejected('An argument is not usable.');
      return arg;
   });
}

function assertCwd(cwd: string | undefined): string | undefined {
   if (cwd === undefined) return undefined;
   if (!path.isAbsolute(cwd) || cwd.includes('\0')) {
      throw new CliRejected('Working directory must be an absolute path.');
   }
   return cwd;
}

function assertTimeout(timeoutMs: number | undefined): number {
   const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;
   if (!Number.isInteger(timeout) || timeout < 1 || timeout > MAX_TIMEOUT_MS) {
      throw new CliRejected('Timeout must be between 1 ms and 10 minutes.');
   }
   return timeout;
}

function childEnv(overrides: Readonly<Record<string, string>> | undefined): NodeJS.ProcessEnv {
   const env: NodeJS.ProcessEnv = { ...process.env };
   if (overrides === undefined) return env;
   for (const [key, value] of Object.entries(overrides)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
         throw new CliRejected('An environment name is not usable.');
      }
      env[key] = value;
   }
   return env;
}

function take(chunks: Buffer[], next: Buffer, used: { bytes: number }): boolean {
   const room = MAX_OUTPUT - used.bytes;
   if (room <= 0) return true;
   if (next.length <= room) {
      chunks.push(next);
      used.bytes += next.length;
      return false;
   }
   chunks.push(next.subarray(0, room));
   used.bytes += room;
   return true;
}

export function runCli(request: CliRequest): Promise<CliResult> {
   const command = assertCommand(request.command);
   const args = assertArgs(request.args ?? []);
   const cwd = assertCwd(request.cwd);
   const timeoutMs = assertTimeout(request.timeoutMs);
   const env = childEnv(request.env);

   return new Promise((resolve) => {
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      const used = { bytes: 0 };
      let truncated = false;
      let timedOut = false;
      let settled = false;

      const child = spawn(command, args, {
         cwd,
         env,
         shell: false,
         windowsHide: true,
         stdio: ['ignore', 'pipe', 'pipe'],
      });

      const finish = (code: number | null, signal: NodeJS.Signals | null): void => {
         if (settled) return;
         settled = true;
         clearTimeout(timer);
         resolve({
            code,
            signal,
            stdout: Buffer.concat(stdout).toString('utf8'),
            stderr: Buffer.concat(stderr).toString('utf8'),
            timedOut,
            truncated,
         });
      };

      const stop = (): void => {
         truncated = true;
         child.kill('SIGTERM');
      };

      child.stdout.on('data', (chunk: Buffer) => {
         if (take(stdout, chunk, used)) stop();
      });
      child.stderr.on('data', (chunk: Buffer) => {
         if (take(stderr, chunk, used)) stop();
      });
      child.on('error', (error: NodeJS.ErrnoException) => {
         stderr.push(Buffer.from(error.code === 'ENOENT' ? 'Executable was not found.' : error.message));
         finish(null, null);
      });
      child.on('close', (code, signal) => {
         finish(code, signal);
      });

      const timer = setTimeout(() => {
         timedOut = true;
         child.kill('SIGTERM');
         setTimeout(() => {
            if (!settled) child.kill('SIGKILL');
         }, 1000).unref();
      }, timeoutMs);
   });
}

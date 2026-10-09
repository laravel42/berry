import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
   runtimeControlResponseSchema,
   type RuntimeControlRequest,
   type RuntimeControlResponse,
   type TaskEnvelope,
} from './envelope.ts';
import { isTerminal, LifecycleStreamError, lifecycleEventSchema, type LifecycleEvent } from './lifecycle.ts';
import { RuntimeUnavailable } from './transport.ts';

const HOST = fileURLToPath(new URL('../agents/runtime/workstation/host.ts', import.meta.url));

/** Names the workstation process may inherit. The API key travels on stdin, not in the environment. */
const INHERITED = new Set([
   'PATH',
   'HOME',
   'USER',
   'LOGNAME',
   'SHELL',
   'LANG',
   'LC_ALL',
   'LC_CTYPE',
   'TMPDIR',
   'NODE_EXTRA_CA_CERTS',
   'SSL_CERT_FILE',
   'SSL_CERT_DIR',
]);

export interface WorkstationKiro {
   control(request: RuntimeControlRequest, signal?: AbortSignal): Promise<RuntimeControlResponse>;
   invoke(envelope: TaskEnvelope, signal: AbortSignal): AsyncIterable<LifecycleEvent>;
}

export interface WorkstationKiroOptions {
   /** Defaults to this Node binary running the workstation host. */
   command?: string;
   args?: string[];
   /**
    * Where this process calls Berry's tool API. The container callback
    * (`host.docker.internal`) does not resolve on the workstation, and this
    * process is a child of the server, so the address is loopback.
    */
   callbackUrl?: string;
}

/** Runs Kiro on this machine. The runtime container is not asked to start `kiro-cli`. */
export function workstationKiro(options: WorkstationKiroOptions = {}): WorkstationKiro {
   const command = options.command ?? process.execPath;
   const args = options.args ?? ['--experimental-strip-types', HOST];
   const callbackUrl = options.callbackUrl;
   return {
      control(request, signal = AbortSignal.timeout(120_000)) {
         return collect(command, args, { control: request }, signal).then((stdout) => {
            let parsed: unknown;
            try {
               parsed = JSON.parse(stdout.trim());
            } catch {
               throw new RuntimeUnavailable('The workstation process returned a control response Berry could not read.');
            }
            const response = runtimeControlResponseSchema.safeParse(parsed);
            if (!response.success) {
               throw new RuntimeUnavailable('The workstation process returned a control response Berry could not read.');
            }
            return response.data;
         });
      },
      async *invoke(envelope, signal) {
         const body = callbackUrl
            ? { ...envelope, berry: { ...envelope.berry, apiUrl: callbackUrl } }
            : envelope;
         yield* stream(command, args, body, signal);
      },
   };
}

function inheritedEnv(): NodeJS.ProcessEnv {
   const env: NodeJS.ProcessEnv = {};
   for (const name of INHERITED) {
      const value = process.env[name];
      if (value) env[name] = value;
   }
   return env;
}

function collect(command: string, args: string[], body: unknown, signal: AbortSignal): Promise<string> {
   return new Promise((resolve, reject) => {
      const child = spawn(command, args, { env: inheritedEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      const stop = () => child.kill('SIGTERM');
      signal.addEventListener('abort', stop, { once: true });
      child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
      child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
      child.on('error', (error) => {
         signal.removeEventListener('abort', stop);
         reject(new RuntimeUnavailable(`could not start Kiro on this workstation: ${error.message}`));
      });
      child.on('close', (code) => {
         signal.removeEventListener('abort', stop);
         if (signal.aborted) {
            reject(new RuntimeUnavailable('The workstation process was stopped.'));
            return;
         }
         if (code !== 0 && out.length === 0) {
            reject(new RuntimeUnavailable(tail(err) || `The workstation process exited ${code ?? 'without a status'}.`));
            return;
         }
         resolve(Buffer.concat(out).toString('utf8'));
      });
      child.stdin.end(JSON.stringify(body));
   });
}

async function* stream(command: string, args: string[], body: unknown, signal: AbortSignal): AsyncGenerator<LifecycleEvent> {
   const child = spawn(command, args, { env: inheritedEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
   child.on('error', (error) => child.stdout.destroy(error));
   const stop = () => child.kill('SIGTERM');
   signal.addEventListener('abort', stop, { once: true });
   child.stdin.end(JSON.stringify(body));
   const stderr: Buffer[] = [];
   child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
   let buffer = '';
   let failed = false;
   let terminal = false;
   const give = (line: string): LifecycleEvent => {
      const event = parseEvent(line);
      if (isTerminal(event)) terminal = true;
      return event;
   };
   try {
      for await (const chunk of child.stdout) {
         buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
         let newline = buffer.indexOf('\n');
         while (newline !== -1) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (line) yield give(line);
            newline = buffer.indexOf('\n');
         }
      }
      const rest = buffer.trim();
      if (rest) yield give(rest);
   } catch (error) {
      failed = true;
      child.kill('SIGTERM');
      throw error;
   } finally {
      signal.removeEventListener('abort', stop);
      if (!failed) {
         const code = await exited(child);
         if (signal.aborted) throw new RuntimeUnavailable('The workstation process was stopped.');
         if (code !== 0 && !terminal) {
            throw new RuntimeUnavailable(tail(stderr) || `The workstation process exited ${code ?? 'without a status'}.`);
         }
      }
   }
}

function parseEvent(line: string): LifecycleEvent {
   let parsed: unknown;
   try {
      parsed = JSON.parse(line);
   } catch {
      throw new LifecycleStreamError('The workstation process wrote a lifecycle event Berry could not read.');
   }
   const event = lifecycleEventSchema.safeParse(parsed);
   if (!event.success) throw new LifecycleStreamError('The workstation process wrote a lifecycle event Berry could not read.');
   return event.data;
}

function exited(child: ReturnType<typeof spawn>): Promise<number | null> {
   if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(child.exitCode);
   return new Promise((resolve) => child.once('close', (code) => resolve(code)));
}

function tail(chunks: Buffer[]): string {
   return chunks
      .join('')
      .replace(/ksk_[A-Za-z0-9_-]+/g, '[redacted]')
      .trim()
      .slice(-500);
}

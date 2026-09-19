import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import type { SessionContainers } from './router.ts';

/**
 * A session's container, through the Docker CLI.
 *
 * Every container is the ordinary runtime image, started the way
 * `scripts/runtime-docker.sh` starts the single one — root stripped to the
 * capabilities that handing out an unprivileged user takes, the runtime's own
 * short list of variables, sessions isolated — with two differences that make
 * it a session's own:
 *
 *   * It mounts only its sub-folder of the workspace volume, at the path the
 *     runtime already uses (`/mnt/workspace/<session>`). The workspaces that
 *     exist keep working; no container can see another's.
 *   * It gets a memory, CPU and process ceiling, so one session's build
 *     cannot starve the rest.
 *
 * The published port is loopback and chosen by Docker; the label is how a
 * restarted router finds what an earlier one left running.
 */

export const SESSION_LABEL = 'berry.runtime.session';

export interface DockerContainersOptions {
   image: string;
   volume: string;
   /** The filtered env file the launcher wrote: the runtime's variables, nothing else. */
   envFile: string;
   memory: string;
   cpus: string;
   pidsLimit: number;
   readyTimeoutMs?: number;
   /** Runs `docker <args>` and resolves with stdout. Injected by tests. */
   docker?: (args: string[]) => Promise<string>;
   fetch?: typeof fetch;
}

/** Docker names are short and lowercase; the session id is neither. Stable, and unique enough to collide never. */
export function containerName(session: string): string {
   return `berry-rt-${createHash('sha256').update(session).digest('hex').slice(0, 24)}`;
}

export function runArgs(options: DockerContainersOptions, session: string): string[] {
   return [
      'run', '--detach', '--rm', '--init',
      '--name', containerName(session),
      '--label', `${SESSION_LABEL}=${session}`,
      '--publish', '127.0.0.1::8080',
      '--env-file', options.envFile,
      '--env', 'PORT=8080',
      '--env', 'BERRY_RUNTIME_WORK_ROOT=/mnt/workspace',
      '--env', 'BERRY_RUNTIME_ISOLATE_SESSIONS=true',
      '--user', '0:0',
      '--cap-drop', 'ALL',
      ...['SETUID', 'SETGID', 'CHOWN', 'DAC_OVERRIDE', 'FOWNER', 'KILL'].flatMap((cap) => ['--cap-add', cap]),
      '--security-opt', 'no-new-privileges',
      '--memory', options.memory,
      '--cpus', options.cpus,
      '--pids-limit', String(options.pidsLimit),
      '--mount', `type=volume,src=${options.volume},dst=/mnt/workspace/${session},volume-subpath=${session}`,
      options.image,
   ];
}

export function dockerContainers(options: DockerContainersOptions): SessionContainers {
   const docker = options.docker ?? cli;
   const doFetch = options.fetch ?? fetch;
   const timeout = options.readyTimeoutMs ?? 30_000;

   const origin = async (session: string): Promise<string | null> => {
      // `docker port` fails for a container that is not running, which is the answer.
      const out = await docker(['port', containerName(session), '8080/tcp']).catch(() => '');
      const port = /:(\d+)\s*$/m.exec(out.trim().split('\n')[0] ?? '')?.[1];
      return port ? `http://127.0.0.1:${port}` : null;
   };

   const ready = async (url: string): Promise<void> => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
         const ok = await doFetch(`${url}/ping`, { signal: AbortSignal.timeout(2_000) }).then((r) => r.ok).catch(() => false);
         if (ok) return;
         await new Promise((resolve) => setTimeout(resolve, 150));
      }
      throw new Error(`the session container did not answer within ${timeout} ms`);
   };

   return {
      async ensure(session) {
         const existing = await origin(session);
         if (existing) {
            await ready(existing);
            return existing;
         }
         // A sub-folder mount needs the folder to exist. Made with the runtime
         // image itself, so nothing else has to be pulled.
         await docker([
            'run', '--rm', '--user', '0:0', '--entrypoint', 'mkdir',
            '--volume', `${options.volume}:/w`, options.image, '-p', `/w/${session}`,
         ]);
         // A container of this name that exited is in the way of the new one.
         await docker(['rm', '--force', containerName(session)]).catch(() => undefined);
         await docker(runArgs(options, session));
         const started = await origin(session);
         if (!started) throw new Error('the session container started without a published port');
         await ready(started);
         return started;
      },
      async stop(session) {
         await docker(['rm', '--force', containerName(session)]);
      },
      async running() {
         const out = await docker(['ps', '--filter', `label=${SESSION_LABEL}`, '--format', `{{.Label "${SESSION_LABEL}"}}`]);
         return out.split('\n').map((line) => line.trim()).filter((line) => line !== '');
      },
   };
}

function cli(args: string[]): Promise<string> {
   return new Promise((resolve, reject) => {
      execFile('docker', args, { maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
         if (error) reject(new Error(`docker ${args[0]}: ${(stderr || error.message).trim().slice(0, 400)}`));
         else resolve(stdout);
      });
   });
}

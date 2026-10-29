import { execFile, type ExecFileException } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A bundled plugin that ships a Dockerfile, started when an agent run needs it.
 *
 * One container per plugin key, shared by every workspace: the plugin holds no
 * workspace state. The listen port comes from the manifest, or Berry assigns
 * one. The published host port is chosen by Docker. A plugin without a
 * Dockerfile is left to the address saved on its installation.
 */

export const PLUGIN_LABEL = 'berry.plugin';

/** Listen port Berry assigns when the manifest does not name one. Each container has its own network, so this port is not shared with the host. */
export const ASSIGNED_PLUGIN_PORT = 8080;

export interface PluginContainerRequest {
   key: string;
   port: number | undefined;
}

export interface PluginContainers {
   /** The origin the process can call, or null when this plugin is not a container. */
   ensure(plugin: PluginContainerRequest): Promise<string | null>;
}

export interface DockerResult {
   code: number;
   output: string;
}

export interface PluginContainersOptions {
   /** The `plugins/` directory. */
   root: string;
   /** Where Docker publishes the port, and where this process reaches it. */
   publishAddr: string;
   hostAddr: string;
   /** The plugin SDK, passed to the image build as the `sdk` context. */
   sdkDir?: string;
   readyTimeoutMs?: number;
   docker?: (args: string[]) => Promise<DockerResult>;
   fetch?: typeof fetch;
}

export function pluginContainers(options: PluginContainersOptions): PluginContainers {
   const docker = options.docker ?? dockerCli;
   const doFetch = options.fetch ?? fetch;
   const timeout = options.readyTimeoutMs ?? 30_000;
   const sdkDir = options.sdkDir ?? join(options.root, '../packages/plugin-sdk');
   const pending = new Map<string, Promise<string | null>>();

   const ensure = (plugin: PluginContainerRequest): Promise<string | null> => {
      const current = pending.get(plugin.key);
      if (current) return current;
      const work = start(plugin).finally(() => {
         if (pending.get(plugin.key) === work) pending.delete(plugin.key);
      });
      pending.set(plugin.key, work);
      return work;
   };

   const start = async (plugin: PluginContainerRequest): Promise<string | null> => {
      const dir = bundledDir(options.root, plugin.key);
      if (!dir) return null;
      const listenPort = plugin.port ?? ASSIGNED_PLUGIN_PORT;
      const name = containerName(plugin.key);
      const image = `berry-plugin-${plugin.key}:local`;
      const running = await origin(docker, name, listenPort, options.hostAddr);
      if (running) {
         await ready(doFetch, running, timeout);
         return running;
      }
      const built = await docker([
         'build',
         '--build-context', `sdk=${sdkDir}`,
         '--tag', image,
         '--file', join(dir, 'Dockerfile'),
         dir,
      ]);
      if (built.code !== 0) {
         throw new Error(`could not build ${plugin.key}: ${built.output.trim().slice(-400) || `docker exited ${built.code}`}`);
      }
      await docker(['rm', '--force', name]).catch(() => undefined);
      const started = await docker([
         'run', '--detach', '--rm', '--init',
         '--name', name,
         '--label', `${PLUGIN_LABEL}=${plugin.key}`,
         '--publish', `${options.publishAddr}::${listenPort}`,
         '--env', `PORT=${listenPort}`,
         '--add-host', 'host.docker.internal:host-gateway',
         '--cap-drop', 'ALL',
         '--security-opt', 'no-new-privileges',
         '--memory', '256m',
         '--pids-limit', '128',
         image,
      ]);
      if (started.code !== 0) {
         throw new Error(`could not start ${plugin.key}: ${started.output.trim().slice(-400) || `docker exited ${started.code}`}`);
      }
      const url = await origin(docker, name, listenPort, options.hostAddr);
      if (!url) throw new Error(`${plugin.key} started without a published port`);
      await ready(doFetch, url, timeout);
      return url;
   };

   return { ensure };
}

/** A loopback Berry address, as a container reaches the host. Other addresses are unchanged. */
export function apiUrlFromContainer(apiUrl: string | null | undefined): string | null {
   if (!apiUrl) return null;
   try {
      const url = new URL(apiUrl);
      if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') url.hostname = 'host.docker.internal';
      return url.toString().replace(/\/$/, '');
   } catch {
      return apiUrl;
   }
}

function containerName(key: string): string {
   return `berry-plugin-${key}`;
}

function bundledDir(root: string, key: string): string | null {
   let names: string[];
   try {
      names = readdirSync(root);
   } catch {
      return null;
   }
   for (const name of names) {
      const dir = join(root, name);
      if (!existsSync(join(dir, 'Dockerfile')) || !existsSync(join(dir, 'manifest.json'))) continue;
      let parsed: unknown;
      try {
         parsed = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
      } catch {
         continue;
      }
      if (parsed && typeof parsed === 'object' && (parsed as { key?: unknown }).key === key) return dir;
   }
   return null;
}

async function origin(docker: (args: string[]) => Promise<DockerResult>, name: string, port: number, hostAddr: string): Promise<string | null> {
   const result = await docker(['port', name, `${port}/tcp`]).catch(() => ({ code: 1, output: '' }));
   const found = /:(\d+)\s*$/m.exec(result.output.trim().split('\n')[0] ?? '')?.[1];
   return result.code === 0 && found ? `http://${hostAddr}:${found}` : null;
}

async function ready(doFetch: typeof fetch, url: string, timeoutMs: number): Promise<void> {
   const deadline = Date.now() + timeoutMs;
   while (Date.now() < deadline) {
      const up = await doFetch(url, { signal: AbortSignal.timeout(2_000) }).then(() => true).catch(() => false);
      if (up) return;
      await new Promise((resolve) => setTimeout(resolve, 150));
   }
   throw new Error(`the plugin container did not answer within ${timeoutMs} ms`);
}

function dockerCli(args: string[]): Promise<DockerResult> {
   const timeout = args[0] === 'build' ? 5 * 60_000 : 60_000;
   return new Promise((resolve) => {
      execFile('docker', args, { maxBuffer: 8 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
         const status = (error as ExecFileException | null)?.status;
         resolve({
            code: typeof status === 'number' ? status : error ? 1 : 0,
            output: `${stdout ?? ''}${stderr ?? ''}`,
         });
      });
   });
}

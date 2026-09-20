import { dockerContainers } from './docker-containers.ts';
import { SessionRouter } from './router.ts';

/**
 * `pnpm runtime:sessions` — started by `scripts/runtime-docker.sh --per-session`,
 * which builds the image and writes the filtered env file this reads.
 */

const env = process.env;
const envFile = env.BERRY_ROUTER_ENV_FILE;
if (!envFile) {
   console.error('BERRY_ROUTER_ENV_FILE is not set; start this through scripts/runtime-docker.sh --per-session');
   process.exit(1);
}

const number = (value: string | undefined, fallback: number): number => {
   const parsed = Number(value);
   return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** An address or a host name and nothing else; anything else is ignored. */
const address = (value: string | undefined): string | null => {
   const trimmed = (value ?? '').trim();
   return /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(trimmed) ? trimmed : null;
};

const log = (message: string, fields: Record<string, unknown> = {}): void => {
   console.log(JSON.stringify({ msg: message, ...fields }));
};

const router = new SessionRouter({
   containers: dockerContainers({
      image: env.BERRY_ROUTER_IMAGE ?? 'berry-agent-runtime',
      volume: env.BERRY_ROUTER_VOLUME ?? 'berry-runtime-work',
      envFile,
      memory: env.BERRY_ROUTER_MEMORY ?? '2g',
      cpus: env.BERRY_ROUTER_CPUS ?? '2',
      pidsLimit: number(env.BERRY_ROUTER_PIDS, 2048),
      ...(address(env.BERRY_DOCKER_PUBLISH_ADDR) ? { publishAddr: address(env.BERRY_DOCKER_PUBLISH_ADDR)! } : {}),
      ...(address(env.BERRY_DOCKER_HOST_ADDR) ? { hostAddr: address(env.BERRY_DOCKER_HOST_ADDR)! } : {}),
   }),
   idleMs: number(env.BERRY_ROUTER_IDLE_MINUTES, 5) * 60_000,
   maxContainers: number(env.BERRY_ROUTER_MAX_CONTAINERS, 8),
   log,
});

await router.adopt();
const reaper = setInterval(() => void router.reap().catch(() => undefined), 60_000);
reaper.unref();

const port = number(env.BERRY_RUNTIME_PORT, 8080);
const server = router.server();
// Loopback only: the API reaches it at localhost, and nothing on the network should. As a container on a
// private network beside the API it has to listen on that network instead (BERRY_ROUTER_LISTEN_HOST=0.0.0.0);
// every request still carries the runtime token, which the session containers check.
server.listen(port, address(env.BERRY_ROUTER_LISTEN_HOST) ?? '127.0.0.1', () => log('berry session router listening', { port, adopted: router.size }));

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
   process.once(signal, () => {
      log('stopping every session container');
      server.close();
      void router.stopAll().finally(() => process.exit(0));
   });
}

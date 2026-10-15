import type { Logger } from '../../../observability/log.ts';
import { nativeModelUnavailable, type AwsCredentials, type ModelFactory } from '../model.ts';
import { setupTelemetry } from '../telemetry.ts';
import { snapshotRepository } from './snapshot-repository.ts';
import { createRuntimeServer } from './server.ts';
import { SessionIdentities, sealWorkRoot } from './session-identity.ts';
import { SessionRegistry } from './sessions.ts';
import { RuntimeAdapterRegistry } from '../adapters/registry.ts';

/**
 * The runtime image's entrypoint.
 *
 * Native Bedrock and Kilo factories are gone. This image still hosts the
 * Strands loop for AgentCore / HTTP invokes; a native model call fails in
 * `nativeModelUnavailable`. Subscription CLIs run on the workstation, not
 * in this container.
 */
const env = process.env;
const region = (env.BERRY_AGENTCORE_REGION ?? env.AWS_REGION ?? '').trim();
const accessKeyId = (env.BERRY_AGENTCORE_ACCESS_KEY_ID ?? env.BERRY_BEDROCK_ACCESS_KEY_ID ?? '').trim();
const secretAccessKey = (env.BERRY_AGENTCORE_SECRET_ACCESS_KEY ?? env.BERRY_BEDROCK_SECRET_ACCESS_KEY ?? '').trim();
const sessionToken = (env.BERRY_AGENTCORE_SESSION_TOKEN ?? env.BERRY_BEDROCK_SESSION_TOKEN ?? '').trim();
const credentials: AwsCredentials | null =
   accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) } : null;

const modelFactory: ModelFactory = nativeModelUnavailable;

const workRoot = env.BERRY_RUNTIME_WORK_ROOT ?? '/mnt/workspace';

// One container serving every session: each gets a Unix user of its own. That
// needs root to hand out, and a setting that protects credentials must not
// quietly do nothing, so anything else is a refusal to start.
const isolate = (env.BERRY_RUNTIME_ISOLATE_SESSIONS ?? '').trim().toLowerCase() === 'true';
if (isolate && process.getuid?.() !== 0) {
   console.error(JSON.stringify({ level: 'ERROR', msg: 'BERRY_RUNTIME_ISOLATE_SESSIONS needs the runtime to run as root (docker run --user 0:0)' }));
   process.exit(1);
}

if (isolate) {
   const sealed = await sealWorkRoot(workRoot);
   console.log(JSON.stringify({ msg: 'sessions are isolated: one user each', workRoot, sealedOlderWorkspaces: sealed }));
}

const authMode = env.BERRY_RUNTIME_AUTH_MODE === 'agentcore' ? 'agentcore' : 'token';
const expectedSession = (env.BERRY_RUNTIME_EXPECTED_SESSION ?? '').trim() || null;
if (expectedSession && !/^[A-Za-z0-9][A-Za-z0-9_-]{32,99}$/.test(expectedSession)) {
   console.error(JSON.stringify({ level: 'ERROR', msg: 'BERRY_RUNTIME_EXPECTED_SESSION is not a valid runtime session id' }));
   process.exit(1);
}
// Kiro runs on the workstation, not in this image. No in-container adapter ships.
const adapters = new RuntimeAdapterRegistry([]);
const server = createRuntimeServer({
   authMode,
   ...(expectedSession ? { expectedSession } : {}),
   ...(env.BERRY_RUNTIME_AUTH_TOKEN ? { authToken: env.BERRY_RUNTIME_AUTH_TOKEN } : {}),
   registry: new SessionRegistry(),
   adapters,
   modelFactory,
   region,
   credentials,
   workRoot,
   ...(isolate ? { identities: new SessionIdentities(workRoot) } : {}),
   repository: snapshotRepository(),
   localControl: (env.BERRY_RUNTIME_LOCAL_CONTROL ?? '').trim().toLowerCase() === 'true',
});

// Traces of model and tool calls start here now: the server makes none.
// A console-backed logger, because the server's logger module is not shipped.
const logger = { info: console.log, error: console.error, warn: console.warn, debug: () => {} } as unknown as Logger;
await setupTelemetry(logger);

// 0.0.0.0, not localhost: AgentCore's health checks come from outside the container.
server.listen(Number(env.PORT ?? 8080), '0.0.0.0', () => {
   console.log(JSON.stringify({ msg: 'berry agent runtime listening', port: Number(env.PORT ?? 8080) }));
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
   process.once(signal, () => {
      void adapters.disconnect().finally(() => server.close(() => process.exit(0)));
   });
}

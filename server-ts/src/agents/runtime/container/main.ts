import type { Logger } from '../../../observability/log.ts';
import { bedrockModel, type AwsCredentials } from '../model.ts';
import { setupTelemetry } from '../telemetry.ts';
import { snapshotRepository } from './snapshot-repository.ts';
import { createRuntimeServer } from './server.ts';
import { SessionIdentities, sealWorkRoot } from './session-identity.ts';
import { SessionRegistry } from './sessions.ts';

/**
 * The runtime image's entrypoint.
 *
 * In AgentCore the credential is the runtime's execution role, so the
 * `BERRY_BEDROCK_*` pair is unset and Bedrock uses the default chain. Locally
 * (the `agent-runtime` Compose service) the pair is how the same image reaches
 * Bedrock; `AWS_ACCESS_KEY_ID` is never read, because in the stack it is MinIO's.
 */
const env = process.env;
const region = (env.BERRY_BEDROCK_REGION ?? env.AWS_REGION ?? 'us-east-1').trim();
const accessKeyId = (env.BERRY_BEDROCK_ACCESS_KEY_ID ?? '').trim();
const secretAccessKey = (env.BERRY_BEDROCK_SECRET_ACCESS_KEY ?? '').trim();
const sessionToken = (env.BERRY_BEDROCK_SESSION_TOKEN ?? '').trim();
const credentials: AwsCredentials | null =
   accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) } : null;

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

const server = createRuntimeServer({
   authMode: env.BERRY_RUNTIME_AUTH_MODE === 'agentcore' ? 'agentcore' : 'token',
   ...(env.BERRY_RUNTIME_AUTH_TOKEN ? { authToken: env.BERRY_RUNTIME_AUTH_TOKEN } : {}),
   registry: new SessionRegistry(),
   modelFactory: (spec) => bedrockModel({ ...spec, credentials: spec.credentials ?? credentials }),
   region,
   credentials,
   workRoot,
   ...(isolate ? { identities: new SessionIdentities(workRoot) } : {}),
   repository: snapshotRepository(),
   localControl: (env.BERRY_RUNTIME_LOCAL_CONTROL ?? '').trim().toLowerCase() === 'true',
   videoOutput: /^s3:\/\//.test((env.BERRY_MEDIA_VIDEO_S3_URI ?? '').trim())
      ? { s3Uri: (env.BERRY_MEDIA_VIDEO_S3_URI ?? '').trim() }
      : undefined,
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
   process.once(signal, () => server.close(() => process.exit(0)));
}

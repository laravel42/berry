/**
 * Environment — the subset this server needs.
 *
 * The variable names are long-standing and deployments are configured with
 * them, so a rename here is a setting that silently stops applying.
 */

import { isIP } from 'node:net';
import {
   parsePostgresEndpoint,
   rdsRegionFromHostname,
   type DatabaseIamAuth,
} from '../db/rds-iam.ts';

export interface Config {
   appEnv: string;
   serviceName: string;
   apiAddr: { host: string; port: number };
   databaseUrl: string;
   /**
    * When set, connections use an RDS IAM auth token instead of a URL password
    * (Aurora Serverless / RDS IAM database authentication).
    */
   databaseIamAuth: DatabaseIamAuth | null;
   metricsEnabled: boolean;
   sessionTtlMs: number;
   allowPasswordlessLogin: boolean;
   /** Better Auth sessions; GitHub via a GitHub OAuth App. See AuthConfig. */
   auth: AuthConfig;
   /** Per-subscriber realtime event buffer, before a slow client is dropped. */
   realtimeBuffer: number;
   /**
    * Where a running preview is addressed: `p-<id>-<app>.<domain>`.
    *
    * Locally `preview.localhost` on the API's own port, which browsers resolve
    * to this machine unaided. A deployment points a wildcard DNS record at
    * Berry and names it here, with the scheme and port a browser really uses.
    */
   previews: {
      domain: string;
      scheme: 'http' | 'https';
      port: number | null;
      /** Where preview checkouts are kept. Null is the home cache. Set when the server is itself a container: see `docker`. */
      root: string | null;
   };
   docker: DockerAddressing;
   organization: OrganizationLimits;
   storage: StorageConfig | null;
   agents: AgentConfig;
   /** Where tasks run and how they are bounded (ADR-0014). */
   runtime: RuntimeConfig;
   /**
    * Where an agent's commands run. Null when no substrate is configured, in
    * which case the composition root installs a driver that refuses every
    * call rather than a null every caller has to remember to check.
    */
   execution: ExecutionConfig | null;
   agentCore: AgentCoreConfig | null;
   agentCoreGateway: AgentCoreGatewayConfig | null;
   /** AgentCore Identity's GitHub credential, usable without a gateway. */
   agentCoreGitCredential: AgentCoreGitCredentialConfig | null;
   /** Which GitHub path is live. `agentcore` routes API calls through the gateway. */
   githubProvider: 'agentcore' | 'legacy';
   /**
    * Seals provider credentials at rest. Null leaves integrations off — a
    * deployment without a key stores nothing rather than storing it in clear.
    */
   integrationKey: string | null;
   /**
    * Lets plugin calls reach http and private addresses. Development only: in
    * production a plugin must be a public https endpoint.
    */
   pluginsAllowPrivateNetwork: boolean;
   /**
    * What this deployment can connect to, and where a provider sends the
    * browser back.
    *
    * Null for either half is a working deployment: the catalogue then says a
    * provider is not configured, which is a better answer than a Connect
    * button that leads to a redirect loop.
    */
   integrations: IntegrationsConfig;
   /**
    * LiveKit Cloud or a self-hosted LiveKit server. Null until URL, API key
    * and API secret are all set. The browser never sees those credentials;
    * `POST /api/v1/voice/token` mints a short-lived room token instead.
    */
   livekit: LivekitConfig | null;
   /**
    * Berry's own git server, when the deployment runs one.
    *
    * All three or none: a repositories directory with no key is a repository
    * nothing can reach, and reporting the server as present would promise a
    * checkout that cannot happen.
    */
   git: GitConfig | null;
}

export interface GitConfig {
   /**
    * Shared secret GitHub signs its webhooks with.
    *
    * Null disables the inbound route entirely. An unsigned webhook endpoint is
    * an open door onto every task in the deployment, so "no secret" means "no
    * endpoint" rather than "no checking".
    */
   webhookSecret: string | null;
}

/**
 * The execution substrate.
 *
 * `driver` exists so a self-hosted deployment can select a local container
 * runtime without this file learning what Cloudflare is — the driver name is
 * the only thing config knows, and the factory maps it to an implementation.
 */
export interface ExecutionConfig {
   /**
    * Where an agent's commands run.
    *
    * `docker` is the runtime service (`server-ts/sandbox/docker/`), a disposable
    * container per run on the operator's own Docker daemon — the self-hosted
    * default. `agentcore` is an AWS Bedrock AgentCore Code Interpreter session.
    * `agentcore-runtime` is a deployed AgentCore Runtime, invoked by ARN. Only
    * `docker` uses `baseUrl`/`token`; the AgentCore substrates are reached with
    * SigV4 and addressed from `AgentCoreConfig`.
    */
   driver: 'docker' | 'agentcore' | 'agentcore-runtime';
   baseUrl: string;
   token: string;
}

/**
 * AgentCore Gateway and Identity, when GitHub is reached through them.
 *
 * Separate from `AgentCoreConfig` because they answer different questions:
 * that one is where an agent's *work* runs, this is where Berry's external
 * *tool access and credentials* come from. A deployment can want either alone.
 */
export interface AgentCoreGatewayConfig {
   region: string;
   /** The gateway's MCP endpoint. */
   gatewayUrl: string;
   /** The OAuth2 credential provider AgentCore holds GitHub's credential in. */
   githubProviderName: string;
   /** Berry's own registered workload identity. */
   workloadName: string;
   /**
    * Explicit capability-to-tool names, when a gateway's naming defeats
    * matching. Empty is the normal case: names come from discovery.
    */
   toolOverrides: Record<string, string>;
}

/**
 * What Berry needs to fetch a GitHub token from AgentCore Identity.
 *
 * The gateway's own config carries the same provider name because a gateway
 * deployment needs both; this stands alone for a deployment that wants only the
 * credential.
 */
export interface AgentCoreGitCredentialConfig {
   region: string;
   providerName: string;
   workloadName: string;
   flow: 'USER_FEDERATION' | 'M2M';
   /** Stable AgentCore user binding; required by USER_FEDERATION. */
   userId: string | null;
   /** Browser destination after one-time consent; required by USER_FEDERATION. */
   returnUrl: string | null;
}

export interface AgentCoreConfig {
   region: string;
   /**
    * The Code Interpreter to run an agent's commands in.
    *
    * `aws.codeinterpreter.v1` is the managed one every account has. A custom
    * identifier is a sandbox an operator built with their own network rules —
    * which is what a run needs to clone from GitHub.
    */
   codeInterpreterId: string;
   /** An AgentCore Runtime to invoke instead of executing in this process. */
   runtimeArn: string | null;
   /**
    * An AgentCore Memory store holding what earlier runs did.
    *
    * Null disables recall rather than degrading it: an agent told nothing is
    * an agent that starts fresh, which is the behaviour Berry had before.
    */
   memoryId: string | null;
   /**
    * Explicit credentials for the AgentCore APIs.
    *
    * Required for the same reason Bedrock's are, and it is not a theoretical
    * concern: `AWS_ACCESS_KEY_ID` in the Compose stack holds MinIO's
    * `berryminio`, so a client left on the default chain authenticates to AWS
    * as the object store and is refused. Falls back to the Bedrock pair, which
    * is already the account's real credential.
    */
   credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string } | null;
}

/** Object storage for run artifacts. Null when it is not configured. */
export interface StorageConfig {
   bucket: string;
   region: string;
   endpoint: string | undefined;
   forcePathStyle: boolean;
   accessKeyId: string | undefined;
   secretAccessKey: string | undefined;
   sessionToken: string | undefined;
   maxBytes: number;
   /**
    * A directory on this machine. When set, artifacts stay here and S3 is
    * not used, which is how the desktop app keeps files without a bucket.
    */
   directory: string | null;
}

/** OAuth credentials, and the origins a provider redirects between. */
export interface IntegrationsConfig {
   github: { clientId: string; clientSecret: string } | null;
   /**
    * Google Cloud OAuth client for MCP servers that use Google's
    * authorization server and do not advertise dynamic client
    * registration. One per deployment; every workspace uses it. Null
    * until both halves are set.
    */
   googleOAuth: { clientId: string; clientSecret: string } | null;
   /**
    * This server's own public origin — where the provider sends the browser
    * back. Not derivable from a request: behind a proxy the request's own
    * host is the proxy's, and a redirect_uri that does not match the one
    * registered with the provider is refused before Berry sees it.
    */
   publicUrl: string | null;
   /** Where the browser lands afterwards. The frontend, when it is separate. */
   appUrl: string | null;
}

/** LiveKit Cloud or a self-hosted LiveKit server, for voice with an agent. */
export interface LivekitConfig {
   url: string;
   apiKey: string;
   apiSecret: string;
   /**
    * The LiveKit agent worker to dispatch when a member opens a voice room.
    * Defaults to berry-voice when LIVEKIT_AGENT_NAME is unset.
    */
   agentName: string;
}

/** Sign-in: Better Auth sessions, GitHub via a GitHub OAuth App. */
export interface AuthConfig {
   /** >= 32 chars. Null disables cookie sessions (bearer tokens still work). */
   secret: string | null;
   /** The browser-facing origin Better Auth builds callback URLs on. */
   baseUrl: string | null;
   /** Origins allowed to send cookie-authenticated unsafe requests. */
   trustedOrigins: string[];
   /**
    * Proxies (IPs or CIDR ranges) whose X-Forwarded-For hop is skipped when a
    * session records the client address. Always includes loopback: the web
    * app's own proxy to the API is one hop on the same host.
    */
   trustedProxies: string[];
   /** The sign-in OAuth App. Separate from integrations.github. */
   github: { clientId: string; clientSecret: string } | null;
   /**
    * The GitHub App's slug — the name in `https://github.com/apps/<slug>`.
    *
    * Not a secret: it names a public page, and it is here only so that an
    * install can be *offered* on a deployment that signs people in with an App
    * whose credentials it was given rather than an App it created for itself.
    * Without it there is no install URL to send anyone to, and a `github_apps`
    * row — when there is one — wins, because that slug came from GitHub.
    */
   githubAppSlug: string | null;
   /** Development-only known-email login (dev-login route + testUtils plugin). */
   devLogin: boolean;
}

/** Planner and run bounds. Not a model credential: those live on a subscription runtime. */
export interface AgentConfig {
   /** Used when an agent row names no model of its own. */
   defaultModel: string;
   /**
    * How many runs this process executes at once.
    *
    * Two by default, and low on purpose: each run holds a container and a
    * model call, so this is a cost ceiling as much as a load one. Raising it
    * on one server and running several servers are both ways to go faster,
    * and the claim is safe either way.
    */
   concurrency: number;
   /**
    * How many times a plan may be sent back to be fixed, and how many times
    * the critic may ask for a revision.
    *
    * Low on purpose: a model that cannot fix its own dependency graph in two
    * attempts will not fix it in ten, and every attempt is paid for.
    */
   maxRepairs: number;
   maxCriticRounds: number;
   /**
    * A ceiling on one model reply, in tokens. Null means the runtime's
    * default (32000). Lowered for a model that accepts less.
    */
   maxTokens: number | null;
   /** How many times AutoGate sends a task back before leaving it to a person. */
   autoGateMaxAttempts: number;
}

export class ConfigError extends Error {
   constructor(problems: string[]) {
      super(`configuration is invalid:\n  - ${problems.join('\n  - ')}`);
      this.name = 'ConfigError';
   }
}

/**
 * What bounds the work agents hand to each other.
 *
 * One run is bounded by its step budget. A tree of tasks is not: each
 * delegation is another run, a delegated task can delegate again, and two roles
 * that list each other can pass one task back and forth, every pass a paid run.
 * These are the ceilings on that, for the whole deployment. Zero turns one off.
 */
export interface OrganizationLimits {
   /** How far below the task a person filed a sub-task may sit. A task at this depth cannot delegate further. */
   maxDelegationDepth: number;
   /** Sub-tasks (delegations and decisions handed to a role) one run may create. */
   maxDelegationsPerRun: number;
   /** The recent handoffs of a task that are looked at when it is handed on again. */
   handoffWindow: number;
   /** The distinct agents those handoffs must involve. Fewer is two roles bouncing the task. */
   handoffMinUniqueAgents: number;
}

export const DEFAULT_ORGANIZATION_LIMITS: OrganizationLimits = { maxDelegationDepth: 3, maxDelegationsPerRun: 5, handoffWindow: 4, handoffMinUniqueAgents: 3 };

function organizationLimits(env: NodeJS.ProcessEnv): OrganizationLimits {
   const limit = (value: string | undefined, fallback: number): number => {
      const trimmed = (value ?? '').trim();
      return /^\d+$/.test(trimmed) ? Math.min(Number(trimmed), 1000) : fallback;
   };
   return {
      maxDelegationDepth: limit(env.BERRY_DELEGATION_MAX_DEPTH, DEFAULT_ORGANIZATION_LIMITS.maxDelegationDepth),
      maxDelegationsPerRun: limit(env.BERRY_DELEGATIONS_PER_RUN, DEFAULT_ORGANIZATION_LIMITS.maxDelegationsPerRun),
      handoffWindow: limit(env.BERRY_HANDOFF_WINDOW, DEFAULT_ORGANIZATION_LIMITS.handoffWindow),
      handoffMinUniqueAgents: limit(env.BERRY_HANDOFF_MIN_UNIQUE_AGENTS, DEFAULT_ORGANIZATION_LIMITS.handoffMinUniqueAgents),
   };
}

/**
 * Where the containers this server starts (a preview's apps, an agent session)
 * are published, and how this process reaches them there.
 *
 * On a machine the server runs on directly, both are loopback: Docker
 * publishes on 127.0.0.1 and the server connects to 127.0.0.1. When the server
 * is itself a container on a bridge network, its loopback is its own, so the
 * containers are published on the Docker bridge's gateway address (reachable
 * from containers and the host, not from outside) and reached by the name
 * that resolves to it: `BERRY_DOCKER_PUBLISH_ADDR=172.17.0.1` and
 * `BERRY_DOCKER_HOST_ADDR=host.docker.internal`.
 */
export interface DockerAddressing {
   publishAddr: string;
   hostAddr: string;
}

function dockerAddressing(env: NodeJS.ProcessEnv): DockerAddressing {
   // An address or a host name and nothing else: both end up in a URL and a docker argument.
   const address = (value: string | undefined): string => {
      const trimmed = (value ?? '').trim();
      return /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/.test(trimmed) ? trimmed : '127.0.0.1';
   };
   return { publishAddr: address(env.BERRY_DOCKER_PUBLISH_ADDR), hostAddr: address(env.BERRY_DOCKER_HOST_ADDR) };
}

function previews(env: NodeJS.ProcessEnv, apiPort: number): Config['previews'] {
   const domain = (env.BERRY_PREVIEW_DOMAIN ?? '').trim().toLowerCase().replace(/^\*?\./, '') || 'preview.localhost';
   const scheme = (env.BERRY_PREVIEW_SCHEME ?? '').trim().toLowerCase() === 'https' ? 'https' : 'http';
   const raw = (env.BERRY_PREVIEW_PORT ?? '').trim();
   // Unset means the API's own port, which is where a local browser finds it;
   // `default` means none in the URL, for a proxy on 80 or 443.
   const port = raw === '' ? apiPort : raw.toLowerCase() === 'default' ? null : Number(raw);
   const root = (env.BERRY_PREVIEW_ROOT ?? '').trim();
   return { domain, scheme, port: port !== null && Number.isInteger(port) && port > 0 && port < 65536 ? port : raw === '' ? apiPort : null, root: root.startsWith('/') ? root : null };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
   const problems: string[] = [];

   const databaseUrl = (env.DATABASE_URL ?? '').trim();
   if (!databaseUrl) problems.push('DATABASE_URL is required');
   else if (databaseUrl.startsWith('pglite:')) {
      if (!databaseUrl.slice('pglite:'.length).trim()) {
         problems.push('DATABASE_URL=pglite: needs a data directory, for example pglite:./.berry');
      }
   } else if (!(databaseUrl.startsWith('postgres:') || databaseUrl.startsWith('postgresql:'))) {
      problems.push('DATABASE_URL must be a postgres:// URL or pglite:<directory>');
   }

   // The Dockerfile sets this; the default matches it so a bare `node` run agrees.
   const addr = (env.API_ADDR ?? '0.0.0.0:4000').trim();
   const separator = addr.lastIndexOf(':');
   const host = separator > 0 ? addr.slice(0, separator) : '0.0.0.0';
   const port = Number(separator > 0 ? addr.slice(separator + 1) : addr);
   if (!Number.isInteger(port) || port < 1 || port > 65535) {
      problems.push(`API_ADDR must end in a port, got ${addr}`);
   }

   // Read before the check below, so a misconfigured substrate is reported
   // with everything else rather than collected into a list nobody throws.
   const executionConfig = execution(env, problems);
   const appEnv = (env.APP_ENV ?? 'development').trim();
   const authConfig = auth(env, appEnv, problems);
   const databaseIamAuth = iamDatabaseAuth(env, databaseUrl, problems);
   const integrationsConfig = integrations(env, problems);
   const livekitConfig = livekit(env, problems);

   if (problems.length > 0) throw new ConfigError(problems);

   return {
      appEnv,
      serviceName: (env.SERVICE_NAME ?? 'berry-server').trim(),
      apiAddr: { host, port },
      databaseUrl,
      databaseIamAuth,
      metricsEnabled: boolean(env.METRICS_ENABLED, true),
      sessionTtlMs: duration(env.SESSION_TTL, 30 * 24 * 60 * 60 * 1000),
      allowPasswordlessLogin: boolean(env.AUTH_ALLOW_PASSWORDLESS_LOGIN, true),
      auth: authConfig,
      // Per-subscriber event buffer, before a slow client is dropped.
      realtimeBuffer: positiveInt(env.REALTIME_BUFFER, 64),
      previews: previews(env, port),
      organization: organizationLimits(env),
      docker: dockerAddressing(env),
      storage: storage(env),
      agents: agents(env),
      runtime: runtime(env),
      // Trimmed and required to be non-empty: a variable set to whitespace is
      // an operator who meant to set it, and treating that as "configured"
      // would accept a token nothing can present.
      execution: executionConfig,
      agentCore: agentCore(env),
      agentCoreGateway: agentCoreGateway(env),
      agentCoreGitCredential: agentCoreGitCredential(env),
      githubProvider: (env.GITHUB_PROVIDER ?? 'agentcore').trim() === 'legacy' ? 'legacy' : 'agentcore',
      // No generated fallback: a key that appeared on its own would differ
      // between restarts and strand every credential already stored.
      integrationKey: (env.INTEGRATION_ENCRYPTION_KEY ?? '').trim() || null,
      pluginsAllowPrivateNetwork: (env.BERRY_PLUGINS_ALLOW_PRIVATE_NETWORK ?? '').trim() === '1',
      integrations: integrationsConfig,
      livekit: livekitConfig,
      git: git(env),
   };
}

/**
 * Reads the execution substrate, or nothing.
 *
 * Both halves are required together. A base URL with no token would present
 * no credential and be refused on every call, and a token with no URL has
 * nothing to authenticate to — either alone is a misconfiguration worth
 * reporting at boot rather than at the first run.
 */
function execution(env: NodeJS.ProcessEnv, problems: string[]): ExecutionConfig | null {
   const driver = (env.BERRY_RUNTIME_DRIVER ?? '').trim();
   const baseUrl = (env.BERRY_RUNTIME_URL ?? '').trim();
   const token = (env.BERRY_RUNTIME_TOKEN ?? '').trim();

   if (!driver && !baseUrl && !token) return null;

   if (driver !== 'docker' && driver !== 'agentcore' && driver !== 'agentcore-runtime') {
      problems.push(
         `BERRY_RUNTIME_DRIVER must be 'docker', 'agentcore' or 'agentcore-runtime' when execution is configured, got '${driver}'`
      );
      return null;
   }

   // The AgentCore substrates are reached with SigV4 and addressed from
   // AgentCoreConfig (an interpreter id or a runtime ARN), so they have neither
   // a URL nor a token of their own. Demanding them would make the substrates
   // that need no secret the only ones that cannot start.
   if (driver === 'agentcore' || driver === 'agentcore-runtime') {
      return { driver, baseUrl: '', token: '' };
   }

   if (!baseUrl) problems.push('BERRY_RUNTIME_URL is required when BERRY_RUNTIME_DRIVER=docker');
   if (!token) problems.push('BERRY_RUNTIME_TOKEN is required when BERRY_RUNTIME_DRIVER=docker');
   if (!baseUrl || !token) return null;

   return { driver, baseUrl, token };
}

/**
 * Object storage, from the standard S3 variables.
 *
 * Only the bucket is required. Credentials may be absent on purpose — the AWS
 * SDK then uses the workload's credential chain, which is how this runs
 * outside development. A development or test process with neither a bucket
 * nor `BERRY_STORAGE_DIR` keeps files in a directory beside the local
 * database, so an attachment has somewhere to land.
 */
function storage(env: NodeJS.ProcessEnv): StorageConfig | null {
   const maxBytes = positiveInt(env.STORAGE_MAX_BYTES, 25 * 1024 * 1024);
   const directory = (env.BERRY_STORAGE_DIR ?? '').trim() || localArtifactDirectory(env);
   if (directory) {
      return {
         bucket: '',
         region: '',
         endpoint: undefined,
         forcePathStyle: false,
         accessKeyId: undefined,
         secretAccessKey: undefined,
         sessionToken: undefined,
         maxBytes,
         directory,
      };
   }
   const bucket = (env.S3_BUCKET ?? '').trim();
   if (!bucket) return null;
   return {
      bucket,
      region: (env.S3_REGION ?? 'us-east-1').trim(),
      endpoint: (env.S3_ENDPOINT ?? '').trim() || undefined,
      // MinIO addresses buckets by path, not by subdomain.
      forcePathStyle: boolean(env.S3_USE_PATH_STYLE, true),
      accessKeyId: (env.AWS_ACCESS_KEY_ID ?? '').trim() || undefined,
      secretAccessKey: (env.AWS_SECRET_ACCESS_KEY ?? '').trim() || undefined,
      sessionToken: (env.AWS_SESSION_TOKEN ?? '').trim() || undefined,
      maxBytes,
      directory: null,
   };
}

/**
 * Where a local process keeps files when nobody named a bucket or a directory.
 *
 * Production stays without storage until it is configured: a forgotten bucket
 * must not start writing into the container. The directory sits next to a
 * PGlite database (`pglite:./.berry` → `./.berry/artifacts`) and otherwise
 * under `.berry/artifacts`, resolved from the server's working directory.
 */
function localArtifactDirectory(env: NodeJS.ProcessEnv): string {
   const development = ['development', 'test'].includes((env.APP_ENV ?? '').trim().toLowerCase());
   if (!development || (env.S3_BUCKET ?? '').trim()) return '';
   const database = (env.DATABASE_URL ?? '').trim();
   if (database.startsWith('pglite:')) {
      return `${database.slice('pglite:'.length).replace(/\/$/, '')}/artifacts`;
   }
   return '.berry/artifacts';
}

/**
 * Planner and run bounds. Always present: they do not need a model provider.
 */
function agents(env: NodeJS.ProcessEnv): AgentConfig {
   return {
      defaultModel: (env.BERRY_AGENT_DEFAULT_MODEL ?? '').trim(),
      concurrency: positive(env.BERRY_RUN_CONCURRENCY, 2),
      maxRepairs: positive(env.PLANNER_MAX_REPAIRS, 2),
      maxCriticRounds: positive(env.PLANNER_MAX_CRITIC_ROUNDS, 1),
      maxTokens: env.BERRY_AGENT_MAX_TOKENS ? positive(env.BERRY_AGENT_MAX_TOKENS, 32_000) : null,
      autoGateMaxAttempts: positive(env.BERRY_AUTOGATE_MAX_ATTEMPTS, 2),
   };
}

/**
 * AgentCore's own settings.
 *
 * Null unless a region and an interpreter are both named: an AgentCore driver
 * with half its settings is a substrate that fails at the first command, and
 * the factory says so by name rather than discovering it at run time.
 */
function agentCore(env: NodeJS.ProcessEnv): AgentCoreConfig | null {
   const region = (
      env.BERRY_AGENTCORE_REGION ??
      env.BERRY_BEDROCK_REGION ??
      env.AWS_REGION ??
      ''
   ).trim();
   const codeInterpreterId = (
      env.BERRY_AGENTCORE_CODE_INTERPRETER_ID ?? 'aws.codeinterpreter.v1'
   ).trim();
   if (!region || !codeInterpreterId) return null;
   // AgentCore's own pair first, then Bedrock's: both address AWS proper in the
   // same account, so a deployment that already named one credential should not
   // have to name it twice. Never `AWS_ACCESS_KEY_ID` — that is MinIO's.
   // `||`, not `??`: Compose passes an unset variable as an empty string, and
   // an empty AgentCore key must fall through to Bedrock's rather than count
   // as "configured" and send the clients to the default chain — which in the
   // Compose stack is MinIO's key, refused as an invalid security token.
   const accessKeyId = (
      env.BERRY_AGENTCORE_ACCESS_KEY_ID?.trim() ||
      env.BERRY_BEDROCK_ACCESS_KEY_ID?.trim() ||
      ''
   ).trim();
   const secretAccessKey = (
      env.BERRY_AGENTCORE_SECRET_ACCESS_KEY?.trim() ||
      env.BERRY_BEDROCK_SECRET_ACCESS_KEY?.trim() ||
      ''
   ).trim();
   const sessionToken = (
      env.BERRY_AGENTCORE_SESSION_TOKEN?.trim() ||
      env.BERRY_BEDROCK_SESSION_TOKEN?.trim() ||
      ''
   ).trim();
   return {
      region,
      codeInterpreterId,
      runtimeArn: (env.BERRY_AGENTCORE_RUNTIME_ARN ?? '').trim() || null,
      memoryId: (env.BERRY_AGENTCORE_MEMORY_ID ?? '').trim() || null,
      credentials:
         accessKeyId && secretAccessKey
            ? { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) }
            : null,
   };
}

/**
 * The gateway, when one is configured.
 *
 * A URL and a credential provider are both required: a gateway with no
 * identity behind it cannot authorise a call, and reporting it as configured
 * would promise something that fails at the first tool.
 */
/**
 * The AgentCore Identity credential provider holding GitHub, on its own.
 *
 * Separate from the gateway because the two are independent primitives and only
 * one of them is needed to clone: git is a wire protocol, so a run needs a
 * token, not a tool call. Requiring a gateway URL before Berry would ask
 * AgentCore for that token meant a deployment had to stand up gateway targets
 * before it could use the credential provider at all.
 */
function agentCoreGitCredential(env: NodeJS.ProcessEnv): AgentCoreGitCredentialConfig | null {
   const providerName = (env.AWS_AGENTCORE_GITHUB_PROVIDER ?? '').trim();
   if (!providerName) return null;
   const flow = (env.AWS_AGENTCORE_GITHUB_FLOW ?? '').trim().toUpperCase();
   return {
      region: (env.AWS_AGENTCORE_REGION ?? env.AWS_REGION ?? 'us-east-1').trim(),
      providerName,
      workloadName: (env.AWS_AGENTCORE_WORKLOAD_NAME ?? 'berry').trim(),
      // Three-legged by default: a GitHub OAuth App has no client-credentials
      // grant, so `M2M` cannot acquire its token.
      flow: flow === 'M2M' ? 'M2M' : 'USER_FEDERATION',
      userId: (env.AWS_AGENTCORE_GITHUB_USER_ID ?? '').trim() || null,
      returnUrl: (env.AWS_AGENTCORE_GITHUB_RETURN_URL ?? '').trim() || null,
   };
}

function agentCoreGateway(env: NodeJS.ProcessEnv): AgentCoreGatewayConfig | null {
   const gatewayUrl = (env.AWS_AGENTCORE_GATEWAY_URL ?? '').trim();
   const githubProviderName = (env.AWS_AGENTCORE_GITHUB_PROVIDER ?? '').trim();
   if (!gatewayUrl || !githubProviderName) return null;

   let toolOverrides: Record<string, string> = {};
   const raw = (env.BERRY_AGENTCORE_TOOL_MAP ?? '').trim();
   if (raw) {
      try {
         const parsed: unknown = JSON.parse(raw);
         if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            toolOverrides = Object.fromEntries(
               Object.entries(parsed as Record<string, unknown>)
                  .filter(([, value]) => typeof value === 'string')
                  .map(([key, value]) => [key, value as string])
            );
         }
      } catch {
         // Left empty rather than fatal: a malformed override should cost the
         // override, not the deployment. Discovery still resolves the rest.
      }
   }

   return {
      region: (env.AWS_AGENTCORE_REGION ?? env.AWS_REGION ?? 'us-east-1').trim(),
      gatewayUrl,
      githubProviderName,
      workloadName: (env.AWS_AGENTCORE_WORKLOAD_NAME ?? 'berry').trim(),
      toolOverrides,
   };
}

function integrations(env: NodeJS.ProcessEnv, problems: string[]): IntegrationsConfig {
   const clientId = (env.GITHUB_CLIENT_ID ?? '').trim();
   const clientSecret = (env.GITHUB_CLIENT_SECRET ?? '').trim();
   const googleId = (env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim();
   const googleSecret = (env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim();
   if (googleId && !googleSecret) {
      problems.push('GOOGLE_OAUTH_CLIENT_SECRET is required with GOOGLE_OAUTH_CLIENT_ID');
   }
   if (googleSecret && !googleId) {
      problems.push('GOOGLE_OAUTH_CLIENT_ID is required with GOOGLE_OAUTH_CLIENT_SECRET');
   }
   return {
      // Both or neither: half a credential cannot complete an exchange, and
      // reporting the provider as configured would promise that it can.
      github: clientId && clientSecret ? { clientId, clientSecret } : null,
      googleOAuth: googleId && googleSecret ? { clientId: googleId, clientSecret: googleSecret } : null,
      publicUrl: origin(env.BERRY_PUBLIC_URL),
      appUrl: origin(env.BERRY_APP_URL),
   };
}

/**
 * Voice rooms. URL, API key and API secret are all or none: a half-set
 * LiveKit client cannot mint a token, and reporting voice as configured
 * would promise a Connect that cannot start.
 */
function livekit(env: NodeJS.ProcessEnv, problems: string[]): LivekitConfig | null {
   const url = (env.LIVEKIT_URL ?? '').trim();
   const apiKey = (env.LIVEKIT_API_KEY ?? '').trim();
   const apiSecret = (env.LIVEKIT_API_SECRET ?? '').trim();
   const agentName = (env.LIVEKIT_AGENT_NAME ?? '').trim() || 'berry-voice';
   const any = Boolean(url || apiKey || apiSecret);
   const all = Boolean(url && apiKey && apiSecret);
   if (any && !all) {
      if (!url) problems.push('LIVEKIT_URL is required with LIVEKIT_API_KEY and LIVEKIT_API_SECRET');
      if (!apiKey) problems.push('LIVEKIT_API_KEY is required with LIVEKIT_URL and LIVEKIT_API_SECRET');
      if (!apiSecret) problems.push('LIVEKIT_API_SECRET is required with LIVEKIT_URL and LIVEKIT_API_KEY');
      return null;
   }
   if (!all) return null;
   if (!/^wss?:\/\//i.test(url) && !/^https?:\/\//i.test(url)) {
      problems.push('LIVEKIT_URL must be a ws://, wss://, http:// or https:// origin');
      return null;
   }
   return { url, apiKey, apiSecret, agentName };
}

/**
 * A development-only secret, fixed rather than generated.
 *
 * Generated would differ between restarts and sign everyone out on every
 * reload; fixed and public is acceptable only because it is never used outside
 * development and test, which is checked below.
 */
const DEVELOPMENT_AUTH_SECRET = 'berry-development-only-auth-secret-do-not-deploy';

/**
 * Sign-in: Better Auth sessions, GitHub through a GitHub OAuth App.
 *
 * The GitHub OAuth App credential has its own names on purpose: GITHUB_CLIENT_ID
 * belongs to the older repository connection, with its own callback. Sign-in
 * asks only for the profile. Repository access is the workspace GitHub connection.
 */
function auth(env: NodeJS.ProcessEnv, _appEnv: string, problems: string[]): AuthConfig {
   // Explicit APP_ENV only. `appEnv` defaults to 'development' when unset, and
   // a production host that forgot APP_ENV must not get the public fixed secret
   // or dev-login. Compose sets APP_ENV (default development), so local stacks
   // are unaffected.
   const development = ['development', 'test'].includes(
      (env.APP_ENV ?? '').trim().toLowerCase()
   );
   const explicit = (env.BERRY_AUTH_SECRET ?? '').trim();
   if (explicit && explicit.length < 32) {
      problems.push('BERRY_AUTH_SECRET must be at least 32 characters');
   }
   const secret = explicit.length >= 32 ? explicit : development ? DEVELOPMENT_AUTH_SECRET : null;

   const clientId = (env.BERRY_AUTH_GITHUB_CLIENT_ID ?? '').trim();
   const clientSecret = (env.BERRY_AUTH_GITHUB_CLIENT_SECRET ?? '').trim();
   if (clientId && !clientSecret) {
      problems.push('BERRY_AUTH_GITHUB_CLIENT_SECRET is required with BERRY_AUTH_GITHUB_CLIENT_ID');
   }
   if (clientSecret && !clientId) {
      problems.push('BERRY_AUTH_GITHUB_CLIENT_ID is required with BERRY_AUTH_GITHUB_CLIENT_SECRET');
   }
   const github = clientId && clientSecret ? { clientId, clientSecret } : null;

   if (github && !explicit && !development) {
      problems.push('BERRY_AUTH_SECRET is required when GitHub sign-in is configured');
   }

   // A GitHub App slug is what GitHub puts in a URL path: letters, digits and
   // dashes. Checked rather than trusted, because the failure of a wrong one is
   // an install link that 404s on GitHub — which reads as Berry being broken.
   const slug = (env.BERRY_GITHUB_APP_SLUG ?? '').trim();
   if (slug && !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,98}[A-Za-z0-9])?$/.test(slug)) {
      problems.push(
         'BERRY_GITHUB_APP_SLUG must be the App name from https://github.com/apps/<slug>, not a URL'
      );
   }

   const appUrl = origin(env.BERRY_APP_URL);
   const publicUrl = origin(env.BERRY_PUBLIC_URL);
   // The API public URL is not a browser origin. In development the app is
   // localhost:3000 unless BERRY_APP_URL says otherwise.
   const baseUrl = appUrl ?? (development ? 'http://localhost:3000' : publicUrl);
   // A browser reaching the app by another name — a LAN address on a phone, a
   // tunnel in front of a local stack — sends that origin, and Better Auth
   // refuses a sign-in from an origin it was not told about. Naming them is an
   // operator's decision, so they are listed rather than guessed from the
   // request.
   const extraOrigins = (env.BERRY_AUTH_TRUSTED_ORIGINS ?? '')
      .split(',')
      .map((value) => trustedOrigin(value))
      .filter((value): value is string => value !== null);
   const trustedOrigins = [
      ...new Set(
         [appUrl, publicUrl, baseUrl, ...extraOrigins].filter(
            (value): value is string => value !== null
         )
      ),
   ];

   // Which X-Forwarded-For hops are proxies rather than the person. Without
   // any, Better Auth trusts only a single-value header, so a chain such as
   // "client, reverse-proxy" records no address at all. Loopback is always a
   // proxy (the web app forwards /api from the same host); a container bridge
   // or a load balancer is the operator's to name — never a blanket private
   // range, which would also cover the people signing in from a LAN.
   const trustedProxies = ['127.0.0.1', '::1'];
   for (const raw of (env.BERRY_TRUSTED_PROXIES ?? '').split(',')) {
      const entry = raw.trim();
      if (!entry) continue;
      if (!isAddressOrRange(entry)) {
         problems.push(`BERRY_TRUSTED_PROXIES: ${entry} is not an IP address or CIDR range`);
         continue;
      }
      if (!trustedProxies.includes(entry)) trustedProxies.push(entry);
   }

   return {
      secret,
      baseUrl,
      trustedOrigins,
      trustedProxies,
      github,
      githubAppSlug: slug === '' ? null : slug,
      devLogin: development && boolean(env.AUTH_ALLOW_PASSWORDLESS_LOGIN, true),
   };
}

/** An IPv4/IPv6 address, optionally with a /prefix that fits its family. */
function isAddressOrRange(value: string): boolean {
   const slash = value.indexOf('/');
   const address = slash === -1 ? value : value.slice(0, slash);
   const family = isIP(address);
   if (family === 0) return false;
   if (slash === -1) return true;
   const prefix = value.slice(slash + 1);
   if (!/^\d{1,3}$/.test(prefix)) return false;
   return Number(prefix) <= (family === 4 ? 32 : 128);
}

/**
 * A trusted browser origin. A leading `*` is one hostname label
 * (`https://*.trycloudflare.com`); anything else must be an absolute URL.
 */
function trustedOrigin(value: string): string | null {
   const trimmed = value.trim();
   if (/^https?:\/\/\*\.[a-z0-9.-]+$/.test(trimmed)) return trimmed;
   return origin(trimmed);
}

/** A URL with no trailing slash, or null when it is not one. */
function origin(value: string | undefined): string | null {
   const trimmed = (value ?? '').trim();
   if (!trimmed) return null;
   try {
      return new URL(trimmed).origin;
   } catch {
      return null;
   }
}

/** A count, when the value given is one. Anything else keeps the default. */
/** Where tasks run and how they are bounded. Independent of Bedrock: the server calls no model. */
export interface RuntimeConfig {
   authToken: string | null;
   maxTokens: number | null;
   /** The authenticated runtime image on a URL, used when no AgentCore runtime ARN is set. */
   agentRuntimeUrl: string | null;
   /** Used when an agent row and its profile name no model. */
   defaultModel: string;
   /** How many tasks this process dispatches at once. */
   concurrency: number;
   /** Unattended continuations of a task stopped at its step limit. Zero is off. */
   maxContinuations: number;
   /** A task token's lifetime: the runtime's maxLifetime. */
   tokenTtlSeconds: number;
   /**
    * Where the runtime reaches Berry back.
    *
    * Not the public URL: that is the address a browser uses, and inside the
    * runtime container "localhost" is the container itself. On Compose this is
    * the service name; on AgentCore it is whatever address AWS can reach.
    * Null falls back to the public URL.
    */
   callbackUrl: string | null;
}

function runtime(env: NodeJS.ProcessEnv): RuntimeConfig {
   const url = (env.BERRY_AGENT_RUNTIME_URL ?? '').trim().replace(/\/+$/, '');
   return {
      agentRuntimeUrl: /^https?:\/\//.test(url) ? url : null,
      authToken: (env.BERRY_RUNTIME_AUTH_TOKEN ?? '').trim() || null,
      maxTokens: env.BERRY_AGENT_MAX_TOKENS ? positive(env.BERRY_AGENT_MAX_TOKENS, 32_000) : null,
      defaultModel: (env.BERRY_AGENT_DEFAULT_MODEL ?? '').trim(),
      concurrency: positive(env.BERRY_RUN_CONCURRENCY, 2),
      maxContinuations: continuations(env.BERRY_RUN_MAX_CONTINUATIONS),
      tokenTtlSeconds: Math.min(positive(env.BERRY_TASK_TOKEN_TTL_SECONDS, 28_800), 28_800),
      callbackUrl: origin(env.BERRY_RUNTIME_CALLBACK_URL),
   };
}

/**
 * How many times a task stopped at its step limit carries on unattended.
 * Unlike the other counts here, zero is a value: it turns continuation off.
 */
function continuations(value: string | undefined): number {
   const parsed = Number.parseInt((value ?? '').trim(), 10);
   return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, 10) : 3;
}

function positive(value: string | undefined, fallback: number): number {
   const parsed = /^\d+$/.test((value ?? '').trim()) ? Number(value) : Number.NaN;
   return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Duration strings as the compose file writes them: `720h`, `30m`, `1s`.
 *
 * Compound forms like `2h5m` are accepted because a deployment may already
 * have one configured, and rejecting it would turn a working setting into a
 * boot failure.
 */
function duration(value: string | undefined, fallback: number): number {
   const trimmed = (value ?? '').trim();
   if (!trimmed) return fallback;
   const units: Record<string, number> = { ms: 1, s: 1000, m: 60000, h: 3600000 };
   let total = 0;
   let matched = false;
   for (const [, amount, unit] of trimmed.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
      total += Number(amount) * (units[unit as string] ?? 0);
      matched = true;
   }
   return matched ? total : fallback;
}

/**
 * RDS / Aurora IAM database authentication.
 *
 * Tokens last 15 minutes and must be minted per connection, so they cannot
 * live in DATABASE_URL as a static password. Region comes from
 * DATABASE_IAM_REGION, AWS_REGION, or an `*.rds.amazonaws.com` hostname.
 */
function iamDatabaseAuth(
   env: NodeJS.ProcessEnv,
   databaseUrl: string,
   problems: string[]
): DatabaseIamAuth | null {
   if (!boolean(env.DATABASE_IAM_AUTH, false)) return null;
   if (databaseUrl.startsWith('pglite:')) {
      problems.push('DATABASE_IAM_AUTH cannot be used with a pglite: DATABASE_URL');
      return null;
   }
   let inferred: string | null = null;
   if (databaseUrl.startsWith('postgres:') || databaseUrl.startsWith('postgresql:')) {
      try {
         inferred = rdsRegionFromHostname(parsePostgresEndpoint(databaseUrl).hostname);
      } catch {
         inferred = null;
      }
   }
   const region = (
      env.DATABASE_IAM_REGION ??
      env.AWS_REGION ??
      env.AWS_DEFAULT_REGION ??
      inferred ??
      ''
   ).trim();
   if (!region) {
      problems.push(
         'DATABASE_IAM_AUTH requires DATABASE_IAM_REGION or AWS_REGION, or an *.rds.amazonaws.com hostname'
      );
      return null;
   }
   return {
      region,
      sslRejectUnauthorized: boolean(env.DATABASE_SSL_REJECT_UNAUTHORIZED, true),
   };
}

function boolean(value: string | undefined, fallback: boolean): boolean {
   const trimmed = (value ?? '').trim().toLowerCase();
   if (trimmed === '') return fallback;
   return trimmed === 'true' || trimmed === '1' || trimmed === 'yes';
}

/** A positive integer, or the fallback. */
function positiveInt(value: string | undefined, fallback: number): number {
   const trimmed = (value ?? '').trim();
   if (!trimmed || !/^\d+$/.test(trimmed)) return fallback;
   const parsed = Number(trimmed);
   return parsed > 0 ? parsed : fallback;
}

/**
 * How GitHub reaches Berry.
 *
 * There is no host or credential here any more: repositories are GitHub's, and
 * the credential is a GitHub App installation token minted per run by
 * `GitHubAppRepository`. What remains is the one secret that is Berry's own —
 * the webhook signing key.
 */
function git(env: NodeJS.ProcessEnv): GitConfig | null {
   const webhookSecret = (env.BERRY_GITHUB_WEBHOOK_SECRET ?? '').trim();
   return webhookSecret ? { webhookSecret } : null;
}

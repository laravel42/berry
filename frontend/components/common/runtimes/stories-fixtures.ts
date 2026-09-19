import type { Runtime, RuntimeDetail, RuntimeProfile } from '@/lib/runtimes';

/**
 * Runtimes as `/api/v1/runtimes` returns them: the deployment's platform
 * runtime plus two an owner registered by ARN, in each health state the list
 * distinguishes. Times are relative to the stories' fixed now, 2026-09-18 12:00Z.
 */

export const platformRuntime: Runtime = {
   id: 'rt-platform',
   name: 'Berry platform',
   kind: 'platform',
   driver: 'agentcore',
   arn: 'arn:aws:bedrock-agentcore:us-east-1:210987654321:runtime/berry_agent-Xk2P9qL0aZ',
   endpointUrl: null,
   qualifier: 'DEFAULT',
   region: 'us-east-1',
   status: 'active',
   lastHealthAt: '2026-09-18T11:56:00Z',
   lastHealthError: null,
   concurrencyLimit: 8,
   visibility: 'workspace',
   ownerId: null,
   idleTimeoutS: 3600,
   maxLifetimeS: 28_800,
   isDefault: true,
   activeRuns: 3,
};

export const customRuntime: Runtime = {
   id: 'rt-gpu',
   name: 'Research sandbox',
   kind: 'custom',
   driver: 'agentcore',
   arn: 'arn:aws:bedrock-agentcore:eu-west-1:123456789012:runtime/research_sandbox-7fQm2',
   endpointUrl: null,
   qualifier: 'DEFAULT',
   region: 'eu-west-1',
   status: 'unreachable',
   lastHealthAt: '2026-09-18T11:24:00Z',
   lastHealthError: 'AccessDeniedException: not authorized to perform InvokeAgentRuntime',
   concurrencyLimit: null,
   visibility: 'private',
   ownerId: 'user-1',
   idleTimeoutS: 900,
   maxLifetimeS: 14_400,
   isDefault: false,
   activeRuns: 0,
};

export const disabledRuntime: Runtime = {
   ...customRuntime,
   id: 'rt-old',
   name: 'Legacy staging',
   arn: 'arn:aws:bedrock-agentcore:us-west-2:123456789012:runtime/legacy_staging-a81Tz',
   region: 'us-west-2',
   status: 'disabled',
   lastHealthAt: '2026-08-02T09:00:00Z',
   lastHealthError: null,
   visibility: 'workspace',
   ownerId: 'user-2',
};

function activity(count: number) {
   const end = Date.UTC(2026, 8, 18);
   return Array.from({ length: count }, (_, index) => {
      const day = new Date(end - (count - 1 - index) * 86_400_000).toISOString().slice(0, 10);
      const weekday = index % 7;
      const runs = weekday >= 5 ? 1 : 4 + ((index * 3) % 7);
      return { day, runs, failed: index % 8 === 3 ? 1 : 0 };
   });
}

export const platformDetail: RuntimeDetail = {
   ...platformRuntime,
   activity: activity(30),
   servingAgents: [
      { id: 'agent-orch', name: 'Orchestrator', status: 'active', profileName: null },
      { id: 'agent-eng', name: 'Engineer', status: 'active', profileName: 'Long sessions' },
      { id: 'agent-rev', name: 'Code Reviewer', status: 'active', profileName: null },
      { id: 'agent-qa', name: 'QA Analyst', status: 'paused', profileName: null },
   ],
};

export const customDetail: RuntimeDetail = {
   ...customRuntime,
   activity: [],
   servingAgents: [
      { id: 'agent-research', name: 'Researcher', status: 'active', profileName: 'EU data' },
   ],
};

export const profiles: RuntimeProfile[] = [
   {
      id: 'prof-1',
      runtimeId: 'rt-platform',
      name: 'Long sessions',
      envKeys: ['GITHUB_ORG', 'SENTRY_DSN'],
      modelDefault: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      timeoutS: null,
      maxConcurrency: null,
      idleTimeoutS: 14_400,
   },
   {
      id: 'prof-2',
      runtimeId: 'rt-platform',
      name: 'Cheap triage',
      envKeys: [],
      modelDefault: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      timeoutS: 600,
      maxConcurrency: 4,
      idleTimeoutS: null,
   },
];

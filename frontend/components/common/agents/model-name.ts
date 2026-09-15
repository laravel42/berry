import { bareModelName, type Agent } from '@/lib/agents';

/**
 * A model id as a person would say it.
 *
 * `claude-sonnet-5` → "Claude Sonnet 5", `us.anthropic.claude-haiku-4-5-20251001-v1:0`
 * → "Claude Haiku 4.5", `claude-opus-4-1` → "Claude Opus 4.1". Only the Claude
 * family is mapped: a guess at another vendor's naming reads worse than the
 * bare id, which is what everything else gets.
 */
const CLAUDE = /^claude-(opus|sonnet|haiku)(?:-(\d+(?:-\d+)*))?$/i;

export function readableModelName(modelId: string): string {
   const bare = bareModelName(modelId) || modelId;
   const match = CLAUDE.exec(bare);
   if (!match) return bare;
   const family = (match[1] ?? '').toLowerCase();
   const name = `Claude ${family.charAt(0).toUpperCase()}${family.slice(1)}`;
   const version = match[2]?.replace(/-/g, '.');
   return version ? `${name} ${version}` : name;
}

/** The agent's model, readable, or a dash when it runs on none. */
export function agentModelName(agent: Pick<Agent, 'modelName'>): string {
   const model = agent.modelName?.trim();
   return model ? readableModelName(model) : '—';
}

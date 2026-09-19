import { bareModelName, modelPairKey, type Agent, type AgentModel } from '@/lib/agents';

/**
 * A model id as a person would say it.
 *
 * `claude-sonnet-5` → "Claude Sonnet 5", `us.anthropic.claude-haiku-4-5-20251001-v1:0`
 * → "Claude Haiku 4.5", `claude-opus-4-1` → "Claude Opus 4.1", `claude-fable-5`
 * → "Claude Fable 5", `anthropic/claude-sonnet-4.5` → "Claude Sonnet 4.5".
 * Only the Claude family is mapped: a guess at another vendor's naming reads
 * worse than the bare id, which is what everything else gets.
 */
const CLAUDE = /^claude-(opus|sonnet|haiku|fable|mythos)(?:-(\d+(?:[.-]\d+)*))?$/i;
/** Pre-4.x ids put the generation before the class: `claude-3-5-sonnet`. */
const CLAUDE_LEGACY = /^claude-(\d+(?:[.-]\d+)*)-(opus|sonnet|haiku)\b/i;

type ClaudeFamily = 'opus' | 'sonnet' | 'haiku' | 'fable' | 'mythos';

function claudeParts(modelId: string): { family: ClaudeFamily; version?: string } | null {
   let bare = bareModelName(modelId) || modelId;
   // Bedrock foundation ids omit the geography prefix: `anthropic.claude-…`.
   bare = bare.replace(/^anthropic\./i, '');
   const modern = CLAUDE.exec(bare);
   if (modern) {
      return {
         family: (modern[1] ?? '').toLowerCase() as ClaudeFamily,
         version: modern[2]?.replace(/-/g, '.'),
      };
   }
   const legacy = CLAUDE_LEGACY.exec(bare);
   if (legacy) {
      return {
         family: (legacy[2] ?? '').toLowerCase() as ClaudeFamily,
         version: legacy[1]?.replace(/-/g, '.'),
      };
   }
   return null;
}

export function readableModelName(modelId: string): string {
   const parts = claudeParts(modelId);
   if (!parts) return bareModelName(modelId) || modelId;
   const name = `Claude ${parts.family.charAt(0).toUpperCase()}${parts.family.slice(1)}`;
   return parts.version ? `${name} ${parts.version}` : name;
}

/** The agent's model, readable, or a dash when it runs on none. */
export function agentModelName(agent: Pick<Agent, 'modelName'>): string {
   const model = agent.modelName?.trim();
   return model ? readableModelName(model) : '—';
}

/**
 * Capability class from input price ($ / million prompt tokens):
 * ≤ $1 low, ≤ $2 mid, ≤ $3 mid-high, > $3 high.
 */
export type ModelTier = 'low' | 'mid' | 'midHigh' | 'high';

export function modelTierFromInputCost(inputCostPerM: number): ModelTier | null {
   if (!Number.isFinite(inputCostPerM) || inputCostPerM <= 0) return null;
   if (inputCostPerM <= 1) return 'low';
   if (inputCostPerM <= 2) return 'mid';
   if (inputCostPerM <= 3) return 'midHigh';
   return 'high';
}

/**
 * Anthropic's published input $/MTok when the live catalog has no price yet.
 * Sonnet 4.x is $3; current Sonnet 5 is $2. Opus / Fable / Mythos sit above $3.
 */
function publishedClaudeInputCost(modelId: string): number | null {
   const parts = claudeParts(modelId);
   if (!parts) return null;
   switch (parts.family) {
      case 'haiku':
         return 1;
      case 'sonnet': {
         const major = Number.parseInt(parts.version?.split('.')[0] ?? '', 10);
         return Number.isFinite(major) && major <= 4 ? 3 : 2;
      }
      case 'opus':
         return 5;
      case 'fable':
      case 'mythos':
         return 10;
      default:
         return null;
   }
}

/**
 * Tier for an agent: catalog input price first, then published Claude rates
 * when the catalog still quotes $0 / unknown for that id.
 */
export function modelTier(
   agent: Pick<Agent, 'modelProvider' | 'modelName'>,
   prices?: Map<string, AgentModel>
): ModelTier | null {
   const key = modelPairKey(agent);
   if (key && prices) {
      const entry = prices.get(key);
      if (entry && entry.inputCostPerM > 0) {
         return modelTierFromInputCost(entry.inputCostPerM);
      }
   }
   const model = agent.modelName?.trim();
   if (!model) return null;
   return modelTierFromInputCost(publishedClaudeInputCost(model) ?? 0);
}

/**
 * Same density as AutonomyLevelChip. Tier colours track autonomy 2→5 so
 * cheaper models read quieter than expensive ones:
 * low→info, mid→success, mid-high→review-pending, high→primary.
 */
export const MODEL_TIER_STYLE: Record<ModelTier, string> = {
   low: 'border-status-info/40 bg-status-info/10 text-status-info',
   mid: 'border-status-success/40 bg-status-success/10 text-status-success',
   midHigh: 'border-review-pending/40 bg-review-pending/10 text-review-pending',
   high: 'border-primary/40 bg-primary/10 text-primary',
};

export const MODEL_TIER_NEUTRAL =
   'border-status-neutral/40 bg-status-neutral/10 text-status-neutral';

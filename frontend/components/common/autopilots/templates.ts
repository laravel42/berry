/**
 * Starting points offered when a workspace has no autopilots yet.
 *
 * Copy (name, runbook, cadence) lives in the catalogue under
 * `areas.autopilots.templates`; this file holds what the editor pre-fills.
 * `agent` is matched by name against the workspace's agents, so a template
 * whose role is not in the organization simply leaves the agent unchosen.
 */
export const TEMPLATE_KEYS = ['standup', 'triage', 'sweep', 'digest', 'release', 'watch'] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export interface TemplatePreset {
   trigger: 'cron' | 'webhook';
   /** For `cron`: the five-field schedule, in the viewer's own time zone. */
   expression?: string;
   agent: string;
}

export const TEMPLATE_PRESETS: Record<TemplateKey, TemplatePreset> = {
   standup: { trigger: 'cron', expression: '0 9 * * 1-5', agent: 'Product Lead' },
   triage: { trigger: 'cron', expression: '0 * * * *', agent: 'Planner' },
   sweep: { trigger: 'cron', expression: '0 8 * * 1', agent: 'Planner' },
   digest: { trigger: 'cron', expression: '0 17 * * 5', agent: 'Product Lead' },
   release: { trigger: 'webhook', agent: 'Release Manager' },
   watch: { trigger: 'cron', expression: '0 * * * *', agent: 'QA Engineer' },
};

export function isTemplateKey(value: string | null | undefined): value is TemplateKey {
   return (
      value !== null && value !== undefined && (TEMPLATE_KEYS as readonly string[]).includes(value)
   );
}

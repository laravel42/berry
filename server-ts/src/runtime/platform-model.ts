/**
 * The model Berry itself provides: one light Amazon Bedrock model the operator
 * names in the environment (`BERRY_BEDROCK_MODEL`), for every workspace.
 *
 * It answers the product's own single calls (chat, the editors' AI help, a
 * project's draft, milestones and tasks generated from a brief, a Loop drafted
 * from a sentence) whatever the workspace has connected. The work agents do on
 * tasks, and the calls where an agent decides about that work (triage, plans,
 * the review gate), stay on the workspace's own AI providers.
 *
 * The server never calls Bedrock: it names the model on the envelope, and the
 * runtime image calls it with the host's own AWS credentials (its environment
 * locally, its role on AgentCore and Lambda MicroVMs).
 */

export interface PlatformModel {
   provider: 'bedrock';
   /** A Bedrock model or inference profile id, e.g. `us.amazon.nova-lite-v1:0`. */
   model: string;
   region: string;
}

/** Completion purposes the platform model answers. Anything else uses the workspace's providers. */
export const PLATFORM_MODEL_PURPOSES: ReadonlySet<string> = new Set([
   'chat_title',
   'chat_follow_ups',
   'editor_assist',
   'project_draft',
   'project_milestones',
   'project_milestone_tasks',
   'loop_draft',
   'agent_builder',
]);

let configured: PlatformModel | null = null;

/** Set once at boot from the configuration; null turns the platform model off. */
export function configurePlatformModel(model: PlatformModel | null): void {
   configured = model;
}

/**
 * The platform model a task runs on, or null when it uses the workspace's
 * providers. A chat reply is an agent task on a conversation with no issue.
 */
export function platformModelFor(task: {
   kind: 'agent' | 'completion';
   purpose?: string | null | undefined;
   chatSessionId?: string | null | undefined;
   issueId?: string | null | undefined;
}): PlatformModel | null {
   if (!configured) return null;
   if (task.kind === 'completion') return task.purpose && PLATFORM_MODEL_PURPOSES.has(task.purpose) ? configured : null;
   return task.chatSessionId && !task.issueId ? configured : null;
}

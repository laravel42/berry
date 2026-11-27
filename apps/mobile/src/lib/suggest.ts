import type { ApiIssuePriority, ApiProject } from '@/api/types';
import type { ActorView } from '@/model/mappers';

export type SuggestField = 'assignee' | 'priority' | 'project';

export type SuggestDirectory = {
  meId: string;
  agents: ActorView[];
  members: ActorView[];
  projects: ApiProject[];
};

export type SuggestOverrides = {
  assigneeId?: string | null;
  priority?: ApiIssuePriority;
  projectId?: string | null;
};

export type DirectorySuggestion = {
  assignee: ActorView | null;
  priority: ApiIssuePriority;
  project: ApiProject | null;
  reasons: Record<SuggestField, string>;
  overridden: Record<SuggestField, boolean>;
  title: string;
  canCreate: boolean;
  isAgent: boolean;
};

const AGENT_ROLE_RULES: [RegExp, RegExp][] = [
  [/\b(tests?|qa|regression|verify|bug\s*repro)\b/i, /qa|quality|test/i],
  [/\b(design|ui|ux|copy|empty state|screens?|icons?|layout|css)\b/i, /design|ui|ux/i],
  [/\b(deploy|infra|secrets?|webhooks?|ci|servers?|rotate|docker|aws)\b/i, /ops|platform|infra|devops/i],
  [/\b(security|auth|csrf|xss|token|audit|vuln)\b/i, /security/i],
  [/\b(code|api|endpoint|bug|fix|export|column|migration|database|build|add)\b/i, /software|engineer|builder|dev/i],
];

const PRIORITY_RULES: [RegExp, ApiIssuePriority][] = [
  [/\b(urgent|asap|today|broken|outage|critical)\b/i, 'urgent'],
  [/\b(important|soon|customers?|blocker|before release)\b/i, 'high'],
  [/\b(later|someday|nice to have|eventually)\b/i, 'low'],
];

export const PRIORITY_OPTIONS: ApiIssuePriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

export const COMPOSE_EXAMPLES = [
  'Fix the webhook retry timeout before release',
  'Add regression tests for the sign-in flow',
  'Design empty state for archived inbox',
];

function inferTitle(prompt: string): string {
  const clean = prompt.trim().replace(/\s+/g, ' ');
  if (!clean) return '';
  const firstSentence = clean.split(/[.!?\n]/, 1)[0]?.trim() || clean;
  return firstSentence.length > 72 ? `${firstSentence.slice(0, 71)}…` : firstSentence;
}

function matchAssignee(text: string, directory: SuggestDirectory): { actor: ActorView | null; reason: string } {
  if (/\b(i'll|i will|remind me|for me|myself)\b/i.test(text)) {
    const me = directory.members.find((m) => m.id === directory.meId) ?? null;
    if (me) return { actor: me, reason: 'Matched personal phrasing' };
  }

  for (const member of directory.members) {
    const firstName = member.name.split(/\s+/)[0]?.toLowerCase() ?? '';
    if (firstName.length >= 3 && text.toLowerCase().includes(firstName)) {
      return { actor: member, reason: `Mentioned “${member.name}”` };
    }
  }

  for (const [promptPattern, rolePattern] of AGENT_ROLE_RULES) {
    const match = text.match(promptPattern);
    if (!match) continue;
    const found = directory.agents.find((agent) =>
      rolePattern.test(`${agent.roleKey ?? ''} ${agent.name} ${agent.description ?? ''}`),
    );
    if (found) {
      return { actor: found, reason: `Matched “${match[0]}”` };
    }
  }

  const defaultAgent =
    directory.agents.find((a) => /software|engineer|builder/i.test(`${a.roleKey ?? ''} ${a.name}`)) ??
    directory.agents[0] ??
    directory.members.find((m) => m.id === directory.meId) ??
    null;

  return { actor: defaultAgent, reason: defaultAgent ? 'Closest fit' : 'Unassigned' };
}

function matchPriority(text: string): { priority: ApiIssuePriority; reason: string } {
  for (const [pattern, value] of PRIORITY_RULES) {
    const match = text.match(pattern);
    if (match?.[0]) return { priority: value, reason: `Matched “${match[0]}”` };
  }
  return { priority: 'medium', reason: 'Default' };
}

function matchProject(text: string, projects: ApiProject[]): { project: ApiProject | null; reason: string } {
  const lower = text.toLowerCase();
  for (const project of projects) {
    const tokens = project.name
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((tok) => tok.length >= 3);
    const hit = tokens.find((tok) => lower.includes(tok));
    if (hit) {
      return { project, reason: `Matched “${hit}”` };
    }
  }
  return { project: null, reason: 'No project' };
}

export function suggestFromDirectory(
  prompt: string,
  directory: SuggestDirectory,
  overrides: SuggestOverrides,
): DirectorySuggestion {
  const allActors = [...directory.agents, ...directory.members];
  const autoAssignee = matchAssignee(prompt, directory);
  const autoPriority = matchPriority(prompt);
  const autoProject = matchProject(prompt, directory.projects);

  const assigneeOverridden = overrides.assigneeId !== undefined;
  const assignee = assigneeOverridden
    ? overrides.assigneeId === null
      ? null
      : (allActors.find((a) => a.id === overrides.assigneeId) ?? null)
    : autoAssignee.actor;

  const priorityOverridden = overrides.priority !== undefined;
  const priority = priorityOverridden && overrides.priority ? overrides.priority : autoPriority.priority;

  const projectOverridden = overrides.projectId !== undefined;
  const project = projectOverridden
    ? overrides.projectId === null
      ? null
      : (directory.projects.find((p) => p.id === overrides.projectId) ?? null)
    : autoProject.project;

  const title = inferTitle(prompt);

  return {
    assignee,
    priority,
    project,
    reasons: {
      assignee: assigneeOverridden ? 'You chose this' : autoAssignee.reason,
      priority: priorityOverridden ? 'You chose this' : autoPriority.reason,
      project: projectOverridden ? 'You chose this' : autoProject.reason,
    },
    overridden: {
      assignee: assigneeOverridden,
      priority: priorityOverridden,
      project: projectOverridden,
    },
    title,
    canCreate: prompt.trim().length > 0,
    isAgent: assignee?.type === 'agent',
  };
}

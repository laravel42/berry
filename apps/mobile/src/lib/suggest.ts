import { person } from '@/data/people';
import type { PersonId, Priority } from '@/model/types';

export type SuggestField = 'assignee' | 'priority' | 'project';

export type Suggestion = {
  assignee: PersonId;
  priority: Priority;
  project: string;
  reasons: Record<SuggestField, string>;
  overridden: Record<SuggestField, boolean>;
  title: string;
  canCreate: boolean;
  isAgent: boolean;
};

const RULES: Record<SuggestField, [RegExp, string][]> = {
  assignee: [
    [/\b(tests?|qa|regression|verify)\b/, 'qa'],
    [/\b(design|ui|ux|copy|empty state|screens?|icons?|layout)\b/, 'pd'],
    [/\b(deploy|infra|secrets?|webhooks?|ci|servers?|rotate)\b/, 'ops'],
    [/\blena\b/, 'lena'],
    [/\b(i'll|i will|remind me|for me)\b/, 'me'],
    [/\b(code|api|endpoint|bug|fix|export|column|migration|database|build|add)\b/, 'se'],
  ],
  priority: [
    [/\b(urgent|asap|today|broken|outage)\b/, 'urgent'],
    [/\b(important|soon|customers?|blocker|before release)\b/, 'high'],
    [/\b(later|someday|nice to have|eventually)\b/, 'low'],
  ],
  project: [
    [/\b(invoices?|export|csv|currency|finance)\b/, 'Invoices'],
    [/\b(inbox|notifications?|approvals?|proposals?)\b/, 'Inbox'],
  ],
};

const DEFAULTS: Record<SuggestField, [string, string]> = {
  assignee: ['se', 'Closest fit for most work'],
  priority: ['medium', 'Default'],
  project: ['Platform', 'Default'],
};

function matchField(field: SuggestField, text: string): [string, string] {
  for (const [pattern, value] of RULES[field]) {
    const found = text.match(pattern);
    if (found?.[0]) return [value, `Matched “${found[0]}”`];
  }
  return DEFAULTS[field];
}

export function suggest(prompt: string, overrides: Partial<Record<SuggestField, string>>): Suggestion {
  const text = prompt.toLowerCase();
  const reasons = {} as Record<SuggestField, string>;
  const overridden = {} as Record<SuggestField, boolean>;
  const values: Record<SuggestField, string> = { assignee: 'se', priority: 'medium', project: 'Platform' };
  (Object.keys(RULES) as SuggestField[]).forEach((field) => {
    const [value, reason] = matchField(field, text);
    const override = overrides[field];
    values[field] = override ?? value;
    overridden[field] = override != null;
    reasons[field] = override != null ? 'Set by you' : reason;
  });
  const first = prompt.split(/[.!?\n]/)[0]?.trim() ?? '';
  const title = first
    ? `${first[0]?.toUpperCase() ?? ''}${first.slice(1)}`.slice(0, 64) + (first.length > 64 ? '…' : '')
    : '';
  const assignee = values.assignee as PersonId;
  return {
    assignee,
    priority: values.priority as Priority,
    project: values.project,
    reasons,
    overridden,
    title,
    canCreate: prompt.trim().length > 0,
    isAgent: person(assignee).agent,
  };
}

export const COMPOSE_EXAMPLES = [
  'Fix the currency column in the CSV export before release',
  'Write tests for the approvals redirect',
  'Design an empty state for the invoices table',
  'Rotate the webhook secrets today',
];

export const ASSIGNEE_OPTIONS: PersonId[] = ['me', 'lena', 'se', 'pd', 'qa', 'ops'];
export const PRIORITY_OPTIONS: Priority[] = ['urgent', 'high', 'medium', 'low'];
export const PROJECT_OPTIONS = ['Invoices', 'Inbox', 'Platform'];

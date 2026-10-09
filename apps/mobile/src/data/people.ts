import type { PersonId, Presence, Status, Tone } from '@/model/types';
import { colors } from '@/theme/tokens';

export type Person = {
  id: PersonId;
  name: string;
  initials: string;
  agent: boolean;
};

export const PEOPLE: Record<PersonId, Person> = {
  me: { id: 'me', name: 'Maya Chen', initials: 'MC', agent: false },
  lena: { id: 'lena', name: 'Lena Ortiz', initials: 'LO', agent: false },
  se: { id: 'se', name: 'Software Engineer', initials: 'SE', agent: true },
  pd: { id: 'pd', name: 'Product Designer', initials: 'PD', agent: true },
  qa: { id: 'qa', name: 'QA Engineer', initials: 'QA', agent: true },
  ops: { id: 'ops', name: 'DevOps Engineer', initials: 'DO', agent: true },
  orch: { id: 'orch', name: 'Orchestrator', initials: 'OR', agent: true },
  berry: { id: 'berry', name: 'Berry', initials: 'B', agent: true },
  none: { id: 'none', name: 'Unassigned', initials: '–', agent: false },
};

export function person(id: PersonId): Person {
  return PEOPLE[id] ?? PEOPLE.none;
}

export function issueKey(id: string): string {
  return `BERR-${id}`;
}

export const STATUS: Record<Status, { label: string; tone: Tone; hollow: boolean; crossed: boolean }> = {
  in_review: { label: 'In review', tone: 'attention', hollow: false, crossed: false },
  in_progress: { label: 'In progress', tone: 'working', hollow: false, crossed: false },
  todo: { label: 'Todo', tone: 'neutral', hollow: true, crossed: false },
  blocked: { label: 'Blocked', tone: 'attention', hollow: false, crossed: true },
  backlog: { label: 'Backlog', tone: 'neutral', hollow: true, crossed: false },
  done: { label: 'Done', tone: 'complete', hollow: false, crossed: false },
};

export const STATUS_ORDER: Status[] = [
  'in_review',
  'in_progress',
  'todo',
  'blocked',
  'backlog',
  'done',
];

export const TONE_COLOR: Record<Tone, string> = {
  neutral: colors.ash,
  working: colors.azure,
  attention: colors.amber,
  complete: colors.verdant,
  danger: colors.danger,
};

export const PRIORITY_LEVEL: Record<string, { bars: number; label: string }> = {
  none: { bars: 0, label: 'No priority' },
  low: { bars: 1, label: 'Low' },
  medium: { bars: 2, label: 'Medium' },
  high: { bars: 3, label: 'High' },
  urgent: { bars: 4, label: 'Urgent' },
};

export const PRESENCE_COLOR: Record<Presence, string> = {
  working: colors.azure,
  blocked: colors.amber,
  online: colors.verdant,
  idle: colors.ash,
};

export const DIRECTORY: { title: string; rows: { id: PersonId; sub: string }[] }[] = [
  {
    title: 'Agents',
    rows: [
      { id: 'se', sub: 'Code, database, integrations, docs' },
      { id: 'pd', sub: 'UI and UX, design assets and styles' },
      { id: 'qa', sub: 'Tests and reviews delivered work' },
      { id: 'ops', sub: 'Deploys, infrastructure, incidents' },
      { id: 'orch', sub: 'Sorts incoming work and sends it on' },
    ],
  },
  {
    title: 'People',
    rows: [{ id: 'lena', sub: 'Product · Online' }],
  },
];

export const AGENT_REPLIES: Partial<Record<PersonId, string[]>> = {
  se: [
    'The currency fix is next. I will restart the run on BERR-41 when you say go.',
    'Noted. I added that to the task so it is there on the next run.',
  ],
  pd: [
    'Thanks. Once BERR-40 has an answer I will finish the empty state today.',
    'Got it. I will attach the updated screens to the task.',
  ],
  qa: [
    'I will rerun the checks after the next push and report back here.',
    'Understood. I will add a test for that case.',
  ],
};

export const VOICE_TRANSCRIPTS: Partial<Record<PersonId, string>> = {
  se: 'Where is the run on BERR-41 now, and what is left?',
  pd: 'Can you send me the empty-state options again?',
  qa: 'Did the redirect test run on Safari too?',
  lena: 'I am checking the currency column now. Back to you before lunch.',
};

export const CALL_LINES: Partial<Record<PersonId, string[]>> = {
  se: [
    'The endpoint is merged. The button is waiting on BERR-40.',
    'I can restart the currency fix on BERR-41 after this call.',
  ],
  qa: ['All four checks passed on pull request 212.', 'I will rerun the checks after the next push.'],
  pd: ['I need the empty-state copy before I can finish the button.'],
  ops: ['Two webhook secrets are past 90 days. Rotation needs an admin.'],
  orch: ['I will route the 0.9 tasks once the plan is started.'],
  lena: ['Finance would like the export by Monday.', 'The October report is the one to compare against.'],
};

export const ADDABLE_AGENTS: PersonId[] = ['se', 'qa', 'pd', 'ops', 'orch'];

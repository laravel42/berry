import type { ApiActorRef, ApiAgent, ApiIssuePriority, ApiMember } from '@/api/types';
import type { Tone } from '@/model/types';
import { colors } from '@/theme/tokens';

export type IssueStatusUi =
  | 'in_review'
  | 'in_progress'
  | 'todo'
  | 'blocked'
  | 'backlog'
  | 'done'
  | 'cancelled';

export type ActorView = {
  id: string;
  type: 'user' | 'agent';
  name: string;
  initials: string;
  avatarUrl: string | null;
  roleKey?: string | null;
  description?: string | null;
  status?: string | null;
};

export const UNASSIGNED_ACTOR: ActorView = {
  id: 'unassigned',
  type: 'user',
  name: 'Unassigned',
  initials: '–',
  avatarUrl: null,
};

export const STATUS_META: Record<IssueStatusUi, { label: string; tone: Tone; hollow: boolean; crossed: boolean }> = {
  in_review: { label: 'In review', tone: 'attention', hollow: false, crossed: false },
  in_progress: { label: 'In progress', tone: 'working', hollow: false, crossed: false },
  todo: { label: 'Todo', tone: 'neutral', hollow: true, crossed: false },
  blocked: { label: 'Blocked', tone: 'attention', hollow: false, crossed: true },
  backlog: { label: 'Backlog', tone: 'neutral', hollow: true, crossed: false },
  done: { label: 'Done', tone: 'complete', hollow: false, crossed: false },
  cancelled: { label: 'Cancelled', tone: 'neutral', hollow: false, crossed: true },
};

export const STATUS_ORDER_UI: IssueStatusUi[] = [
  'in_review',
  'in_progress',
  'todo',
  'blocked',
  'backlog',
  'done',
  'cancelled',
];

export const TONE_COLOR_MAP: Record<Tone, string> = {
  neutral: colors.ash,
  working: colors.azure,
  attention: colors.amber,
  complete: colors.verdant,
  danger: colors.danger,
};

export const PRIORITY_META: Record<ApiIssuePriority, { bars: number; label: string }> = {
  none: { bars: 0, label: 'No priority' },
  low: { bars: 1, label: 'Low' },
  medium: { bars: 2, label: 'Medium' },
  high: { bars: 3, label: 'High' },
  urgent: { bars: 4, label: 'Urgent' },
};

const API_TO_UI_STATUS: Record<string, IssueStatusUi> = {
  backlog: 'backlog',
  todo: 'todo',
  inProgress: 'in_progress',
  in_progress: 'in_progress',
  inReview: 'in_review',
  in_review: 'in_review',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled',
};

const UI_TO_API_STATUS: Record<IssueStatusUi, string> = {
  backlog: 'backlog',
  todo: 'todo',
  in_progress: 'inProgress',
  in_review: 'inReview',
  blocked: 'blocked',
  done: 'done',
  cancelled: 'cancelled',
};

const VALID_PRIORITIES = new Set<string>(['none', 'low', 'medium', 'high', 'urgent']);

export function mapApiStatus(raw: string | null | undefined): IssueStatusUi {
  if (!raw) return 'backlog';
  return API_TO_UI_STATUS[raw] ?? 'backlog';
}

export function mapUiStatusToApi(status: IssueStatusUi): string {
  return UI_TO_API_STATUS[status];
}

export function mapApiPriority(raw: string | null | undefined): ApiIssuePriority {
  if (raw && VALID_PRIORITIES.has(raw)) {
    return raw as ApiIssuePriority;
  }
  return 'none';
}

export function deriveInitials(name: string | null | undefined): string {
  const cleaned = (name ?? '').trim();
  if (!cleaned) return '?';
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const first = words[0]?.[0] ?? '';
    const last = words[words.length - 1]?.[0] ?? '';
    return `${first}${last}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

export function formatRelativeTime(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const diffSec = Math.max(0, Math.round((nowMs - ts) / 1000));
  if (diffSec < 45) return 'now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 45) return `${diffMin}m`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h`;
  const diffDays = Math.round(diffHours / 24);
  return `${diffDays}d`;
}

export function actorFromMember(member: ApiMember): ActorView {
  return {
    id: member.userId,
    type: 'user',
    name: member.name || member.email,
    initials: deriveInitials(member.name || member.email),
    avatarUrl: member.avatarUrl,
  };
}

export function actorFromAgent(agent: ApiAgent): ActorView {
  return {
    id: agent.id,
    type: 'agent',
    name: agent.name,
    initials: deriveInitials(agent.name),
    avatarUrl: agent.avatarUrl,
    roleKey: agent.roleKey ?? null,
    description: agent.description,
    status: agent.status,
  };
}

export function actorFromRef(ref: ApiActorRef | null | undefined): ActorView {
  if (!ref) return UNASSIGNED_ACTOR;
  return {
    id: ref.id,
    type: ref.type,
    name: ref.name,
    initials: deriveInitials(ref.name),
    avatarUrl: ref.avatarUrl,
  };
}

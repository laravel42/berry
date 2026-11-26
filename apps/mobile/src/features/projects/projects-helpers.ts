import type { ApiIssue, ApiProject } from '@/api/types';
import { mapApiStatus } from '@/model/mappers';

export type ProjectHealthTone = 'verdant' | 'amber' | 'danger' | 'ash';

export type ProjectFilter = 'all' | 'active' | 'planned' | 'completed' | 'at_risk';

function normalizeToken(raw: string | null | undefined): string {
  return (raw ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function humanizeToken(raw: string): string {
  const spaced = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
  if (!spaced) return 'Unknown';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

export function formatProjectStatus(status: string | null | undefined): string {
  if (!status) return 'Planned';
  return humanizeToken(status);
}

export function formatProjectHealth(
  health: string | null | undefined,
): { label: string; tone: ProjectHealthTone } {
  const normalized = (health ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'on_track' || normalized === 'ontrack' || normalized === 'healthy') {
    return { label: 'On track', tone: 'verdant' };
  }
  if (normalized === 'at_risk' || normalized === 'atrisk') {
    return { label: 'At risk', tone: 'amber' };
  }
  if (normalized === 'off_track' || normalized === 'offtrack') {
    return { label: 'Off track', tone: 'danger' };
  }
  return { label: humanizeToken(health ?? 'unknown'), tone: 'ash' };
}

export function filterProjects(projects: ApiProject[], query: string): ApiProject[] {
  return filterProjectsByCriteria(projects, query, 'all');
}

export function matchesProjectFilter(project: ApiProject, filter: ProjectFilter): boolean {
  if (filter === 'all') return true;
  const status = normalizeToken(project.status);
  const health = normalizeToken(project.health);
  if (filter === 'active') {
    return status === 'in_progress' || status === 'active' || status === 'started';
  }
  if (filter === 'planned') {
    return status === 'planned' || status === 'backlog';
  }
  if (filter === 'completed') {
    return status === 'completed' || status === 'done';
  }
  return health === 'at_risk' || health === 'atrisk' || health === 'off_track' || health === 'offtrack';
}

export function filterProjectsByCriteria(
  projects: readonly ApiProject[],
  query: string,
  filter: ProjectFilter,
): ApiProject[] {
  const needle = query.trim().toLowerCase();
  return projects.filter((project) => {
    if (!matchesProjectFilter(project, filter)) return false;
    if (!needle) return true;
    const name = project.name.toLowerCase();
    const description = (project.description ?? '').toLowerCase();
    const status = formatProjectStatus(project.status).toLowerCase();
    return name.includes(needle) || description.includes(needle) || status.includes(needle);
  });
}

export function filterIssuesByProject(issues: ApiIssue[], projectId: string): ApiIssue[] {
  return issues.filter((issue) => issue.project?.id === projectId);
}

export function summarizeProjectIssues(issues: ApiIssue[]): {
  total: number;
  done: number;
  active: number;
} {
  let done = 0;
  let active = 0;
  for (const issue of issues) {
    const uiStatus = mapApiStatus(issue.status);
    if (uiStatus === 'done') {
      done += 1;
    } else if (uiStatus !== 'cancelled') {
      active += 1;
    }
  }
  return { total: issues.length, done, active };
}

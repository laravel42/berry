import { describe, expect, test } from 'bun:test';

import type { ApiIssue, ApiProject } from '@/api/types';

import {
  filterIssuesByProject,
  filterProjects,
  filterProjectsByCriteria,
  formatProjectHealth,
  formatProjectStatus,
  summarizeProjectIssues,
} from './projects-helpers';

const baseProject: ApiProject = {
  id: 'proj-1',
  workspaceId: 'ws-1',
  name: 'Mobile App',
  description: 'Expo iOS & Android client',
  status: 'in_progress',
  priority: 'high',
  health: 'on_track',
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-25T00:00:00.000Z',
};

function makeIssue(id: string, status: string, projectId: string | null): ApiIssue {
  return {
    id,
    boardId: 'board-1',
    number: 1,
    identifier: `BER-${id}`,
    title: `Task ${id}`,
    description: null,
    status,
    priority: 'medium',
    sortOrder: 0,
    startDate: null,
    dueDate: null,
    assignee: null,
    activeRunId: null,
    project: projectId ? { id: projectId, name: 'Mobile App' } : null,
    createdBy: null,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
  };
}

describe('projects helpers', () => {
  test('formats project status and health labels consistently', () => {
    expect(formatProjectStatus('in_progress')).toBe('In progress');
    expect(formatProjectStatus('inProgress')).toBe('In progress');
    expect(formatProjectStatus('planned')).toBe('Planned');
    expect(formatProjectStatus('completed')).toBe('Completed');
    expect(formatProjectHealth('on_track')).toEqual({ label: 'On track', tone: 'verdant' });
    expect(formatProjectHealth('at_risk')).toEqual({ label: 'At risk', tone: 'amber' });
    expect(formatProjectHealth('off_track')).toEqual({ label: 'Off track', tone: 'danger' });
    expect(formatProjectHealth('unknown')).toEqual({ label: 'Unknown', tone: 'ash' });
  });

  test('filters projects by query across name and description', () => {
    const second: ApiProject = {
      ...baseProject,
      id: 'proj-2',
      name: 'Billing Engine',
      description: 'Stripe webhooks and invoices',
    };
    expect(filterProjects([baseProject, second], '')).toHaveLength(2);
    expect(filterProjects([baseProject, second], 'expo').map((p) => p.id)).toEqual(['proj-1']);
    expect(filterProjects([baseProject, second], 'BILLING').map((p) => p.id)).toEqual(['proj-2']);
  });

  test('filters projects by status and health criteria combined with query', () => {
    const projects: ApiProject[] = [
      { ...baseProject, id: 'p-active', name: 'Mobile', status: 'in_progress', health: 'on_track' },
      { ...baseProject, id: 'p-started', name: 'Sync', status: 'started', health: 'at_risk' },
      { ...baseProject, id: 'p-planned', name: 'Roadmap', status: 'planned', health: 'on_track' },
      { ...baseProject, id: 'p-backlog', name: 'Ideas', status: 'backlog', health: 'off_track' },
      { ...baseProject, id: 'p-done', name: 'Launch', status: 'completed', health: 'on_track' },
    ];

    expect(filterProjectsByCriteria(projects, '', 'all')).toHaveLength(5);
    expect(filterProjectsByCriteria(projects, '', 'active').map((p) => p.id)).toEqual(['p-active', 'p-started']);
    expect(filterProjectsByCriteria(projects, '', 'planned').map((p) => p.id)).toEqual(['p-planned', 'p-backlog']);
    expect(filterProjectsByCriteria(projects, '', 'completed').map((p) => p.id)).toEqual(['p-done']);
    expect(filterProjectsByCriteria(projects, '', 'at_risk').map((p) => p.id)).toEqual(['p-started', 'p-backlog']);
    expect(filterProjectsByCriteria(projects, 'sync', 'at_risk').map((p) => p.id)).toEqual(['p-started']);
  });

  test('filters issues by project and summarizes open vs done counts', () => {
    const issues = [
      makeIssue('1', 'inProgress', 'proj-1'),
      makeIssue('2', 'done', 'proj-1'),
      makeIssue('3', 'inReview', 'proj-1'),
      makeIssue('4', 'todo', 'proj-2'),
      makeIssue('5', 'backlog', null),
    ];
    const scoped = filterIssuesByProject(issues, 'proj-1');
    expect(scoped.map((i) => i.id)).toEqual(['1', '2', '3']);
    expect(summarizeProjectIssues(scoped)).toEqual({
      total: 3,
      done: 1,
      active: 2,
    });
  });
});

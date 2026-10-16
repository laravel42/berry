import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chatWorkspaceNote, formatWorkspaceOverview, type WorkspaceOverview } from './workspace-overview.ts';

const empty: WorkspaceOverview = { tasks: [], plans: [], goals: [], projects: [], truncated: false };

test('an empty workspace is said once, and the agent is told not to list it', () => {
   const note = chatWorkspaceNote(empty);
   assert.match(note, /no open tasks, plans, goals or projects/);
   assert.match(note, /Answer from that snapshot/);
   assert.match(note, /Do not list the workspace before answering/);
   assert.match(note, /To create a project, call create_project/);
   assert.match(note, /Write markdown \(headings, lists, tables\)/);
   assert.match(note, /Do not emit HTML/);
   assert.doesNotMatch(note, /list_tasks, list_plans, list_goals and list_projects before answering/);
});

test('open work is a compact list with assignee and project', () => {
   const text = formatWorkspaceOverview({
      tasks: [
         {
            identifier: 'ABC-1',
            title: 'Incoming brief',
            status: 'todo',
            assigneeName: 'Planner',
            project: 'Site',
         },
      ],
      plans: [{ title: 'Q4 launch', status: 'draft' }],
      goals: [{ title: 'Ship billing', status: 'active' }],
      projects: [{ name: 'Site', status: 'planned' }],
      truncated: false,
   });
   assert.match(text, /ABC-1 \(todo\): Incoming brief \[Site\] — Planner/);
   assert.match(text, /Q4 launch \(draft\)/);
   assert.match(text, /Ship billing \(active\)/);
   assert.match(text, /Site \(planned\)/);
   assert.doesNotMatch(text, /newest 40/);
});

test('a long title is one line, and a truncated page says so', () => {
   const text = formatWorkspaceOverview({
      tasks: [
         {
            identifier: 'ABC-9',
            title: `Need ${'very '.repeat(40)}soon`,
            status: 'in_progress',
            assigneeName: null,
            project: null,
         },
      ],
      plans: [],
      goals: [],
      projects: [],
      truncated: true,
   });
   const line = text.split('\n').find((row) => row.startsWith('- ABC-9'));
   assert.ok(line);
   assert.ok(line.length <= 120);
   assert.match(line, /\.\.\.$/);
   assert.match(text, /newest 40/);
});

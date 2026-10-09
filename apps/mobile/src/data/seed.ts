import type { Chat, Goal, Issue, Meeting, Notification } from '@/model/types';

export const TODAY = '2026-10-09';
export const INITIAL_WEEK = '2026-10-05';

const act = (who: Issue['activity'][number]['who'], text: string, time: string) => ({ who, text, time });

export const ISSUES: Issue[] = [
  {
    id: '38',
    title: 'Move approvals and proposals into the inbox',
    status: 'in_review',
    priority: 'high',
    assignee: 'se',
    createdBy: 'me',
    project: 'Inbox',
    decision: 'review',
    desc: 'Approvals and agent proposals should arrive as inbox items, so a person can decide without leaving the feed.',
    pr: {
      num: '#212',
      branch: 'berr-38-inbox-approvals',
      files: 7,
      add: 214,
      del: 61,
      checks: '4 of 4 project checks passed',
    },
    qa: 'QA Engineer approved',
    handoff:
      'Approvals and proposals now land in the inbox as their own items. Start and Decline sit in the detail pane, and the old Approvals page redirects here.',
    activity: [
      act('orch', 'assigned Software Engineer', '1h'),
      act('se', 'opened pull request #212', '28m'),
      act('qa', 'approved the change', '9m'),
      act('se', 'moved this to In review', '4m'),
    ],
  },
  {
    id: '44',
    title: 'Drop the legacy invoice_exports table',
    status: 'backlog',
    priority: 'medium',
    assignee: 'se',
    createdBy: 'me',
    project: 'Invoices',
    decision: 'approval',
    desc: 'The CSV export no longer reads invoice_exports. Remove the table and the migration guard that protects it.',
    approval: 'Software Engineer wants to start this task. The plan marked it for approval because it deletes data.',
    activity: [act('orch', 'assigned Software Engineer', '14m'), act('berry', 'asked for your approval', '12m')],
  },
  {
    id: '41',
    title: 'Add the currency column to the CSV export',
    status: 'todo',
    priority: 'high',
    assignee: 'se',
    createdBy: 'me',
    project: 'Invoices',
    decision: 'failed',
    desc: 'Each exported row should carry the invoice currency next to the amount.',
    failure: 'Timed out after 30 min. The runtime stopped responding while the project checks were running.',
    activity: [
      act('berry', 'started a run for Software Engineer', '58m'),
      act('berry', 'reported the run failed: timed out', '25m'),
    ],
  },
  {
    id: '40',
    title: 'Empty state for the export button',
    status: 'blocked',
    priority: 'medium',
    assignee: 'pd',
    createdBy: 'me',
    project: 'Invoices',
    decision: 'question',
    desc: 'Show something useful when the current filter matches no invoices.',
    question: 'Which copy should the export button use when the filter matches no invoices?',
    options: ['“No invoices match this filter”', '“Nothing to export yet”', 'Hide the button instead'],
    activity: [act('orch', 'assigned Product Designer', '2h'), act('pd', 'escalated a question to you', '1h')],
  },
  {
    id: '36',
    title: 'Check the currency column against the finance report',
    status: 'in_progress',
    priority: 'medium',
    assignee: 'me',
    createdBy: 'lena',
    project: 'Invoices',
    desc: 'Compare one month of exported rows with the finance team’s report before we ship.',
    activity: [
      act('lena', 'assigned you', '3h'),
      act('lena', 'mentioned you: “can you check the currency column against the finance report?”', '2h'),
    ],
  },
  {
    id: '45',
    title: 'Rotate webhook signing secrets',
    status: 'todo',
    priority: 'urgent',
    assignee: 'me',
    createdBy: 'ops',
    project: 'Platform',
    desc: 'Two autopilot webhook secrets are older than 90 days. Rotating them needs an admin.',
    activity: [act('ops', 'created this task', '3h'), act('ops', 'assigned you', '3h')],
  },
  {
    id: '47',
    title: 'Write release notes for 0.9',
    status: 'backlog',
    priority: 'low',
    assignee: 'me',
    createdBy: 'me',
    project: 'Platform',
    desc: 'Cover the inbox changes, AutoGate and the new model tiers.',
    activity: [act('me', 'created this task', '2d')],
  },
  {
    id: '35',
    title: 'CSV export endpoint',
    status: 'done',
    priority: 'high',
    assignee: 'se',
    createdBy: 'me',
    project: 'Invoices',
    desc: 'Stream the filtered invoice list as CSV.',
    activity: [act('se', 'opened pull request #205', '1d'), act('me', 'approved and moved this to Done', '1d')],
  },
  {
    id: '33',
    title: 'Review onboarding copy',
    status: 'done',
    priority: 'low',
    assignee: 'me',
    createdBy: 'me',
    project: 'Inbox',
    desc: 'Read through the first-use inbox and tasks copy.',
    activity: [act('me', 'moved this to Done', '3d')],
  },
];

export const DUE: Record<string, string> = {
  '45': '2026-10-09',
  '38': '2026-10-09',
  '36': '2026-10-10',
  '41': '2026-10-12',
  '47': '2026-10-13',
  '40': '2026-10-14',
  '35': '2026-10-07',
};

export const NOTIFICATIONS: Notification[] = [
  { id: 'n1', issue: '38', kind: 'review', body: 'Software Engineer delivered #212, QA approved', time: '4m', read: false, needs: true, archived: false },
  { id: 'n2', issue: '44', kind: 'approval', body: 'Starting this task deletes data', time: '12m', read: false, needs: true, archived: false },
  { id: 'n3', issue: '41', kind: 'failed', body: 'Software Engineer timed out after 30 min', time: '25m', read: false, needs: true, archived: false },
  { id: 'n4', issue: '40', kind: 'blocked', body: 'Product Designer needs a decision on empty-state copy', time: '1h', read: true, needs: true, archived: false },
  { id: 'n5', issue: '36', kind: 'mention', body: 'Lena Ortiz: “can you check the currency column?”', time: '2h', read: true, needs: false, archived: false },
  { id: 'n6', issue: '45', kind: 'assigned', body: 'DevOps Engineer marked this urgent', time: '3h', read: true, needs: false, archived: false },
  { id: 'n7', issue: '35', kind: 'done', body: 'You approved CSV export endpoint', time: '1d', read: true, needs: false, archived: true },
];

export const MEETINGS: Meeting[] = [
  { id: 'm0', date: '2026-10-06', start: '10:00', end: '10:15', title: 'Invoices standup', people: ['me', 'lena', 'se', 'qa'] },
  { id: 'm6', date: '2026-10-08', start: '15:00', end: '15:30', title: 'Design sync', people: ['me', 'lena', 'pd'] },
  { id: 'm1', date: '2026-10-09', start: '10:00', end: '10:15', title: 'Invoices standup', people: ['me', 'lena', 'se', 'qa'] },
  { id: 'm2', date: '2026-10-09', start: '14:00', end: '14:45', title: 'CSV export review', people: ['me', 'lena', 'pd'] },
  { id: 'm4', date: '2026-10-12', start: '11:00', end: '12:00', title: 'Plan the 0.9 release', people: ['me', 'lena', 'orch'] },
  { id: 'm5', date: '2026-10-15', start: '16:00', end: '16:30', title: 'Release 0.9 go/no-go', people: ['me', 'lena', 'ops', 'qa'] },
];

export const GOALS: Goal[] = [
  { date: '2026-10-08', title: 'Export endpoint', plan: 'CSV export', done: 4, total: 4 },
  { date: '2026-10-09', title: 'Export button and download', plan: 'CSV export', done: 1, total: 3 },
  { date: '2026-10-14', title: 'Approvals in the inbox', plan: 'Inbox', done: 0, total: 2 },
];

export const CHATS: Chat[] = [
  {
    id: 'se',
    type: 'agent',
    who: 'se',
    presence: 'working',
    status: 'Working on BERR-41',
    unread: 1,
    messages: [
      { id: 'se-0', from: 'se', text: 'I opened #212 for BERR-38. QA approved it, and it is waiting on your review.', ref: '38', time: '9:31' },
      { id: 'se-1', from: 'me', voice: { dur: 9 }, transcript: 'Thanks. Does the old approvals link keep working after the redirect?', time: '9:34' },
      { id: 'se-2', from: 'se', text: 'Yes. /approvals?id= redirects to the inbox with the item open, and there is a test for it.', time: '9:35' },
    ],
  },
  {
    id: 'lena',
    type: 'person',
    who: 'lena',
    presence: 'online',
    status: 'Online',
    unread: 1,
    messages: [
      { id: 'lena-0', from: 'lena', text: 'Can you check the currency column against the finance report?', time: 'Yesterday' },
      { id: 'lena-1', from: 'me', text: 'On it this morning.', time: 'Yesterday' },
      { id: 'lena-2', from: 'lena', voice: { dur: 12 }, transcript: 'Finance would like the export by Monday. The October report is in the shared drive.', time: '8:52' },
    ],
  },
  {
    id: 'pd',
    type: 'agent',
    who: 'pd',
    presence: 'blocked',
    status: 'Blocked on BERR-40',
    unread: 0,
    messages: [
      { id: 'pd-0', from: 'pd', text: 'I need a decision on the empty-state copy before I can finish. The options are on the task.', ref: '40', time: '8:44' },
    ],
  },
  {
    id: 'qa',
    type: 'agent',
    who: 'qa',
    presence: 'idle',
    status: 'Idle',
    unread: 0,
    messages: [{ id: 'qa-0', from: 'qa', text: 'All four checks passed on #212. I approved it, and it still needs your review.', time: '9:27' }],
  },
  {
    id: 't38',
    type: 'thread',
    issue: '38',
    people: ['se', 'qa', 'me'],
    status: 'Software Engineer, QA Engineer, you',
    unread: 0,
    messages: [
      { id: 't38-0', from: 'se', text: 'Delivered #212. Approvals and proposals now land in the inbox.', time: '9:24' },
      { id: 't38-1', from: 'qa', text: 'Approved. Tests cover start, decline and the redirect.', time: '9:27' },
    ],
  },
  {
    id: 't36',
    type: 'thread',
    issue: '36',
    people: ['lena', 'me'],
    status: 'Lena Ortiz, you',
    unread: 0,
    messages: [{ id: 't36-0', from: 'lena', text: 'The October finance report is the one to compare against.', time: '8:50' }],
  },
];

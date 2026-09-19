import { http, HttpResponse } from 'msw';

/**
 * The Berry API calls stories make. The frontend reaches the server through
 * the same-origin `/api/*` proxy, so handlers match that path on any origin.
 */

/** A pending gate as `GET /api/v1/approvals/{id}` returns it. */
export const pendingApproval = {
   id: 'appr-1',
   workspaceId: 'ws-1',
   kind: 'issue_start',
   risk: 'medium' as const,
   title: 'Start BERR-42: migrate project health to the database',
   description:
      'The health chip has only ever lived in the browser. This task adds a column and a migration.',
   goalId: null,
   planId: null,
   issueId: 'issue-42',
   issue: { id: 'issue-42', identifier: 'BERR-42', title: 'Persist project health' },
   requestedFrom: { userId: null, role: 'admin' },
   requestedBy: { type: 'agent', id: 'agent-1' },
   status: 'pending' as const,
   decisionNote: null,
   resolvedBy: null,
   requestedAt: '2026-09-18T09:30:00Z',
   expiresAt: null,
   resolvedAt: null,
};

export const mswHandlers = [
   http.post('*/api/v1/approvals/:id/approve', ({ params }) =>
      HttpResponse.json({
         ...pendingApproval,
         id: String(params.id),
         status: 'approved',
         resolvedBy: 'user-1',
         resolvedAt: '2026-09-18T12:00:00Z',
      })
   ),
   http.post('*/api/v1/approvals/:id/reject', ({ params }) =>
      HttpResponse.json({
         ...pendingApproval,
         id: String(params.id),
         status: 'rejected',
         resolvedBy: 'user-1',
         resolvedAt: '2026-09-18T12:00:00Z',
      })
   ),
];

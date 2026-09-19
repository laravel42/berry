/**
 * Story fixtures for the review gate: tasks in review with the run that
 * delivered them, as `GET /api/v1/reviews` returns them, plus a unified diff
 * and the MSW handlers the containers read.
 */
import { http, HttpResponse } from 'msw';
import type { User } from '@/data/users';
import type { ReviewItem } from '@/lib/reviews';

export const reviewUser: User = {
   id: 'user-andrea',
   name: 'Andrea Lunelio',
   avatarUrl: '',
   email: 'andrea@example.com',
   status: 'online',
   role: 'Admin',
   joinedDate: '2026-01-04',
   teamIds: [],
   timezone: 'Europe/Rome',
};

export const reviewSession = {
   status: 'ready' as const,
   user: reviewUser,
   workspace: { id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' },
   workspaces: [{ id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' }],
   boardId: 'board-1',
   error: null,
};

const RUN_SUMMARY = `## Summary

Added the \`health\` column to \`projects\` with a forward-only migration and served it from a new route. The project chip now reads from the API.

### Changes

- \`server-ts/migrations/061_project_health.sql\`
- \`server-ts/src/mounts/projects.ts\`: \`PATCH /api/v1/projects/{id}/health\`
- \`frontend/store/projects-store.ts\`: hydrate health from the list call

### Verification

1. \`pnpm typecheck:server\` passed
2. \`pnpm test:server\` passed (DB tests ran against a schema-only copy)

\`\`\`sql
ALTER TABLE projects ADD COLUMN health text NOT NULL DEFAULT 'no-update';
\`\`\`

> The localStorage fallback is removed; existing browser-only values are dropped.`;

/** A delivered pull request, checks green, a peer approval under AutoGate. */
export const deliveredReview: ReviewItem = {
   id: 'issue-101',
   issue: {
      id: 'issue-101',
      identifier: 'BERR-101',
      title: 'Persist project health to the database',
      status: 'in_review',
      autoGate: true,
   },
   author: { id: 'agent-backend', name: 'Backend Engineer' },
   run: { id: 'run-71', summary: RUN_SUMMARY, completedAt: '2026-09-18T10:45:00Z' },
   repository: 'berry/berry',
   pullRequest: {
      number: 412,
      url: 'https://github.com/berry/berry/pull/412',
      branch: 'berr-101-project-health',
      headCommit: '4a0b5fb',
   },
   delivery: {
      committed: true,
      filesChanged: 3,
      insertions: 46,
      deletions: 7,
      files: [
         'server-ts/migrations/061_project_health.sql',
         'server-ts/src/mounts/projects.ts',
         'frontend/store/projects-store.ts',
      ],
      producedFiles: 0,
   },
   checks: {
      passed: true,
      complete: true,
      results: [
         { command: 'pnpm typecheck:server', exitCode: 0, passed: true },
         { command: 'pnpm test:server', exitCode: 0, passed: true },
      ],
   },
   verdicts: [
      {
         id: 'verdict-2',
         reviewer: 'Code Reviewer',
         approved: true,
         reason:
            'The migration is forward-only and the route checks `product.write`. **Approved.**',
         attempt: 2,
         decidedAt: '2026-09-18T11:00:00Z',
      },
      {
         id: 'verdict-1',
         reviewer: 'Code Reviewer',
         approved: false,
         reason:
            'The first attempt edited migration 058 in place.\n\n- Add a new numbered migration instead\n- Never edit an applied one',
         attempt: 1,
         decidedAt: '2026-09-18T09:30:00Z',
      },
   ],
   updatedAt: '2026-09-18T11:00:00Z',
};

/** The run stopped without a commit, a pull request or any files. */
export const stoppedReview: ReviewItem = {
   id: 'issue-102',
   issue: {
      id: 'issue-102',
      identifier: 'BERR-102',
      title: 'Move approvals and proposals into the inbox',
      status: 'in_review',
      autoGate: false,
   },
   author: { id: 'agent-frontend', name: 'Frontend Engineer' },
   run: {
      id: 'run-72',
      summary:
         'I could not find the inbox route in `app/[orgId]/`. Which page should approvals move to?',
      completedAt: '2026-09-18T08:10:00Z',
   },
   repository: 'berry/berry',
   pullRequest: null,
   delivery: {
      committed: false,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      files: [],
      producedFiles: 0,
   },
   checks: null,
   verdicts: [],
   updatedAt: '2026-09-18T08:10:00Z',
};

/** A design task: files produced and attached, nothing committed, a check failed. */
export const producedFilesReview: ReviewItem = {
   id: 'issue-103',
   issue: {
      id: 'issue-103',
      identifier: 'BERR-103',
      title: 'Explore empty states for the review queue',
      status: 'in_review',
      autoGate: false,
   },
   author: { id: 'agent-designer', name: 'Product Designer' },
   run: {
      id: 'run-73',
      summary: 'Three directions for the empty queue, each as a static page.',
      completedAt: '2026-09-17T17:00:00Z',
   },
   repository: null,
   pullRequest: null,
   delivery: {
      committed: false,
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      files: [],
      producedFiles: 2,
   },
   checks: {
      passed: false,
      complete: false,
      results: [
         { command: 'pnpm lint', exitCode: 1, passed: false },
         { command: 'python3 scripts/check-locale-catalogues.py', exitCode: null, passed: false },
      ],
   },
   verdicts: [],
   updatedAt: '2026-09-17T17:00:00Z',
};

export const approvedReview: ReviewItem = {
   ...deliveredReview,
   id: 'issue-090',
   issue: {
      ...deliveredReview.issue,
      id: 'issue-090',
      identifier: 'BERR-90',
      title: 'Render run transcript steps in a code editor',
      status: 'done',
   },
   run: { ...deliveredReview.run, id: 'run-60', completedAt: '2026-09-16T12:00:00Z' },
   updatedAt: '2026-09-16T14:00:00Z',
};

export const sentBackReview: ReviewItem = {
   ...stoppedReview,
   id: 'issue-091',
   issue: {
      ...stoppedReview.issue,
      id: 'issue-091',
      identifier: 'BERR-91',
      title: 'Tighten task, review and display surfaces',
      status: 'todo',
   },
   run: { ...stoppedReview.run, id: 'run-61', completedAt: '2026-09-15T09:00:00Z' },
   updatedAt: '2026-09-15T10:00:00Z',
};

export const openReviews = [stoppedReview, deliveredReview, producedFilesReview];
export const decidedReviews = [approvedReview, sentBackReview];

export const unifiedDiff = `diff --git a/server-ts/migrations/061_project_health.sql b/server-ts/migrations/061_project_health.sql
new file mode 100644
index 0000000..3f2a1b9
--- /dev/null
+++ b/server-ts/migrations/061_project_health.sql
@@ -0,0 +1,4 @@
+-- Project health moves from the browser to the database.
+ALTER TABLE projects
+  ADD COLUMN health text NOT NULL DEFAULT 'no-update',
+  ADD COLUMN health_updated_at timestamptz;
diff --git a/server-ts/src/mounts/projects.ts b/server-ts/src/mounts/projects.ts
index 8c1d2e0..b7a9f41 100644
--- a/server-ts/src/mounts/projects.ts
+++ b/server-ts/src/mounts/projects.ts
@@ -12,6 +12,9 @@ export function mountProjects(router: Router, deps: Deps) {
    router.get('/api/v1/projects', listProjects(deps));
    router.get('/api/v1/projects/:id', getProject(deps));
    router.patch('/api/v1/projects/:id', updateProject(deps));
+   router.patch('/api/v1/projects/:id/health', updateHealth(deps));
 }

-function listProjects(deps: Deps) {
+export function listProjects(deps: Deps) {
@@ -80,3 +83,7 @@ function updateProject(deps: Deps) {
    };
 }
+
+function updateHealth(deps: Deps) {
+   return async (req: Request) => deps.projects.setHealth(req.params.id, req.body.health);
+}
`;

export const producedArtifacts = [
   {
      id: 'artifact-1',
      path: 'design/empty-queue/calm.html',
      name: 'calm.html',
      directory: 'design/empty-queue',
      contentType: 'text/html',
      sizeBytes: 4812,
      runId: 'run-73',
      agentName: 'Product Designer',
      downloadUrl: '/api/v1/artifacts/artifact-1/download',
      createdAt: '2026-09-17T16:58:00Z',
   },
   {
      id: 'artifact-2',
      path: 'design/empty-queue/celebrate.html',
      name: 'celebrate.html',
      directory: 'design/empty-queue',
      contentType: 'text/html',
      sizeBytes: 5230,
      runId: 'run-73',
      agentName: 'Product Designer',
      downloadUrl: '/api/v1/artifacts/artifact-2/download',
      createdAt: '2026-09-17T16:59:00Z',
   },
];

/** Both review lists, the diff, run artifacts, and a decision that succeeds. */
export const reviewHandlers = [
   http.get('*/api/v1/reviews', ({ request }) =>
      HttpResponse.json({
         nodes:
            new URL(request.url).searchParams.get('state') === 'completed'
               ? decidedReviews
               : openReviews,
      })
   ),
   http.get('*/api/v1/reviews/:runId/diff', () =>
      HttpResponse.text(unifiedDiff, { headers: { 'content-type': 'text/plain' } })
   ),
   http.get('*/api/v1/issues/:ref/artifacts', () =>
      HttpResponse.json({ artifacts: producedArtifacts })
   ),
   http.patch('*/api/v1/issues/:ref', () => new HttpResponse(null, { status: 204 })),
   http.post('*/api/v1/issues/:ref/comments', ({ params }) =>
      HttpResponse.json(
         {
            id: 'comment-1',
            issueId: String(params.ref),
            body: 'Review note',
            author: { type: 'user', id: reviewUser.id, name: reviewUser.name, avatarUrl: null },
            parentId: null,
            revision: 1,
            resolvedAt: null,
            resolvedBy: null,
            createdAt: '2026-09-18T12:00:00Z',
            updatedAt: '2026-09-18T12:00:00Z',
         },
         { status: 201 }
      )
   ),
];

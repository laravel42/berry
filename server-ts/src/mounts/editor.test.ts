import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SessionService, User } from '../auth/sessions.ts';
import { ProjectDraftAssist, normalizePatch, type ProjectDraftFields } from '../editor/project-draft.ts';
import { createApp, type BerryApp } from '../http/app.ts';
import { Registry } from '../http/registry.ts';
import type { RuntimeCompletion } from '../runtime/completion.ts';
import { editorMounts } from './editor.ts';

/**
 * The new-project assistant, with the runtime faked: what reaches the
 * completion and what comes back to the browser. No database — the mount only
 * needs a signed-in person with a workspace.
 */

type StructuredCall = Parameters<RuntimeCompletion['structured']>[0];

const user = {
   id: 'user-1',
   email: 'andrea@example.test',
   name: 'Andrea',
   avatarUrl: null,
   role: 'owner',
   currentWorkspaceId: 'ws-1',
   createdAt: '2026-01-01T00:00:00Z',
   updatedAt: '2026-01-01T00:00:00Z',
} as unknown as User;

const draft: ProjectDraftFields = {
   name: '',
   description: '',
   status: 'to-do',
   priority: 'no-priority',
   startDate: null,
   targetDate: null,
};

function fakeCompletion(answer: unknown, calls: StructuredCall[] = []) {
   return {
      calls,
      completion: {
         async structured(input: StructuredCall) {
            calls.push(input);
            return { value: answer, text: JSON.stringify(answer), inputTokens: 1, outputTokens: 1, durationMs: 1 };
         },
      } as unknown as Pick<RuntimeCompletion, 'structured'>,
   };
}

function buildApp(options: {
   projectDraft: ProjectDraftAssist | null;
   who?: User | null;
}): BerryApp {
   const registry = new Registry();
   registry.registerAll(
      editorMounts({
         sessions: {
            resolveRequest: async () => {
               if (options.who === null) throw new Error('nobody');
               return options.who ?? user;
            },
         } as unknown as SessionService,
         assist: null,
         projectDraft: options.projectDraft,
      })
   );
   return createApp(registry);
}

async function post(app: BerryApp, body: unknown) {
   const response = await app.request('/api/v1/editor/project-draft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
   });
   return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

describe('POST /api/v1/editor/project-draft', () => {
   test('sends the exchange as a transcript, the form in the user turn, and returns the patch', async () => {
      const { completion, calls } = fakeCompletion({
         reply: 'Set a name and a brief.',
         patch: {
            name: '  Billing v2 ',
            description: '```markdown\n# Billing v2\n\nMove invoicing to Stripe.\n```',
            status: null,
            priority: 'high',
            startDate: '2026-10-01',
            targetDate: '2026-12-15',
         },
      });
      const app = buildApp({
         projectDraft: new ProjectDraftAssist({ completion, defaultModel: 'model-x', today: () => '2026-09-19' }),
      });
      const res = await post(app, {
         messages: [
            { role: 'user', text: 'I want a billing project' },
            { role: 'assistant', text: 'What is the outcome?' },
            { role: 'user', text: 'Invoicing on Stripe by mid December, start in October' },
         ],
         draft: { ...draft, name: 'Billing' },
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.reply, 'Set a name and a brief.');
      assert.deepEqual(res.body.patch, {
         name: 'Billing v2',
         description: '# Billing v2\n\nMove invoicing to Stripe.',
         priority: 'high',
         startDate: '2026-10-01',
         targetDate: '2026-12-15',
      });

      const call = calls[0];
      assert.ok(call);
      assert.equal(call.workspaceId, 'ws-1');
      assert.equal(call.purpose, 'project_draft');
      assert.equal(call.model, 'model-x');
      assert.match(call.system, /Today is 2026-09-19/);
      assert.deepEqual(call.transcript, [
         { role: 'user', text: 'I want a billing project' },
         { role: 'assistant', text: 'What is the outcome?' },
      ]);
      assert.match(call.user, /"name": "Billing"/);
      assert.match(call.user, /Message:\nInvoicing on Stripe by mid December, start in October$/);
   });

   test('without a runtime the route answers 503 with the editor code', async () => {
      const res = await post(buildApp({ projectDraft: null }), {
         messages: [{ role: 'user', text: 'hi' }],
         draft,
      });
      assert.equal(res.status, 503);
      assert.equal((res.body.error as { code: string }).code, 'EDITOR_UNAVAILABLE');
   });

   test('an exchange that does not end on the person is refused before any call', async () => {
      const { completion, calls } = fakeCompletion({ reply: 'x', patch: {} });
      const app = buildApp({ projectDraft: new ProjectDraftAssist({ completion, defaultModel: 'm' }) });
      const res = await post(app, {
         messages: [{ role: 'assistant', text: 'hello' }],
         draft,
      });
      assert.equal(res.status, 422);
      assert.equal(calls.length, 0);
   });

   test('an unknown status, a stray field or a malformed date is a validation error', async () => {
      const { completion } = fakeCompletion({ reply: 'x', patch: {} });
      const app = buildApp({ projectDraft: new ProjectDraftAssist({ completion, defaultModel: 'm' }) });
      const bad = await post(app, {
         messages: [{ role: 'user', text: 'hi' }],
         draft: { ...draft, status: 'shipped' },
      });
      assert.equal(bad.status, 422);
      const stray = await post(app, {
         messages: [{ role: 'user', text: 'hi' }],
         draft: { ...draft, lead: 'me' },
      });
      assert.equal(stray.status, 422);
      const date = await post(app, {
         messages: [{ role: 'user', text: 'hi' }],
         draft: { ...draft, startDate: 'next week' },
      });
      assert.equal(date.status, 422);
   });

   test('a person with no workspace gets a 404 rather than a completion', async () => {
      const { completion, calls } = fakeCompletion({ reply: 'x', patch: {} });
      const app = buildApp({
         projectDraft: new ProjectDraftAssist({ completion, defaultModel: 'm' }),
         who: { ...user, currentWorkspaceId: null },
      });
      const res = await post(app, { messages: [{ role: 'user', text: 'hi' }], draft });
      assert.equal(res.status, 404);
      assert.equal(calls.length, 0);
   });

   test('a runtime failure is a 503, not a 500', async () => {
      const completion = {
         async structured() {
            throw new Error('no runtime');
         },
      } as unknown as Pick<RuntimeCompletion, 'structured'>;
      const app = buildApp({ projectDraft: new ProjectDraftAssist({ completion, defaultModel: 'm' }) });
      const res = await post(app, { messages: [{ role: 'user', text: 'hi' }], draft });
      assert.equal(res.status, 503);
      assert.match((res.body.error as { message: string }).message, /no runtime/);
   });
});

describe('normalizePatch', () => {
   const nothing = { name: null, description: null, status: null, priority: null, startDate: null, targetDate: null };

   test('null and blank leave a field alone', () => {
      assert.deepEqual(normalizePatch({ ...nothing, name: '   ', description: '' }, draft), {});
   });

   test('a target before the start is dropped, judged against the form when the start is not patched', () => {
      assert.deepEqual(
         normalizePatch({ ...nothing, targetDate: '2026-09-01' }, { ...draft, startDate: '2026-09-10' }),
         {}
      );
      assert.deepEqual(
         normalizePatch({ ...nothing, startDate: '2026-09-10', targetDate: '2026-09-01' }, draft),
         { startDate: '2026-09-10' }
      );
      assert.deepEqual(
         normalizePatch({ ...nothing, targetDate: '2026-09-10' }, { ...draft, startDate: '2026-09-10' }),
         { targetDate: '2026-09-10' }
      );
   });

   test('a date that is not a calendar date is dropped', () => {
      assert.deepEqual(normalizePatch({ ...nothing, startDate: 'Oct 1', targetDate: '2026-13-40' }, draft), {});
   });
});

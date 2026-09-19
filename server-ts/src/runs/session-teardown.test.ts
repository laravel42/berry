import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Sql } from '../db/pool.ts';
import { releaseTaskResources } from './session-teardown.ts';

/** Answers the two queries in the order the function asks them. */
function fakeSql(busy: boolean, rows: Array<Record<string, unknown>>): Sql {
   let asked = 0;
   return (async () => (asked++ === 0 ? (busy ? [{}] : []) : rows)) as unknown as Sql;
}
const target = { id: 'rt', driver: 'http', arn: null, qualifier: 'DEFAULT', region: null, endpointUrl: 'http://localhost:8080' } as never;

test('every session that ran on the finished task is stopped, and its preview with them', async () => {
   const stopped: string[] = [];
   const previews: string[] = [];
   const result = await releaseTaskResources(
      {
         sql: fakeSql(false, [
            { runtime_session_id: 'berry-author', workspace_id: 'w', runtime_id: null },
            { runtime_session_id: 'berry-reviewer', workspace_id: 'w', runtime_id: 'r1' },
         ]),
         transport: { stop: async ({ runtimeSessionId }) => void stopped.push(runtimeSessionId) },
         target: async () => target,
         previews: { stop: async (issueId) => void previews.push(issueId) },
      },
      'issue-1'
   );
   assert.deepEqual(stopped.sort(), ['berry-author', 'berry-reviewer']);
   assert.deepEqual(previews, ['issue-1']);
   assert.equal(result.sessions, 2);
});

test('a task closed while a run is still on it keeps its sessions', async () => {
   const stopped: string[] = [];
   const result = await releaseTaskResources(
      { sql: fakeSql(true, [{ runtime_session_id: 's', workspace_id: 'w', runtime_id: null }]), transport: { stop: async () => void stopped.push('s') }, target: async () => target },
      'issue-1'
   );
   assert.deepEqual([stopped, result.sessions], [[], 0]);
});

test('a runtime that refuses, a missing target and a preview that fails never become an error', async () => {
   const reported: string[] = [];
   const result = await releaseTaskResources(
      {
         sql: fakeSql(false, [
            { runtime_session_id: 'refused', workspace_id: 'w', runtime_id: null },
            { runtime_session_id: 'no-target', workspace_id: 'other', runtime_id: null },
         ]),
         transport: { stop: async () => { throw new Error('404'); } },
         target: async (workspaceId) => (workspaceId === 'w' ? target : null),
         previews: { stop: async () => { throw new Error('docker is down'); } },
         report: (text) => void reported.push(text),
      },
      'issue-1'
   );
   assert.equal(result.sessions, 0);
   assert.deepEqual(reported.sort(), ['a runtime session did not confirm its stop', 'the task preview did not stop']);
});

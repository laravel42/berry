import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { configurePlatformModel, platformModelFallback, platformModelFor, type PlatformModel } from './platform-model.ts';

const bedrock: PlatformModel = { provider: 'bedrock', model: 'us.amazon.nova-lite-v1:0', region: 'us-east-1' };

afterEach(() => configurePlatformModel(null));

test('with no model configured, everything stays on the workspace providers', () => {
   assert.equal(platformModelFor({ kind: 'completion', purpose: 'editor_assist' }), null);
   assert.equal(platformModelFor({ kind: 'agent', chatSessionId: 'chat-1' }), null);
});

test('chat replies and the product calls run on the platform model', () => {
   configurePlatformModel(bedrock);
   assert.equal(platformModelFor({ kind: 'agent', chatSessionId: 'chat-1', issueId: null }), bedrock);
   for (const purpose of ['chat_title', 'chat_follow_ups', 'editor_assist', 'project_draft', 'project_milestones', 'project_milestone_tasks', 'loop_draft', 'agent_builder']) {
      assert.equal(platformModelFor({ kind: 'completion', purpose }), bedrock, purpose);
   }
});

test('everything the Orchestrator does runs on the platform model', () => {
   configurePlatformModel(bedrock);
   assert.equal(platformModelFor({ kind: 'completion', purpose: 'triage', orchestrator: true }), bedrock);
   assert.equal(platformModelFor({ kind: 'completion', purpose: 'completion', orchestrator: true }), bedrock);
   assert.equal(platformModelFor({ kind: 'agent', issueId: 'issue-1', orchestrator: true }), bedrock);
   configurePlatformModel(null);
   assert.equal(platformModelFor({ kind: 'agent', issueId: 'issue-1', orchestrator: true }), null);
});

test('agent work and agent decisions stay on the workspace providers', () => {
   configurePlatformModel(bedrock);
   assert.equal(platformModelFor({ kind: 'agent', issueId: 'issue-1' }), null);
   assert.equal(platformModelFor({ kind: 'agent', chatSessionId: 'chat-1', issueId: 'issue-1' }), null);
   for (const purpose of ['triage', 'review_gate', 'planner', 'completion', undefined]) {
      assert.equal(platformModelFor({ kind: 'completion', purpose }), null, String(purpose));
   }
});

test('a task no provider was chosen for falls back to the platform model', () => {
   configurePlatformModel(bedrock);
   assert.equal(platformModelFallback(), bedrock);
   configurePlatformModel(null);
   assert.equal(platformModelFallback(), null);
});

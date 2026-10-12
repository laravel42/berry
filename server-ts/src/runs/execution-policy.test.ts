import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { configureTaskExecution, taskExecutionAllowed, WORKSTATION_RUNTIME_KEYS } from './execution-policy.ts';

after(() => configureTaskExecution(null));

test('subscription-only execution refuses native work instead of leaving it queued', () => {
   configureTaskExecution({ nativeExecution: false, workstationKeys: WORKSTATION_RUNTIME_KEYS });
   assert.equal(taskExecutionAllowed(null), false);
   for (const key of WORKSTATION_RUNTIME_KEYS) assert.equal(taskExecutionAllowed(key), true);
   assert.equal(taskExecutionAllowed('unknown'), false);
});

test('a native compute host admits native work while preserving the selected runtime', () => {
   configureTaskExecution({ nativeExecution: true, workstationKeys: WORKSTATION_RUNTIME_KEYS });
   assert.equal(taskExecutionAllowed(null), true);
   assert.equal(taskExecutionAllowed('kiro'), true);
});

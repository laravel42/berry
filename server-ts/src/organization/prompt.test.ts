import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG } from './catalog.ts';

// The review gate runs by itself only on a task under AutoGate; elsewhere a
// person asks for the review or decides without one.
test('a role is not told its work is always reviewed by itself', () => {
   for (const role of CATALOG) {
      assert.doesNotMatch(role.system_prompt, /run by themselves when you deliver it/, role.id);
      assert.doesNotMatch(role.system_prompt, /Your work is reviewed by:/, role.id);
      if (role.can_delegate_to.length > 0) {
         assert.match(role.system_prompt, /by itself when you deliver a task under AutoGate, and otherwise when a person asks for them/, role.id);
      }
      if (role.review_requirements.length > 0) {
         assert.match(role.system_prompt, /When your work is reviewed, which happens by itself on a task under AutoGate/, role.id);
         assert.match(role.system_prompt, /Without that review a person decides on your work/, role.id);
      }
   }
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { invokedSkillNames, requiredSkillsContract } from './invoke.ts';

test('a chat message names the skills it invokes, and a path is not one', () => {
   assert.deepEqual(invokedSkillNames('/release-notes the last week'), ['release-notes']);
   assert.deepEqual(invokedSkillNames('use /pdf-tools and /release-notes'), ['pdf-tools', 'release-notes']);
   assert.deepEqual(invokedSkillNames('use /pdf-tools and /pdf-tools again'), ['pdf-tools']);
   assert.deepEqual(invokedSkillNames('see frontend/components/chat'), []);
   assert.deepEqual(invokedSkillNames('not /Not-A-Skill'), []);
});

test('the contract tells the agent to read the invoked skill and follow it', () => {
   const text = requiredSkillsContract([
      {
         name: 'release-notes',
         description: 'Turn merged work\ninto a changelog.',
         content: 'List the changes a person would notice.',
      },
   ]);
   assert.match(text, /read_skill/);
   assert.match(text, /Skill release-notes: Turn merged work into a changelog\./);
   assert.match(text, /has to come from that skill/);
   assert.match(text, /<skill name="release-notes">\nList the changes a person would notice\.\n<\/skill>/);
});

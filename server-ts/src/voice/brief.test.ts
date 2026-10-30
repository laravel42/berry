import assert from 'node:assert/strict';
import { test } from 'node:test';
import { voiceBrief } from './brief.ts';

test('a voice brief names the Berry role and keeps the chat short', () => {
   const brief = voiceBrief({
      agentName: 'Software Engineer',
      memberName: 'Andrea',
      mission: 'Build the product end to end.',
      prompt: 'You write TypeScript.',
      transcript: [
         { author: 'Andrea', body: 'Can you look at the review queue?' },
         { author: 'Software Engineer', body: 'Yes. I will start with the oldest.' },
      ],
   });
   assert.equal(brief.name, 'Software Engineer');
   assert.equal(brief.memberName, 'Andrea');
   assert.match(brief.instructions, /Software Engineer/);
   assert.match(brief.instructions, /Andrea/);
   assert.match(brief.instructions, /review queue/);
   assert.match(brief.instructions, /cannot mark work done/);
});

test('a voice brief still works with no chat yet', () => {
   const brief = voiceBrief({ agentName: 'Orchestrator', memberName: 'Pat' });
   assert.match(brief.instructions, /Orchestrator/);
   assert.doesNotMatch(brief.instructions, /Recent chat/);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSkillTool } from './skill-tool.ts';

const skills = [
   { name: 'systematic-debugging', files: [{ path: 'SKILL.md', content: '---\nname: systematic-debugging\n---\nReproduce first.' }, { path: 'checklist.md', content: '- logs' }] },
];

async function call(args: object) {
   const t = readSkillTool(skills);
   const invoke = (t as unknown as { invoke: (a: object) => Promise<unknown> }).invoke;
   return (await invoke.call(t, args)) as Record<string, unknown>;
}

test('a skill is read by name, SKILL.md by default, another file by path', async () => {
   const manifest = await call({ name: 'systematic-debugging' });
   assert.equal(manifest.found, true);
   assert.match(String(manifest.content), /Reproduce first/);
   assert.deepEqual(manifest.files, ['SKILL.md', 'checklist.md']);
   const extra = await call({ name: 'systematic-debugging', file: 'checklist.md' });
   assert.equal(extra.content, '- logs');
});

test('an unknown skill or file is named back, with what exists', async () => {
   const missing = await call({ name: 'nope' });
   assert.equal(missing.found, false);
   assert.match(String(missing.error), /Your skills: systematic-debugging/);
   const noFile = await call({ name: 'systematic-debugging', file: 'x.md' });
   assert.equal(noFile.found, false);
   assert.deepEqual(noFile.files, ['SKILL.md', 'checklist.md']);
});

test('the tool description names the skills, so the model knows before the prompt does', () => {
   const t = readSkillTool(skills) as unknown as { description: string };
   assert.match(t.description, /systematic-debugging/);
   assert.match((readSkillTool([]) as unknown as { description: string }).description, /no skills/);
});

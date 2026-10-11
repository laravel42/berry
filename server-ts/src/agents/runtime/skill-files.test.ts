import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { BERRY_SKILL_ROOT, HOST_SKILL_ROOTS, skillFileTree, writeSkills } from './skill-files.ts';

const manifest = '---\nname: pdf-tools\ndescription: "Work with PDFs"\n---\nUse pdftotext.\n';
const skill = {
   name: 'pdf-tools',
   files: [
      { path: 'SKILL.md', content: manifest },
      { path: 'scripts/run.sh', content: 'echo hi' },
   ],
};

test('each skill becomes a directory holding its files, SKILL.md included', () => {
   assert.deepEqual(skillFileTree([skill]), [
      { path: `${BERRY_SKILL_ROOT}/pdf-tools/SKILL.md`, content: manifest },
      { path: `${BERRY_SKILL_ROOT}/pdf-tools/scripts/run.sh`, content: 'echo hi' },
   ]);
});

test('skill files never land in a directory a host CLI scans', () => {
   for (const file of skillFileTree([skill])) {
      assert.ok(file.path.startsWith(`${BERRY_SKILL_ROOT}/`));
      for (const root of HOST_SKILL_ROOTS) {
         assert.equal(file.path.startsWith(`${root}/`), false, file.path);
      }
   }
});

test('a skill without a SKILL.md is refused rather than written half-formed', () => {
   assert.throws(() => skillFileTree([{ name: 'bare', files: [{ path: 'a.txt', content: '' }] }]));
});

test('a path that would escape its directory is refused', () => {
   assert.throws(() => skillFileTree([{ ...skill, files: [...skill.files, { path: '../../x', content: '' }] }]));
   assert.throws(() => skillFileTree([{ ...skill, files: [...skill.files, { path: '/etc/passwd', content: '' }] }]));
   assert.throws(() => skillFileTree([{ ...skill, name: '../evil' }]));
});

test('writing puts the files on disk under the root', async () => {
   const root = await mkdtemp(join(tmpdir(), 'berry-skills-'));
   try {
      const written = await writeSkills(root, [skill]);
      assert.equal(written.length, 2);
      assert.equal(await readFile(join(root, BERRY_SKILL_ROOT, 'pdf-tools/scripts/run.sh'), 'utf8'), 'echo hi');
      assert.equal(await readFile(join(root, BERRY_SKILL_ROOT, 'pdf-tools/SKILL.md'), 'utf8'), manifest);
   } finally {
      await rm(root, { recursive: true, force: true });
   }
});

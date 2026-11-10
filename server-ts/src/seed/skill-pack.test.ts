import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { CATALOG } from '../organization/catalog.ts';
import { parseSkillMarkdown } from '../skills/frontmatter.ts';
import { SKILLS_PER_ROLE, skillsFromFiles, SOFTWARE_PACK_SOURCE, WORK_PACK_SOURCE } from './skill-pack.ts';
import { loadPackedSkills, loadSkillFolder, SOFTWARE_PACK, WORK_PACK } from './skills.ts';

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

test('every committed skill is named, described and labelled with one role', () => {
   const skills = loadPackedSkills();
   for (const skill of skills) {
      assert.match(skill.name, NAME);
      assert.ok(skill.description.length > 0 && skill.description.length <= 1024);
      assert.ok(skill.content.includes('# '), `${skill.name} has no heading`);
      assert.equal(skill.labels.length, 1);
   }
   const discovery = skills.find((skill) => skill.name === 'product-discovery');
   assert.equal(discovery?.description, 'Use for a new product/feature idea before solution commitment.');
   assert.equal(discovery?.labels[0], 'Product Lead');
   assert.equal(discovery?.source, SOFTWARE_PACK_SOURCE);
});

test('skill names are unique across every committed pack', () => {
   const names = loadPackedSkills().map((skill) => skill.name);
   assert.equal(new Set(names).size, names.length);
});

test('every catalogue role offers exactly eight skills, and every skill names a role', () => {
   const perRole = new Map<string, number>();
   for (const skill of loadPackedSkills()) {
      perRole.set(skill.labels[0]!, (perRole.get(skill.labels[0]!) ?? 0) + 1);
   }
   const roleNames = new Set(CATALOG.map((role) => role.name));
   for (const label of perRole.keys()) assert.ok(roleNames.has(label), `pack role "${label}" has no catalog agent`);
   for (const role of CATALOG) {
      assert.equal(perRole.get(role.name) ?? 0, SKILLS_PER_ROLE, `${role.name} offers ${perRole.get(role.name) ?? 0} skills`);
   }
});

test('software roles and work roles come from their own packs', () => {
   const software = loadSkillFolder(SOFTWARE_PACK, SOFTWARE_PACK_SOURCE);
   const work = loadSkillFolder(WORK_PACK, WORK_PACK_SOURCE);
   assert.ok(software.every((skill) => skill.source === SOFTWARE_PACK_SOURCE));
   assert.ok(work.every((skill) => skill.source === WORK_PACK_SOURCE));
   for (const skill of work) {
      for (const section of ['## When to use', '## Deliverable', '## Steps', '## Stop and hand to a person when', '## Done when']) {
         assert.ok(skill.content.includes(section), `${skill.name} has no "${section}"`);
      }
   }
   for (const skill of software) {
      for (const section of ['## When to use', '## Required deliverable', '### 2. Specialist checks', '## Escalation rules']) {
         assert.ok(skill.content.includes(section), `${skill.name} has no "${section}"`);
      }
   }
});

test('each work skill file agrees with its manifest entry', () => {
   const manifest = JSON.parse(readFileSync(join(WORK_PACK, 'manifest.json'), 'utf8')) as Array<{
      name: string;
      description: string;
      path: string;
   }>;
   for (const entry of manifest) {
      const parsed = parseSkillMarkdown(readFileSync(join(WORK_PACK, entry.path), 'utf8'));
      assert.equal(parsed.name, entry.name);
      assert.equal(parsed.description, entry.description);
   }
});

test('a pack is split on its manifest, and a missing file is refused', () => {
   const manifest = JSON.stringify([
      { name: 'alpha-skill', role: 'Backend Engineer', description: 'Use when writing alpha.', path: 'alpha-skill/SKILL.md' },
      { name: 'beta-skill', role: 'QA Engineer', description: 'Use when writing beta.', path: 'beta-skill/SKILL.md' },
   ]);
   const files = new Map([
      ['manifest.json', manifest],
      ['alpha-skill/SKILL.md', '---\nname: alpha-skill\n---\n\n# Alpha\n\nDo the alpha thing.\n'],
      ['beta-skill/SKILL.md', '---\nname: beta-skill\n---\n\n# Beta\n\nDo the beta thing.\n'],
   ]);
   assert.deepEqual(
      skillsFromFiles(files, 'seed://test').map((skill) => [skill.name, skill.labels[0], skill.content.includes('# Alpha')]),
      [
         ['alpha-skill', 'Backend Engineer', true],
         ['beta-skill', 'QA Engineer', false],
      ]
   );
   files.delete('beta-skill/SKILL.md');
   assert.throws(() => skillsFromFiles(files, 'seed://test'), /beta-skill has no/);
});

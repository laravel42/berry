import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { skillsFromPack } from './skill-pack.ts';

const PACK = join(dirname(fileURLToPath(import.meta.url)), 'data', 'berry-agentcore-deep-skills-100.zip');
const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

function zip(files: { name: string; data: string }[]): Buffer {
   const locals: Buffer[] = [];
   const centrals: Buffer[] = [];
   let offset = 0;
   for (const file of files) {
      const raw = Buffer.from(file.data);
      const body = deflateRawSync(raw);
      const name = Buffer.from(file.name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(8, 8);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(name.length, 26);
      const central = Buffer.alloc(46);
      central.writeUInt32LE(0x02014b50, 0);
      central.writeUInt16LE(8, 10);
      central.writeUInt32LE(body.length, 20);
      central.writeUInt32LE(raw.length, 24);
      central.writeUInt16LE(name.length, 28);
      central.writeUInt32LE(offset, 42);
      locals.push(local, name, body);
      centrals.push(central, name);
      offset += 30 + name.length + body.length;
   }
   const cd = Buffer.concat(centrals);
   const end = Buffer.alloc(22);
   end.writeUInt32LE(0x06054b50, 0);
   end.writeUInt16LE(files.length, 8);
   end.writeUInt16LE(files.length, 10);
   end.writeUInt32LE(cd.length, 12);
   end.writeUInt32LE(offset, 16);
   return Buffer.concat([...locals, cd, end]);
}

test('the committed pack is 100 named skills with instructions', () => {
   const skills = skillsFromPack(readFileSync(PACK));
   assert.equal(skills.length, 100);
   assert.equal(new Set(skills.map((skill) => skill.name)).size, 100);
   for (const skill of skills) {
      assert.match(skill.name, NAME);
      assert.ok(skill.description.length > 0);
      assert.ok(skill.description.length <= 1024);
      assert.ok(skill.content.includes('# '));
      assert.equal(skill.labels.length, 1);
   }
   const discovery = skills.find((skill) => skill.name === 'product-discovery');
   assert.equal(discovery?.description, 'Use for a new product/feature idea before solution commitment.');
   assert.equal(discovery?.labels[0], 'Product Lead');
   assert.ok(discovery?.content.includes('When to use'));
});

test('a wrapped pack is split on the manifest, not treated as one skill', () => {
   const skills = skillsFromPack(
      zip([
         {
            name: 'pack/manifest.json',
            data: JSON.stringify([
               {
                  name: 'alpha-skill',
                  role: 'Backend Engineer',
                  description: 'Use when writing alpha.',
                  path: 'alpha-skill/SKILL.md',
               },
               {
                  name: 'beta-skill',
                  role: 'QA Engineer',
                  description: 'Use when writing beta.',
                  path: 'beta-skill/SKILL.md',
               },
            ]),
         },
         {
            name: 'pack/alpha-skill/SKILL.md',
            data: '---\nname: alpha-skill\n---\n\n# Alpha\n\nDo the alpha thing.\n',
         },
         {
            name: 'pack/beta-skill/SKILL.md',
            data: '---\nname: beta-skill\n---\n\n# Beta\n\nDo the beta thing.\n',
         },
      ])
   );
   assert.deepEqual(
      skills.map((skill) => [skill.name, skill.labels[0], skill.content.includes('# Alpha')]),
      [
         ['alpha-skill', 'Backend Engineer', true],
         ['beta-skill', 'QA Engineer', false],
      ]
   );
});

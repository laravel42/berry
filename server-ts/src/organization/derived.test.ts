import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, catalogRole } from './catalog.ts';
import { deriveReceivesWorkFrom, deriveReviewRequirements, effectiveContract, writesCode } from './derived.ts';

/**
 * The derived parts of a role contract: who hands it work and who reviews it
 * are worked out, never set. For a catalogue role the result is exactly what
 * the catalogue stores, so no untouched role reads as customised.
 */

test('for every catalogue role, the derived parts equal what the catalogue stores', () => {
   for (const role of CATALOG) {
      assert.deepEqual(deriveReviewRequirements(role), role.review_requirements, role.id);
      assert.deepEqual(new Set(deriveReceivesWorkFrom(role.id, CATALOG)), new Set(role.receives_work_from), role.id);
   }
});

test('a role that runs commands writes code, and code is always reviewed by QA', () => {
   const engineer = catalogRole('backend-engineer')!;
   assert.equal(writesCode(engineer), true);
   assert.ok(deriveReviewRequirements(engineer).some((rule) => rule.reviewer === 'qa-engineer' && rule.authority === 'blocking'));
   const lead = catalogRole('product-lead')!;
   assert.equal(writesCode(lead), false);
   assert.ok(!deriveReviewRequirements(lead).some((rule) => rule.reviewer === 'qa-engineer'));
});

test('a role never reviews itself', () => {
   const qa = catalogRole('qa-engineer')!;
   assert.ok(!deriveReviewRequirements(qa).some((rule) => rule.reviewer === 'qa-engineer'));
});

test('who a role receives work from follows who hands work to it, whatever its contract says', () => {
   const writer = catalogRole('technical-writer')!;
   const lied = { ...writer, receives_work_from: ['cto' as const] };
   const handsToWriter = { ...catalogRole('product-lead')!, can_delegate_to: ['technical-writer' as const] };
   const effective = effectiveContract(lied, [handsToWriter, writer]);
   assert.deepEqual(effective.receives_work_from, ['product-lead']);
   assert.deepEqual(effective.review_requirements, deriveReviewRequirements(writer));
});

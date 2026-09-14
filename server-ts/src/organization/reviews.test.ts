import assert from 'node:assert/strict';
import { test } from 'node:test';

import { catalogRole } from './catalog.ts';
import { globMatch, requiredReviews } from './reviews.ts';

const backend = catalogRole('backend-engineer')!.review_requirements;
const subject = (over: Partial<Parameters<typeof requiredReviews>[1]> = {}) => ({
   labels: [], paths: ['server-ts/src/core/issues.ts'], impactClasses: [], severity: null, workflow: null, ...over,
});

test('an architectural proposal needs the Architect; the CTO only when it is also critical', () => {
   const high = requiredReviews(backend, subject({ impactClasses: ['architectural'], severity: 'high' }));
   assert.ok(high.some((r) => r.reviewer === 'software-architect' && r.authority === 'blocking'));
   assert.ok(!high.some((r) => r.reviewer === 'cto'));

   const critical = requiredReviews(backend, subject({ impactClasses: ['architectural'], severity: 'critical' }));
   assert.ok(critical.some((r) => r.reviewer === 'software-architect' && r.authority === 'blocking'));
   assert.ok(critical.some((r) => r.reviewer === 'cto' && r.authority === 'blocking'));

   const criticalProduct = requiredReviews(backend, subject({ impactClasses: ['product'], severity: 'critical' }));
   assert.ok(!criticalProduct.some((r) => r.reviewer === 'cto'), 'critical alone is not architectural');

   // A role that does not write code still has its architectural proposals reviewed by the Architect.
   const analyst = requiredReviews(catalogRole('business-analyst')!.review_requirements, subject({ impactClasses: ['architectural'], severity: 'low' }));
   assert.deepEqual(analyst, [{ reviewer: 'software-architect', authority: 'blocking' }]);
});

test('QA always reviews implementation', () => {
   assert.deepEqual(requiredReviews(backend, subject()), [{ reviewer: 'qa-engineer', authority: 'blocking' }]);
});

test('auth paths bring Security; migrations bring the Architect and the Database Engineer', () => {
   const reviews = requiredReviews(backend, subject({ paths: ['server-ts/src/auth/sessions.ts', 'server-ts/migrations/187_x.up.sql'] }));
   assert.deepEqual(reviews.map((r) => `${r.reviewer}:${r.authority}`).sort(), [
      'database-engineer:advisory', 'qa-engineer:blocking', 'security-engineer:blocking', 'software-architect:blocking',
   ]);
});

test('labels and workflow trigger reviews too', () => {
   const reviews = requiredReviews(backend, subject({ labels: ['security'], workflow: 'full-delivery' }));
   assert.ok(reviews.some((r) => r.reviewer === 'security-engineer'));
   assert.ok(reviews.some((r) => r.reviewer === 'product-lead' && r.authority === 'blocking'));
});

test('globs', () => {
   assert.equal(globMatch('**/auth/**', 'server-ts/src/auth/x.ts'), true);
   assert.equal(globMatch('**/*.sql', 'a/b/c.sql'), true);
   assert.equal(globMatch('.github/**', '.github/workflows/ci.yml'), true);
   assert.equal(globMatch('**/auth/**', 'server-ts/src/author.ts'), false);
});

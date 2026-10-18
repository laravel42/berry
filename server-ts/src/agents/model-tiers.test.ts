import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { normalizeTierName, resolveTierNames, TIER_NAMES } from './model-tiers.ts';

describe('tier display names', () => {
   test('a blank or default name clears the override', () => {
      assert.equal(normalizeTierName('berry_max', '  '), null);
      assert.equal(normalizeTierName('berry_max', 'BerryMax'), null);
   });

   test('a custom name is kept and collapsed', () => {
      assert.equal(normalizeTierName('berry_mid', '  Fast  lane '), 'Fast lane');
   });

   test('a name past 32 characters is refused', () => {
      assert.equal(normalizeTierName('berry_low', 'x'.repeat(33)), null);
   });

   test('saved names replace only the tiers they name', () => {
      const names = resolveTierNames({ berry_high: 'Careful', berry_max: 'BerryMax', extra: 'no' });
      assert.equal(names.berry_high, 'Careful');
      assert.equal(names.berry_max, TIER_NAMES.berry_max);
      assert.equal(names.berry_low, TIER_NAMES.berry_low);
   });
});

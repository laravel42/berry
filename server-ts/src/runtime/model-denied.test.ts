import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RankedModel, TierPools } from '../agents/kilo/tiers.ts';
import { isModelPermissionDenied, modelsAfterPermissionDenial } from './model-denied.ts';

function ranked(id: string): RankedModel {
   return {
      id,
      name: id,
      completion: null,
      estimatedFrom: null,
      costPerAttemptUsd: null,
      usageTokens: 0,
      blendedPricePerM: null,
      inputPricePerM: null,
      outputPricePerM: null,
   };
}

function pools(low: string[], mid: string[], max: string[]): TierPools {
   return {
      berry_low: low.map(ranked),
      berry_mid: mid.map(ranked),
      berry_max: max.map(ranked),
   };
}

test('a BYOK permission refusal is the gateway saying this key cannot call the model', () => {
   assert.equal(
      isModelPermissionDenied(
         '403 "[BYOK] Your API key does not have permission to access this model. Please check your API key permissions."'
      ),
      true
   );
   assert.equal(isModelPermissionDenied('402 the balance has run out'), false);
});

test('after the tier choice and its one fallback, the rest of the tiers remain', () => {
   const rest = modelsAfterPermissionDenial(
      pools(['low/a', 'low/b', 'low/c'], ['mid/a', 'mid/b'], ['max/a']),
      'berry_low',
      null
   );
   assert.deepEqual(rest, ['kilo-auto/efficient', 'low/c', 'mid/a', 'mid/b', 'max/a']);
});

test("an agent's own gateway fallback is the one the runtime already tried", () => {
   const rest = modelsAfterPermissionDenial(
      pools(['low/a', 'low/b', 'low/c'], ['mid/a'], ['max/a']),
      'berry_low',
      'mid/a'
   );
   assert.deepEqual(rest, ['kilo-auto/efficient', 'low/b', 'low/c', 'max/a']);
});

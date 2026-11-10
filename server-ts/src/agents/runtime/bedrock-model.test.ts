import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bedrockModelFactory } from './bedrock-model.ts';

test('the platform model is the envelope model, in its region, whatever the agent asked for', () => {
   const factory = bedrockModelFactory({ provider: 'bedrock', model: 'us.amazon.nova-lite-v1:0', region: 'eu-central-1' }, null);
   const model = factory({ model: 'some-tier-model', region: 'us-east-1', maxTokens: 2048, temperature: 0.2 });
   const config = model.getConfig();
   assert.equal(config.modelId, 'us.amazon.nova-lite-v1:0');
   assert.equal(config.maxTokens, 2048);
   assert.equal(config.temperature, 0.2);
});

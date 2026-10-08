import assert from 'node:assert/strict';
import { test } from 'node:test';
import { identityNeedsRenewal } from './provider-factory.ts';

test('an expired AgentCore token and an unfinished consent are a renewal; a setup miss is not', () => {
   assert.equal(identityNeedsRenewal('Token has expired. Please generate a new token.'), true);
   assert.equal(identityNeedsRenewal('GitHub is not authorised for this AgentCore identity yet; complete the consent flow'), true);
   assert.equal(identityNeedsRenewal('AgentCore GitHub consent is failed'), true);
   assert.equal(identityNeedsRenewal('AgentCore Identity returned no GitHub token'), false);
});

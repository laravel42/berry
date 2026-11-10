import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatMention, parseMentions } from './mentions.ts';

const USER = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';

test('user and agent mentions are read from their tokens, once each', () => {
   const body = `hi ${formatMention('user', USER, 'Ada')} and ${formatMention('agent', AGENT, 'Bot')}, ${formatMention('user', USER, 'Ada')}`;
   assert.deepEqual(parseMentions(body), { users: [USER], agents: [AGENT], plugins: [] });
});

test('a plain @name is not a mention', () => {
   assert.deepEqual(parseMentions('ping @ada please'), { users: [], agents: [], plugins: [] });
});

test('a malformed id is ignored', () => {
   assert.deepEqual(parseMentions('[@x](mention://user/not-a-uuid)'), { users: [], agents: [], plugins: [] });
});

test('a plugin mention is the installation, once', () => {
   const plugin = '33333333-3333-4333-8333-333333333333';
   const body = `${formatMention('plugin', plugin, 'Linear')} and ${formatMention('plugin', plugin, 'Linear')}`;
   assert.deepEqual(parseMentions(body).plugins, [plugin]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMentions } from './mentions.ts';

const A = '0a1b2c3d-0000-4000-8000-00000000000a';

test('agent tokens are found, once each', () => {
   const parsed = parseMentions(`@[Coder](agent:${A}) please; again @[Coder](agent:${A.toUpperCase()})`);
   assert.deepEqual(parsed, { agents: [A] });
});

test('a bare @name, an email and a malformed token are not mentions', () => {
   assert.deepEqual(parseMentions('@Coder mail me@x.test @[Coder](agent:nope)'), { agents: [] });
});

test('a display name cannot span lines', () => {
   assert.deepEqual(parseMentions(`@[Co\nder](agent:${A})`), { agents: [] });
});

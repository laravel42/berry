import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvInvalid, parseDotenv } from './env-store.ts';

test('.env text is read as dotenv reads it: comments, export, quotes, and nothing expanded', () => {
   assert.deepEqual(
      parseDotenv(['# keys', '', 'OPENAI_API_KEY=sk-abc', 'export REGION = eu-west-1  # where', 'GREETING="hello\\nworld"', 'RAW=\'a # b\'', 'URL=${services.db.host}', 'EMPTY='].join('\r\n')),
      { OPENAI_API_KEY: 'sk-abc', REGION: 'eu-west-1', GREETING: 'hello\nworld', RAW: 'a # b', URL: '${services.db.host}', EMPTY: '' }
   );
});

test('a line that would silently not apply is refused with its number', () => {
   for (const [text, line] of [['A=1\nnot a variable', 2], ['1BAD=x', 1], ['A=1\n\nPORT=9', 3], ['NODE_OPTIONS=--require ./x', 1]] as const) {
      assert.throws(() => parseDotenv(text), (error: unknown) => error instanceof EnvInvalid && error.line === line, text);
   }
});

import assert from 'node:assert/strict';
import { Message } from '@strands-agents/sdk';
import { test } from 'node:test';
import { ApiTokenCallError, ApiTokenModel, buildRequest, readReply } from './api-token-model.ts';

const TOKEN = 'secret-token-value';

function user(text: string): Message {
   return Message.fromMessageData({ role: 'user', content: [{ text }] });
}

function assistantTools(name: string, id: string, input: { status: string }): Message {
   return Message.fromMessageData({
      role: 'assistant',
      content: [{ toolUse: { name, toolUseId: id, input } }],
   });
}

function toolResult(id: string, text: string): Message {
   return Message.fromMessageData({
      role: 'user',
      content: [{ toolResult: { toolUseId: id, status: 'success', content: [{ text }] } }],
   });
}

test('Gemini generateContent puts the token in a header, not the URL', () => {
   const request = buildRequest(
      { runtimeId: 'gemini', model: 'gemini-2.5-flash', token: TOKEN },
      [user('hello')],
      { systemPrompt: 'Be brief.', toolSpecs: [{ name: 'probe', description: 'probe', inputSchema: { type: 'object', properties: { q: { type: 'string' } } } }] }
   );
   assert.equal(
      request.url,
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
   );
   assert.doesNotMatch(request.url, /secret/);
   assert.equal(request.headers['x-goog-api-key'], TOKEN);
   assert.deepEqual(request.body.systemInstruction, { parts: [{ text: 'Be brief.' }] });
   const tools = request.body.tools as Array<{ functionDeclarations: Array<{ name: string }> }>;
   assert.equal(tools[0]?.functionDeclarations[0]?.name, 'probe');
});

test('Gemini function results keep the tool name from the earlier call', () => {
   const request = buildRequest(
      { runtimeId: 'gemini', model: 'gemini-2.5-flash', token: TOKEN },
      [user('list'), assistantTools('list_tasks', 'call_1', { status: 'todo' }), toolResult('call_1', 'none')]
   );
   const contents = request.body.contents as Array<{ role: string; parts: Array<Record<string, unknown>> }>;
   const response = contents.at(-1)?.parts[0]?.functionResponse as { name?: string; id?: string } | undefined;
   assert.equal(response?.name, 'list_tasks');
   assert.equal(response?.id, 'call_1');
});

test('Gemini reads a function call and usage', () => {
   const reply = readReply('gemini', {
      candidates: [
         {
            finishReason: 'STOP',
            content: {
               role: 'model',
               parts: [{ functionCall: { name: 'probe', args: { q: 'x' }, id: 'c1' } }],
            },
         },
      ],
      usageMetadata: { promptTokenCount: 11, candidatesTokenCount: 4, cachedContentTokenCount: 3 },
   });
   assert.equal(reply.text, '');
   assert.deepEqual(reply.tools, [{ id: 'c1', name: 'probe', input: { q: 'x' } }]);
   assert.equal(reply.usage.inputTokens, 11);
   assert.equal(reply.usage.cacheReadInputTokens, 3);
   assert.equal(reply.blocked, false);
});

test('Gemini SAFETY is a content block, not a successful empty reply', () => {
   const reply = readReply('gemini', {
      candidates: [{ finishReason: 'SAFETY', content: { parts: [] } }],
   });
   assert.equal(reply.blocked, true);
});

test('OpenAI chat completions map tools and do not put the token on the URL', () => {
   const request = buildRequest(
      { runtimeId: 'openai', model: 'gpt-4.1', token: TOKEN },
      [user('hi')],
      { toolSpecs: [{ name: 'probe', description: 'probe' }] }
   );
   assert.equal(request.url, 'https://api.openai.com/v1/chat/completions');
   assert.doesNotMatch(request.url, /secret/);
   assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
   const reply = readReply('openai', {
      choices: [{ message: { content: 'done', tool_calls: [{ id: 't1', function: { name: 'probe', arguments: '{"a":1}' } }] } }],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
   });
   assert.equal(reply.text, 'done');
   assert.deepEqual(reply.tools, [{ id: 't1', name: 'probe', input: { a: 1 } }]);
});

test('Anthropic messages keep the token off the URL', () => {
   const request = buildRequest(
      { runtimeId: 'anthropic', model: 'claude-sonnet-4-5', token: TOKEN, maxTokens: 100 },
      [user('hi')]
   );
   assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
   assert.doesNotMatch(request.url, /secret/);
   assert.equal(request.headers['x-api-key'], TOKEN);
   assert.equal(request.body.max_tokens, 100);
});

test('a refused Gemini token is reported without the secret', async () => {
   const seen: { url?: string } = {};
   const model = new ApiTokenModel({
      runtimeId: 'gemini',
      model: 'gemini-2.5-flash',
      token: TOKEN,
      fetchImpl: async (url) => {
         seen.url = url;
         return new Response('{"error":{"message":"permission denied"}}', { status: 403 });
      },
   });
   await assert.rejects(
      (async () => {
         for await (const _event of model.stream([user('hi')])) {
            // Drain.
         }
      })(),
      (error: unknown) =>
         error instanceof ApiTokenCallError &&
         error.status === 403 &&
         !error.message.includes(TOKEN)
   );
   assert.doesNotMatch(seen.url ?? '', /secret/);
});

test('a Gemini reply streams text then usage', async () => {
   const model = new ApiTokenModel({
      runtimeId: 'gemini',
      model: 'gemini-2.5-flash',
      token: TOKEN,
      fetchImpl: async () =>
         new Response(
            JSON.stringify({
               candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'all done' }] } }],
               usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 },
            }),
            { status: 200 }
         ),
   });
   const events = [];
   for await (const event of model.stream([user('hi')])) events.push(event);
   const text = events
      .filter((event) => event.type === 'modelContentBlockDeltaEvent')
      .map((event) => ('delta' in event && event.delta.type === 'textDelta' ? event.delta.text : ''))
      .join('');
   assert.equal(text, 'all done');
   const usage = events.find((event) => event.type === 'modelMetadataEvent');
   assert.ok(usage && 'usage' in usage);
   assert.equal(usage.usage?.inputTokens, 5);
   assert.equal(usage.usage?.outputTokens, 2);
});

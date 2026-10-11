import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { encodeResponse, takeFrame } from './claude-mcp-bridge.ts';

describe('claude mcp bridge framing', () => {
   test('a JSON line is answered with a JSON line', () => {
      const request = Buffer.from('{"jsonrpc":"2.0","id":0,"method":"initialize"}\n');
      const frame = takeFrame(request);
      assert.ok(frame);
      assert.equal(frame.framing, 'line');
      assert.equal(JSON.parse(frame.body).method, 'initialize');
      const reply = encodeResponse('{"jsonrpc":"2.0","id":0,"result":{}}', frame.framing);
      assert.equal(reply.toString('utf8'), '{"jsonrpc":"2.0","id":0,"result":{}}\n');
   });

   test('a Content-Length request is answered with Content-Length', () => {
      const body = '{"jsonrpc":"2.0","id":1,"method":"ping"}';
      const request = Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      const frame = takeFrame(request);
      assert.ok(frame);
      assert.equal(frame.framing, 'content-length');
      assert.equal(frame.body, body);
      const reply = encodeResponse('{"jsonrpc":"2.0","id":1,"result":{}}', frame.framing);
      assert.equal(reply.toString('utf8'), 'Content-Length: 36\r\n\r\n{"jsonrpc":"2.0","id":1,"result":{}}');
   });
});

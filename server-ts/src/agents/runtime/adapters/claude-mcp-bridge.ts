/**
 * Stdio MCP proxy for the Claude Code CLI.
 *
 * Claude Code 2.1 writes one JSON object per line. Older clients write
 * `Content-Length` frames. The reply uses the same framing as the request:
 * a Content-Length header is not a JSON line, and Claude ignores it and
 * waits out its 30s connect timeout. Berry's tool host speaks one JSON
 * object per line on a Unix socket. This process is the only thing between
 * them. It sees tool names, not the CLI login.
 */
import { connect } from 'node:net';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';

const runningAsBridge = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
const socketPath = runningAsBridge ? process.argv[2] : undefined;
if (runningAsBridge && !socketPath) process.exit(1);

const socket = socketPath ? connect(socketPath) : null;
socket?.on('error', () => process.exit(1));

const queued: string[] = [];
let wait: ((line: string) => void) | null = null;
if (socket) {
   createInterface({ input: socket }).on('line', (line) => {
      if (wait) {
         const resolve = wait;
         wait = null;
         resolve(line);
         return;
      }
      queued.push(line);
   });
}

function nextLine(): Promise<string> {
   const line = queued.shift();
   if (line !== undefined) return Promise.resolve(line);
   return new Promise((resolve) => {
      wait = resolve;
   });
}

let incoming = Buffer.alloc(0);
let reading = false;

if (runningAsBridge) {
   process.stdin.on('data', (chunk: Buffer | string) => {
      incoming = Buffer.concat([incoming, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      void pump();
   });
}

async function pump(): Promise<void> {
   if (reading) return;
   reading = true;
   try {
      for (;;) {
         const framed = takeFrame(incoming);
         if (framed === null) break;
         incoming = framed.rest;
         let message: { id?: unknown };
         try {
            message = JSON.parse(framed.body) as { id?: unknown };
         } catch {
            continue;
         }
         socket?.write(`${framed.body}\n`);
         if (message.id === undefined) continue;
         const response = await nextLine();
         process.stdout.write(encodeResponse(response, framed.framing));
      }
   } finally {
      reading = false;
   }
}

export type McpFraming = 'line' | 'content-length';

/** One JSON-RPC message, either Content-Length framed or a single JSON line. */
export function takeFrame(incoming: Buffer): { body: string; framing: McpFraming; rest: Buffer } | null {
   const source = incoming.toString('utf8');
   if (source.startsWith('{')) {
      const newline = source.indexOf('\n');
      if (newline === -1) return null;
      return {
         body: source.slice(0, newline).trim(),
         framing: 'line',
         rest: Buffer.from(source.slice(newline + 1), 'utf8'),
      };
   }
   const headerEnd = incoming.indexOf('\r\n\r\n');
   if (headerEnd === -1) return null;
   const header = incoming.subarray(0, headerEnd).toString('utf8');
   const match = /content-length:\s*(\d+)/i.exec(header);
   if (!match?.[1]) return null;
   const length = Number(match[1]);
   const start = headerEnd + 4;
   if (incoming.length < start + length) return null;
   return {
      body: incoming.subarray(start, start + length).toString('utf8'),
      framing: 'content-length',
      rest: incoming.subarray(start + length),
   };
}

/** Reply in the framing the request used, so a line client can read the result. */
export function encodeResponse(body: string, framing: McpFraming): Buffer {
   if (framing === 'line') return Buffer.from(`${body}\n`, 'utf8');
   const bytes = Buffer.from(body, 'utf8');
   return Buffer.concat([Buffer.from(`Content-Length: ${bytes.length}\r\n\r\n`, 'utf8'), bytes]);
}

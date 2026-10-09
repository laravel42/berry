/**
 * Stdio MCP proxy. Kiro spawns this file and Berry's adapter owns the socket.
 * The bridge sees tool names only. The API key never crosses it.
 */
import { connect } from 'node:net';
import { createInterface } from 'node:readline';

const socketPath = process.argv[2];
if (!socketPath) process.exit(1);

const socket = connect(socketPath);
socket.on('error', () => process.exit(1));
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
   socket.write(`${line}\n`);
});
socket.on('data', (chunk: Buffer) => {
   process.stdout.write(chunk);
});
socket.on('end', () => process.exit(0));

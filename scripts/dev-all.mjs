// Cross-platform replacement for `a & b & wait` (bun's shell has no "&").
import { spawn, spawnSync } from 'node:child_process';

const win = process.platform === 'win32';
const children = ['dev:server', 'dev:frontend'].map((script) =>
  Object.assign(spawn('bun', ['run', script], { stdio: 'inherit', shell: win }), { script })
);

let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null || c.signalCode) continue;
    // With shell:true the child is cmd.exe; kill() would orphan bun and node.
    if (win) spawnSync('taskkill', ['/pid', String(c.pid), '/t', '/f'], { stdio: 'ignore' });
    else c.kill();
  }
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

// If one dies, say which one and take the other down too.
for (const c of children) {
  c.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`\ndev-all: ${c.script} exited (code ${code}, signal ${signal}). Stopping the rest.`);
    }
    stop();
    process.exit(code ?? 0);
  });
}

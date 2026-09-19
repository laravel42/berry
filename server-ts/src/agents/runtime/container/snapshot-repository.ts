import { mkdtemp, readFile, readlink, realpath, lstat, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { shellQuote } from '../../checkout.ts';
import { parseNumstat } from '../../delivery.ts';
import { verify } from '../../verification.ts';
import { emitterSink } from './emitter.ts';
import type { RepositoryStep } from './handler.ts';
import type { LocalSession } from './local-session.ts';
import type { TaskDelivery } from '../../../runtime/lifecycle.ts';

/** Fresh, credential-free snapshots. The control plane publishes the returned candidate. */
export function snapshotRepository(options: { fetch?: typeof fetch } = {}): RepositoryStep {
   const baselines = new WeakMap<LocalSession, string>();
   const git = 'git -c core.hooksPath=/dev/null -c core.fsmonitor=false';
   return {
      async prepare({ envelope, session, emit, signal }) {
         const repo = envelope.repo;
         if (!repo) return null;
         if (!repo.snapshotCommit) throw new Error('Repository snapshots require an updated Berry server');
         await session.open();
         // Made by the runtime, under a name nobody could have laid a link at,
         // then handed to the session's user so its commands can work in it.
         const directory = await mkdtemp(join(session.root, 'repo-'));
         await session.adopt(directory);
         const archive = `${directory}.tar.gz`;
         const response = await (options.fetch ?? fetch)(`${envelope.berry.apiUrl.replace(/\/+$/, '')}/api/v1/agent-tools/repository-snapshot`, {
            headers: { authorization: `Bearer ${envelope.berry.token}` }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
         });
         if (!response.ok || !response.body) throw new Error(`Repository snapshot unavailable (${response.status})`);
         const chunks: Uint8Array[] = [];
         let size = 0;
         for await (const chunk of response.body) {
            size += chunk.byteLength;
            if (size > 100 * 1024 * 1024) throw new Error('Repository archive exceeds the 100 MiB snapshot limit');
            chunks.push(chunk);
         }
         await writeFile(archive, Buffer.concat(chunks));
         await session.adopt(archive);
         try {
            const extract = await session.exec(`tar -xzf ${shellQuote(archive)} --strip-components=1 -C ${shellQuote(directory)}`, { cwd: directory });
            if (extract.exitCode !== 0) throw new Error('Could not unpack repository snapshot');
         } finally { await rm(archive, { force: true }); }
         const result = await session.exec(`${git} init -q && ${git} add -A && ${git} -c user.name=Berry -c user.email=agent@berry.invalid commit -q --allow-empty -m snapshot && ${git} rev-parse HEAD`, { cwd: directory });
         if (result.exitCode !== 0) throw new Error('Could not initialize repository snapshot');
         baselines.set(session, result.stdout.trim());
         await emitterSink(emit).appendRepositoryReady(envelope.runId, { repository: repo.fullName, branch: repo.branch, baseCommit: repo.snapshotCommit });
         return directory;
      },
      async deliver({ envelope, session, directory, emit, checkpoint }) {
         const repo = envelope.repo;
         if (!repo || repo.readOnly) return null;
         const baseline = baselines.get(session);
         if (!baseline || !/^[0-9a-f]{40,64}$/.test(baseline)) throw new Error('Repository baseline is missing');
         // Unfinished work is saved, not judged: its checks would fail for the
         // plain reason that it is not done.
         if (!checkpoint) {
            const report = await verify({ session, directory, commands: repo.verifyCommands });
            await emitterSink(emit).appendVerified(envelope.runId, {
               passed: report.passed, complete: report.complete, durationMs: report.durationMs,
               results: report.results.map((r) => ({ command: r.command, exitCode: r.exitCode, passed: r.passed, durationMs: r.durationMs, error: r.error })),
            });
         }
         const diff = await session.exec(`${git} add -A && ${git} diff --cached --numstat -z --no-renames ${shellQuote(baseline)}`, { cwd: directory });
         if (diff.exitCode !== 0) throw new Error('Could not read the complete candidate');
         const stat = parseNumstat(diff.stdout);
         const files: NonNullable<TaskDelivery['candidate']> = [];
         for (const path of stat.files) {
            const full = resolve(directory, path);
            const rel = relative(directory, full);
            if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Candidate path escapes the repository');
            try {
               const info = await lstat(full);
               if (!info.isFile() && !info.isSymbolicLink()) throw new Error('Unsupported candidate file');
               // `lstat` sees a link at the leaf, not one in the directories above
               // it. The runtime may be root here and the tree is the agent's, so a
               // file is only read where it really is inside the checkout.
               if (info.isFile()) {
                  const real = await realpath(full);
                  const home = await realpath(directory);
                  if (real !== home && !real.startsWith(home + sep)) throw new Error('Candidate path escapes the repository');
               }
               const bytes = info.isSymbolicLink() ? Buffer.from(await readlink(full)) : await readFile(full);
               files.push({ path, mode: info.isSymbolicLink() ? '120000' : (info.mode & 0o111) ? '100755' : '100644', content: bytes.toString('base64') });
            } catch (error) {
               if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
               files.push({ path, mode: '100644', content: null });
            }
            if (files.length > 2000 || Buffer.byteLength(JSON.stringify(files)) > 7 * 1024 * 1024) throw new Error('Candidate exceeds the bounded delivery size; split the change');
         }
         baselines.delete(session);
         return { ...stat, committed: false, commit: null, branch: repo.branch, candidate: files };
      },
   };
}

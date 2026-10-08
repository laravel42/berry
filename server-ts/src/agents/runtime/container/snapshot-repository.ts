import { mkdtemp, open, readFile, readlink, realpath, lstat, writeFile, rm } from 'node:fs/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';
import { shellQuote } from '../../checkout.ts';
import { parseNumstat } from '../../delivery.ts';
import { verify } from '../../verification.ts';
import { emitterSink } from './emitter.ts';
import type { RepositoryStep } from './handler.ts';
import type { LocalSession } from './local-session.ts';
import { applyMergeOverlay } from './merge-overlay.ts';
import { checkCommands, LOCKFILES, packageChecks, type PackageChecks } from './package-checks.ts';
import type { TaskDelivery } from '../../../runtime/lifecycle.ts';

/** Fresh, credential-free snapshots. The control plane publishes the returned candidate. */
export function snapshotRepository(options: { fetch?: typeof fetch } = {}): RepositoryStep {
   const baselines = new WeakMap<LocalSession, string>();
   const merges = new WeakSet<LocalSession>();
   const packages = new WeakMap<LocalSession, PackageChecks>();
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
         if (repo.verifyCommands.length === 0) {
            const manifest = await readRegularFile(join(directory, 'package.json'));
            const present = await Promise.all(LOCKFILES.map(async ([file]) => ((await readRegularFile(join(directory, file))) !== null ? file : null)));
            const found = manifest === null ? null : packageChecks(manifest, present.filter((file): file is string => file !== null));
            if (found) packages.set(session, found);
         }
         // After the baseline, so the branch's side of a conflict-resolution
         // run is part of the candidate: the baseline is the default branch.
         if (repo.merge && !repo.readOnly) {
            await applyMergeOverlay({ envelope, session, directory, fetch: options.fetch ?? fetch, signal });
            merges.add(session);
         }
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
            const report = await verify({ session, directory, commands: await commandsFor(repo.verifyCommands, packages.get(session), directory) });
            // An empty list is not a failed suite. Recording it as `passed:
            // false` made every project with no checks look unverified.
            if (report.results.length > 0) {
               await emitterSink(emit).appendVerified(envelope.runId, {
                  passed: report.passed, complete: report.complete, durationMs: report.durationMs,
                  results: report.results.map((r) => ({ command: r.command, exitCode: r.exitCode, passed: r.passed, durationMs: r.durationMs, error: r.error })),
               });
            }
         }
         // A crash dump is never the work: a browser or tool that crashed in the
         // checkout left a 28 MB `core` there, and it failed the delivery on size.
         const untracked = await session.exec(`${git} ls-files --others --exclude-standard -z`, { cwd: directory });
         if (untracked.exitCode === 0) await removeCoreDumps(directory, untracked.stdout.split('\0').filter(Boolean));
         // Installed dependencies are never the work either. An agent ran
         // `npm install` in a repository with no .gitignore, and its 1,100 files
         // of node_modules, one GitHub write each, tripped the secondary rate
         // limit and failed the delivery. Only what the snapshot did not
         // already track is left out: a repository that vendors its
         // dependencies keeps delivering changes to them.
         await session.exec(`mkdir -p .git/info && printf '%s/\\n' ${INSTALLED_DIRECTORIES.map(shellQuote).join(' ')} >> .git/info/exclude`, { cwd: directory });
         const added = await session.exec(`${git} add -A && ${git} diff --cached --name-only --diff-filter=A -z ${shellQuote(baseline)}`, { cwd: directory });
         if (added.exitCode !== 0) throw new Error('Could not read the complete candidate');
         // Staged or committed by the agent itself, where the exclude does not
         // reach; and an editor's or a patch's leftovers this run added.
         const installed = added.stdout
            .split('\0')
            .filter((path) => path !== '' && (isInstalledPath(path) || isLeftoverFile(path)));
         for (let from = 0; from < installed.length; from += 200) {
            const paths = installed.slice(from, from + 200).map(shellQuote).join(' ');
            const unstaged = await session.exec(`${git} rm --cached -q -- ${paths}`, { cwd: directory });
            if (unstaged.exitCode !== 0) throw new Error('Could not leave installed dependencies out of the candidate');
         }
         const diff = await session.exec(`${git} diff --cached --numstat -z --no-renames ${shellQuote(baseline)}`, { cwd: directory });
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
         // Said only when the overlay was really applied: the control plane
         // publishes a merge commit on nothing less.
         const merged = merges.delete(session);
         return { ...stat, committed: false, commit: null, branch: repo.branch, candidate: files, ...(merged ? { merged: true } : {}) };
      },
   };
}

/**
 * The project's commands, else the default branch's package checks. Those run
 * only where dependencies were installed: in a checkout without node_modules
 * every one fails on a missing binary, which says nothing about the work.
 */
async function commandsFor(configured: string[], found: PackageChecks | undefined, directory: string): Promise<string[]> {
   if (configured.length > 0 || !found) return configured;
   const installed = await lstat(join(directory, 'node_modules')).then((info) => info.isDirectory(), () => false);
   return installed ? checkCommands(found, await readRegularFile(join(directory, 'package.json'))) : [];
}

/** A file's text, only when it is a regular file: a link in the agent's tree is never followed. */
async function readRegularFile(path: string): Promise<string | null> {
   try {
      const info = await lstat(path);
      if (!info.isFile() || info.size > 1024 * 1024) return null;
      return await readFile(path, 'utf8');
   } catch {
      return null;
   }
}

/**
 * Folders a package manager, interpreter or build tool fills, at any depth.
 * None of them is ever source, whatever the repository's .gitignore says.
 */
export const INSTALLED_DIRECTORIES: readonly string[] = [
   'node_modules', 'bower_components', '.pnpm-store',
   '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.venv', '.tox',
   '.next', '.nuxt', '.svelte-kit', '.turbo', '.parcel-cache',
];

/** Whether a repository path lies inside one of `INSTALLED_DIRECTORIES`. */
export function isInstalledPath(path: string): boolean {
   return path.split('/').slice(0, -1).some((segment) => INSTALLED_DIRECTORIES.includes(segment));
}

/**
 * Whether a new file is a copy kept beside the real one: `x.tsx.bak`,
 * `x.orig`, `x.rej`, `x~`, an editor's swap file. An agent saved
 * `channel/[id].tsx.bak` before editing the screen, and it shipped in the
 * pull request. Only files the run added are left out, so a repository that
 * tracks such a file still delivers changes to it.
 */
export function isLeftoverFile(path: string): boolean {
   return /(\.(bak|orig|rej|swp|swo)|~)$/.test(path);
}

/** Whether a file's first bytes are an ELF core dump: the magic, then e_type 4 (ET_CORE). */
export function isCoreDump(head: Uint8Array): boolean {
   if (head.length < 18) return false;
   if (head[0] !== 0x7f || head[1] !== 0x45 || head[2] !== 0x4c || head[3] !== 0x46) return false;
   // e_type sits at offset 16, in the file's own byte order (EI_DATA: 1 little, 2 big).
   const type = head[5] === 2 ? (head[16]! << 8) | head[17]! : head[16]! | (head[17]! << 8);
   return type === 4;
}

/**
 * Deletes the untracked files named like a core dump (`core`, `core.1234`)
 * that really are one. A `core/` folder or a source file called core is left
 * alone: only the name and the ELF header together say crash dump.
 */
async function removeCoreDumps(directory: string, paths: string[]): Promise<void> {
   for (const path of paths) {
      if (!/(^|\/)core(\.\d+)?$/.test(path)) continue;
      const full = resolve(directory, path);
      const rel = relative(directory, full);
      if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) continue;
      try {
         const info = await lstat(full);
         if (!info.isFile()) continue;
         const handle = await open(full, 'r');
         try {
            const head = new Uint8Array(18);
            await handle.read(head, 0, 18, 0);
            if (!isCoreDump(head)) continue;
         } finally {
            await handle.close();
         }
         await rm(full, { force: true });
      } catch {
         // Unreadable or gone: the size check below still guards the delivery.
      }
   }
}

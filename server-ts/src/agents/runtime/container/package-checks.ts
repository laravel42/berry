import { shellQuote } from '../../checkout.ts';

/**
 * A project's own checks, read from the default branch's package.json when
 * the project names none.
 *
 * Projects had no way to name their verify commands, so no run was ever
 * verified. The scripts a repository already keeps are the next best word on
 * what "it works" means there. They are read from the snapshot, before the
 * agent runs: a script the run edits is checked as the default branch wrote
 * it, so a run cannot weaken its own evidence.
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export interface PackageChecks {
   manager: PackageManager;
   checks: Array<{ name: string; body: string }>;
}

/** Tried in order; the first a project defines is its type check. */
const TYPECHECK_SCRIPTS = ['typecheck', 'type-check', 'check-types', 'check'];

/** The lockfiles that name a manager, in the order they are trusted. */
export const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
   ['pnpm-lock.yaml', 'pnpm'],
   ['yarn.lock', 'yarn'],
   ['bun.lock', 'bun'],
   ['bun.lockb', 'bun'],
   ['package-lock.json', 'npm'],
];

function scriptsOf(text: string): Record<string, string> | null {
   try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || !('scripts' in parsed)) return null;
      const scripts = parsed.scripts;
      if (!scripts || typeof scripts !== 'object') return null;
      return Object.fromEntries(
         Object.entries(scripts).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim() !== '')
      );
   } catch {
      return null;
   }
}

/** The type check and test scripts of a package.json, or null when it has neither. */
export function packageChecks(packageJson: string, lockfiles: readonly string[]): PackageChecks | null {
   const scripts = scriptsOf(packageJson);
   if (!scripts) return null;
   const checks: PackageChecks['checks'] = [];
   const typecheck = TYPECHECK_SCRIPTS.find((name) => scripts[name] !== undefined);
   if (typecheck) checks.push({ name: typecheck, body: scripts[typecheck]! });
   // npm init's placeholder fails on purpose; it is not a suite.
   if (scripts.test !== undefined && !/no test specified/i.test(scripts.test)) checks.push({ name: 'test', body: scripts.test });
   if (checks.length === 0) return null;
   const manager = LOCKFILES.find(([file]) => lockfiles.includes(file))?.[1] ?? 'npm';
   return { manager, checks };
}

/**
 * The commands to run at delivery. A script still as the default branch wrote
 * it runs by name; one the run changed or removed runs as it was written.
 */
export function checkCommands(found: PackageChecks, currentPackageJson: string | null): string[] {
   const current = currentPackageJson === null ? null : scriptsOf(currentPackageJson);
   return found.checks.map(({ name, body }) =>
      current?.[name] === body
         ? `${found.manager} run ${name}`
         : `PATH="$PWD/node_modules/.bin:$PATH" sh -c ${shellQuote(body)}`
   );
}

import { apiFetch } from './api';
import {
   artifactPreviewBase,
   artifactText,
   loadIssueArtifacts,
   siteEntry,
   type RunArtifact,
} from './attachments';

/** A page that loads source a browser cannot run as it is: TypeScript, JSX or a framework component. */
export const NEEDS_BUILD = /<script[^>]*\bsrc\s*=\s*["'][^"']+\.(?:tsx?|jsx|vue|svelte)["']/i;

export interface SitePreviewTarget {
   /** The page the preview opens on. */
   entry: RunArtifact;
   /** The signed base every file of the task is served under. */
   base: string;
   /** The page is a build tool's source and has to be built first. */
   unbuilt: boolean;
}

/**
 * What a task's site preview needs, fetched once per task and page: the entry,
 * a preview base and whether it needs a build. Kept for less than the base's
 * hour, and forgotten on failure so the next attempt asks again.
 */
const targets = new Map<string, { at: number; value: Promise<SitePreviewTarget | null> }>();
const TARGET_TTL_MS = 45 * 60_000;

export function loadSitePreview(
   issueRef: string,
   options: { path?: string | null; artifacts?: RunArtifact[] } = {}
): Promise<SitePreviewTarget | null> {
   const key = `${issueRef}\0${options.path ?? ''}`;
   const held = targets.get(key);
   if (held && Date.now() - held.at < TARGET_TTL_MS) return held.value;
   const value = (async () => {
      const artifacts = options.artifacts ?? (await loadIssueArtifacts(issueRef));
      const entry =
         (options.path && artifacts.find((artifact) => artifact.path === options.path)) ||
         siteEntry(artifacts);
      if (!entry) return null;
      const [base, html] = await Promise.all([artifactPreviewBase(issueRef), artifactText(entry)]);
      return { entry, base, unbuilt: NEEDS_BUILD.test(html) };
   })();
   targets.set(key, { at: Date.now(), value });
   value.catch(() => targets.delete(key));
   return value;
}

/** Where a task's site build stood when last asked, for the Preview to start from. */
export interface KnownSiteBuild {
   available: boolean;
   state: 'idle' | 'building' | 'ready' | 'failed';
   log: string;
   startedAt: string | null;
   finishedAt: string | null;
   url?: string | null;
}
const builds = new Map<string, KnownSiteBuild>();

/**
 * The build state last seen for this task. The Preview starts from it, so a
 * site already built shows at once instead of flashing "Building".
 */
export function knownSiteBuild(issueRef: string): KnownSiteBuild | null {
   return builds.get(issueRef) ?? null;
}

/** Records a build state seen by anyone, so the next Preview starts from it. */
export function rememberSiteBuild(issueRef: string, build: KnownSiteBuild): void {
   builds.set(issueRef, build);
}

function buildPath(issueRef: string): string {
   return `/api/v1/issues/${encodeURIComponent(issueRef)}/artifacts/preview/build`;
}

/**
 * Builds the task's site again even though its files are already built — the
 * Rebuild button. Joins the running build when there is one.
 */
export async function rebuildSite(issueRef: string): Promise<KnownSiteBuild> {
   const build = await apiFetch<KnownSiteBuild>(buildPath(issueRef), {
      method: 'POST',
      body: JSON.stringify({ force: true }),
   });
   rememberSiteBuild(issueRef, build);
   return build;
}

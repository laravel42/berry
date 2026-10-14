// Build-time fetch of real repository signals. Never invents a number: if the request
// fails, is rate-limited, or the signal is below its threshold, that item is simply
// not rendered. Thresholds keep a young repo from advertising zeroes.
export type RepoFacts = {
  stars: number;
  contributors: number;
  releases: number;
  pushedAt: string | null;
};

const REPO = "laravel42/berry";
const HEADERS = { Accept: "application/vnd.github+json", "User-Agent": "berry.pm-build" };

async function json(path: string, signal: AbortSignal) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, { headers: HEADERS, signal });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export async function getRepoFacts(): Promise<RepoFacts | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 4000);
  try {
    const [repo, contributors, releases] = await Promise.all([
      json("", ctl.signal),
      json("/contributors?per_page=100", ctl.signal),
      json("/releases?per_page=1", ctl.signal),
    ]);
    return {
      stars: repo.stargazers_count ?? 0,
      contributors: Array.isArray(contributors) ? contributors.length : 0,
      releases: Array.isArray(releases) ? releases.length : 0,
      pushedAt: repo.pushed_at ?? null,
    };
  } catch {
    return null; // the build must not depend on GitHub being reachable
  } finally {
    clearTimeout(timer);
  }
}

export function relativeAge(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "last month" : `${months} months ago`;
}

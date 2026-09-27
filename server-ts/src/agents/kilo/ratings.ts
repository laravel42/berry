import { z } from 'zod';

/**
 * Model ratings from Terminal-Bench (tbench.ai), on one scale (ADR-0017).
 *
 * Terminal-Bench publishes one leaderboard per version, and no version rates
 * every model: the newest rates frontier models, the oldest most of the
 * cheaper ones. Kilo's gateway carries a benchmark score of its own for a
 * few more. Each is on its own scale — a harder version scores the same
 * model lower — so they are put on the newest leaderboard's scale before
 * they are compared:
 *
 * - A model the newest leaderboard rates keeps that score.
 * - Another source is converted through the models it shares with what is
 *   already on the scale, by a straight line fitted in log-odds, where a
 *   harder benchmark is a shift and a stretch rather than a curve. A source
 *   joins once it shares at least three models; sources join most-shared
 *   first, so an old version reaches the scale through a newer one.
 * - A model rated by several converted sources takes their mean, and is
 *   marked as estimated, with the sources it came from: a converted score is
 *   a prediction of the newest leaderboard, and a loose one (Kilo scores two
 *   models alike that Terminal-Bench 4.0 puts 0.2 apart).
 *
 * Nothing here names a model: the leaderboards move, and so do the ratings.
 */

/** The public read behind tbench.ai's leaderboard pages; no key. */
export const TBENCH_LEADERBOARD_URL = 'https://ofhuhcpkvzjlejydnvyd.supabase.co/functions/v1/leaderboard-read';

/** Newest first: the first one is the scale every rating is given on. */
export const TBENCH_LEADERBOARDS = [
   { package: 'terminal-bench/terminal-bench', name: '4-0-0', title: 'Terminal-Bench 4.0' },
   { package: 'terminal-bench/terminal-bench', name: '3-0-0', title: 'Terminal-Bench 3.0' },
   { package: 'terminal-bench/terminal-bench-2-1', name: 'main', title: 'Terminal-Bench 2.1' },
   { package: 'terminal-bench/terminal-bench-2', name: '2-0', title: 'Terminal-Bench 2.0' },
] as const;

/** Success rate (0–1) per model key. */
export type Scores = Map<string, number>;

export interface RatingSource {
   title: string;
   scores: Scores;
}

/** A source joins the scale only through at least this many shared models. */
const MIN_SHARED = 3;

/**
 * The same model under the names the sources give it: `anthropic/claude-opus-4.7`,
 * `Claude Opus 4.7` and `Opus 4.7` are one key. The vendor prefix, a `:free`
 * suffix and the word "claude" are dropped, and the words sorted, so
 * `Claude 4.5 Sonnet` meets `claude-sonnet-4.5`.
 */
export function modelKey(name: string): string {
   const bare = name.includes('/') ? name.slice(name.indexOf('/') + 1) : name;
   return bare
      .replace(/:free$/i, '')
      .toLowerCase()
      .split(/[\s_-]+/)
      .filter((word) => word !== '' && word !== 'claude')
      .sort()
      .join(' ');
}

const rowSchema = z.object({
   metadata: z.object({
      model_display: z.union([z.string(), z.object({ label: z.string() })]).nullish(),
   }),
   metrics: z.object({ accuracy: z.number() }),
});

/**
 * One leaderboard's best score per model. A model is listed once per agent
 * and reasoning effort; its best run says what it can do. Scores are
 * percentages; a leaderboard that gives none above 1 gives fractions.
 */
export function parseLeaderboard(body: unknown): Scores {
   const rows = (body as { rows?: unknown })?.rows;
   if (!Array.isArray(rows)) throw new Error('the Terminal-Bench leaderboard had no rows');
   const parsed = rows.flatMap((row) => {
      const result = rowSchema.safeParse(row);
      if (!result.success) return [];
      const display = result.data.metadata.model_display;
      const label = typeof display === 'string' ? display : display?.label;
      return label ? [{ key: modelKey(label), accuracy: result.data.metrics.accuracy }] : [];
   });
   const percent = parsed.some((row) => row.accuracy > 1);
   const scores: Scores = new Map();
   for (const { key, accuracy } of parsed) {
      const rate = percent ? accuracy / 100 : accuracy;
      if (rate >= 0 && rate <= 1 && rate > (scores.get(key) ?? -1)) scores.set(key, rate);
   }
   return scores;
}

// Log-odds of a rate kept off 0 and 1, where they are infinite.
const logit = (rate: number) => {
   const p = Math.min(Math.max(rate, 0.005), 0.995);
   return Math.log(p / (1 - p));
};
const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

function fitLine(pairs: Array<[number, number]>): { intercept: number; slope: number } | null {
   const n = pairs.length;
   const meanX = pairs.reduce((sum, [x]) => sum + x, 0) / n;
   const meanY = pairs.reduce((sum, [, y]) => sum + y, 0) / n;
   let sxx = 0;
   let sxy = 0;
   for (const [x, y] of pairs) {
      sxx += (x - meanX) ** 2;
      sxy += (x - meanX) * (y - meanY);
   }
   if (sxx === 0) return null;
   const slope = sxy / sxx;
   return { intercept: meanY - slope * meanX, slope };
}

/**
 * Every source's ratings on the first non-empty source's scale, as the
 * module comment describes. A source that shares too few models, or whose
 * scores run against the scale's, is left out rather than guessed at.
 */
export function combineRatings(sources: RatingSource[]): {
   scale: string | null;
   ratings: Scores;
   /** The sources an estimated rating was converted from; a rating the scale measured has none. */
   estimatedFrom: Map<string, string[]>;
} {
   const present = sources.filter((source) => source.scores.size > 0);
   const reference = present[0];
   const estimatedFrom = new Map<string, string[]>();
   if (!reference) return { scale: null, ratings: new Map(), estimatedFrom };

   // On the scale, in log-odds.
   const known = new Map([...reference.scores].map(([key, rate]) => [key, logit(rate)]));
   const converted = new Map<string, number[]>();
   const pending = present.slice(1);
   for (;;) {
      const shared = (source: RatingSource) => [...source.scores.keys()].filter((key) => known.has(key));
      const next = pending
         .map((source, index) => ({ source, index, count: shared(source).length }))
         .filter((entry) => entry.count >= MIN_SHARED)
         .sort((a, b) => b.count - a.count || a.index - b.index)[0];
      if (!next) break;
      pending.splice(next.index, 1);
      const line = fitLine(shared(next.source).map((key) => [logit(next.source.scores.get(key)!), known.get(key)!]));
      if (!line || line.slope <= 0) continue;
      for (const [key, rate] of next.source.scores) {
         if (reference.scores.has(key)) continue;
         const values = converted.get(key) ?? [];
         values.push(line.intercept + line.slope * logit(rate));
         converted.set(key, values);
         estimatedFrom.set(key, [...(estimatedFrom.get(key) ?? []), next.source.title]);
         known.set(key, values.reduce((sum, value) => sum + value, 0) / values.length);
      }
   }

   const ratings: Scores = new Map();
   for (const [key, rate] of reference.scores) ratings.set(key, rate);
   for (const [key, values] of converted) {
      ratings.set(key, sigmoid(values.reduce((sum, value) => sum + value, 0) / values.length));
   }
   return { scale: reference.title, ratings, estimatedFrom };
}

/** Reads one leaderboard; throws when it cannot be read or has no rows. */
export async function readLeaderboard(
   fetch: typeof globalThis.fetch,
   url: string,
   board: { package: string; name: string },
   timeoutMs: number
): Promise<Scores> {
   const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ package: board.package, name: board.name }),
      signal: AbortSignal.timeout(timeoutMs),
   });
   if (!response.ok) throw new Error(`the Terminal-Bench leaderboard answered ${response.status}`);
   return parseLeaderboard(await response.json());
}

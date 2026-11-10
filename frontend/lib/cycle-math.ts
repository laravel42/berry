import type { Cycle, CycleIssueRef, CycleProgress } from './cycles';

/**
 * Date and progress arithmetic for cycles. Pure: no store, no fetch.
 *
 * A cycle's `startsOn` and `endsOn` are calendar dates with no zone, and both
 * days belong to the cycle. They are handled as UTC midnights so a day is
 * always 24 hours; "today" is the reader's local calendar date, because that
 * is the day they are living in.
 */

const DAY_MS = 86_400_000;

function utc(iso: string): number {
   const [year = 1970, month = 1, day = 1] = iso.slice(0, 10).split('-').map(Number);
   return Date.UTC(year, month - 1, day);
}

function isoFromUtc(ms: number): string {
   return new Date(ms).toISOString().slice(0, 10);
}

function pad(value: number): string {
   return String(value).padStart(2, '0');
}

/** The reader's local calendar date, `YYYY-MM-DD`. */
export function todayIso(now: Date = new Date()): string {
   return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The local calendar date an instant fell on. */
export function localDateOf(instant: string): string {
   return todayIso(new Date(instant));
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
   return Math.round((utc(to) - utc(from)) / DAY_MS);
}

export function addDays(iso: string, days: number): string {
   return isoFromUtc(utc(iso) + days * DAY_MS);
}

export function isWeekend(iso: string): boolean {
   const day = new Date(utc(iso)).getUTCDay();
   return day === 0 || day === 6;
}

/** Days in the cycle, both ends included. */
export function cycleLength(cycle: Pick<Cycle, 'startsOn' | 'endsOn'>): number {
   return daysBetween(cycle.startsOn, cycle.endsOn) + 1;
}

/** Which day of the cycle `today` is, clamped to the cycle (1-based). */
export function cycleDay(cycle: Pick<Cycle, 'startsOn' | 'endsOn'>, today: string): number {
   const length = cycleLength(cycle);
   return Math.min(length, Math.max(1, daysBetween(cycle.startsOn, today) + 1));
}

/** Days of the cycle that have begun: all of a completed one, none of an upcoming one. */
export function elapsedDays(
   cycle: Pick<Cycle, 'startsOn' | 'endsOn' | 'status'>,
   today: string
): number {
   const length = cycleLength(cycle);
   if (cycle.status === 'completed') return length;
   if (cycle.status === 'upcoming') return 0;
   return Math.min(length, Math.max(0, daysBetween(cycle.startsOn, today) + 1));
}

/** "Nov 2", in the reader's language. */
export function formatDay(iso: string, locale = 'en'): string {
   return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
   }).format(new Date(utc(iso)));
}

/** "Nov 2, 2026". */
export function formatDate(iso: string, locale = 'en'): string {
   return new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
   }).format(new Date(utc(iso)));
}

/** "Nov 2 → Nov 15, 2026": the year once, from the end. */
export function formatRange(cycle: Pick<Cycle, 'startsOn' | 'endsOn'>, locale = 'en'): string {
   return `${formatDay(cycle.startsOn, locale)} → ${formatDate(cycle.endsOn, locale)}`;
}

export interface ProgressBreakdown {
   total: number;
   done: number;
   working: number;
   cancelled: number;
   notStarted: number;
   /** Tasks the cycle still means to finish: everything but cancelled. */
   scope: number;
   /** Done as a share of scope, 0–100. */
   donePercent: number;
   /** Done or under way, as a share of scope, 0–100. */
   startedPercent: number;
}

/**
 * The counts every cycle surface shows. "Done" is done over scope —
 * cancelled work leaves the denominator — which is what a reader means by
 * "how much of this cycle is finished".
 */
export function breakdown(progress: CycleProgress | null | undefined): ProgressBreakdown {
   const total = progress?.issuesTotal ?? 0;
   const done = progress?.issuesDone ?? 0;
   const cancelled = progress?.issuesCancelled ?? 0;
   const working = progress?.issuesWorking ?? 0;
   const scope = Math.max(0, total - cancelled);
   const share = (value: number) => (scope > 0 ? Math.round((value / scope) * 100) : 0);
   return {
      total,
      done,
      working,
      cancelled,
      notStarted: Math.max(0, total - done - cancelled - working),
      scope,
      donePercent: share(done),
      startedPercent: share(done + working),
   };
}

/** The same counts, from the tasks themselves. */
export function progressFromIssues(issues: CycleIssueRef[]): CycleProgress {
   const count = (statuses: string[]) =>
      issues.filter((issue) => statuses.includes(issue.status)).length;
   return {
      issuesTotal: issues.length,
      issuesDone: count(['done']),
      issuesCancelled: count(['cancelled']),
      issuesWorking: count(['inProgress', 'inReview']),
      percent: 0,
   };
}

export interface BurnUp {
   /** SVG paths in a 300×120 box. Empty when nothing has elapsed. */
   done: string;
   area: string;
   scope: string;
   ideal: string;
   /** Empty unless the cycle is under way. */
   today: string;
}

export const BURNUP_WIDTH = 300;
export const BURNUP_HEIGHT = 120;

/**
 * Burn-up: done tasks per elapsed day against the cycle's scope.
 *
 * A task counts from the local day it was completed; one completed before
 * the cycle started counts from day one. Scope is today's — Berry does not
 * keep a history of when tasks joined a cycle — so it is a flat line.
 */
export function burnUp(
   cycle: Pick<Cycle, 'startsOn' | 'endsOn' | 'status'>,
   issues: CycleIssueRef[],
   today: string
): BurnUp {
   const W = BURNUP_WIDTH;
   const H = BURNUP_HEIGHT;
   const length = cycleLength(cycle);
   const elapsed = elapsedDays(cycle, today);
   const scope = Math.max(1, issues.filter((issue) => issue.status !== 'cancelled').length);
   const x = (day: number) => ((day / length) * W).toFixed(1);
   const y = (value: number) => (H - (value / scope) * H * 0.86).toFixed(1);

   const doneDays = issues
      .filter((issue) => issue.status === 'done')
      .map((issue) =>
         issue.completedAt
            ? Math.max(1, daysBetween(cycle.startsOn, localDateOf(issue.completedAt)) + 1)
            : 1
      );

   let done = `M0 ${H}`;
   let previous = 0;
   for (let day = 1; day <= elapsed; day += 1) {
      const current = doneDays.filter((value) => value <= day).length;
      done += ` L${x(day - 1)} ${y(previous)} L${x(day - 1)} ${y(current)} L${x(day)} ${y(current)}`;
      previous = current;
   }

   return {
      done: elapsed > 0 ? done : '',
      area: elapsed > 0 ? `${done} L${x(elapsed)} ${H} Z` : '',
      scope: `M0 ${y(scope)} H${W}`,
      ideal: `M0 ${H} L${W} ${y(scope)}`,
      today: cycle.status === 'active' && elapsed > 0 ? `M${x(elapsed - 0.5)} 0 V${H}` : '',
   };
}

export interface TimelineBlock {
   cycle: Cycle;
   /** Percent offsets along the timeline. */
   left: number;
   width: number;
}

export interface Timeline {
   blocks: TimelineBlock[];
   ticks: { left: number; month: string }[];
   /** Null when today falls outside the span. */
   today: number | null;
   startsOn: string;
   endsOn: string;
}

/** Every cycle on one horizontal axis, with a tick at each month start. */
export function timeline(cycles: Cycle[], today: string, locale = 'en'): Timeline | null {
   const first = cycles[0];
   if (!first) return null;
   const startsOn = cycles.reduce(
      (earliest, cycle) => (cycle.startsOn < earliest ? cycle.startsOn : earliest),
      first.startsOn
   );
   const endsOn = cycles.reduce(
      (latest, cycle) => (cycle.endsOn > latest ? cycle.endsOn : latest),
      first.endsOn
   );
   const end = addDays(endsOn, 1);
   const span = Math.max(1, daysBetween(startsOn, end));
   const at = (iso: string) => (daysBetween(startsOn, iso) / span) * 100;

   const ticks: Timeline['ticks'] = [];
   const monthName = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' });
   let [year = 1970, month = 1] = startsOn.split('-').map(Number);
   for (let guard = 0; guard < 120; guard += 1) {
      month += 1;
      if (month > 12) {
         month = 1;
         year += 1;
      }
      const iso = `${year}-${pad(month)}-01`;
      if (iso >= end) break;
      ticks.push({ left: at(iso), month: monthName.format(new Date(utc(iso))) });
   }

   return {
      startsOn,
      endsOn,
      ticks,
      today: today >= startsOn && today < end ? at(today) + 50 / span : null,
      blocks: cycles.map((cycle) => ({
         cycle,
         left: at(cycle.startsOn),
         width: (cycleLength(cycle) / span) * 100,
      })),
   };
}

/** Where the next cycle should start: the day after the last one ends, or today. */
export function nextCycleStart(cycles: Cycle[], today: string): string {
   const last = cycles.reduce(
      (latest, cycle) => (cycle.endsOn > latest ? cycle.endsOn : latest),
      ''
   );
   if (!last) return today;
   const after = addDays(last, 1);
   return after > today ? after : today;
}

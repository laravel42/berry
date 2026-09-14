import { toRFC3339, type Sql } from '../db/pool.ts';

/**
 * AutoGate verdicts on an issue.
 *
 * This route exists because of a specific failure: a rejected review left the
 * task sitting in review with nothing to read. The verdict was recorded and
 * the reason was written, and no surface showed either — so an issue an agent
 * had declined to approve looked exactly like one nobody had looked at yet.
 */

export interface AutoReview {
   id: string;
   runId: string;
   reviewer: string;
   /** The organization role the reviewer reviewed as; null for a legacy peer review. */
   reviewerRole: string | null;
   /** A blocking verdict decides the task; an advisory one only comments. */
   authority: 'blocking' | 'advisory';
   author: string;
   /** Null while the reviewer is still reading. */
   approved: boolean | null;
   inProgress: boolean;
   reason: string;
   attempt: number;
   startedAt: string;
   decidedAt: string | null;
}

const DEFAULT_LIMIT = 20;

export class ReviewRepository {
   private readonly sql: Sql;

   constructor(sql: Sql) {
      this.sql = sql;
   }

   /** The verdicts on one issue, newest first. */
   async list(issueId: string, limit = DEFAULT_LIMIT): Promise<AutoReview[]> {
      const bounded = limit < 1 || limit > 100 ? DEFAULT_LIMIT : limit;
      const rows = await this.sql`
         SELECT review.id, review.run_id,
                -- A reviewer whose agent row is gone is still a reviewer, and
                -- the verdict it left is still worth reading.
                COALESCE(reviewer.name, 'an agent') AS reviewer,
                COALESCE(author.name, 'an agent') AS author,
                review.approved, COALESCE(review.reason, '') AS reason,
                review.attempt, review.started_at, review.decided_at, review.reviewer_role, review.authority
           FROM issue_auto_reviews AS review
           LEFT JOIN agents AS reviewer ON reviewer.id = review.reviewer_id
           LEFT JOIN agents AS author ON author.id = review.author_id
          WHERE review.issue_id = ${issueId}
          ORDER BY review.started_at DESC
          LIMIT ${bounded}`;

      return rows.map((row) => ({
         id: row.id as string,
         runId: row.run_id as string,
         reviewer: row.reviewer as string,
         reviewerRole: (row.reviewer_role as string | null) ?? null,
         authority: row.authority === 'advisory' ? 'advisory' : 'blocking',
         author: row.author as string,
         approved: (row.approved as boolean | null) ?? null,
         // A row is reserved when the reviewer is picked and completed when it
         // answers, so an undecided verdict is one still being read.
         inProgress: row.approved === null,
         reason: row.reason as string,
         attempt: Number(row.attempt),
         startedAt: toRFC3339(row.started_at as string) ?? '',
         decidedAt: toRFC3339(row.decided_at as string | null),
      }));
   }
}

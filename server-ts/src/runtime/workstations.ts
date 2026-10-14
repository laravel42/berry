import { randomBytes } from 'node:crypto';
import { toRFC3339, type Sql } from '../db/pool.ts';
import { generateWorkstationToken, secretMatches } from '../auth/tokens.ts';

const MAX_PER_USER = 8;
const COLUMNS = `id, user_id, name, token_public_id, token_hash, last_seen_at, created_at`;

export class WorkstationLimit extends Error {
   override readonly name = 'WorkstationLimit';
   constructor() {
      super(`A person may pair at most ${MAX_PER_USER} workstations.`);
   }
}

export class WorkstationNotFound extends Error {
   override readonly name = 'WorkstationNotFound';
}

export interface WorkstationRecord {
   id: string;
   userId: string;
   name: string;
   lastSeenAt: string | null;
   createdAt: string;
}

export interface WorkstationAuth {
   id: string;
   userId: string;
   name: string;
   tokenHash: Buffer;
}

export interface IssuedWorkstation extends WorkstationRecord {
   /** Shown once. Never persisted. */
   token: string;
}

export class WorkstationRepository {
   readonly #sql: Sql;
   readonly #random: (size: number) => Buffer;
   readonly #newId: () => string;

   constructor(
      sql: Sql,
      random: (size: number) => Buffer = randomBytes,
      newId: () => string = () => crypto.randomUUID()
   ) {
      this.#sql = sql;
      this.#random = random;
      this.#newId = newId;
   }

   async list(userId: string): Promise<WorkstationRecord[]> {
      const rows = await this.#sql`
         SELECT ${this.#sql.unsafe(COLUMNS)}
           FROM workstations
          WHERE user_id = ${userId}
          ORDER BY created_at DESC, id DESC`;
      return rows.map(toRecord);
   }

   async create(userId: string, name: string): Promise<IssuedWorkstation> {
      const generated = generateWorkstationToken(this.#random);
      const id = this.#newId();
      const inserted = await this.#sql.begin(async (tx) => {
         const [count] = await tx<{ n: string }[]>`
            SELECT count(*)::text AS n FROM workstations WHERE user_id = ${userId}`;
         if (Number(count?.n ?? 0) >= MAX_PER_USER) throw new WorkstationLimit();
         const [row] = await tx`
            INSERT INTO workstations (id, user_id, name, token_public_id, token_hash)
            VALUES (${id}, ${userId}, ${name}, ${generated.publicId}, ${generated.secretHash})
            RETURNING ${tx.unsafe(COLUMNS)}`;
         return row;
      });
      if (!inserted) throw new Error('workstation insert returned no row');
      return { ...toRecord(inserted), token: generated.token };
   }

   async revoke(userId: string, id: string): Promise<void> {
      const result = await this.#sql`
         DELETE FROM workstations WHERE id = ${id} AND user_id = ${userId}`;
      if (result.count === 0) throw new WorkstationNotFound();
   }

   async findByPublicId(publicId: string): Promise<WorkstationAuth | null> {
      const [row] = await this.#sql`
         SELECT ${this.#sql.unsafe(COLUMNS)}
           FROM workstations
          WHERE token_public_id = ${publicId}`;
      if (!row) return null;
      return {
         id: row.id as string,
         userId: row.user_id as string,
         name: row.name as string,
         tokenHash: Buffer.from(row.token_hash as Uint8Array),
      };
   }

   async authenticate(token: { publicId: string; secret: string }): Promise<WorkstationAuth | null> {
      const found = await this.findByPublicId(token.publicId);
      if (!found || !secretMatches(token.secret, found.tokenHash)) return null;
      return found;
   }

   async touch(id: string): Promise<void> {
      await this.#sql`
         UPDATE workstations SET last_seen_at = now() WHERE id = ${id}`;
   }
}

function toRecord(row: Record<string, unknown>): WorkstationRecord {
   return {
      id: row.id as string,
      userId: row.user_id as string,
      name: row.name as string,
      lastSeenAt: toRFC3339(row.last_seen_at as string | null),
      createdAt: toRFC3339(row.created_at as string) ?? '',
   };
}

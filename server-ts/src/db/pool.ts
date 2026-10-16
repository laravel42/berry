import pg from 'pg';
import postgres from 'postgres';
import {
   iamPassword,
   parsePostgresEndpoint,
   type DatabaseIamAuth,
} from './rds-iam.ts';

/**
 * The database.
 *
 * Nothing here owns schema — `../migrations` does, applied by `src/migrate`
 * before the server starts. This is a connection and a transaction helper,
 * nothing more.
 */

export type Sql = postgres.Sql<{ timestamptz: string; timestamp: string; date: string }>;

/**
 * A pool or an open transaction.
 *
 * Helpers take this so the same function works inside and outside a
 * transaction. Passing the pool where a transaction is meant is the classic
 * way to run one statement of a supposedly atomic sequence on its own
 * connection, outside the transaction that was meant to protect it.
 */
export type Queryable =
   | Sql
   | postgres.TransactionSql<{ timestamptz: string; timestamp: string; date: string }>;

/**
 * A PostgreSQL timestamptz as Go renders it: RFC 3339 in UTC, keeping whatever
 * precision the column holds.
 *
 * postgres.js hands back the server's rendering — `2026-08-22 23:47:19.652293-06`
 * when the session is on America/Mexico_City. Replacing that offset with `Z`
 * would keep the digits and change the instant by six hours, which is a bug
 * that looks like a formatting choice. Connections are pinned to UTC below so
 * the offset is normally `+00`, and anything else is converted rather than
 * trusted.
 *
 * The conversion is done on the whole-second part and the fraction reattached,
 * because a JavaScript Date holds milliseconds and would drop the microseconds
 * PostgreSQL stores.
 */
const TIMESTAMP =
   /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/**
 * Renders a PostgreSQL timestamp as the RFC 3339 string Go puts on the wire.
 *
 * The driver hands back text, and PostgreSQL renders `timestamptz` in the
 * session's timezone: on a host set to America/Mexico_City the same instant
 * arrives as `2026-08-22 23:47:19.652293-06`. Replacing that offset with `Z`
 * keeps every digit and moves the instant six hours — a corruption that reads
 * like a formatting choice. The connection is pinned to UTC so this normally
 * has nothing to do, but a mispinned session must not silently produce a
 * plausible wrong answer.
 *
 * The offset is applied arithmetically rather than by handing the string to
 * `new Date`, whose parser requires `-06:00` and returns Invalid Date for
 * PostgreSQL's `-06` — which is exactly how the six-hour shift shipped once
 * already, through a fallback that stripped the offset it could not parse.
 */
export function toRFC3339(value: string | null | undefined): string | null {
   if (!value) return null;

   const match = TIMESTAMP.exec(value);
   if (!match) {
      // Refusing beats guessing: a timestamp that reaches the browser without
      // a zone is read as local time, which is the same bug in a new place.
      throw new Error(`unrecognised timestamp from PostgreSQL: ${value}`);
   }
   const [, year, month, day, hour, minute, second, fraction = '', offset] = match;

   const shift = offsetMinutes(offset);
   if (shift === 0) {
      return `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}Z`;
   }

   // Shift whole seconds and reattach the fraction untouched, because Date
   // holds milliseconds and PostgreSQL sends microseconds.
   const utc = new Date(
      Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) -
         shift * 60_000
   );
   return utc.toISOString().slice(0, 19) + fraction + 'Z';
}

/** Minutes east of UTC. An absent or `Z` offset is zero, as is `+00:00`. */
function offsetMinutes(offset: string | undefined): number {
   if (!offset || offset === 'Z') return 0;
   const digits = offset.slice(1).replace(':', '');
   const hours = Number(digits.slice(0, 2));
   const minutes = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
   return (offset.startsWith('-') ? -1 : 1) * (hours * 60 + minutes);
}

export interface DatabaseOptions {
   url: string;
   /** Mirrors pgxpool's default ceiling closely enough for one API process. */
   max?: number;
   connectTimeoutSeconds?: number;
   /**
    * When set, the password is an RDS IAM auth token minted per connection
    * (`@aws-sdk/rds-signer`). SSL is required. The URL password is ignored.
    */
   iam?: DatabaseIamAuth & { getAuthToken?: () => Promise<string> };
}

function driverOptions(options: DatabaseOptions) {
   return {
      max: options.max ?? 10,
      // Local Postgres answers in milliseconds. Aurora Serverless v2 can sit
      // at 0 ACU and spend 15–30s on TLS plus IAM before ReadyForQuery; 10s
      // then surfaces as `write CONNECT_TIMEOUT undefined:undefined` because
      // postgres.js reads host/port off the TLS socket, which does not have them.
      connect_timeout: options.connectTimeoutSeconds ?? (options.iam ? 60 : 10),
      // Timestamps come back as strings, not Dates, and that is a contract
      // requirement rather than a preference. PostgreSQL stores microseconds
      // and Go renders every digit — `2026-08-23T05:47:19.652293Z`. A
      // JavaScript Date holds milliseconds, so parsing and re-serializing
      // would silently emit `...652Z` and quietly drop precision the frontend
      // and every stored timestamp already carry.
      types: {
         timestamptz: { to: 1184, from: [1184], serialize: String, parse: String },
         timestamp: { to: 1114, from: [1114], serialize: String, parse: String },
         // A DATE is a calendar day, not an instant. Left to the driver it
         // arrives as a JS Date, which then has to be rendered back to a day —
         // and rendering a Date is exactly where a timezone shifts it. Kept as
         // the text PostgreSQL sent, which is already `YYYY-MM-DD`.
         date: { to: 1082, from: [1082], serialize: String, parse: String },
      },
      // Pinned to UTC so the server renders every timestamptz at +00 and the
      // conversion above has nothing to correct. Without this the answer
      // depends on the host's timezone, which is not a property a response
      // should have.
      connection: { TimeZone: 'UTC' },
      onnotice: () => {},
   };
}

export function databaseOptionsFromConfig(config: {
   databaseUrl: string;
   databaseIamAuth: DatabaseIamAuth | null;
   max?: number;
   connectTimeoutSeconds?: number;
}): DatabaseOptions {
   const options: DatabaseOptions = { url: config.databaseUrl };
   if (config.max !== undefined) options.max = config.max;
   if (config.connectTimeoutSeconds !== undefined) {
      options.connectTimeoutSeconds = config.connectTimeoutSeconds;
   }
   if (config.databaseIamAuth) options.iam = config.databaseIamAuth;
   return options;
}

export function openDatabase(options: DatabaseOptions): Sql {
   const common = driverOptions(options);
   if (!options.iam) {
      return postgres(options.url, common);
   }
   const endpoint = parsePostgresEndpoint(options.url);
   return postgres({
      ...common,
      host: endpoint.hostname,
      port: endpoint.port,
      database: endpoint.database,
      username: endpoint.username,
      password: iamPassword(endpoint, options.iam, options.iam.getAuthToken),
      ssl: { rejectUnauthorized: options.iam.sslRejectUnauthorized },
   });
}

/** Better Auth's `pg` pool, with the same IAM token path as postgres.js. */
export function openPgPool(options: DatabaseOptions): pg.Pool {
   const max = options.max ?? 10;
   if (!options.iam) {
      return new pg.Pool({ connectionString: options.url, max });
   }
   const endpoint = parsePostgresEndpoint(options.url);
   return new pg.Pool({
      host: endpoint.hostname,
      port: endpoint.port,
      user: endpoint.username,
      database: endpoint.database,
      password: iamPassword(endpoint, options.iam, options.iam.getAuthToken),
      ssl: { rejectUnauthorized: options.iam.sslRejectUnauthorized },
      max,
   });
}

/** The readiness probe behind `/ready`: can this process reach the database. */
export async function checkDatabase(sql: Sql): Promise<void> {
   await sql`SELECT 1`;
}

/**
 * Runs `work` inside one transaction, ported from `WithinTx[T]`.
 *
 * Returns the callback's value, rolls back on any throw, and hands the
 * callback the transaction rather than the pool so a query cannot accidentally
 * escape onto a different connection — the mistake `WithinTx` exists to make
 * impossible in Go.
 */
export async function withinTx<T>(sql: Sql, work: (tx: Sql) => Promise<T>): Promise<T> {
   return sql.begin(async (tx) => work(tx as unknown as Sql)) as Promise<T>;
}

export async function closeDatabase(sql: Sql): Promise<void> {
   await sql.end({ timeout: 5 });
}

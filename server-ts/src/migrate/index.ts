import { loadConfig } from '../config/config.ts';
import { openFromUrl } from '../db/embedded.ts';
import { createLogger } from '../observability/log.ts';
import { apply } from './migrations.ts';

/**
 * The migrator.
 *
 * Run to completion before the server starts, so readiness never races schema
 * setup. It exits non-zero on any drift rather than migrating over it.
 */

const config = loadConfig();
const logger = createLogger(`${config.serviceName}-migrate`);
const database = await openFromUrl(config.databaseUrl);
const sql = database.sql;

try {
   await apply(sql, logger);
   logger.info('database migrations are current');
} catch (error) {
   logger.error('migration failed', { error: error instanceof Error ? error.message : String(error) });
   await database.close().catch(() => {});
   process.exit(1);
}

await database.close();

import { loadConfig } from '../config/config.ts';
import { openFromUrl } from '../db/embedded.ts';
import { createLogger } from '../observability/log.ts';
import { BoardSlug, UserEmail, WorkspaceSlug } from './ids.ts';
import { apply } from './seed.ts';

/** The development seeder. */

const config = loadConfig();
const logger = createLogger(`${config.serviceName}-seed`);
const database = await openFromUrl(config.databaseUrl);
const sql = database.sql;

// `BERRY_SEED_DEMO_WORK=false` keeps the identity and the board and skips the
// demo projects — for a developer working in an empty product.
const demoWork = !['false', '0', 'no', 'off'].includes(
   (process.env.BERRY_SEED_DEMO_WORK ?? '').trim().toLowerCase()
);

try {
   await apply(sql, undefined, { demoWork });
   logger.info('development seed data is current', {
      userEmail: UserEmail,
      workspaceSlug: WorkspaceSlug,
      boardSlug: BoardSlug,
      demoWork,
   });
} catch (error) {
   logger.error('seed failed', { error: error instanceof Error ? error.message : String(error) });
   await database.close().catch(() => {});
   process.exit(1);
}

await database.close();

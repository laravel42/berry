/**
 * One-shot SMTP smoke test. Recipient comes from the CLI (or chat-supplied
 * argv); env is only a fallback when no address is passed.
 *
 *   pnpm --filter @berry/server mail:test -- you@example.com
 *
 * Needs the same mail config as the server (`BERRY_MAIL_PROVIDER=cloudflare`
 * plus `BERRY_SMTP_PASS` / `CF_API_TOKEN`, or an explicit SMTP host/URL).
 */

import { loadConfig, ConfigError } from '../config/config.ts';
import { createMailer } from '../auth/better-auth.ts';

const EMAIL_OK = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * Prefer an explicit address (CLI arg / caller), then optional env fallbacks.
 * Returns null when none is usable.
 */
export function resolveTestMailRecipient(
   argv: readonly string[],
   env: NodeJS.ProcessEnv = process.env
): string | null {
   for (const raw of argv) {
      if (raw.startsWith('-')) continue;
      const trimmed = raw.trim();
      if (EMAIL_OK.test(trimmed)) return trimmed;
   }
   for (const key of ['BERRY_MAIL_TEST_TO', 'MAIL_TEST_TO', 'TEST_EMAIL_TO'] as const) {
      const trimmed = (env[key] ?? '').trim();
      if (EMAIL_OK.test(trimmed)) return trimmed;
   }
   return null;
}

async function main(argv: string[]): Promise<void> {
   const to = resolveTestMailRecipient(argv);
   if (!to) {
      console.error(
         'Usage: pnpm --filter @berry/server mail:test -- <recipient@example.com>\n' +
            'Or set BERRY_MAIL_TEST_TO / MAIL_TEST_TO / TEST_EMAIL_TO as a fallback.'
      );
      process.exitCode = 1;
      return;
   }

   let config;
   try {
      config = loadConfig();
   } catch (error) {
      if (error instanceof ConfigError) {
         console.error(error.message);
         process.exitCode = 1;
         return;
      }
      throw error;
   }

   const mailer = createMailer(config.auth.mail);
   if (!mailer) {
      console.error(
         'No outbound mail configured. Set BERRY_MAIL_PROVIDER=cloudflare with BERRY_SMTP_PASS ' +
            '(or CF_API_TOKEN), BERRY_MAIL_FROM, and BERRY_SMTP_USER=api_token — or set BERRY_SMTP_HOST / BERRY_SMTP_URL.'
      );
      process.exitCode = 1;
      return;
   }
   if (!mailer.delivers) {
      console.error(
         'Mail is the development console sink, not SMTP. Configure Cloudflare or another SMTP host first.'
      );
      process.exitCode = 1;
      return;
   }

   const subject = 'Berry SMTP test';
   const text =
      'This is a Berry outbound-mail smoke test over authenticated SMTP.\n' +
      `Sent at ${new Date().toISOString()}.\n`;

   await mailer.send({ to, subject, text });
   console.info(`sent: to=${to} from=${mailer.from} subject=${subject}`);
}

const isDirectRun =
   process.argv[1] !== undefined &&
   (process.argv[1].endsWith('/mail/send-test.ts') || process.argv[1].endsWith('/mail/send-test.js'));

if (isDirectRun) {
   void main(process.argv.slice(2)).catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
   });
}

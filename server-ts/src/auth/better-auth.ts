import { randomUUID } from 'node:crypto';

import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { magicLink, testUtils, twoFactor, type TestHelpers } from 'better-auth/plugins';
import type { Pool } from 'pg';

import {
   createConsoleMailer,
   createSmtpMailer,
   magicLinkMail,
   resetPasswordMail,
   twoFactorOtpMail,
   type Mailer,
} from '../mail/mailer.ts';
import type { AuthMailConfig } from '../config/config.ts';

/**
 * Sign-in: Better Auth with GitHub, email/password, magic link and 2FA.
 *
 * Better Auth's user model *is* `users`, so an account keeps the id every
 * workspace, issue and token already points at. Its own state — sessions,
 * linked accounts, OAuth state and 2FA secrets — lives in the auth_* tables.
 *
 * It talks to Postgres through a small `pg` pool rather than the server's
 * postgres.js client because its Kysely adapter speaks `pg`; the pool is sized
 * for sign-in and session lookups, not for product queries.
 */

export const AUTH_BASE_PATH = '/api/auth';
export const SESSION_COOKIE_PREFIX = 'berry';

export interface BerryAuthOptions {
   pool: Pool;
   secret: string;
   baseUrl: string;
   trustedOrigins: string[];
   /** IPs or CIDR ranges skipped when reading the client from X-Forwarded-For. */
   trustedProxies?: string[];
   github: { clientId: string; clientSecret: string } | null;
   sessionTtlMs: number;
   /** Enables Better Auth's testUtils plugin: dev-login and tests only. */
   testUtils?: boolean;
   /** Outbound mail. Null disables magic link and password reset. */
   mail?: AuthMailConfig | null;
}

const MIN_PASSWORD_LENGTH = 12;
const MAGIC_LINK_TTL_SECONDS = 15 * 60;
const RESET_TOKEN_TTL_SECONDS = 15 * 60;

/** The route path Better Auth puts on the endpoint context for email sign-up. */
function endpointPath(context: unknown): string {
   if (!context || typeof context !== 'object' || !('path' in context)) return '';
   const path = context.path;
   return typeof path === 'string' ? path : '';
}

/** What GitHub tells us about whoever just signed in. */
export interface GitHubProfile {
   login?: string | null;
   name?: string | null;
   email?: string | null;
}

/**
 * The user behind a GitHub profile.
 *
 * GitHub withholds the email when the account keeps it private, and a GitHub
 * App gets one only with the Email addresses permission. Refusing the sign-in
 * over that would make a correct, deliberate privacy setting look like a
 * broken login, so the account falls back to the address GitHub itself hands
 * out for the purpose: <login>@users.noreply.github.com. A real address is
 * preferred whenever one is offered, because that is what links a GitHub
 * account to a user Berry already knows.
 */
export function githubProfileToUser(
   profile: GitHubProfile
): { email: string; name: string } | { email: string; name: string; emailVerified: true } {
   const email = (profile.email ?? '').trim();
   const login = (profile.login ?? '').trim();
   const name = (profile.name ?? '').trim();
   if (email) return { email, name: name || login };
   // The synthesised address counts as verified: it is derived from GitHub's
   // own login, nobody else can hold it, and it cannot collide with the
   // address of a Berry user who signed up another way. Without this the
   // create hook below refuses the account, because GitHub never marks this
   // address verified — it never sent it at all.
   return {
      email: login ? `${login}@users.noreply.github.com` : '',
      name: name || login,
      emailVerified: true,
   };
}

export function createMailer(config: AuthMailConfig | null | undefined): Mailer | null {
   if (!config) return null;
   if (config.smtp === null) return createConsoleMailer(config.from);
   if (typeof config.smtp === 'string') {
      return createSmtpMailer({ from: config.from, transport: config.smtp });
   }
   const { host, port, user, pass, secure } = config.smtp;
   return createSmtpMailer({
      from: config.from,
      transport: {
         host,
         port,
         secure,
         ...(user ? { auth: { user, pass: pass ?? '' } } : {}),
      },
   });
}

export function createBerryAuth(options: BerryAuthOptions) {
   const mailer = createMailer(options.mail ?? null);
   const plugins: BetterAuthPlugin[] = [];

   if (mailer) {
      plugins.push(
         magicLink({
            expiresIn: MAGIC_LINK_TTL_SECONDS,
            // Existing accounts only: registration is the email/password form.
            disableSignUp: true,
            storeToken: 'hashed',
            sendMagicLink: async ({ email, url }) => {
               const body = magicLinkMail(url);
               await mailer.send({ to: email, ...body });
            },
         }) as unknown as BetterAuthPlugin
      );
   }

   plugins.push(
      twoFactor({
         issuer: 'Berry',
         twoFactorTable: 'auth_two_factors',
         trustDeviceMaxAge: 30 * 24 * 60 * 60,
         schema: {
            user: {
               fields: {
                  twoFactorEnabled: 'two_factor_enabled',
               },
            },
            twoFactor: {
               fields: {
                  userId: 'user_id',
                  backupCodes: 'backup_codes',
                  failedVerificationCount: 'failed_verification_count',
                  lockedUntil: 'locked_until',
               },
            },
         },
         ...(mailer
            ? {
                 otpOptions: {
                    async sendOTP({
                       user,
                       otp,
                    }: {
                       user: { email: string };
                       otp: string;
                    }) {
                       const body = twoFactorOtpMail(otp);
                       await mailer.send({ to: user.email, ...body });
                    },
                 },
              }
            : {}),
      }) as unknown as BetterAuthPlugin
   );

   if (options.testUtils) {
      plugins.push(testUtils() as unknown as BetterAuthPlugin);
   }

   return betterAuth({
      appName: 'Berry',
      baseURL: options.baseUrl,
      basePath: AUTH_BASE_PATH,
      secret: options.secret,
      trustedOrigins: options.trustedOrigins,
      database: options.pool,
      emailAndPassword: {
         enabled: true,
         minPasswordLength: MIN_PASSWORD_LENGTH,
         maxPasswordLength: 256,
         resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,
         ...(mailer
            ? {
                 sendResetPassword: async ({
                    user,
                    url,
                 }: {
                    user: { email: string };
                    url: string;
                    token: string;
                 }) => {
                    const body = resetPasswordMail(url);
                    await mailer.send({ to: user.email, ...body });
                 },
              }
            : {}),
      },
      socialProviders: options.github
         ? {
              github: {
                 clientId: options.github.clientId,
                 clientSecret: options.github.clientSecret,
                 // Repository access rides on this login. A workspace with no
                 // App installation clones and pushes with the sign-in token.
                 scope: ['repo', 'workflow', 'read:org'],
                 mapProfileToUser: githubProfileToUser,
              },
           }
         : {},
      user: {
         modelName: 'users',
         fields: {
            image: 'avatar_url',
            emailVerified: 'email_verified',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
         },
         additionalFields: {
            twoFactorEnabled: {
               type: 'boolean',
               required: false,
               defaultValue: false,
               input: false,
               fieldName: 'two_factor_enabled',
            },
         },
         changeEmail: { enabled: false },
         deleteUser: { enabled: false },
      },
      databaseHooks: {
         user: {
            create: {
               // Better Auth has no "verified email only" switch for social
               // sign-up. Email registration is the /sign-up/email route and
               // arrives unverified when there is no verification mailer.
               // Every other create, including a new GitHub user, still needs
               // a verified address. Returning false aborts the create.
               before: async (user, context) => {
                  if (endpointPath(context) === '/sign-up/email') {
                     const name = typeof user.name === 'string' ? user.name.trim() : '';
                     if (name.length < 1 || name.length > 80) return false;
                     return { data: { ...user, name } };
                  }
                  return user.emailVerified === true ? { data: user } : false;
               },
            },
         },
      },
      session: {
         modelName: 'auth_sessions',
         fields: {
            userId: 'user_id',
            expiresAt: 'expires_at',
            ipAddress: 'ip_address',
            userAgent: 'user_agent',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
         },
         expiresIn: Math.floor(options.sessionTtlMs / 1000),
      },
      account: {
         modelName: 'auth_accounts',
         fields: {
            userId: 'user_id',
            accountId: 'account_id',
            providerId: 'provider_id',
            accessToken: 'access_token',
            refreshToken: 'refresh_token',
            idToken: 'id_token',
            accessTokenExpiresAt: 'access_token_expires_at',
            refreshTokenExpiresAt: 'refresh_token_expires_at',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
         },
         // The sign-in token is used again for repository work, and is kept
         // sealed.
         encryptOAuthTokens: true,
         accountLinking: {
            enabled: true,
            // Not trusted by name: linking happens only on a GitHub-verified
            // address (userInfo.emailVerified from GitHub's /user/emails).
            trustedProviders: [],
            allowDifferentEmails: false,
            // Email registration creates an unverified user, because there is
            // no verification mailer by default. Linking still requires
            // GitHub's verified address.
            requireLocalEmailVerified: false,
         },
      },
      verification: {
         modelName: 'auth_verifications',
         fields: {
            expiresAt: 'expires_at',
            createdAt: 'created_at',
            updatedAt: 'updated_at',
         },
      },
      advanced: {
         cookiePrefix: SESSION_COOKIE_PREFIX,
         // users.id and auth_sessions / auth_accounts / auth_two_factors ids
         // are uuid columns. auth_verifications.id is text: Better Auth's
         // reserveVerificationValue writes a SHA-256 base64url primary key
         // when a magic link promotes an unverified account. A generator
         // rather than 'uuid': in this Better Auth version 'uuid' means "the
         // database supplies it", and only users.id has a default; the
         // auth_* tables take the id they are given.
         database: { generateId: () => randomUUID() },
         // The address a session records (Settings › Security › Sessions).
         // The browser reaches the API through the web app's proxy, and often
         // a reverse proxy before it, so X-Forwarded-For carries a chain; the
         // named proxies are stripped from the right and the first hop left
         // is the person. Without them only a single-value header counts.
         ipAddress: { trustedProxies: options.trustedProxies ?? [] },
      },
      // Cast: plugin declared types do not always satisfy BetterAuthPlugin
      // under exactOptionalPropertyTypes. They are the library's plugins,
      // used as the library documents.
      plugins,
   });
}

export type BerryAuth = ReturnType<typeof createBerryAuth>;

/**
 * A signed session cookie for a user, as Set-Cookie header values.
 *
 * Only for the development dev-login route and tests: it needs the testUtils
 * plugin, which `createBerryAuth` installs only when asked to.
 */
export async function devSessionCookies(auth: BerryAuth, userId: string): Promise<string[]> {
   const context = (await auth.$context) as unknown as { test?: TestHelpers };
   if (!context.test) {
      throw new Error('devSessionCookies needs createBerryAuth({ testUtils: true })');
   }
   const { cookies } = await context.test.login({ userId });
   return cookies.map((cookie) => {
      const parts = [`${cookie.name}=${cookie.value}`, `Path=${cookie.path ?? '/'}`, 'HttpOnly'];
      parts.push(`SameSite=${cookie.sameSite ?? 'Lax'}`);
      if (cookie.secure) parts.push('Secure');
      if (typeof cookie.expires === 'number') {
         parts.push(`Expires=${new Date(cookie.expires * 1000).toUTCString()}`);
      }
      return parts.join('; ');
   });
}

import { z } from 'zod';

import { apiFetch } from './api';
import { authClient } from './auth-client';

const userSchema = z.object({
   id: z.string(),
   email: z.string(),
   name: z.string(),
   avatarUrl: z.string().nullable(),
   role: z.string().optional(),
   createdAt: z.string(),
   updatedAt: z.string(),
});

const devLoginResponseSchema = z.object({ user: userSchema });

const workspaceSchema = z.object({
   id: z.string(),
   name: z.string(),
   slug: z.string(),
   description: z.string().nullable(),
   role: z.string(),
   createdAt: z.string(),
   updatedAt: z.string(),
});

const bootstrapSchema = z.object({
   user: userSchema.extend({
      settings: z.object({
         theme: z.string(),
         timezone: z.string(),
         reducedMotion: z.boolean(),
         locale: z.string().default('en'),
      }),
   }),
   workspaces: z.array(workspaceSchema),
   currentWorkspaceId: z.string().nullable(),
});

const configSchema = z.object({
   signInOrigin: z.string().url().nullish(),
   capabilities: z.looseObject({
      githubSignIn: z.boolean().optional(),
      passwordlessLogin: z.boolean().optional(),
      emailRegistration: z.boolean().optional(),
      magicLink: z.boolean().optional(),
      passwordReset: z.boolean().optional(),
      twoFactor: z.boolean().optional(),
      sso: z.boolean().optional(),
      ssoDomains: z.array(z.string()).optional(),
      /** Models are reached through a gateway with Berry tiers (ADR-0017). */
      modelGateway: z.boolean().optional(),
      /** Members can open a LiveKit voice room with a workspace agent. */
      voiceAgents: z.boolean().optional(),
   }),
});

export type LoginUser = z.infer<typeof userSchema>;
export type BootstrapWorkspace = z.infer<typeof workspaceSchema>;
export type BootstrapPayload = z.infer<typeof bootstrapSchema>;

export type SignInOptions = {
   github: boolean;
   passwordless: boolean;
   emailRegistration: boolean;
   magicLink: boolean;
   passwordReset: boolean;
   twoFactor: boolean;
   sso: boolean;
   ssoDomains: string[];
   signInOrigin: string | null;
};

/**
 * Starts GitHub sign-in. It identifies the person and asks for repository
 * access so a workspace without an App can still clone and push.
 *
 * The browser must start on the server's sign-in origin so the state cookie
 * and the GitHub callback stay on the same host.
 */
export async function signInWithGitHub(): Promise<void> {
   const available = await fetchSignInOptions();
   const signInOrigin = (available.signInOrigin ?? '').replace(/\/$/, '');
   if (signInOrigin && window.location.origin !== signInOrigin) {
      const next = new URL('/sign-in', signInOrigin);
      next.searchParams.set('github', '1');
      window.location.assign(next.toString());
      return;
   }
   const origin = signInOrigin || window.location.origin;
   const { error } = await authClient().signIn.social({
      provider: 'github',
      callbackURL: `${origin}/`,
      errorCallbackURL: `${origin}/sign-in`,
   });
   if (error) {
      throw new Error(error.message || 'GitHub sign-in could not start');
   }
}

/**
 * Development-only sign-in as an existing account. The server registers the
 * route only in development and test, so this 404s anywhere else.
 */
export async function devLogin(email: string): Promise<LoginUser> {
   const json: unknown = await apiFetch('/api/v1/auth/dev-login', {
      method: 'POST',
      body: JSON.stringify({ email: email.trim() }),
   });
   const parsed = devLoginResponseSchema.safeParse(json);
   if (!parsed.success) {
      throw new Error('Login response was not recognized');
   }
   return parsed.data.user;
}

export async function fetchBootstrap(): Promise<BootstrapPayload> {
   const json: unknown = await apiFetch('/api/v1/me/bootstrap');
   const parsed = bootstrapSchema.safeParse(json);
   if (!parsed.success) {
      throw new Error('Bootstrap response was not recognized');
   }
   return parsed.data;
}

/** Whether this server can sign anyone in with GitHub. */
export async function fetchGitHubSignInAvailable(): Promise<boolean> {
   const options = await fetchSignInOptions();
   return options.github;
}

/** What the sign-in page can offer. */
export async function fetchSignInOptions(): Promise<SignInOptions> {
   const json: unknown = await apiFetch('/api/v1/config');
   const parsed = configSchema.safeParse(json);
   const capabilities = parsed.success ? parsed.data.capabilities : {};
   return {
      github: capabilities.githubSignIn === true,
      passwordless: capabilities.passwordlessLogin === true,
      emailRegistration: capabilities.emailRegistration === true,
      magicLink: capabilities.magicLink === true,
      passwordReset: capabilities.passwordReset === true,
      twoFactor: capabilities.twoFactor === true,
      sso: capabilities.sso === true,
      ssoDomains: Array.isArray(capabilities.ssoDomains)
         ? capabilities.ssoDomains.map((domain) => domain.toLowerCase())
         : [],
      signInOrigin: parsed.success ? (parsed.data.signInOrigin ?? null) : null,
   };
}

export async function registerWithEmail(input: {
   name: string;
   email: string;
   password: string;
}): Promise<void> {
   const { error } = await authClient().signUp.email({
      name: input.name.trim(),
      email: input.email.trim(),
      password: input.password,
      callbackURL: `${window.location.origin}/`,
   });
   if (error) {
      throw new Error(error.message || 'Could not create the account');
   }
}

/**
 * Email/password sign-in. When 2FA is enabled the client plugin redirects to
 * `?step=twofa` and this resolves without a session until the code is verified.
 */
export async function signInWithEmail(email: string, password: string): Promise<void> {
   const { error } = await authClient().signIn.email({
      email: email.trim(),
      password,
      callbackURL: `${window.location.origin}/`,
   });
   if (error) {
      throw new Error(error.message || 'Could not sign in');
   }
}

export async function requestMagicLink(email: string): Promise<void> {
   const origin = window.location.origin;
   const { error } = await authClient().signIn.magicLink({
      email: email.trim(),
      callbackURL: `${origin}/`,
      errorCallbackURL: `${origin}/sign-in?error=magic_link`,
   });
   if (error) {
      throw new Error(error.message || 'Could not send a sign-in link');
   }
}

export async function requestPasswordReset(email: string): Promise<void> {
   const origin = window.location.origin;
   const { error } = await authClient().requestPasswordReset({
      email: email.trim(),
      redirectTo: `${origin}/reset-password`,
   });
   if (error) {
      throw new Error(error.message || 'Could not send a reset link');
   }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
   const { error } = await authClient().resetPassword({
      token,
      newPassword,
   });
   if (error) {
      throw new Error(error.message || 'Could not set a new password');
   }
}

export async function signInWithSso(email: string): Promise<void> {
   const origin = window.location.origin;
   const { error } = await authClient().signIn.sso({
      email: email.trim(),
      callbackURL: `${origin}/`,
      errorCallbackURL: `${origin}/sign-in?error=sso`,
   });
   if (error) {
      throw new Error(error.message || 'Could not start SSO');
   }
}

export async function verifyTwoFactorTotp(code: string, trustDevice: boolean): Promise<void> {
   const { error } = await authClient().twoFactor.verifyTotp({
      code: code.trim(),
      trustDevice,
   });
   if (error) {
      throw new Error(error.message || 'That code did not work');
   }
}

export async function verifyTwoFactorBackup(code: string): Promise<void> {
   const { error } = await authClient().twoFactor.verifyBackupCode({
      code: code.trim(),
   });
   if (error) {
      throw new Error(error.message || 'That backup code did not work');
   }
}

/**
 * Whether agents run on Berry tiers through a model gateway. False when the
 * server does not say so, or cannot be asked: the model picker is the safe UI.
 */
export async function fetchModelGatewayAvailable(): Promise<boolean> {
   try {
      const json: unknown = await apiFetch('/api/v1/config');
      const parsed = configSchema.safeParse(json);
      return parsed.success && parsed.data.capabilities.modelGateway === true;
   } catch {
      return false;
   }
}

/**
 * Whether this process can mint a LiveKit voice token. False when the server
 * does not say so, or cannot be asked: the voice control stays hidden.
 */
export async function fetchVoiceAgentsAvailable(): Promise<boolean> {
   try {
      const json: unknown = await apiFetch('/api/v1/config');
      const parsed = configSchema.safeParse(json);
      return parsed.success && parsed.data.capabilities.voiceAgents === true;
   } catch {
      return false;
   }
}

/** Ends the session on the server; the cookie is cleared by the response. */
export async function logoutSession(): Promise<void> {
   const { error } = await authClient().signOut();
   if (error && error.status !== 401) {
      throw new Error(error.message || 'Sign-out failed');
   }
}

/** Domain part of an email, lowercased, or null when the address is not usable. */
export function emailDomain(email: string): string | null {
   const at = email.trim().lastIndexOf('@');
   if (at < 1) return null;
   const domain = email
      .trim()
      .slice(at + 1)
      .toLowerCase();
   return domain.includes('.') ? domain : null;
}

export function ssoDomainMatch(email: string, domains: string[]): string | null {
   const domain = emailDomain(email);
   if (!domain) return null;
   return domains.includes(domain) ? domain : null;
}

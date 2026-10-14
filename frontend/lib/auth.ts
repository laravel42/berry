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
      /** Models are reached through a gateway with Berry tiers (ADR-0017). */
      modelGateway: z.boolean().optional(),
   }),
});

export type LoginUser = z.infer<typeof userSchema>;
export type BootstrapWorkspace = z.infer<typeof workspaceSchema>;
export type BootstrapPayload = z.infer<typeof bootstrapSchema>;

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

/** What the sign-in page can offer. GitHub is shown whenever it is configured. */
export async function fetchSignInOptions(): Promise<{
   github: boolean;
   passwordless: boolean;
   emailRegistration: boolean;
   signInOrigin: string | null;
}> {
   const json: unknown = await apiFetch('/api/v1/config');
   const parsed = configSchema.safeParse(json);
   const capabilities = parsed.success ? parsed.data.capabilities : {};
   return {
      github: capabilities.githubSignIn === true,
      passwordless: capabilities.passwordlessLogin === true,
      emailRegistration: capabilities.emailRegistration === true,
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

/** Ends the session on the server; the cookie is cleared by the response. */
export async function logoutSession(): Promise<void> {
   const { error } = await authClient().signOut();
   if (error && error.status !== 401) {
      throw new Error(error.message || 'Sign-out failed');
   }
}

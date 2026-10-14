import { z } from 'zod';
import { apiFetch } from './api';

/**
 * First-login pair + tiers. Accounts still on version 1 only finished
 * creating or joining a workspace — the retired welcome/about-you steps.
 * Must match `SETUP_ONBOARDING_VERSION` on the server.
 */
export const SETUP_ONBOARDING_VERSION = 2;

export const onboardingSchema = z.object({
   version: z.number(),
   step: z.string(),
   answers: z.record(z.string(), z.string()).default({}),
   skipped: z.boolean(),
   completed: z.boolean(),
});

export type OnboardingState = z.infer<typeof onboardingSchema>;

export function needsSetupWizard(onboarding: OnboardingState | null | undefined): boolean {
   return (onboarding?.version ?? 0) < SETUP_ONBOARDING_VERSION;
}

export async function loadOnboarding(): Promise<OnboardingState> {
   const parsed = onboardingSchema.safeParse(await apiFetch('/api/v1/me/onboarding'));
   if (!parsed.success) throw new Error('Onboarding response was not recognized');
   return parsed.data;
}

export async function saveOnboarding(patch: {
   step?: string;
   skipped?: boolean;
   completed?: boolean;
}): Promise<OnboardingState> {
   const parsed = onboardingSchema.safeParse(
      await apiFetch('/api/v1/me/onboarding', {
         method: 'PATCH',
         body: JSON.stringify(patch),
      })
   );
   if (!parsed.success) throw new Error('Onboarding response was not recognized');
   return parsed.data;
}

/**
 * Berry's model tiers (ADR-0017). A role is on a tier, not on a model: which
 * model a tier means today is decided at run time, from the gateway's
 * leaderboard (agents/kilo/tiers.ts). Nothing here names a model or a vendor.
 */

export const TIERS = ['berry_max', 'berry_mid', 'berry_low', 'berry_free', 'berry_auto'] as const;
export type Tier = (typeof TIERS)[number];

/** The tiers a role in the default organization can be on: the paid ones. */
export type RoleTier = Extract<Tier, 'berry_max' | 'berry_mid' | 'berry_low'>;

export const TIER_NAMES: Record<Tier, string> = {
   berry_max: 'BerryMax',
   berry_mid: 'BerryMid',
   berry_low: 'BerryLow',
   berry_free: 'BerryFree',
   berry_auto: 'BerryAuto',
};

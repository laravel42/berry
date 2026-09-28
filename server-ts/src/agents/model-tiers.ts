/**
 * Berry's model tiers (ADR-0017). A role is on a tier, not on a model: which
 * model a tier means today is decided at run time, from the gateway's
 * leaderboard (agents/kilo/tiers.ts). Nothing here names a model or a vendor.
 */

// BerryFree and BerryAuto were removed on 2026-09-27: every tier is a paid
// one, served by the deployment's own key.
export const TIERS = ['berry_max', 'berry_mid', 'berry_low'] as const;
export type Tier = (typeof TIERS)[number];

/** The tiers a role in the default organization can be on: all of them. */
export type RoleTier = Tier;

export const TIER_NAMES: Record<Tier, string> = {
   berry_max: 'BerryMax',
   berry_mid: 'BerryMid',
   berry_low: 'BerryLow',
};

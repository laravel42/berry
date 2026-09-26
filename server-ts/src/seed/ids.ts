/** Stable Berry development identifiers. Safe to reference in local docs and tests. */

export const UserID = '11111111-1111-4111-8111-111111111101';
export const WorkspaceID = '11111111-1111-4111-8111-111111111110';
export const BoardID = '11111111-1111-4111-8111-111111111120';
export const TextToSpeechAgentID = '11111111-1111-4111-8111-111111111131';
export const TextToVideoAgentID = '11111111-1111-4111-8111-111111111132';

export const UserEmail = 'prototype@berry.test';
export const UserName = 'Prototype User';
export const WorkspaceName = 'Berry';
export const WorkspaceSlug = 'berry';
export const BoardName = 'Platform';
export const BoardSlug = 'platform';

/**
 * The Bedrock profile earlier seeds pinned every agent in the seeded
 * workspace to. Agents run on Berry tiers now (ADR-0017); the seed only takes
 * this pin off again (`clearSeededModels`).
 */
export const LegacySeedModel = { provider: 'bedrock', name: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' } as const;

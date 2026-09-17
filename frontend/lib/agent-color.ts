/**
 * A colour for each agent's Berry mark dot.
 *
 * Azure alone made every agent look the same in a dense roster. These hues
 * stay readable on both themes; the seed (agent id) picks one so the same
 * agent keeps the same colour wherever it appears.
 */
const AGENT_DOT_PALETTE = [
   '#5a92c9', // azure
   '#4f9f7a', // verdant
   '#d9a441', // amber
   '#c74a5e', // berry
   '#7c5cbf', // purple
   '#e07a5f', // coral
   '#3d9b8f', // teal
   '#6b8cae', // steel
   '#b4436c', // rose
   '#8a9a5b', // olive
   '#c47a3a', // rust
   '#5c7cfa', // indigo
   '#9b6715', // ochre
   '#397caf', // sky
   '#6366f1', // violet
   '#2a9d8f', // sea
] as const;

/** Stable Berry-mark dot colour for an agent id (or any stable seed). */
export function colorForAgent(seed: string): string {
   let total = 0;
   for (const character of seed) total = (total * 31 + character.charCodeAt(0)) >>> 0;
   return AGENT_DOT_PALETTE[total % AGENT_DOT_PALETTE.length]!;
}

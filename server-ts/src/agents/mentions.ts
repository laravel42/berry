/**
 * Mentions are explicit tokens the composer writes, never guessed from text.
 *
 * A bare "@Coder" could be a name, a handle or an email fragment; guessing
 * would start runs nobody asked for. The picker inserts
 * `@[Name](agent:<uuid>)`, which is unambiguous and survives a rename.
 */
const TOKEN =
   /@\[[^\]\n]{1,100}\]\(agent:([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

export function parseMentions(body: string): { agents: string[] } {
   const agents = new Set<string>();
   for (const match of body.matchAll(TOKEN)) {
      agents.add((match[1] ?? '').toLowerCase());
   }
   return { agents: [...agents] };
}

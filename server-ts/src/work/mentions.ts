/**
 * Mentions are markdown links with a `mention://` target:
 * `[@Ada](mention://user/<uuid>)`, `[@Reviewer](mention://agent/<uuid>)`.
 *
 * A link rather than a bare `@name` because a name is not an identity, and the
 * description and comment fields are stored byte for byte.
 */
const MENTION =
   /\[@[^\]\n]{1,100}\]\(mention:\/\/(user|agent|plugin)\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\)/gi;

export interface Mentions {
   users: string[];
   agents: string[];
   plugins: string[];
}

export function parseMentions(body: string): Mentions {
   const users = new Set<string>();
   const agents = new Set<string>();
   const plugins = new Set<string>();
   for (const match of body.matchAll(MENTION)) {
      const kind = (match[1] ?? '').toLowerCase();
      const id = (match[2] ?? '').toLowerCase();
      if (kind === 'user') users.add(id);
      if (kind === 'agent') agents.add(id);
      if (kind === 'plugin') plugins.add(id);
   }
   return { users: [...users], agents: [...agents], plugins: [...plugins] };
}

export function formatMention(kind: 'user' | 'agent' | 'plugin', id: string, name: string): string {
   return `[@${name.replace(/[\]\n]/g, '')}](mention://${kind}/${id})`;
}

const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

/**
 * The computer that exposes a subscription CLI.
 *
 * `localhost` is this server. Anything else must be a fully qualified domain
 * name: at least two labels, no scheme, port, or path.
 */
export function computerHost(value: string): string | null {
   const host = value.trim().toLowerCase().replace(/\.$/, '');
   if (host === 'localhost') return 'localhost';
   if (host.length === 0 || host.length > 253 || !host.includes('.')) return null;
   const labels = host.split('.');
   if (labels.some((label) => !LABEL.test(label))) return null;
   return host;
}

/**
 * Credentials a transcript can carry: a command that printed its environment,
 * a config file the agent read, a token in a URL. They are replaced before
 * the bundle leaves the machine, so neither the bucket, the model nor the
 * findings table ever holds one.
 *
 * Each rule matches a credential's own shape. Names alone are not enough:
 * agents read source code, and `token: runtimeId` is code, not a secret.
 */
export const REDACTED = '[redacted]';

const RULES: Array<[RegExp, string]> = [
   [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, REDACTED],
   [/\bberry_(?:pat|task|plugin)_[A-Za-z0-9_-]{8,}/g, REDACTED],
   [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, REDACTED],
   [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, REDACTED],
   [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, REDACTED],
   [/\bsk-[A-Za-z0-9_-]{20,}\b/g, REDACTED],
   [/\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, REDACTED],
   [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, REDACTED],
   [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, `$1 ${REDACTED}`],
   // Environment and config assignments: upper-case names only, the way .env files and `env` print them.
   [/\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|ACCESS_KEY|PRIVATE_KEY)[A-Z0-9_]*)(\s*[=:]\s*)["']?[^\s"']{6,}["']?/g, `$1$2${REDACTED}`],
   // user:password@ in a connection string.
   [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${REDACTED}@`],
];

export function redactText(text: string): string {
   let out = text;
   for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
   return out;
}

/** Every string inside a JSON-shaped value, redacted. Keys are left alone. */
export function redact<T>(value: T): T {
   if (typeof value === 'string') return redactText(value) as T;
   if (Array.isArray(value)) return value.map((item) => redact(item)) as T;
   if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item)])) as T;
   }
   return value;
}

export type Command =
   | { name: 'host' }
   | { name: 'help' }
   | { name: 'version' }
   | { name: 'up'; url: string; token: string };

/**
 * What this process should do. No args, or `host`, is the stdin JSON
 * protocol. `up` dials a remote Berry and claims jobs.
 */
export function parseArgv(argv: readonly string[]): Command {
   const [first, ...rest] = argv;
   if (first === undefined || first === 'host') {
      if (rest.length > 0) return { name: 'help' };
      return { name: 'host' };
   }
   if (first === '-h' || first === '--help' || first === 'help') return { name: 'help' };
   if (first === '-v' || first === '--version' || first === 'version') return { name: 'version' };
   if (first === 'up') {
      const flags = parseUpFlags(rest);
      if (!flags) return { name: 'help' };
      return { name: 'up', url: flags.url, token: flags.token };
   }
   return { name: 'help' };
}

export function parseUpFlags(
   argv: readonly string[],
   env: NodeJS.ProcessEnv = process.env
): { url: string; token: string } | null {
   let url = (env.BERRY_URL ?? '').trim();
   let token = (env.BERRY_WORKSTATION_TOKEN ?? '').trim();
   for (let i = 0; i < argv.length; i += 1) {
      const flag = argv[i];
      const next = argv[i + 1];
      if (flag === '--url' && next) {
         url = next.trim();
         i += 1;
         continue;
      }
      if (flag === '--token' && next) {
         token = next.trim();
         i += 1;
         continue;
      }
      return null;
   }
   if (!url || !token) return null;
   try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
   } catch {
      return null;
   }
   if (!token.startsWith('berry_ws_')) return null;
   return { url: url.replace(/\/+$/, ''), token };
}

export function helpText(): string {
   return [
      'berry-bridge — start subscription AI CLIs on this workstation for Berry.',
      '',
      'Usage:',
      '  berry-bridge up --url <berry> --token <berry_ws_…>',
      '      pair with a remote Berry and claim jobs (the usual command)',
      '  berry-bridge           read one JSON request on stdin (host protocol)',
      '  berry-bridge host      same as the default',
      '  berry-bridge --help    this text',
      '  berry-bridge --version package version',
      '',
      'Pair a token from Settings → Runtimes. BERRY_URL and BERRY_WORKSTATION_TOKEN',
      'work in place of the flags. The named CLI (claude, kiro-cli, …) stays on',
      'PATH with its own login. Berry does not read those credential files.',
   ].join('\n');
}

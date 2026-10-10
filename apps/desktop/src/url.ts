// The shell's start address and which navigations may stay inside the window.

const DEFAULT_START = 'http://localhost:3000';

export type StartUrl = {
   href: string;
   origin: string;
};

export function parseStartUrl(raw: string | undefined): StartUrl {
   const value = raw === undefined || raw.trim() === '' ? DEFAULT_START : raw.trim();
   let url: URL;
   try {
      url = new URL(value);
   } catch {
      throw new Error('BERRY_DESKTOP_URL must be an absolute http(s) URL.');
   }
   if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      throw new Error('BERRY_DESKTOP_URL must be an absolute http(s) URL.');
   }
   if (url.username !== '' || url.password !== '') {
      throw new Error('BERRY_DESKTOP_URL must not include credentials.');
   }
   return { href: url.href, origin: url.origin };
}

// GitHub is the only off-origin navigation the window keeps, so Better Auth
// can leave for the OAuth screen and return to the callback on the app origin.
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com']);

export function inAppNavigation(target: string, appOrigin: string): boolean {
   let url: URL;
   try {
      url = new URL(target);
   } catch {
      return false;
   }
   if (url.origin === appOrigin) return true;
   return url.protocol === 'https:' && GITHUB_HOSTS.has(url.hostname);
}

export function externalHttpUrl(target: string): string | null {
   let url: URL;
   try {
      url = new URL(target);
   } catch {
      return null;
   }
   if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
   if (url.username !== '' || url.password !== '') return null;
   return url.href;
}

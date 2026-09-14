/**
 * Stops a server and waits for it to finish, without waiting forever.
 *
 * `server.close()` stops accepting connections and calls back only once every
 * open one has ended. An event stream (`/api/v1/events`, held open by the
 * Next.js proxy) never ends on its own, so a plain close hangs: the listener is
 * gone, the process never exits, and `node --watch` cannot start its
 * replacement — every request then fails at the proxy.
 *
 * Idle keep-alive sockets are closed at once; anything still open after
 * `graceMs` — in-flight requests that overran, and streams — is cut.
 */

export interface Drainable {
   close(callback?: (error?: Error) => void): unknown;
   closeIdleConnections?(): void;
   closeAllConnections?(): void;
}

export function drain(server: Drainable, options: { graceMs: number }): Promise<void> {
   return new Promise((resolve) => {
      const force = setTimeout(() => server.closeAllConnections?.(), options.graceMs);
      server.close(() => {
         clearTimeout(force);
         resolve();
      });
      server.closeIdleConnections?.();
   });
}

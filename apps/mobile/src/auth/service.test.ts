import { describe, expect, test } from 'bun:test';

import { ApiClientError, createBerryClient } from '@/api/client';

import {
  probeServer,
  signInWithPassword,
  signInWithPat,
  signOutSession,
  verifyTwoFactorAndMintToken,
} from './service';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('auth service', () => {
  test('probeServer calls GET /api/v1/config without auth', async () => {
    let seenUrl = '';
    const config = await probeServer('https://berry.example.com', async (input) => {
      seenUrl = String(input);
      return jsonResponse({
        version: '0.9.4',
        signInOrigin: 'https://berry.example.com',
        capabilities: {
          agentExecution: true,
          metrics: false,
          realtime: true,
          storage: true,
          valkey: false,
          planner: false,
          modelGateway: false,
          voiceAgents: false,
          githubSignIn: true,
          passwordlessLogin: false,
          emailRegistration: true,
          magicLink: false,
          passwordReset: false,
          twoFactor: true,
        },
      });
    });

    expect(seenUrl).toBe('https://berry.example.com/api/v1/config');
    expect(config.version).toBe('0.9.4');
    expect(config.capabilities.twoFactor).toBe(true);
  });

  test('extracts berry.session_token cookie and mints mobile PAT on email sign-in', async () => {
    const calls: { url: string; method: string; cookie: string | null; idempotency: string | null }[] = [];

    const result = await signInWithPassword(
      {
        baseUrl: 'https://berry.example.com',
        email: 'maya@example.com',
        password: 'super-secret-password',
        deviceLabel: 'iOS',
      },
      async (input, init) => {
        const headers = new Headers(init?.headers);
        calls.push({
          url: String(input),
          method: init?.method ?? 'GET',
          cookie: headers.get('cookie'),
          idempotency: headers.get('idempotency-key'),
        });

        if (String(input).endsWith('/api/auth/sign-in/email')) {
          return jsonResponse(
            { user: { id: 'u1', email: 'maya@example.com' } },
            200,
            { 'set-cookie': 'berry.session_token=signed_tok_1; Path=/; HttpOnly; SameSite=Lax' },
          );
        }
        if (String(input).endsWith('/api/v1/tokens')) {
          return jsonResponse(
            {
              personalToken: { id: 'tok-uuid-1', name: 'Berry Mobile (iOS)' },
              token: 'berry_pat_abc_secret123',
            },
            201,
          );
        }
        if (String(input).endsWith('/api/auth/sign-out')) {
          return jsonResponse({ success: true }, 200);
        }
        return jsonResponse({}, 404);
      },
    );

    expect(result).toEqual({
      kind: 'signed_in',
      token: 'berry_pat_abc_secret123',
      tokenId: 'tok-uuid-1',
    });
    expect(calls[0]?.url).toBe('https://berry.example.com/api/auth/sign-in/email');
    expect(calls[1]?.url).toBe('https://berry.example.com/api/v1/tokens');
    expect(calls[1]?.cookie).toBe('berry.session_token=signed_tok_1');
    expect((calls[1]?.idempotency ?? '').length).toBeGreaterThanOrEqual(16);
    expect(calls[2]?.url).toBe('https://berry.example.com/api/auth/sign-out');
  });

  test('returns two_factor challenge when Better Auth responds with twoFactorRedirect and verifies TOTP before minting PAT', async () => {
    const challenge = await signInWithPassword(
      {
        baseUrl: 'https://berry.example.com',
        email: 'maya@example.com',
        password: 'super-secret-password',
        deviceLabel: 'Android',
      },
      async () =>
        jsonResponse(
          { twoFactorRedirect: true },
          200,
          { 'set-cookie': 'berry.two_factor=2fa_cookie_val; Path=/; HttpOnly' },
        ),
    );

    expect(challenge).toEqual({
      kind: 'two_factor',
      sessionCookie: 'berry.two_factor=2fa_cookie_val',
    });

    const verifiedUrls: string[] = [];
    const minted = await verifyTwoFactorAndMintToken(
      {
        baseUrl: 'https://berry.example.com',
        sessionCookie: 'berry.two_factor=2fa_cookie_val',
        code: '123456',
        deviceLabel: 'Android',
      },
      async (input, init) => {
        verifiedUrls.push(String(input));
        const headers = new Headers(init?.headers);
        if (String(input).endsWith('/api/auth/two-factor/verify-totp')) {
          expect(headers.get('cookie')).toBe('berry.two_factor=2fa_cookie_val');
          return jsonResponse(
            { user: { id: 'u1' } },
            200,
            { 'set-cookie': 'berry.session_token=final_sess_2; Path=/; HttpOnly' },
          );
        }
        if (String(input).endsWith('/api/v1/tokens')) {
          expect(headers.get('cookie')).toBe('berry.session_token=final_sess_2');
          return jsonResponse(
            { personalToken: { id: 'tok-2', name: 'Berry Mobile (Android)' }, token: 'berry_pat_2fa_ok' },
            201,
          );
        }
        return jsonResponse({ success: true }, 200);
      },
    );

    expect(minted).toEqual({ token: 'berry_pat_2fa_ok', tokenId: 'tok-2' });
    expect(verifiedUrls).toEqual([
      'https://berry.example.com/api/auth/two-factor/verify-totp',
      'https://berry.example.com/api/v1/tokens',
      'https://berry.example.com/api/auth/sign-out',
    ]);
  });

  test('rejects malformed PAT locally and verifies valid PAT via bootstrap', async () => {
    let called = false;
    let caught: unknown = null;
    try {
      await signInWithPat('https://berry.example.com', 'not_a_berry_token', async () => {
        called = true;
        return jsonResponse({});
      });
    } catch (error) {
      caught = error;
    }
    expect(called).toBe(false);
    expect(caught instanceof ApiClientError).toBe(true);

    const bootstrap = await signInWithPat('https://berry.example.com', 'berry_pat_id_secret', async (input, init) => {
      expect(String(input)).toBe('https://berry.example.com/api/v1/me/bootstrap');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer berry_pat_id_secret');
      return jsonResponse({
        user: {
          id: 'u1',
          email: 'maya@example.com',
          name: 'Maya',
          avatarUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
        workspaces: [],
        currentWorkspaceId: null,
        serverTime: '2026-11-25T00:00:00.000Z',
      });
    });
    expect(bootstrap.user.id).toBe('u1');
  });

  test('signOutSession revokes mobile PAT and tolerates 401/404', async () => {
    let deletedPath = '';
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_id_secret',
      fetchImpl: async (input, init) => {
        expect(init?.method).toBe('DELETE');
        deletedPath = String(input);
        return jsonResponse({ error: { code: 'NOT_FOUND', message: 'gone', requestId: 'r1', details: null } }, 404);
      },
    });

    await signOutSession(client, 'tok-uuid-1');
    expect(deletedPath).toBe('https://berry.example.com/api/v1/tokens/tok-uuid-1');
  });

  test('normalizes email casing and falls back to native cookie jar when Set-Cookie header is hidden on iOS', async () => {
    const seen: { url: string; credentials?: RequestCredentials; email?: string }[] = [];

    const result = await signInWithPassword(
      {
        baseUrl: 'https://berry.example.com',
        email: '  Edo@Laravel42.com  ',
        password: 'Berry-secret-password',
        deviceLabel: 'iOS',
      },
      async (input, init) => {
        const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
        seen.push({
          url: String(input),
          credentials: init?.credentials,
          email: typeof body?.email === 'string' ? body.email : undefined,
        });

        if (String(input).endsWith('/api/auth/sign-in/email')) {
          // Simulate iOS NSURLSession storing HttpOnly cookie natively without exposing Set-Cookie to JS.
          return jsonResponse({ user: { id: 'u1', email: 'edo@laravel42.com' } }, 200);
        }
        if (String(input).endsWith('/api/v1/tokens')) {
          return jsonResponse(
            {
              personalToken: { id: 'tok-ios-1', name: 'Berry Mobile (iOS)' },
              token: 'berry_pat_ios_cookiejar_ok',
            },
            201,
          );
        }
        return jsonResponse({ success: true }, 200);
      },
    );

    expect(result).toEqual({
      kind: 'signed_in',
      token: 'berry_pat_ios_cookiejar_ok',
      tokenId: 'tok-ios-1',
    });
    expect(seen[0]?.email).toBe('edo@laravel42.com');
    expect(seen[0]?.credentials).toBe('include');
    expect(seen[1]?.url).toBe('https://berry.example.com/api/v1/tokens');
    expect(seen[1]?.credentials).toBe('include');
  });

  test('uses credentials: omit with explicit Cookie header and falls back to native jar on 401', async () => {
    const tokenCalls: { credentials?: RequestCredentials; cookie: string | null }[] = [];

    const result = await signInWithPassword(
      {
        baseUrl: 'https://berry.example.com',
        email: 'edo@laravel42.com',
        password: 'Berry-secret-password',
        deviceLabel: 'iOS',
      },
      async (input, init) => {
        const headers = new Headers(init?.headers);
        if (String(input).endsWith('/api/auth/sign-in/email')) {
          return jsonResponse(
            { user: { id: 'u1', email: 'edo@laravel42.com' } },
            200,
            { 'set-cookie': '__cf_bm=edge_cookie; Path=/' },
          );
        }
        if (String(input).endsWith('/api/v1/tokens')) {
          tokenCalls.push({
            credentials: init?.credentials,
            cookie: headers.get('cookie'),
          });
          if (tokenCalls.length === 1) {
            return jsonResponse(
              { error: { code: 'UNAUTHENTICATED', message: 'Authentication required.', requestId: 'r1', details: null } },
              401,
            );
          }
          return jsonResponse(
            {
              personalToken: { id: 'tok-ios-2', name: 'Berry Mobile (iOS)' },
              token: 'berry_pat_ios_fallback_ok',
            },
            201,
          );
        }
        return jsonResponse({ success: true }, 200);
      },
    );

    expect(result).toEqual({
      kind: 'signed_in',
      token: 'berry_pat_ios_fallback_ok',
      tokenId: 'tok-ios-2',
    });
    expect(tokenCalls).toEqual([
      { credentials: 'omit', cookie: '__cf_bm=edge_cookie' },
      { credentials: 'include', cookie: null },
    ]);
  });
});

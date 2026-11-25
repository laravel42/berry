import { create } from 'zustand';

import { ApiClientError, createBerryClient, type BerryClient } from '@/api/client';
import type { ApiProfile, ApiWorkspace, BootstrapResponse, ServerCapabilities } from '@/api/types';
import { probeServer, signOutSession } from '@/auth/service';
import { sessionStorage } from '@/auth/storage';
import { defaultServerUrl } from '@/lib/env';

export type AuthStatus = 'hydrating' | 'signed_out' | 'signed_in';

type AuthState = {
  status: AuthStatus;
  baseUrl: string;
  token: string | null;
  tokenId: string | null;
  user: ApiProfile | null;
  workspaces: ApiWorkspace[];
  currentWorkspaceId: string | null;
  capabilities: ServerCapabilities | null;
  signInOrigin: string | null;
  client: BerryClient | null;
  hydrateError: string | null;
  notice: string | null;
  hydrate: () => Promise<void>;
  completeSignIn: (input: {
    baseUrl: string;
    token: string;
    tokenId: string | null;
    bootstrap?: BootstrapResponse;
  }) => Promise<void>;
  setCurrentWorkspace: (workspaceId: string) => Promise<void>;
  clearNotice: () => void;
  logout: (options?: { reason?: 'expired' | 'manual' }) => Promise<void>;
};

function pickWorkspaceId(
  preferred: string | null,
  serverCurrent: string | null,
  workspaces: ApiWorkspace[],
): string | null {
  if (preferred && workspaces.some((w) => w.id === preferred)) return preferred;
  if (serverCurrent && workspaces.some((w) => w.id === serverCurrent)) return serverCurrent;
  return workspaces[0]?.id ?? null;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: 'hydrating',
  baseUrl: defaultServerUrl(),
  token: null,
  tokenId: null,
  user: null,
  workspaces: [],
  currentWorkspaceId: null,
  capabilities: null,
  signInOrigin: null,
  client: null,
  hydrateError: null,
  notice: null,

  hydrate: async () => {
    set({ status: 'hydrating', hydrateError: null });
    const stored = await sessionStorage.load();
    if (!stored) {
      set({
        status: 'signed_out',
        baseUrl: get().baseUrl || defaultServerUrl(),
        token: null,
        tokenId: null,
        user: null,
        workspaces: [],
        currentWorkspaceId: null,
        client: null,
      });
      return;
    }

    const client = createBerryClient({
      baseUrl: stored.baseUrl,
      token: stored.token,
      onUnauthorized: () => {
        void get().logout({ reason: 'expired' });
      },
    });

    try {
      const [config, bootstrap] = await Promise.all([
        probeServer(stored.baseUrl).catch(() => null),
        client.get<BootstrapResponse>('/api/v1/me/bootstrap'),
      ]);
      const workspaceId = pickWorkspaceId(
        stored.workspaceId,
        bootstrap.currentWorkspaceId,
        bootstrap.workspaces,
      );
      set({
        status: 'signed_in',
        baseUrl: stored.baseUrl,
        token: stored.token,
        tokenId: stored.tokenId,
        user: bootstrap.user,
        workspaces: bootstrap.workspaces,
        currentWorkspaceId: workspaceId,
        capabilities: config?.capabilities ?? null,
        signInOrigin: config?.signInOrigin ?? null,
        client,
        hydrateError: null,
      });
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 401) {
        await sessionStorage.clear();
        set({
          status: 'signed_out',
          baseUrl: stored.baseUrl,
          token: null,
          tokenId: null,
          user: null,
          workspaces: [],
          currentWorkspaceId: null,
          client: null,
          notice: 'Your session expired. Please sign in again.',
        });
        return;
      }
      set({
        status: 'hydrating',
        baseUrl: stored.baseUrl,
        hydrateError:
          error instanceof Error ? error.message : 'Could not reach Berry. Check your connection and retry.',
      });
    }
  },

  completeSignIn: async ({ baseUrl, token, tokenId, bootstrap: suppliedBootstrap }) => {
    const client = createBerryClient({
      baseUrl,
      token,
      onUnauthorized: () => {
        void get().logout({ reason: 'expired' });
      },
    });
    const [config, bootstrap] = await Promise.all([
      probeServer(baseUrl).catch(() => null),
      suppliedBootstrap ? Promise.resolve(suppliedBootstrap) : client.get<BootstrapResponse>('/api/v1/me/bootstrap'),
    ]);
    const workspaceId = pickWorkspaceId(null, bootstrap.currentWorkspaceId, bootstrap.workspaces);
    await sessionStorage.save({ baseUrl, token, tokenId, workspaceId });
    set({
      status: 'signed_in',
      baseUrl,
      token,
      tokenId,
      user: bootstrap.user,
      workspaces: bootstrap.workspaces,
      currentWorkspaceId: workspaceId,
      capabilities: config?.capabilities ?? null,
      signInOrigin: config?.signInOrigin ?? null,
      client,
      hydrateError: null,
      notice: null,
    });
  },

  setCurrentWorkspace: async (workspaceId) => {
    await sessionStorage.updateWorkspace(workspaceId);
    set({ currentWorkspaceId: workspaceId });
  },

  clearNotice: () => set({ notice: null }),

  logout: async (options) => {
    const { client, tokenId, baseUrl } = get();
    if (client && tokenId && options?.reason !== 'expired') {
      await signOutSession(client, tokenId).catch(() => undefined);
    }
    await sessionStorage.clear();
    set({
      status: 'signed_out',
      baseUrl: baseUrl || defaultServerUrl(),
      token: null,
      tokenId: null,
      user: null,
      workspaces: [],
      currentWorkspaceId: null,
      client: null,
      hydrateError: null,
      notice: options?.reason === 'expired' ? 'Your session expired. Please sign in again.' : null,
    });
  },
}));

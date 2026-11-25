import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export type StoredSession = {
  baseUrl: string;
  token: string;
  tokenId: string | null;
  workspaceId: string | null;
};

const SESSION_KEY = 'berry_mobile_session_v1';

// Web preview keeps credentials strictly in memory (never localStorage).
let memorySession: StoredSession | null = null;

function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.baseUrl !== 'string' || typeof record.token !== 'string') return null;
    if (!record.baseUrl || !record.token) return null;
    return {
      baseUrl: record.baseUrl,
      token: record.token,
      tokenId: typeof record.tokenId === 'string' ? record.tokenId : null,
      workspaceId: typeof record.workspaceId === 'string' ? record.workspaceId : null,
    };
  } catch {
    return null;
  }
}

export const sessionStorage = {
  async load(): Promise<StoredSession | null> {
    if (Platform.OS === 'web') {
      return memorySession ? { ...memorySession } : null;
    }
    const raw = await SecureStore.getItemAsync(SESSION_KEY);
    return parseStoredSession(raw);
  },

  async save(session: StoredSession): Promise<void> {
    if (Platform.OS === 'web') {
      memorySession = { ...session };
      return;
    }
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(session), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
  },

  async updateWorkspace(workspaceId: string | null): Promise<void> {
    const current = await this.load();
    if (!current) return;
    await this.save({ ...current, workspaceId });
  },

  async clear(): Promise<void> {
    memorySession = null;
    if (Platform.OS === 'web') return;
    await SecureStore.deleteItemAsync(SESSION_KEY);
  },
};

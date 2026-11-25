import { describe, expect, test } from 'bun:test';

import { normalizeServerUrl } from './env';

describe('normalizeServerUrl', () => {
  test('normalizes https URL and strips trailing slash', () => {
    expect(normalizeServerUrl('  https://berry.example.com///  ')).toEqual({
      ok: true,
      url: 'https://berry.example.com',
    });
  });

  test('allows http only for localhost and private LAN IPs', () => {
    expect(normalizeServerUrl('http://localhost:4000/')).toEqual({
      ok: true,
      url: 'http://localhost:4000',
    });
    expect(normalizeServerUrl('http://127.0.0.1:4000')).toEqual({
      ok: true,
      url: 'http://127.0.0.1:4000',
    });
    expect(normalizeServerUrl('http://192.168.100.6:4000')).toEqual({
      ok: true,
      url: 'http://192.168.100.6:4000',
    });
    expect(normalizeServerUrl('http://10.0.2.2:4000')).toEqual({
      ok: true,
      url: 'http://10.0.2.2:4000',
    });
    const publicHttp = normalizeServerUrl('http://berry.example.com');
    expect(publicHttp.ok).toBe(false);
  });

  test('rejects empty, invalid, or non-http schemes', () => {
    expect(normalizeServerUrl('').ok).toBe(false);
    expect(normalizeServerUrl('ftp://berry.example.com').ok).toBe(false);
    expect(normalizeServerUrl('not a url').ok).toBe(false);
  });
});

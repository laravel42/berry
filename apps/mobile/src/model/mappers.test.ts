import { describe, expect, test } from 'bun:test';

import {
  deriveInitials,
  formatRelativeTime,
  mapApiPriority,
  mapApiStatus,
  mapUiStatusToApi,
} from './mappers';

describe('mappers', () => {
  test('maps camelCase API statuses and preserves unknown fallback', () => {
    expect(mapApiStatus('inProgress')).toBe('in_progress');
    expect(mapApiStatus('inReview')).toBe('in_review');
    expect(mapApiStatus('todo')).toBe('todo');
    expect(mapApiStatus('blocked')).toBe('blocked');
    expect(mapApiStatus('backlog')).toBe('backlog');
    expect(mapApiStatus('done')).toBe('done');
    expect(mapApiStatus('cancelled')).toBe('cancelled');
    expect(mapApiStatus('future_unknown_status')).toBe('backlog');
  });

  test('maps UI statuses back to API camelCase statuses', () => {
    expect(mapUiStatusToApi('in_progress')).toBe('inProgress');
    expect(mapUiStatusToApi('in_review')).toBe('inReview');
    expect(mapUiStatusToApi('todo')).toBe('todo');
    expect(mapUiStatusToApi('done')).toBe('done');
  });

  test('maps API priorities safely with fallback to none', () => {
    expect(mapApiPriority('urgent')).toBe('urgent');
    expect(mapApiPriority('high')).toBe('high');
    expect(mapApiPriority('unknown')).toBe('none');
  });

  test('derives initials cleanly for 1-word, 2-word, and empty names', () => {
    expect(deriveInitials('Héctor Martínez')).toBe('HM');
    expect(deriveInitials('Builder')).toBe('BU');
    expect(deriveInitials('  Maya  Chen  ')).toBe('MC');
    expect(deriveInitials('')).toBe('?');
  });

  test('formats relative timestamps in m/h/d', () => {
    const now = Date.parse('2026-11-25T18:00:00.000Z');
    expect(formatRelativeTime('2026-11-25T17:59:40.000Z', now)).toBe('now');
    expect(formatRelativeTime('2026-11-25T17:56:00.000Z', now)).toBe('4m');
    expect(formatRelativeTime('2026-11-25T15:00:00.000Z', now)).toBe('3h');
    expect(formatRelativeTime('2026-11-23T18:00:00.000Z', now)).toBe('2d');
  });
});

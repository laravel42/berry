import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillMissingDates, normalizeProposed } from './generate-milestones.ts';

test('normalizeProposed keeps title and a valid date', () => {
   assert.deepEqual(
      normalizeProposed([
         { title: ' People can sign in ', date: '2026-12-01' },
         { title: '', date: '2026-12-02' },
         { title: 'People can sign in', date: 'not-a-date' },
         { title: 'Tickets assigned', date: '' },
         { title: 'Null date', date: null },
      ]),
      [
         { title: 'People can sign in', date: '2026-12-01' },
         { title: 'Tickets assigned', date: null },
         { title: 'Null date', date: null },
      ]
   );
});

test('fillMissingDates spaces blank dates from today', () => {
   assert.deepEqual(
      fillMissingDates(
         [
            { title: 'Has date', date: '2026-12-01' },
            { title: 'First blank', date: null },
            { title: 'Second blank', date: null },
         ],
         '2026-11-06'
      ),
      [
         { title: 'Has date', date: '2026-12-01' },
         { title: 'First blank', date: '2026-11-27' },
         { title: 'Second blank', date: '2026-12-18' },
      ]
   );
});

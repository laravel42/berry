import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { browserReturnOrigin, returnOriginAllowed, storedReturnOrigin } from './integrations.ts';

const options = {
   appUrl: 'http://localhost:3000',
   publicUrl: null,
   returnOrigins: ['http://localhost:3000', 'https://local.berry.pm', 'https://*.trycloudflare.com'],
};

describe('where a GitHub install sends the browser back', () => {
   test('an allowed origin is remembered, including a one-label wildcard', () => {
      assert.equal(returnOriginAllowed('https://local.berry.pm', options.returnOrigins), true);
      assert.equal(
         returnOriginAllowed('https://random-name.trycloudflare.com', options.returnOrigins),
         true
      );
      assert.equal(returnOriginAllowed('https://evil.example', options.returnOrigins), false);
      assert.equal(
         returnOriginAllowed('http://random-name.trycloudflare.com', options.returnOrigins),
         false
      );
   });

   test('the install returns to the site it was started from', () => {
      assert.equal(
         browserReturnOrigin(
            { origin: 'https://local.berry.pm', referer: undefined },
            options,
            'http://127.0.0.1:4000'
         ),
         'https://local.berry.pm'
      );
      assert.equal(
         browserReturnOrigin(
            { origin: 'https://github.com', referer: 'https://local.berry.pm/berry/settings' },
            options,
            'http://127.0.0.1:4000'
         ),
         'https://local.berry.pm'
      );
   });

   test('an unknown origin falls back to the app, not the API', () => {
      assert.equal(
         browserReturnOrigin(
            { origin: 'https://evil.example', referer: undefined },
            options,
            'http://127.0.0.1:4000'
         ),
         'http://localhost:3000'
      );
   });

   test('a stored GitHub page is not a return address', () => {
      assert.equal(
         storedReturnOrigin('https://github.com/apps/berry/installations/new', options),
         null
      );
      assert.equal(storedReturnOrigin('https://local.berry.pm', options), 'https://local.berry.pm');
      assert.equal(storedReturnOrigin('https://evil.example/phish', options), null);
   });
});

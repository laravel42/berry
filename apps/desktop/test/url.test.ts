import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { externalHttpUrl, inAppNavigation, parseStartUrl } from '../src/url.ts';

const APP = 'http://localhost:3000';

describe('parseStartUrl', () => {
   it('defaults to the local web app', () => {
      assert.deepEqual(parseStartUrl(undefined), {
         href: 'http://localhost:3000/',
         origin: APP,
      });
      assert.equal(parseStartUrl('   ').origin, APP);
   });

   it('keeps an explicit origin', () => {
      const parsed = parseStartUrl('https://board.example.com/workspace');
      assert.equal(parsed.origin, 'https://board.example.com');
      assert.equal(parsed.href, 'https://board.example.com/workspace');
   });

   it('rejects a non-http address and embedded credentials', () => {
      assert.throws(() => parseStartUrl('file:///tmp/index.html'), /http\(s\)/);
      assert.throws(() => parseStartUrl('http://user:secret@localhost:3000'), /credentials/);
   });
});

describe('inAppNavigation', () => {
   it('allows the app origin and GitHub sign-in', () => {
      assert.equal(inAppNavigation('http://localhost:3000/sign-in', APP), true);
      assert.equal(inAppNavigation('https://github.com/login/oauth/authorize?x=1', APP), true);
      assert.equal(inAppNavigation('https://www.github.com/', APP), true);
   });

   it('refuses another site, a lookalike host, and a non-url', () => {
      assert.equal(inAppNavigation('https://evil.github.com/', APP), false);
      assert.equal(inAppNavigation('http://github.com/', APP), false);
      assert.equal(inAppNavigation('https://example.com/', APP), false);
      assert.equal(inAppNavigation('not a url', APP), false);
   });
});

describe('externalHttpUrl', () => {
   it('returns http(s) links and drops the rest', () => {
      assert.equal(externalHttpUrl('https://example.com/docs'), 'https://example.com/docs');
      assert.equal(externalHttpUrl('javascript:alert(1)'), null);
      assert.equal(externalHttpUrl('https://user:pw@example.com/'), null);
   });
});

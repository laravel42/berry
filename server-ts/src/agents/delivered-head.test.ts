import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deliveredHead } from './delivered-head.ts';

const delivered = 'db25e75150e78d65871742cfca308a2dde459386';
const base = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const merge = '3ca57f56f83466bcb72c394fdfae7ec5863d4e55';

test('the delivered commit is itself', () => {
   assert.equal(deliveredHead(delivered, delivered, [base], base), delivered);
});

test('a merge of the base into the delivered commit is still that delivery', () => {
   assert.equal(deliveredHead(delivered, merge, [delivered, base], base), merge);
});

test('a new commit on the branch is not the delivery', () => {
   assert.equal(deliveredHead(delivered, merge, [delivered], base), null);
});

test('a merge of some other commit is not the delivery', () => {
   const other = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
   assert.equal(deliveredHead(delivered, merge, [delivered, other], base), null);
});

test('a missing head is not the delivery', () => {
   assert.equal(deliveredHead(delivered, null, [], base), null);
});

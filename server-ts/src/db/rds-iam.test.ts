import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parsePostgresEndpoint, rdsRegionFromHostname } from './rds-iam.ts';

test('parsePostgresEndpoint reads user, host, port and database', () => {
   const endpoint = parsePostgresEndpoint(
      'postgres://postgres@berry-1.cluster-example.us-east-1.rds.amazonaws.com:5432/postgres?sslmode=require'
   );
   assert.equal(endpoint.username, 'postgres');
   assert.equal(endpoint.hostname, 'berry-1.cluster-example.us-east-1.rds.amazonaws.com');
   assert.equal(endpoint.port, 5432);
   assert.equal(endpoint.database, 'postgres');
});

test('parsePostgresEndpoint defaults port 5432 and database postgres', () => {
   const endpoint = parsePostgresEndpoint('postgres://app@db.internal');
   assert.equal(endpoint.port, 5432);
   assert.equal(endpoint.database, 'postgres');
   assert.equal(endpoint.username, 'app');
});

test('rdsRegionFromHostname reads the region from an Aurora endpoint', () => {
   assert.equal(
      rdsRegionFromHostname('berry-1.cluster-example.us-east-1.rds.amazonaws.com'),
      'us-east-1'
   );
   assert.equal(rdsRegionFromHostname('localhost'), null);
   assert.equal(rdsRegionFromHostname('db.internal.example'), null);
});

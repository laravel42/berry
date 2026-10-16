import { Signer } from '@aws-sdk/rds-signer';

/**
 * Aurora / RDS IAM database auth (tokens from `aws rds generate-db-auth-token`).
 *
 * The token is the password, valid 15 minutes, and is only used at connect
 * time. Existing sessions keep working after it expires. We mint a fresh one
 * for every new connection rather than stuffing one into DATABASE_URL.
 */

export interface DatabaseIamAuth {
   region: string;
   /**
    * When false, TLS still encrypts but the RDS certificate is not verified.
    * Prefer true plus the Amazon RDS CA; false matches clusters whose hostname
    * does not match the cert (common on some Serverless endpoints).
    */
   sslRejectUnauthorized: boolean;
}

export interface PostgresEndpoint {
   hostname: string;
   port: number;
   username: string;
   database: string;
}

export function parsePostgresEndpoint(url: string): PostgresEndpoint {
   const parsed = new URL(url);
   const hostname = parsed.hostname.trim();
   if (!hostname) {
      throw new Error('DATABASE_URL has no hostname');
   }
   const port = parsed.port ? Number(parsed.port) : 5432;
   if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`DATABASE_URL has an invalid port: ${parsed.port}`);
   }
   const username = decodeURIComponent(parsed.username) || 'postgres';
   const path = parsed.pathname.replace(/^\//, '');
   const database = decodeURIComponent(path) || 'postgres';
   return { hostname, port, username, database };
}

/**
 * Region from an RDS / Aurora hostname
 * (`….us-east-1.rds.amazonaws.com`). Custom CNAMEs return null.
 */
export function rdsRegionFromHostname(hostname: string): string | null {
   const match = /\.([a-z]{2}(?:-[a-z0-9]+)+-\d+)\.rds\.amazonaws\.com(?:\.cn)?$/i.exec(
      hostname.trim()
   );
   const region = match?.[1];
   return region ? region.toLowerCase() : null;
}

export async function createRdsAuthToken(
   endpoint: PostgresEndpoint,
   region: string
): Promise<string> {
   const signer = new Signer({
      hostname: endpoint.hostname,
      port: endpoint.port,
      username: endpoint.username,
      region,
   });
   return signer.getAuthToken();
}

export function iamPassword(
   endpoint: PostgresEndpoint,
   iam: DatabaseIamAuth,
   getAuthToken?: () => Promise<string>
): () => Promise<string> {
   if (getAuthToken) return getAuthToken;
   return () => createRdsAuthToken(endpoint, iam.region);
}

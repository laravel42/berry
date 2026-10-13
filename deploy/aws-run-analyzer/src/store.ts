import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { BatchWriteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { SUMMARY_SK, runPk, type Item } from './items.ts';

export function documentClient(): DynamoDBDocumentClient {
   return DynamoDBDocumentClient.from(new DynamoDBClient({ maxAttempts: 5 }), {
      marshallOptions: { removeUndefinedValues: true },
   });
}

/** What the run was last analyzed from, so a redelivered message does not pay for the model twice. */
export async function previousAnalysis(
   db: DynamoDBDocumentClient,
   table: string,
   runId: string
): Promise<{ transcriptETag: string; analyzerModel: string } | null> {
   const { Item: item } = await db.send(
      new GetCommand({
         TableName: table,
         Key: { pk: runPk(runId), sk: SUMMARY_SK },
         ProjectionExpression: 'transcriptETag, analyzerModel',
      })
   );
   if (!item || typeof item.transcriptETag !== 'string' || typeof item.analyzerModel !== 'string') return null;
   return { transcriptETag: item.transcriptETag, analyzerModel: item.analyzerModel };
}

async function keysOf(db: DynamoDBDocumentClient, table: string, runId: string): Promise<string[]> {
   const keys: string[] = [];
   let start: Record<string, unknown> | undefined;
   do {
      const page = await db.send(
         new QueryCommand({
            TableName: table,
            KeyConditionExpression: 'pk = :pk',
            ExpressionAttributeValues: { ':pk': runPk(runId) },
            ProjectionExpression: 'sk',
            ExclusiveStartKey: start,
         })
      );
      for (const item of page.Items ?? []) if (typeof item.sk === 'string') keys.push(item.sk);
      start = page.LastEvaluatedKey;
   } while (start);
   return keys;
}

type WriteRequest = { PutRequest: { Item: Item } } | { DeleteRequest: { Key: { pk: string; sk: string } } };

async function batchWrite(db: DynamoDBDocumentClient, table: string, requests: WriteRequest[]): Promise<void> {
   for (let offset = 0; offset < requests.length; offset += 25) {
      let pending: WriteRequest[] = requests.slice(offset, offset + 25);
      for (let attempt = 0; pending.length > 0; attempt += 1) {
         if (attempt === 8) throw new Error(`DynamoDB left ${pending.length} writes unprocessed after ${attempt} attempts`);
         if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, 50 * 2 ** attempt)));
         const result = await db.send(new BatchWriteCommand({ RequestItems: { [table]: pending } }));
         pending = (result.UnprocessedItems?.[table] ?? []) as WriteRequest[];
      }
   }
}

/**
 * The run's items, replacing whatever an earlier analysis left. The summary is
 * written last: until it lands, the run reads as not yet analyzed, so a write
 * that fails half way is retried rather than skipped.
 */
export async function replaceRun(db: DynamoDBDocumentClient, table: string, summary: Item, findings: Item[]): Promise<void> {
   const runId = String(summary.runId);
   const kept = new Set([SUMMARY_SK, ...findings.map((item) => String(item.sk))]);
   const stale = (await keysOf(db, table, runId)).filter((sk) => !kept.has(sk));
   await batchWrite(db, table, [
      ...findings.map((item): WriteRequest => ({ PutRequest: { Item: item } })),
      ...stale.map((sk): WriteRequest => ({ DeleteRequest: { Key: { pk: runPk(runId), sk } } })),
   ]);
   await db.send(new PutCommand({ TableName: table, Item: summary }));
}

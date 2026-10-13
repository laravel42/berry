#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { RunAnalyzerStack } from '../lib/run-analyzer-stack.ts';

/**
 * `npx cdk deploy` with the defaults, or with any of:
 *    -c modelId=us.anthropic.claude-haiku-4-5-20251001-v1:0
 *    -c bedrockRegion=us-east-1
 *    -c transcriptRetentionDays=30
 *    -c maxConcurrency=2
 *    -c stackName=BerryRunAnalyzer
 */
const app = new App();
const context = (name: string): string | undefined => {
   const value = app.node.tryGetContext(name) as unknown;
   return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

new RunAnalyzerStack(app, context('stackName') ?? 'BerryRunAnalyzer', {
   env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
   description: 'Berry run analyzer: transcripts in S3, findings by a Bedrock model, stored in DynamoDB',
   modelId: context('modelId') ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
   bedrockRegion: context('bedrockRegion') ?? 'us-east-1',
   transcriptRetentionDays: Number(context('transcriptRetentionDays') ?? 30),
   maxConcurrency: Number(context('maxConcurrency') ?? 2),
});

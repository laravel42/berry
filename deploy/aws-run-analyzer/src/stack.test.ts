import assert from 'node:assert/strict';
import { test } from 'node:test';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { RunAnalyzerStack, modelResources } from '../lib/run-analyzer-stack.ts';

function template(): Template {
   // No bundling: the test is about the wiring, not the function's code.
   const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
   const stack = new RunAnalyzerStack(app, 'Test', {
      env: { account: '111111111111', region: 'us-east-1' },
      modelId: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      bedrockRegion: 'us-east-1',
      transcriptRetentionDays: 30,
      maxConcurrency: 2,
   });
   return Template.fromStack(stack);
}

test('a cross-region profile grants the profile and its model in every region it routes to', () => {
   assert.deepEqual(modelResources('us.anthropic.claude-haiku-4-5-20251001-v1:0', 'us-east-1', '1'), [
      'arn:aws:bedrock:us-east-1:1:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0',
      'arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0',
   ]);
   assert.deepEqual(modelResources('amazon.nova-micro-v1:0', 'us-west-2', '1'), ['arn:aws:bedrock:us-west-2::foundation-model/amazon.nova-micro-v1:0']);
});

test('uploads reach the function through a queue with a dead-letter queue, one at a time', () => {
   const t = template();
   t.hasResourceProperties('AWS::SQS::Queue', {
      VisibilityTimeout: 1800,
      RedrivePolicy: { maxReceiveCount: 3, deadLetterTargetArn: Match.anyValue() },
   });
   t.hasResourceProperties('AWS::Lambda::EventSourceMapping', {
      BatchSize: 1,
      FunctionResponseTypes: ['ReportBatchItemFailures'],
      ScalingConfig: { MaximumConcurrency: 2 },
   });
   t.hasResourceProperties('AWS::Lambda::Function', { Runtime: 'nodejs22.x', Architectures: ['arm64'], Timeout: 300 });
});

test('the function may invoke only the analysis model', () => {
   const t = template();
   t.hasResourceProperties('AWS::IAM::Policy', {
      PolicyDocument: {
         Statement: Match.arrayWith([
            Match.objectLike({
               Sid: 'InvokeTheAnalysisModel',
               Action: 'bedrock:InvokeModel',
               Resource: Match.arrayWith(['arn:aws:bedrock:*::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0']),
            }),
         ]),
      },
   });
});

test('the findings table is kept, recoverable, and has both indexes', () => {
   const t = template();
   t.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
   t.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      GlobalSecondaryIndexes: Match.arrayWith([Match.objectLike({ IndexName: 'byKind' }), Match.objectLike({ IndexName: 'byModel' })]),
      Replicas: [Match.objectLike({ PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }, DeletionProtectionEnabled: true })],
   });
});

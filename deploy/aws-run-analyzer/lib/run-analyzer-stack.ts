import { fileURLToPath } from 'node:url';
import {
   CfnOutput,
   Duration,
   RemovalPolicy,
   Stack,
   type StackProps,
   aws_cloudwatch as cloudwatch,
   aws_dynamodb as dynamodb,
   aws_iam as iam,
   aws_lambda as lambda,
   aws_lambda_event_sources as sources,
   aws_lambda_nodejs as nodejs,
   aws_logs as logs,
   aws_s3 as s3,
   aws_s3_notifications as notifications,
   aws_sqs as sqs,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import { TRANSCRIPT_PREFIX } from '../src/bundle.ts';
import { KIND_INDEX, MODEL_INDEX } from '../src/items.ts';

const here = fileURLToPath(new URL('../', import.meta.url));

export interface RunAnalyzerStackProps extends StackProps {
   /** A Bedrock inference profile (`us.anthropic…`) or a model id the region serves on demand. */
   modelId: string;
   /** Where Bedrock is called. An inference profile lives in this region. */
   bedrockRegion: string;
   /** How long an uploaded transcript is kept. The findings are kept regardless. */
   transcriptRetentionDays: number;
   /** Analyses running at once: what keeps a large export from throttling Bedrock. Two at least. */
   maxConcurrency: number;
}

/**
 * Reads finished Berry runs and keeps what went wrong in them.
 *
 *    export-runs ─ PutObject ─ bucket runs/… ─ event ─ queue ─ function ─ Bedrock Converse
 *                                                        │           └─ table RunFindings
 *                                                        └─ after 3 tries ─ dead letters
 *
 * Berry is not reached from here: the exporter, run where Berry's database
 * is, uploads each run as one file, and that file is all the function sees.
 */
export class RunAnalyzerStack extends Stack {
   constructor(scope: Construct, id: string, props: RunAnalyzerStackProps) {
      super(scope, id, props);

      const transcripts = new s3.Bucket(this, 'Transcripts', {
         encryption: s3.BucketEncryption.S3_MANAGED,
         blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
         objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
         enforceSSL: true,
         versioned: false,
         lifecycleRules: [
            { prefix: TRANSCRIPT_PREFIX, expiration: Duration.days(props.transcriptRetentionDays) },
            { abortIncompleteMultipartUploadAfter: Duration.days(1) },
         ],
         // Transcripts can hold task details; deleting the stack must not delete them by surprise.
         removalPolicy: RemovalPolicy.RETAIN,
      });

      const findings = new dynamodb.TableV2(this, 'Findings', {
         partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
         sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
         billing: dynamodb.Billing.onDemand(),
         pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
         deletionProtection: true,
         removalPolicy: RemovalPolicy.RETAIN,
         globalSecondaryIndexes: [
            {
               indexName: KIND_INDEX,
               partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
               sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
            },
            {
               indexName: MODEL_INDEX,
               partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
               sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
            },
         ],
      });

      const timeout = Duration.minutes(5);
      const deadLetters = new sqs.Queue(this, 'DeadLetters', {
         encryption: sqs.QueueEncryption.SQS_MANAGED,
         enforceSSL: true,
         retentionPeriod: Duration.days(14),
      });
      const queue = new sqs.Queue(this, 'Uploads', {
         encryption: sqs.QueueEncryption.SQS_MANAGED,
         enforceSSL: true,
         // Six times the function's timeout, so a message is never visible again while it is being handled.
         visibilityTimeout: Duration.minutes(30),
         retentionPeriod: Duration.days(4),
         deadLetterQueue: { queue: deadLetters, maxReceiveCount: 3 },
      });
      transcripts.addEventNotification(s3.EventType.OBJECT_CREATED, new notifications.SqsDestination(queue), {
         prefix: TRANSCRIPT_PREFIX,
         suffix: '.json',
      });

      const analyzer = new nodejs.NodejsFunction(this, 'Analyzer', {
         description: 'Reads one Berry run transcript with Bedrock and stores its findings',
         entry: `${here}src/handler.ts`,
         handler: 'handler',
         depsLockFilePath: `${here}package-lock.json`,
         projectRoot: here,
         runtime: lambda.Runtime.NODEJS_22_X,
         architecture: lambda.Architecture.ARM_64,
         memorySize: 1024,
         timeout,
         tracing: lambda.Tracing.ACTIVE,
         logGroup: new logs.LogGroup(this, 'AnalyzerLogs', {
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: RemovalPolicy.DESTROY,
         }),
         environment: {
            TABLE_NAME: findings.tableName,
            MODEL_ID: props.modelId,
            BEDROCK_REGION: props.bedrockRegion,
            MAX_OUTPUT_TOKENS: '4096',
            SLOW_STEP_SECONDS: '120',
            MAX_TRANSCRIPT_CHARS: '120000',
            NODE_OPTIONS: '--enable-source-maps',
         },
         bundling: {
            target: 'node22',
            minify: true,
            sourceMap: true,
            // The Lambda runtime ships AWS SDK v3; bundling it would only grow the package.
            externalModules: ['@aws-sdk/*'],
         },
      });

      transcripts.grantRead(analyzer, `${TRANSCRIPT_PREFIX}*`);
      findings.grantReadWriteData(analyzer);
      analyzer.addToRolePolicy(
         new iam.PolicyStatement({
            sid: 'InvokeTheAnalysisModel',
            actions: ['bedrock:InvokeModel'],
            resources: modelResources(props.modelId, props.bedrockRegion, this.account),
         })
      );
      analyzer.addEventSource(
         new sources.SqsEventSource(queue, {
            batchSize: 1,
            reportBatchItemFailures: true,
            maxConcurrency: Math.max(2, props.maxConcurrency),
         })
      );

      new cloudwatch.Alarm(this, 'DeadLettersWaiting', {
         alarmDescription: 'A run transcript could not be analyzed after three tries; see the Analyzer logs.',
         metric: deadLetters.metricApproximateNumberOfMessagesVisible({ period: Duration.minutes(5) }),
         threshold: 0,
         comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
         evaluationPeriods: 1,
         treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      new cloudwatch.Alarm(this, 'AnalyzerErrors', {
         alarmDescription: 'The analyzer function is failing.',
         metric: analyzer.metricErrors({ period: Duration.minutes(15) }),
         threshold: 0,
         comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
         evaluationPeriods: 1,
         treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });

      new CfnOutput(this, 'TranscriptBucketName', { value: transcripts.bucketName });
      new CfnOutput(this, 'FindingsTableName', { value: findings.tableName });
      new CfnOutput(this, 'DeadLetterQueueUrl', { value: deadLetters.queueUrl });
      new CfnOutput(this, 'AnalyzerLogGroup', { value: analyzer.logGroup.logGroupName });
   }
}

/**
 * What `bedrock:InvokeModel` must name for one model. A cross-region profile
 * (`us.…`, `eu.…`, `global.…`) routes to the model in other regions, so the
 * profile and the model in every region it may reach are both granted.
 */
export function modelResources(modelId: string, region: string, account: string): string[] {
   const profile = /^(us|eu|apac|global|us-gov|au|jp|ca)\.(.+)$/.exec(modelId);
   if (!profile) return [`arn:aws:bedrock:${region}::foundation-model/${modelId}`];
   return [
      `arn:aws:bedrock:${region}:${account}:inference-profile/${modelId}`,
      `arn:aws:bedrock:*::foundation-model/${profile[2]}`,
   ];
}

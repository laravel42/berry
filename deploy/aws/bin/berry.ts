#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { BerryStack } from '../lib/berry-stack.ts';

/**
 * `cdk deploy -c domain=berry.example.com -c hostedZone=example.com`
 *
 * The account and region come from the credentials in use. They are given to
 * the stack explicitly because the hosted zone is looked up at synth time, and
 * a lookup needs to know where it is looking.
 */
const app = new App();
const context = (name: string): string | undefined => {
   const value = app.node.tryGetContext(name) as unknown;
   return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
};

const domain = context('domain');
const hostedZone = context('hostedZone');
if (!domain || !hostedZone) {
   throw new Error('Pass the address Berry is served at and the Route 53 zone that holds it: -c domain=berry.example.com -c hostedZone=example.com');
}

new BerryStack(app, context('stackName') ?? 'Berry', {
   env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
   description: 'Berry: one EC2 Docker host behind a load balancer',
   // The host holds the database. Deleting the stack is a decision, not a slip of the hand.
   terminationProtection: true,
   domain,
   hostedZone,
   instanceType: context('instanceType') ?? 't4g.xlarge',
   dataVolumeGiB: Number(context('dataVolumeGiB') ?? 50),
   bedrockRegion: context('bedrockRegion') ?? 'us-east-1',
});

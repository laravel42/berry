import { fileURLToPath } from 'node:url';
import {
   CfnOutput,
   Duration,
   IgnoreMode,
   RemovalPolicy,
   SecretValue,
   Size,
   Stack,
   Tags,
   Validations,
   type StackProps,
   aws_certificatemanager as acm,
   aws_dlm as dlm,
   aws_ec2 as ec2,
   aws_ecr_assets as ecrAssets,
   aws_elasticloadbalancingv2 as elb,
   aws_elasticloadbalancingv2_targets as elbTargets,
   aws_iam as iam,
   aws_route53 as route53,
   aws_route53_targets as route53Targets,
   aws_s3 as s3,
   aws_s3_assets as s3Assets,
   aws_secretsmanager as secrets,
   aws_ssm as ssm,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

const repository = fileURLToPath(new URL('../../../', import.meta.url));
const here = fileURLToPath(new URL('../', import.meta.url));

/** Never part of an image's build context: what is large, local, or a secret. */
const NOT_CONTEXT = ['.*', '!.npmrc', '**/.env*', '**/.DS_Store', '**/node_modules', '**/.next', '**/.next-verify', '**/cdk.out', 'docs', 'documentation', 'semantic-review', '*.pdf', '*.md', 'LICENSE', 'skills-lock.json', 'deploy/*', '!deploy/docker'];

export interface BerryStackProps extends StackProps {
   /** Where Berry is served: `berry.example.com`. Previews answer under `*.preview.<domain>`. */
   domain: string;
   /** The Route 53 public zone that holds `domain`: `example.com`. */
   hostedZone: string;
   /** Sized for the host's real load: every preview app and every agent session is a 2 GB container. */
   instanceType: string;
   /** The volume the database lives on, apart from the host's disk and kept when the stack goes. */
   dataVolumeGiB: number;
   /** Where Bedrock is called. Models are inference profiles, so this is where the profile lives. */
   bedrockRegion: string;
}

/**
 * Berry on one Docker host.
 *
 * One host rather than a fleet because of what Berry runs: a preview is the
 * pull request's own containers and an agent session is a container, both
 * started through the Docker socket of the machine the API is on, and both
 * reached on its loopback. That is one machine by design (ADR-0014 keeps
 * AgentCore as the way to take agent runs off it).
 *
 *    browser ─ HTTPS ─ load balancer ─┬─ /api/*, /v1/*, *.preview.<domain> ─ api :4000
 *                                     └─ everything else ─────────────────── web :3000
 *
 * `cdk deploy` is the release: the images are built and pushed as assets, and
 * a State Manager association whose command names them runs again on the host
 * whenever they change. Nothing about a release is in user data, so a release
 * never replaces or restarts the machine that holds the database.
 */
export class BerryStack extends Stack {
   constructor(scope: Construct, id: string, props: BerryStackProps) {
      super(scope, id, props);
      const { domain } = props;
      const previewDomain = `preview.${domain}`;

      // ── Network: two public subnets (a load balancer needs two zones), no NAT to pay for.
      const vpc = new ec2.Vpc(this, 'Vpc', {
         maxAzs: 2,
         natGateways: 0,
         subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 }],
      });

      // ── What outlives a release, and the stack: run artifacts, and the application's secrets.
      const artifacts = new s3.Bucket(this, 'Artifacts', {
         encryption: s3.BucketEncryption.S3_MANAGED,
         blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
         enforceSSL: true,
         removalPolicy: RemovalPolicy.RETAIN,
      });

      // The API's environment as one JSON object. The host fills in what can be
      // generated (auth secret, integration key, database password, runtime token)
      // the first time it runs and writes them back here, so the key that seals
      // every stored credential is never only on a disk. A person adds the rest:
      // the GitHub OAuth app's id and secret, and any other variable the API reads.
      const appSecret = new secrets.Secret(this, 'AppEnv', {
         description: 'Berry API environment (JSON object of NAME: value)',
         secretObjectValue: {},
         removalPolicy: RemovalPolicy.RETAIN,
      });

      // Agent sessions run the task's commands in the same container that calls
      // Bedrock, and they are kept away from the instance's own role (see the hop
      // limit below). So the runtime gets a key that can invoke models and
      // nothing else, as it does on a developer's machine.
      const bedrockUser = new iam.User(this, 'BedrockCaller');
      bedrockUser.addToPolicy(
         new iam.PolicyStatement({
            actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
            resources: ['arn:aws:bedrock:*::foundation-model/*', `arn:aws:bedrock:*:${this.account}:inference-profile/*`],
         })
      );
      const bedrockKey = new iam.AccessKey(this, 'BedrockCallerKey', { user: bedrockUser });
      const bedrockSecret = new secrets.Secret(this, 'BedrockCredentials', {
         description: 'Access key of the Bedrock-only user the agent runtime calls models with',
         secretObjectValue: {
            accessKeyId: SecretValue.unsafePlainText(bedrockKey.accessKeyId),
            secretAccessKey: bedrockKey.secretAccessKey,
         },
      });

      // ── Images, built for the host's processor and pushed to the bootstrap repository.
      const instanceType = new ec2.InstanceType(props.instanceType);
      const arm = instanceType.architecture === ec2.InstanceArchitecture.ARM_64;
      const platform = arm ? ecrAssets.Platform.LINUX_ARM64 : ecrAssets.Platform.LINUX_AMD64;
      // `exclude` is also what the asset's hash is taken over: an image is rebuilt
      // and released only when something it is made from changed.
      const image = (name: string, directory: string, file: string, exclude: string[] = [], buildArgs: Record<string, string> = {}) =>
         new ecrAssets.DockerImageAsset(this, `${name}Image`, { directory, file, platform, buildArgs, exclude: [...NOT_CONTEXT, ...exclude], ignoreMode: IgnoreMode.DOCKER });
      const images = {
         api: image('Api', repository, 'deploy/docker/api.Dockerfile', ['frontend', 'packages', 'scripts', '**/*.test.ts']),
         web: image('Web', repository, 'deploy/docker/web.Dockerfile', ['server-ts/*', '!server-ts/package.json', 'scripts']),
         // Its Dockerfile pins arm64 for AgentCore; here it runs on the host, whatever that is.
         runtime: image('Runtime', `${repository}server-ts`, 'sandbox/agentcore/Dockerfile', [], { BERRY_RUNTIME_PLATFORM: arm ? 'linux/arm64' : 'linux/amd64' }),
         preview: image('Preview', `${repository}server-ts/sandbox/preview`, 'Dockerfile'),
      };

      // The compose file and the script that applies it, as one archive.
      const hostBundle = new s3Assets.Asset(this, 'HostBundle', { path: `${here}host` });

      // ── The host.
      const role = new iam.Role(this, 'HostRole', {
         assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
         managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
      });
      for (const asset of Object.values(images)) asset.repository.grantPull(role);
      hostBundle.grantRead(role);
      artifacts.grantReadWrite(role);
      appSecret.grantRead(role);
      appSecret.grantWrite(role);
      bedrockSecret.grantRead(role);

      const loadBalancerGroup = new ec2.SecurityGroup(this, 'LoadBalancerGroup', { vpc, description: 'Berry load balancer: the internet, on 80 and 443' });
      const hostGroup = new ec2.SecurityGroup(this, 'HostGroup', { vpc, description: 'Berry host: the load balancer only. No SSH; use Session Manager.' });
      hostGroup.addIngressRule(loadBalancerGroup, ec2.Port.tcp(3000), 'web');
      hostGroup.addIngressRule(loadBalancerGroup, ec2.Port.tcp(4000), 'api and previews');

      const host = new ec2.Instance(this, 'Host', {
         vpc,
         vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC, availabilityZones: [vpc.availabilityZones[0]!] },
         instanceType,
         machineImage: ec2.MachineImage.latestAmazonLinux2023({
            cpuType: arm ? ec2.AmazonLinuxCpuType.ARM_64 : ec2.AmazonLinuxCpuType.X86_64,
            // Pinned in cdk.context.json at first synth: a new AMI is a replacement of the host, which is a decision.
            cachedInContext: true,
         }),
         role,
         securityGroup: hostGroup,
         associatePublicIpAddress: true,
         blockDevices: [{ deviceName: '/dev/xvda', volume: ec2.BlockDeviceVolume.ebs(80, { volumeType: ec2.EbsDeviceVolumeType.GP3, encrypted: true }) }],
         httpTokens: ec2.HttpTokens.REQUIRED,
         // One hop: the API and the release script, on the host's network, reach
         // the instance role. A preview or an agent session is a bridged container,
         // a hop further away, and gets no answer — code from a pull request must
         // not be able to read the application's secrets.
         httpPutResponseHopLimit: 1,
      });

      // The AMI is pinned on purpose (see `cachedInContext` above): the host holds the database.
      Validations.of(host).acknowledge({ id: 'CloudFormation-Validate::W9010', reason: 'The AMI is pinned in cdk.context.json so that a new one never replaces the host unasked.' });

      const data = new ec2.Volume(this, 'Data', {
         availabilityZone: host.instanceAvailabilityZone,
         size: Size.gibibytes(props.dataVolumeGiB),
         volumeType: ec2.EbsDeviceVolumeType.GP3,
         encrypted: true,
         removalPolicy: RemovalPolicy.RETAIN,
      });
      Tags.of(data).add('berry:snapshot', this.stackName);
      const attachment = new ec2.CfnVolumeAttachment(this, 'DataAttachment', { instanceId: host.instanceId, volumeId: data.volumeId, device: '/dev/sdf' });

      // A snapshot of the database's volume every day, a week of them kept.
      const snapshotRole = new iam.Role(this, 'SnapshotRole', {
         assumedBy: new iam.ServicePrincipal('dlm.amazonaws.com'),
         managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSDataLifecycleManagerServiceRole')],
      });
      new dlm.CfnLifecyclePolicy(this, 'DataSnapshots', {
         description: `${this.stackName} database volume, daily`,
         state: 'ENABLED',
         executionRoleArn: snapshotRole.roleArn,
         policyDetails: {
            resourceTypes: ['VOLUME'],
            targetTags: [{ key: 'berry:snapshot', value: this.stackName }],
            schedules: [{ name: 'daily', createRule: { interval: 24, intervalUnit: 'HOURS', times: ['03:00'] }, retainRule: { count: 7 }, copyTags: true }],
         },
      });

      // ── The address: one certificate for the app and every preview under it.
      const zone = route53.HostedZone.fromLookup(this, 'Zone', { domainName: props.hostedZone });
      const certificate = new acm.Certificate(this, 'Certificate', {
         domainName: domain,
         subjectAlternativeNames: [`*.${previewDomain}`],
         validation: acm.CertificateValidation.fromDns(zone),
      });

      const loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', {
         vpc,
         internetFacing: true,
         securityGroup: loadBalancerGroup,
         // The board's event stream is one long response. The longest the balancer allows.
         idleTimeout: Duration.seconds(4000),
         dropInvalidHeaderFields: true,
      });
      loadBalancer.addListener('Http', { port: 80, defaultAction: elb.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }) });

      const target = (name: string, port: number, path: string) =>
         new elb.ApplicationTargetGroup(this, `${name}Targets`, {
            vpc,
            protocol: elb.ApplicationProtocol.HTTP,
            port,
            targets: [new elbTargets.InstanceTarget(host, port)],
            // A redirect to sign-in is an answer.
            healthCheck: { path, healthyHttpCodes: '200-399', interval: Duration.seconds(15), healthyThresholdCount: 2 },
            deregistrationDelay: Duration.seconds(15),
         });
      const web = target('Web', 3000, '/');
      const api = target('Api', 4000, '/ready');

      const https = loadBalancer.addListener('Https', {
         port: 443,
         certificates: [certificate],
         sslPolicy: elb.SslPolicy.RECOMMENDED_TLS,
         defaultTargetGroups: [web],
      });
      // A preview is served by the API's own proxy, by host name.
      https.addTargetGroups('Previews', { priority: 10, conditions: [elb.ListenerCondition.hostHeaders([`*.${previewDomain}`])], targetGroups: [api] });
      // Straight to the API rather than through the web server's rewrite: one hop fewer under every event stream.
      https.addTargetGroups('ApiPaths', { priority: 20, conditions: [elb.ListenerCondition.pathPatterns(['/api/*', '/v1/*'])], targetGroups: [api] });

      const alias = route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(loadBalancer));
      new route53.ARecord(this, 'AppRecord', { zone, recordName: domain, target: alias });
      new route53.ARecord(this, 'PreviewRecord', { zone, recordName: `*.${previewDomain}`, target: alias });

      // ── The release. The command names every image, so a new image is a new
      // command, and State Manager runs a changed association at once.
      const settings: Record<string, string> = {
         BERRY_DOMAIN: domain,
         BERRY_PREVIEW_DOMAIN: previewDomain,
         BERRY_REGION: this.region,
         BERRY_BEDROCK_REGION: props.bedrockRegion,
         BERRY_BUCKET: artifacts.bucketName,
         BERRY_APP_SECRET: appSecret.secretArn,
         BERRY_BEDROCK_SECRET: bedrockSecret.secretArn,
         BERRY_REGISTRY: `${this.account}.dkr.ecr.${this.region}.${this.urlSuffix}`,
         BERRY_IMAGE_API: images.api.imageUri,
         BERRY_IMAGE_WEB: images.web.imageUri,
         BERRY_IMAGE_RUNTIME: images.runtime.imageUri,
         BERRY_IMAGE_PREVIEW: images.preview.imageUri,
      };
      const release = new ssm.CfnAssociation(this, 'Release', {
         name: 'AWS-RunShellScript',
         associationName: `${this.stackName}-release`,
         targets: [{ key: 'InstanceIds', values: [host.instanceId] }],
         // The deploy waits for the host to have applied it, and fails when it could not.
         waitForSuccessTimeoutSeconds: 1800,
         parameters: {
            executionTimeout: ['1800'],
            commands: [
               'set -euo pipefail',
               'mkdir -p /opt/berry/host',
               `aws s3 cp ${hostBundle.s3ObjectUrl} /opt/berry/host.zip --only-show-errors`,
               'command -v unzip >/dev/null || dnf install -y -q unzip',
               'unzip -o -q /opt/berry/host.zip -d /opt/berry/host',
               ...Object.entries(settings).map(([name, value]) => `export ${name}='${value}'`),
               'bash /opt/berry/host/update.sh',
            ],
         },
      });
      release.node.addDependency(attachment, role);

      new CfnOutput(this, 'Url', { value: `https://${domain}` });
      new CfnOutput(this, 'HostId', { value: host.instanceId, description: 'aws ssm start-session --target <this>' });
      new CfnOutput(this, 'AppSecretArn', { value: appSecret.secretArn, description: 'Add BERRY_AUTH_GITHUB_CLIENT_ID and BERRY_AUTH_GITHUB_CLIENT_SECRET here, then deploy again' });
      new CfnOutput(this, 'ArtifactsBucket', { value: artifacts.bucketName });
   }
}

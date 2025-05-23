import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Duration } from 'aws-cdk-lib';
import { join } from 'path';

/**
 * VideoProcessingConstruct:
 *  - ffmpeg Layer
 *  - Post-processing Lambda + S3 trigger
 *  - DLQ for failures
 *  - DynamoDB metadata table
 */
export interface VideoProcessingProps {
  readonly bucket: s3.IBucket;
}
export class VideoProcessingConstruct extends Construct {
  constructor(scope: Construct, id: string, props: VideoProcessingProps) {
    super(scope, id);

    // Layer
    const ffmpegLayer = new lambda.LayerVersion(this, 'FfmpegLayer', {
      code: lambda.Code.fromAsset(join(__dirname, '../../lambda-layers/ffmpeg')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      description: 'FFmpeg & ffprobe binaries',
    });

    // Post-processing Lambda
    const postProcessingLambda = new NodejsFunction(this, 'PostProcessingLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: join(__dirname, '../../lambda/post-processing/index.js'),
      handler: 'handler',
      memorySize: 1024,
      timeout: Duration.minutes(2),
      environment: {
        BUCKET_NAME: props.bucket.bucketName,
        FFMPEG_PATH: '/opt/bin/ffmpeg',
        FFPROBE_PATH: '/opt/bin/ffprobe',
      },
      layers: [ffmpegLayer],
      bundling: {
        externalModules: ['@aws-sdk/client-s3'],
        nodeModules: ['fluent-ffmpeg'],
      },
    });

    props.bucket.grantReadWrite(postProcessingLambda);
    props.bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(postProcessingLambda),
      { prefix: 'uploads/' }
    );

    // DLQ
    const postProcessingDlq = new sqs.Queue(this, 'PostProcessingDLQ', {
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(5),
    });

    new lambda.EventInvokeConfig(this, 'PostProcessingInvokeConfig', {
      function: postProcessingLambda,
      onFailure: new destinations.SqsDestination(postProcessingDlq),
      retryAttempts: 2,
      maxEventAge: Duration.hours(1),
    });

    // DynamoDB metadata
    const metadataTable = new dynamodb.Table(this, 'VideoMetadata', {
      partitionKey: { name: 'videoId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'uploadTs', type: dynamodb.AttributeType.NUMBER },
      timeToLiveAttribute: 'expireAt',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    metadataTable.addGlobalSecondaryIndex({
      indexName: 'ByResolution',
      partitionKey: { name: 'resolution', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    metadataTable.grantWriteData(postProcessingLambda);
    postProcessingLambda.addEnvironment('METADATA_TABLE', metadataTable.tableName);
  }
}

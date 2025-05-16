import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { join } from 'path';
import * as destinations from 'aws-cdk-lib/aws-lambda-destinations';
import { Duration } from 'aws-cdk-lib';

export class VideoUploadServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI');
    const bucket = new s3.Bucket(this, 'VideoBucket', {
      // If your files are public
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Create a CloudFront distribution pointing to S3 bucket
    const distribution = new cloudfront.Distribution(this, 'VideoCDN', {
      defaultBehavior: {
        origin: new origins.S3Origin(bucket, { originAccessIdentity: oai }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      },
    });

    //lambda layer for ffmpeg
    const ffmpegLayer = new lambda.LayerVersion(this, 'FfmpegLayer', {
      code: lambda.Code.fromAsset(join(__dirname, '../lambda-layers/ffmpeg')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
      description: 'FFmpeg binary for thumbnail generation',
    });

    const videoLambda = new lambda.Function(this, 'DownloadAndUploadLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(join(__dirname, '../lambda/download-and-upload')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 10240, // 10 GB
      ephemeralStorageSize: cdk.Size.gibibytes(10),
      environment: {
        BUCKET_NAME: bucket.bucketName,
        CLOUDFRONT_DOMAIN: distribution.domainName,
      }
    });

    // Allow lambda to write to the S3 bucket
    bucket.grantPut(videoLambda);

    const postProcessingLambda = new NodejsFunction(this, 'PostProcessingLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: join(__dirname, '../lambda/post-processing/index.js'),
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.minutes(2),
      environment: {
        BUCKET_NAME: bucket.bucketName,
        FFMPEG_PATH: '/opt/bin/ffmpeg', // from your layer
      },
      layers: [ffmpegLayer],
      bundling: {
        externalModules: ['@aws-sdk/client-s3'],  // keep AWS SDK v3 out
        // (optional) ensure ffmpeg wrapper is bundled:
        nodeModules: ['fluent-ffmpeg'],
      },
    });
    // Grant read/write access to the Lambda
    bucket.grantReadWrite(postProcessingLambda);
    // Trigger post-processing when new file is uploaded to 'uploads/'
    bucket.addEventNotification(
      s3.EventType.OBJECT_CREATED,
      new s3n.LambdaDestination(postProcessingLambda),
      { prefix: 'uploads/' }
    );

    // API Gateway
    const api = new apigateway.RestApi(this, 'VideoUploadAPI', {
      restApiName: 'Video Upload Service',
    });

    const upload = api.root.addResource('upload');
    upload.addMethod(
      'POST',
      new apigateway.LambdaIntegration(videoLambda),
      {
        apiKeyRequired: true,
      });

    const key = api.addApiKey('UploadApiKey');
    const usagePlan = api.addUsagePlan('UploadUsagePlan', {
      name: 'FreeTierPlan',
      throttle: { rateLimit: 5, burstLimit: 2 },
      apiStages: [{ api, stage: api.deploymentStage }],
    });

    usagePlan.addApiKey(key);

    const postProcessingDlq = new sqs.Queue(this, 'PostProcessingDLQ', {
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.minutes(5),
    });

    new lambda.EventInvokeConfig(this, 'PostProcessingInvokeConfig', {
      function: postProcessingLambda,
      // send failures to the SQS DLQ
      onFailure: new destinations.SqsDestination(postProcessingDlq),
      // optionally tune retry attempts and age
      retryAttempts: 2,
      maxEventAge: Duration.hours(1),
    });

    // Output API endpoint
    new cdk.CfnOutput(this, 'UploadEndpoint', {
      value: api.url + 'upload',
    });

    new cdk.CfnOutput(this, 'CDNUrl', {
      value: `https://${distribution.domainName}`,
    });
  }
}

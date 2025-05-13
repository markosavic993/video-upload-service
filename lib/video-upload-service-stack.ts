import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import { join } from 'path';

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

    // 3. API Gateway
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

    // Output API endpoint
    new cdk.CfnOutput(this, 'UploadEndpoint', {
      value: api.url + 'upload',
    });

    new cdk.CfnOutput(this, 'CDNUrl', {
      value: `https://${distribution.domainName}`,
    });
  }
}

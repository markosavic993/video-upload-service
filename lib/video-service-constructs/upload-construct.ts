import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { join } from 'path';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';

/**
 * VideoUploadConstruct:
 *  - Lambda for downloading & uploading
 *  - API Gateway + API Key + Usage Plan
 */
export interface VideoUploadProps {
  readonly bucket: s3.IBucket;
  readonly distribution: cloudfront.IDistribution;
}
export class VideoUploadConstruct extends Construct {
  public readonly lambdaFn: lambda.Function;
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: VideoUploadProps) {
    super(scope, id);

    this.lambdaFn = new lambda.Function(this, 'DownloadAndUploadLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(join(__dirname, '../../lambda/download-and-upload')),
      timeout: Duration.minutes(15),
      memorySize: 10240,
      ephemeralStorageSize: cdk.Size.gibibytes(10),
      environment: {
        BUCKET_NAME: props.bucket.bucketName,
        CLOUDFRONT_DOMAIN: props.distribution.distributionDomainName,
      },
    });

    props.bucket.grantPut(this.lambdaFn);

    this.api = new apigateway.RestApi(this, 'VideoUploadAPI', {
      restApiName: 'Video Upload Service',
    });

    const upload = this.api.root.addResource('upload');
    upload.addMethod('POST', new apigateway.LambdaIntegration(this.lambdaFn), {
      apiKeyRequired: true,
    });

    const key = this.api.addApiKey('UploadApiKey');
    const usagePlan = this.api.addUsagePlan('UploadUsagePlan', {
      name: 'FreeTierPlan',
      throttle: { rateLimit: 5, burstLimit: 2 },
      apiStages: [{ api: this.api, stage: this.api.deploymentStage }],
    });
    usagePlan.addApiKey(key);
  }
}

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { join } from 'path';

export class VideoUploadServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = new s3.Bucket(this, 'VideoBucket');

    const videoLambda = new lambda.Function(this, 'DownloadAndUploadLambda', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(join(__dirname, '../lambda/download-and-upload')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 10240, // 10 GB
      ephemeralStorageSize: cdk.Size.gibibytes(10),
      environment: {
        BUCKET_NAME: bucket.bucketName,
      }
    });

    // Allow lambda to write to the S3 bucket
    bucket.grantPut(videoLambda);

    // 3. API Gateway
    const api = new apigateway.RestApi(this, 'VideoUploadAPI', {
      restApiName: 'Video Upload Service',
    });

    const upload = api.root.addResource('upload');
    upload.addMethod('POST', new apigateway.LambdaIntegration(videoLambda));

    // Output API endpoint
    new cdk.CfnOutput(this, 'UploadEndpoint', {
      value: api.url + 'upload',
    });
  }
}

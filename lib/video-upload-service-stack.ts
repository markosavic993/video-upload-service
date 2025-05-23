import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { VideoDeliveryConstruct } from './video-service-constructs/delivery-construct';
import { VideoUploadConstruct } from './video-service-constructs/upload-construct';
import { VideoProcessingConstruct } from './video-service-constructs/processing-construct';

export class VideoUploadServiceStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const delivery = new VideoDeliveryConstruct(this, 'Delivery');

    const uploader = new VideoUploadConstruct(this, 'Uploader', {
      bucket: delivery.bucket,
      distribution: delivery.distribution,
    });

    // 3️⃣ Post-processing pipeline
    new VideoProcessingConstruct(this, 'Processor', {
      bucket: delivery.bucket,
    });

    // Output API endpoint
    new cdk.CfnOutput(this, 'UploadEndpoint', {
      value: uploader.api.url + 'upload',
    });

    new cdk.CfnOutput(this, 'CDNUrl', {
      value: `https://${delivery.distribution.domainName}`,
    });
  }
}

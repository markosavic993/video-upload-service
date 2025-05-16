# Welcome to your CDK TypeScript project

This is a demo project investigating scalable architecture for video upload and post processing.
It uses streaming to download files directly into S3.

Additionally, this includes post-processing which will:
* Generate and update thumbnail

In case of failed post-processing, there is DLQ in place to handle errors and retries.

All the files are available via Cloudfront CDN.

Meta data of processed video files is stored in dynamo db table.
## Useful commands

* `npm run build`   compile typescript to js
* `npm run watch`   watch for changes and compile
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

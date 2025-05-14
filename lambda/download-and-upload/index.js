const https = require('https');
const { Upload } = require('@aws-sdk/lib-storage');
const { S3Client } = require('@aws-sdk/client-s3');
const s3 = new S3Client();
const bucketName = process.env.BUCKET_NAME;
const cloudfrontDomain = process.env.CLOUDFRONT_DOMAIN;

exports.handler = async (event) => {
  const { url } = JSON.parse(event.body);
  const filename = url.split('/').pop();

  const responseStream = await new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download file: ${res.statusCode}`));
        res.resume();
        return;
      }
      console.log('Success downloading', res.headers)
      resolve(res);
    }).on('error', reject);
  });

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: bucketName,
      Key: `uploads/${filename}`,
      Body: responseStream,
    },
  });

  await upload.done();

  const fileUrl = `https://${cloudfrontDomain}/${filename}`;

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Upload successful',
      fileUrl,
    }),
  };
};

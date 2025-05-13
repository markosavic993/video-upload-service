const https = require('https');
const { Upload } = require('@aws-sdk/lib-storage');
const { S3Client } = require('@aws-sdk/client-s3');
const s3 = new S3Client();

exports.handler = async (event) => {
  const { url } = JSON.parse(event.body);
  const filename = url.split('/').pop();
  const bucketName = process.env.BUCKET_NAME;
  const region = process.env.AWS_REGION;

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
      Key: filename,
      Body: responseStream,
    },
  });

  await upload.done();

  const fileUrl = `https://${bucketName}.s3.${region}.amazonaws.com/${filename}`;

  return {
    statusCode: 200,
    body: JSON.stringify({
      message: 'Upload successful',
      fileUrl,
    }),
  };
};

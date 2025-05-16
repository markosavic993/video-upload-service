const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const os = require('os');
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const s3 = new S3Client();
const ddb = new DynamoDBClient();

const bucketName = process.env.BUCKET_NAME;
const ffmpegPath = process.env.FFMPEG_PATH;
const ffprobePath = process.env.FFPROBE_PATH;
const TABLE_NAME   = process.env.METADATA_TABLE;

exports.handler = async (event) => {
  const record = event.Records[0];
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  const baseName = path.basename(key, path.extname(key));
  const thumbnailKey = `processed/thumbnails/${baseName}.jpg`;
  const inputPath = path.join(os.tmpdir(), baseName);
  const outputPath = path.join(os.tmpdir(), `${baseName}.jpg`);

  console.log('Processing video:', key);
  // Download the video
  const video = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  const stream = video.Body;
  const file = fs.createWriteStream(inputPath);

  await new Promise((resolve, reject) =>
    stream.pipe(file).on('finish', resolve).on('error', reject)
  );

  // Configure ffmpeg
  ffmpeg.setFfmpegPath(ffmpegPath);
  ffmpeg.setFfprobePath(ffprobePath);

  // Generate thumbnail
  console.log(`Generating thumbnail for ${key}`);
  await new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .screenshots({
        timestamps: ['10'],
        filename: `${baseName}.jpg`,
        folder: os.tmpdir(),
        size: '640x?'
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Upload thumbnail
  const thumbBuffer = fs.readFileSync(outputPath);

  const putCommand = new PutObjectCommand({
    Bucket: bucketName,
    Key: thumbnailKey,
    Body: thumbBuffer,
    ContentType: 'image/jpeg',
  });

  await s3.send(putCommand);

  console.log(`Thumbnail created for ${key}`);

  // ————— Probe metadata ↓
  const metadata = await new Promise((res, rej) =>
    ffmpeg.ffprobe(inputPath, (err, data) => err ? rej(err) : res(data))
  );
  const fmt      = metadata.format || {};
  const vidStream = metadata.streams.find(s => s.codec_type==='video') || {};
  const nowTs    = Date.now();

  // ————— Write to DynamoDB ↓
  await ddb.send(new PutItemCommand({
    TableName: TABLE_NAME,
    Item: {
      videoId:   { S: baseName },
      uploadTs:  { N: nowTs.toString() },
      duration:  { N: (fmt.duration||0).toString() },
      bytes:     { N: (fmt.size||0).toString() },
      format:    { S: fmt.format_name||'?' },
      resolution:{ S: `${vidStream.width||0}x${vidStream.height||0}` },
      codec:     { S: vidStream.codec_name||'?' },
      expireAt:  { N: (Math.floor(nowTs/1000) + 60*60*24*30).toString() },
    }
  }));

  console.log(`✅ Processed ${baseName}: ${fmt.duration}s, ${vidStream.width}x${vidStream.height}`);
};

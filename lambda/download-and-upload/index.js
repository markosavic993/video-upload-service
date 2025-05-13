const url = require('url');

exports.handler = async (event) => {
  const body = JSON.parse(event.body);
  const sourceUrl = body.url;
  const parsed = url.parse(sourceUrl);
  const filename = parsed.pathname.split('/').pop();

  return {
    statusCode: 200,
    body: JSON.stringify({ message: 'Upload successful', filename }),
  }
};

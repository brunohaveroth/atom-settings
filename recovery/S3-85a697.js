var s3 = require('s3');
var client = s3.createClient({
  s3Options: {
    accessKeyId: sails.config.s3Credentials.key,
    secretAccessKey: sails.config.s3Credentials.secret,
  },
});

var AWS = require('aws-sdk');
AWS.config.update(
  {
    accessKeyId: sails.config.s3Credentials.key,
    secretAccessKey: sails.config.s3Credentials.secret,
    region: 'us-east-1'
  }
);
var s3 = new AWS.S3();


module.exports = {

  sign: function (key) {
    options = {
      Bucket    : sails.config.s3Credentials.bucket,
      Key    : key,
    };
    return s3.getSignedUrl('getObject', options);
  },

  signWithFileName(file) {
    options = {
      Bucket: sails.config.s3Credentials.bucket,
      Key: file.path,
      ResponseContentDisposition: 'attachment; filename ="' + file.name + '"'
    };
    return s3.getSignedUrl('getObject', options);
  },

  signPut(key) {
    options = {
      Bucket: sails.config.s3Credentials.bucket,
      Key: key,
    };
    return s3.getSignedUrl('putObject', options);
  },

  delete: function(key) {
    var params = {
      Bucket: sails.config.s3Credentials.bucket,
      /* required */
      Delete: { /* required */
        Objects: [ /* required */ {
          Key: key /* required */
        }]
      }
    };
    var deleter = client.deleteObjects(params);
    deleter.on('error', (err) => {
      sails.log.warn('S3: Não apagou o arquivo ', key);
      sails.log.error(err, err.stack); // an error occurred
    });
    deleter.on('end', () => {
      sails.log.info('S3: Removido com sucesso: ', key)
    });
  }
};

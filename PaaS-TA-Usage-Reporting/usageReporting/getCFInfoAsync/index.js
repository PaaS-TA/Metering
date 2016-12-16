var request = require('abacus-request');
var debug = require('abacus-debug')('appUsageAPI-getCFInfoAsync');
var edebug = require('abacus-debug')('e-appUsageAPI-getCFInfoAsync');

var uris = process.env.API;

var hostUri = uris + '/v2/apps';
var err = null;

// CF APP 정보 조회
exports.getdataAsync = function getCFdataAsync(cfAdminToken, cb){

  var token = cfAdminToken();

  request.get(hostUri, {
    headers: {
      Authorization: token
    },
    api: uris,
    json: true
  }, function(error, response) {

    if (error || response.statusCode !== 200) {
      edebug('err:::' + error);
      err = new Error(error);
      cb(err,null);
      return;
    }

    var cfData = response.body;

    if (cfData) {
      debug(cfData);
      cb(err,cfData);
      return;
    }
  })
}
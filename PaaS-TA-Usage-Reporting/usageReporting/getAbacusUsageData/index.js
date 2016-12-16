var request = require('abacus-request');

var debug = require('abacus-debug')('appUsageAPI-getAbacusUsageData');
var edebug = require('abacus-debug')('e-appUsageAPI-getAbacusUsageData');

var err = false;

// Take secured abacus request Header
var authHeader = function authHeader(token) {
  return token ? { authorization: token() } : {};
};

exports.getdataAsync = function getAbacusReportData(abacusToken, orgId, pTimestamp, cb){

  // pTimestamp 가 null 인 경우, 현재 시간 timestamp
  pTimestamp ? pTimestamp : new Date().getTime();

  var abacushost = process.env.ABACUS_REPORT_SERVER;

  // call abacus reporting summary
  var rPath = '/v1/metering/organizations/' + orgId + '/aggregated/usage/'+ pTimestamp;

  var hostUri = abacushost + rPath;

  request.get(hostUri, {
    headers: authHeader(abacusToken),
    api: 80,
    json: true
  }, function(error, response) {

    if (error || response.statusCode !== 200) {
      edebug(error);
      cb(err,null);
      return;
    }

    var resources = response.body;

    if (resources) {
      //debug('response.body:::' + JSON.stringify(response.body));
      cb(err,resources);
      return;
    }
  })
}





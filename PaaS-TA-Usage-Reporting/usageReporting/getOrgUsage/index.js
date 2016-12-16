var async = require('async');
var debug = require('abacus-debug')('appUsageAPI-getAppUsage');
var edebug = require('abacus-debug')('e-appUsageAPI-getAppUsage');

var getCfDataAsync = require('../getCFInfoAsync');
var getAbacusUsageData = require('../getAbacusUsageData');
var getUsageAmountJSON = require('../getUsageAmountJSON');

var getAppUsage = function(cfAdminToken, abacusToken, orgId, spaceId, cb) {

  var tasks = [

    function(callback) {

      // CF 에서 APP 정보를 취득한다.
      getCfDataAsync.getdataAsync(cfAdminToken, function(err, cfData) {

        if (err) {
          edebug(err);
          callback(err,null);
        }
        callback(null, cfData);
      });
    },
    function(cfData, callback) {

      // Abacus-report 에서 Usage Summary 정보를 취득한다.
      getAbacusUsageData.getdataAsync(abacusToken, orgId, new Date().getTime(), function(err, abData) {

        if (err) {
          edebug(err);
          callback(err,null);
        } else if (abData == null) {
          edebug('조직의 사용량 정보가 없습니다.');
          callback('조직의 사용량 정보가 없습니다.', null);
        } else {
          abData.cfAppStatusData = cfData;
          callback(null, cfData, abData);
        }

      });
    },
    function(cfData, abData, callback) {

      // 데이타를 계산하고, 결과데이타를 JSON 으로 가공한다.
      getUsageAmountJSON.getOrgUsage(cfData, abData, spaceId, function(err, appUsageData) {

        if (err) {
          edebug(err);
          callback(err,null);
        }

        callback(false, appUsageData);

      });
    }
  ];

  async.waterfall(tasks, function(err, appUsageData) {
    if (err)
      cb(err, 'err');
    else
      cb(null, JSON.stringify(appUsageData));
      //debug('zzzzzzzzzzzzzzzzzzzzzz' + JSON.stringify(appUsageData));
  });
}

exports.getdata = function(cfAdminToken, abacusToken, orgId, spaceId, cb) {

  getAppUsage(cfAdminToken, abacusToken, orgId, spaceId, cb);
  
};
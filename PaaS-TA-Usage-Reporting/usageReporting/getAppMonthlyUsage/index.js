var async = require('async');

var debug = require('abacus-debug')('appUsageAPI-getAppUsageMonthly');
var edebug = require('abacus-debug')('e-appUsageAPI-getAppUsageMonthly');

var getAbacusData = require('../getAbacusUsageData');
var getCfDataAsync = require('../getCFInfoAsync');
var getUsageAmountJSON = require('../getUsageAmountJSON');

var getAppMonthlyUsage = function(cfAdminToken, abacusToken, monthIndex, orgId, spaceId, appId, cb) {

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

      var abDataArr =  new Array();
      var counter = monthIndex.length;

      // orgId 로 abacus 파라메타 갯수만큼 데이타를 호훌한다. 배열 length 로 비동기 완료 체크 한 후 callback 처리
      monthIndex.forEach(function(yyyymmRow) {

        getAbacusData.getdataAsync(abacusToken, orgId, yyyymmRow.lastday, function(err, abData) {

          if (err) {
            edebug(err);
            cb(err,null);
          } else if (abData != null && abData != 'undefined') {

            abData.cfAppStatusData = cfData;
            abData.timestamp_param = yyyymmRow.lastday;
            abData.yyyymm = yyyymmRow.yyyymm;

            abDataArr.push(abData);
            --counter;

            if (counter === 0 && abDataArr.length > 0) {
              callback(null, abDataArr);
            }
          }
        });
      });

    },
    function(abDataArr, callback) {

      // 배열을 날짜 순서대로 sorting 한다.
      abDataArr.sort(function(a, b) {
        if (a.yyyymm > b.yyyymm) {
          return 1;
        }
        if (a.yyyymm < b.yyyymm) {
          return -1;
        }
        // a must be equal to b
        return 0;
      });

      // 데이타를 계산하고, 결과데이타를 JSON 으로 가공한다.
      getUsageAmountJSON.getAppMonthlyUsage(orgId, monthIndex, abDataArr, spaceId, appId, function(err, appUsageData) {

        if (err) {
          edebug(err);
          callback(err,null);
        }

        callback( false, appUsageData);

      });
    }
  ];

  async.waterfall(tasks, function(err, appUsageData) {
    if (err)
      cb(err, 'errr');
    else
      cb(null, JSON.stringify(appUsageData));
      //debug('zzzzzzzzzzzzzzzzzzzzzz' + JSON.stringify(appUsageData));
  });
}

exports.api003 = function(cfAdminToken, abacusToken, orgId, spaceId, appId, monthIndex, cb) {

  getAppMonthlyUsage(cfAdminToken, abacusToken, monthIndex, orgId, spaceId, appId, cb);

};


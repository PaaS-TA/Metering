/**
 * Created by park on 9/6/16.
 */

var debug = require('abacus-debug')('appUsageAPI-getUsageAmountJSON');
var edebug = require('abacus-debug')('e-appUsageAPI-getUsageAmountJSON');

/*
 abaucs 미터링 event 발생 이후, API CALL 시간 까지의 사용량을 계산한다.
 reportEndTime : abacus 가 reporting 한 시간
 insCnt : 인스턴스 갯수
 memQan : app 할당 메모리
 appState : 현재 app의 상태 값
 consuming : abacus 적산 값
 */
var calUsageToNow = function(reportEndTime, insCnt, memQan, appState, consuming) {

  // 그 동안의 시간
  var timeToNow = new Date().getTime() - reportEndTime;

  var calculatedUsage = (timeToNow / 3600000)*insCnt*(memQan / 1024);

  // 절삭 처리
  calculatedUsage = Math.round(calculatedUsage - (memQan / 1024));

  // 앱의 현재 스테이터스가 STARTED 가 아닌 경우, 현재까지의 사용량은 0 처리한다.
  return appState=='STARTED' ? calculatedUsage + consuming : 0 + consuming;

}

// abacus window 배열에서 유효한 usage consuming -> summary 값을 찾아 리턴한다.
// 배열의 맨 마지막 데이타를 리턴 (abacus time-windows 'M' 데이타의 summary)
var getValidQanFromCwindow = function(abWindows) {

  var consuming = 0;
  var flag = true;
  
  debug('abWindows:::' + abWindows);

  abWindows.forEach(function(pwindow) {
    if (pwindow != '' && pwindow != null && flag) {
      // pwindow.forEach(function(cwindow) {
      //   if (cwindow != '' && cwindow != null) {
      //      // debug('cwindow.quantity.consuming:::' + cwindow.quantity.consuming);
      //      // consuming = cwindow.quantity.consuming;
      //     debug('cwindow.summary:::' + cwindow.summary);
      //     consuming = cwindow.summary;
      //   }
      // });
      debug('pwindow.summary:::' + pwindow.summary);
      consuming = pwindow.summary;
      flag = false;
    }
  });

  debug('getValidQanFromCwindow(abacus 적산량):' + consuming);
  return consuming;
}

// 이번달 첫날의 타임스탬프
var getThisMonth1Date = function() {
  var date = new Date();
  var mt = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  return mt;
}

// abacus 의 앱 사용량 미터링 정책 데이타는 0 번째 배열에 위치한다.
var linuxContainerResSeq = 0;

// abacus 의 메모리 리소스 사용량 데이타는 0 번째 배열에 위치한다.
var memResSeq = 0;

// abacus 의 month 사용량 데이타는 4 번째 배열에 위치한다.
var monthUsageSeq = 4;

////////////////////////////////////////////////////////////////////////// API 1번
////////////////////////////////////////////////////////////////////////// API 1번
// abacus data 와 cf Data 를 조회하여, 데이타를 계산하고, 결과데이타를 JSON 으로 가공한다.
////////////////////////////////////////////////////////////////////////// API 1번
////////////////////////////////////////////////////////////////////////// API 1번
var getOrgUsage = function(cfData, abData, spaceId, cb) {

  // 리턴할 JSON 객체를 생성하고 정보를 삽입한다.
  var rtnObject =  new Object() ;

  var reportEndTime = abData.end;
  var addUsage = 0;
  var appDataArr = new Array() ;
  var appUsageSum  = 0;

  abData.spaces.forEach(function(spaceData, index) {

    // abacus 데이타의 앱(consumers) 영역을 loop 처리
    spaceData.consumers.forEach(function(abEntity) {

      // CF 앱스테이터스 데이타를 loop 처리
      cfData.resources.forEach(function(cfEntity) {

        // spaceId 가 all인 경우, org 전체의 데이타를 처리한다.
        if (abEntity.consumer_id == ('app:' + cfEntity.metadata.guid) && (spaceId == 'all' || (spaceId != 'all' && cfEntity.entity.space_guid == spaceId))){

          var arrObject =  new Object();

          var abWindows = abEntity.resources[linuxContainerResSeq].plans[0].aggregated_usage[memResSeq].windows[monthUsageSeq];

          var consuming = getValidQanFromCwindow(abWindows);

          debug('reportEndTime:' + reportEndTime);
          debug('인스턴스:' + cfEntity.entity.instances);
          debug('메모리:' + cfEntity.entity.memory);
          debug('app 아이디:' + abEntity.consumer_id);
          debug('app 명:' + cfEntity.entity.name);
          debug('app 상태:' + cfEntity.entity.state);

          // abaucs 미터링 event 발생 이후, API CALL 시간 까지의 사용량을 계산한다.
          // addUsage =  calUsageToNow(reportEndTime, cfEntity.entity.instances, cfEntity.entity.memory, cfEntity.entity.state, consuming);
          addUsage = consuming;
          debug('사용량:::' + addUsage);
          debug('---------------------------------------------------------------------------------');

          arrObject.space_id = cfEntity.entity.space_guid;
          arrObject.app_id = cfEntity.metadata.guid;
          arrObject.app_name = cfEntity.entity.name;
          arrObject.app_state = cfEntity.entity.state;
          arrObject.app_instance = cfEntity.entity.instances;
          arrObject.app_memory = cfEntity.entity.memory;
          arrObject.app_usage = addUsage;

          appDataArr.push(arrObject);

          // 집계된 엔티티에 대하여, 플래그 처리
          abEntity.amounted = true;

          appUsageSum = appUsageSum + addUsage;
        }
      });
    });

    // CF 에서 삭제 처리된 앱을 찾기 위해 스페이스 loop 처리를 한번 더 한다.
    spaceData.consumers.forEach(function(abEntity) {

      var arrObject =  new Object();

      if (!abEntity.amounted && (spaceId == 'all' || (spaceId != 'all' && spaceData.space_id == spaceId))){

        var abWindows = abEntity.resources[linuxContainerResSeq].plans[0].aggregated_usage[memResSeq].windows[monthUsageSeq];
        var consuming = getValidQanFromCwindow(abWindows);

        debug('reportEndTime:' + reportEndTime);
        debug('인스턴스: 0');
        debug('메모리: 0');
        debug('app 아이디:' + abEntity.consumer_id);
        debug('app 명: CF_DELETED_APP');
        debug('app 상태: DELETED');
        debug('사용량:::' + consuming);
        debug('---------------------------------------------------------------------------------');

        arrObject.space_id = spaceData.space_id;
        arrObject.app_id = abEntity.consumer_id;
        arrObject.app_name = 'CF_DELETED_APP';
        arrObject.app_state = 'DELETED';
        arrObject.app_instance = 0;
        arrObject.app_memory = 0;

        // 현재 app 사용종료이므로 abacus 적산량을 그대로 집계처리한다.
        arrObject.app_usage = consuming;

        appDataArr.push(arrObject);

        abEntity.amounted = true;

        appUsageSum = appUsageSum + consuming;
      }
    });
  });

  rtnObject.org_id = abData.organization_id;
  rtnObject.from = getThisMonth1Date();
  rtnObject.to = new Date().getTime();
  rtnObject.sum = appUsageSum;
  rtnObject.app_usage_arr = appDataArr;

  debug(rtnObject);
  cb(false, rtnObject);
}

////////////////////////////////////////////////////////////////////////// API 2번
////////////////////////////////////////////////////////////////////////// API 2번
////////////////////////////////////////////////////////////////////////// API 2번
var getOrgMonthlyUsage = function(orgId, monthIndex, abDataArr, spaceId, cb) {

  var rtnObject =  new Object();
  var allSum = 0;

  var monthlyUsageArr = new Array();

  var appTotalUsageArr = new Array();

  var appTotalUsageObject =  new Object();

  appTotalUsageObject.app_id = 'dummy';
  appTotalUsageObject.app_usage = 0;

  appTotalUsageArr.push(appTotalUsageObject);

  // monthly
  abDataArr.forEach(function(abData) {

    var monthArrObject =  new Object();
    var monthArrSum = 0;
    var spacesArr = new Array();
//    var spaceArrSum = 0;

    var cfData = abData.cfAppStatusData;
    var reportEndTime = abData.end;

    debug('reportEndTime :::' + reportEndTime);
    // var reportEndDate = new Date(reportEndTime);

    abData.spaces.forEach(function(spaceData) {

      var spaceArrObject =  new Object();
      var appUsageArr = new Array();
      var spacesArrSum = 0;

      // abacus 데이타의 앱(consumers) 영역을 loop 처리
      spaceData.consumers.forEach(function(abEntity) {

        var addUsage = 0;

        // CF 앱스테이터스 데이타를 loop 처리
        cfData.resources.forEach(function(cfEntity) {

          var appArrObject =  new Object();

          if (abEntity.consumer_id == ('app:' + cfEntity.metadata.guid) && (spaceId == 'all' || (spaceId != 'all' && cfEntity.entity.space_guid == spaceId))){
          // if (spaceId == 'all' || (spaceId != 'all' && cfEntity.entity.space_guid == spaceId)){

            var abWindows = abEntity.resources[linuxContainerResSeq].plans[0].aggregated_usage[memResSeq].windows[monthUsageSeq];
            var consuming = getValidQanFromCwindow(abWindows);

            //addUsage =  calUsageToNow(reportEndTime, cfEntity.entity.instances, cfEntity.entity.memory, cfEntity.entity.state, consuming);
            addUsage = consuming;
            appArrObject.app_id = abEntity.consumer_id;
            appArrObject.app_name = cfEntity.entity.name;
            appArrObject.app_instance = cfEntity.entity.instances;
            appArrObject.app_memory = cfEntity.entity.memory;
            appArrObject.app_usage = addUsage;

            appUsageArr.push(appArrObject);

            spacesArrSum = spacesArrSum + addUsage;

            // 집계된 엔티티에 대하여, 플래그 처리
            abEntity.amounted = true;

            // 해당기간 앱 전체 사용량 데이타
            var appTotalUsageObject =  new Object();

            appTotalUsageObject.app_id = abEntity.consumer_id;
            appTotalUsageObject.app_name = cfEntity.entity.name;
            appTotalUsageObject.app_usage = addUsage;


            var existFlag = false;
            appTotalUsageArr.forEach(function(arrObject) {
              if (arrObject.app_id==abEntity.consumer_id){
                existFlag = true;
                arrObject.app_usage = arrObject.app_usage + addUsage;
              }
            });

            if (!existFlag)
              appTotalUsageArr.push(appTotalUsageObject);
          }
        });


      });

      // 스페이스 loop 처리를 한번 더 한다.
      spaceData.consumers.forEach(function(abEntity) {

        var addUsage = 0;
        var appArrObject =  new Object();

        // 집계 플래그가 true 가 아니면 다시 집계 한다.
        if (!abEntity.amounted && (spaceId == 'all' || (spaceId != 'all' && spaceData.space_id == spaceId))){

          var abWindows = abEntity.resources[linuxContainerResSeq].plans[0].aggregated_usage[memResSeq].windows[monthUsageSeq];
          var consuming = getValidQanFromCwindow(abWindows);

          addUsage =  consuming;

          appArrObject.app_id = abEntity.consumer_id;
          appArrObject.app_name = 'CF_DELETED_APP';
          appArrObject.app_instance = 0;
          appArrObject.app_memory = 0;
          appArrObject.app_usage = addUsage;

          appUsageArr.push(appArrObject);
          spacesArrSum = spacesArrSum + addUsage;

          abEntity.amounted = true;

          // 해당기간 앱 전체 사용량 데이타
          var appTotalUsageObject =  new Object();

          appTotalUsageObject.app_id = abEntity.consumer_id;
          appTotalUsageObject.app_name = 'CF_DELETED_APP';
          appTotalUsageObject.app_usage = addUsage;

          var existFlag = false;
          appTotalUsageArr.forEach(function(arrObject) {
            if (arrObject.app_id==abEntity.consumer_id){
              existFlag = true;
              arrObject.app_usage = arrObject.app_usage + addUsage;
            }
          });

          if (!existFlag)
            appTotalUsageArr.push(appTotalUsageObject);
        }
      });

      spaceArrObject.space_id = spaceData.space_id;
      spaceArrObject.sum = spacesArrSum;
      spaceArrObject.app_usage_arr = appUsageArr;
      spacesArr.push(spaceArrObject);

      monthArrSum = monthArrSum + spacesArrSum;
    });

    monthArrObject.month = abData.yyyymm;
    monthArrObject.sum = monthArrSum;
    monthArrObject.spaces = spacesArr;
    monthlyUsageArr.push(monthArrObject);

    allSum = allSum + monthArrSum;

  });

  rtnObject.org_id = orgId;
  rtnObject.from_month = monthIndex[0].yyyymm;
  rtnObject.to_month = monthIndex[monthIndex.length-1].yyyymm;
  rtnObject.sum = allSum;
  rtnObject.monthly_usage_arr = monthlyUsageArr;

  var newAppTotalUsageArr = new Array();

  appTotalUsageArr.forEach(function(appObject) {
    if (appObject.app_id!='dummy')
      newAppTotalUsageArr.push(appObject);
  });

  // app 이름으로 소팅한다.
  newAppTotalUsageArr.sort(function(a, b) {

    var nameA = a.app_name;
    var nameB = b.app_name;

    if (nameA < nameB) {
      return -1;
    }
    if (nameA > nameB) {
      return 1;
    }
    // names must be equal
    return 0;
  });

  rtnObject.total_app_usage_arr = newAppTotalUsageArr;

  cb(false, rtnObject);
}

////////////////////////////////////////////////////////////////////////// API 3번
////////////////////////////////////////////////////////////////////////// API 3번
////////////////////////////////////////////////////////////////////////// API 3번
var getAppMonthlyUsage = function(orgId, monthIndex, abDataArr, spaceId, appId,  cb ) {

  var rtnObject =  new Object();
  var monthArrSum = 0;
  var instance = 0;
  var memory = 0;
  var addUsage = 0;
  var appName = '';

  var monthlyUsageArr = new Array();

  // monthly
  abDataArr.forEach(function(abData) {

    var monthArrObject =  new Object();
    var cfData = abData.cfAppStatusData;
    var reportEndTime = abData.end;

    abData.spaces.forEach(function(spaceData) {

      spaceData.consumers.forEach(function(abEntity) {

        cfData.resources.forEach(function(cfEntity) {

          if (abEntity.consumer_id == ('app:' + appId) && cfEntity.metadata.guid == appId ) {

              var abWindows = abEntity.resources[linuxContainerResSeq].plans[0].aggregated_usage[memResSeq].windows[monthUsageSeq];
              var consuming = getValidQanFromCwindow(abWindows);

              instance = cfEntity.entity.instances;
              memory = cfEntity.entity.memory;
              appName = cfEntity.entity.name;
              //addUsage =  calUsageToNow(reportEndTime, cfEntity.entity.instances, cfEntity.entity.memory, cfEntity.entity.state, consuming);
              addUsage = consuming;

              debug('instance:' + instance);
              debug('memory:' + memory);
              debug('appName:' + appName);
              debug('addUsage:' + addUsage);

              abEntity.amounted = true;
          }
        });
      });

      // abacs 에서 집계된 후, CF 에서 삭제 된 경우
      spaceData.consumers.forEach(function(abEntity) {

        if (! abEntity.amounted && abEntity.consumer_id == ('app:' + appId)) {

          var abWindows = abEntity.resources[linuxContainerResSeq].plans[0].aggregated_usage[memResSeq].windows[monthUsageSeq];
          var consuming = getValidQanFromCwindow(abWindows);

          instance = 0;
          memory = 0;
          appName = 'CF_DELETED_APP';
          addUsage =  consuming;

          debug('instance:' + instance);
          debug('memory:' + memory);
          debug('appName:' + appName);
          debug('addUsage:' + addUsage);

          abEntity.amounted = true;
        }
      });
    });

    monthArrObject.month = abData.yyyymm;
    monthArrObject.app_instance = instance;
    monthArrObject.app_memory = memory;
    monthArrObject.app_usage = addUsage;
    monthlyUsageArr.push(monthArrObject);
    monthArrSum = monthArrSum + addUsage;

  });

  rtnObject.app_name = appName;
  rtnObject.org_id = orgId;
  rtnObject.space_id = spaceId;
  rtnObject.app_id = appId;
  rtnObject.from_month = monthIndex[0].yyyymm;
  rtnObject.to_month = monthIndex[monthIndex.length-1].yyyymm;
  rtnObject.sum = monthArrSum;
  rtnObject.monthly_usage_arr = monthlyUsageArr;

  cb(false, rtnObject);
}

module.exports.getOrgUsage = getOrgUsage;
module.exports.getOrgMonthlyUsage = getOrgMonthlyUsage;
module.exports.getAppMonthlyUsage = getAppMonthlyUsage;
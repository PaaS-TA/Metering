'use strict';

// from_month 부터 to_month 사이의 month timewindow 배열을 리턴한다.
var monthIndex = function(from_month, to_month)  {

  var strTermCnt = fn_calcDayMonthCount(from_month, to_month);

  // 현재 날짜
  var d = new Date();
  var yyyymmToday = d.getFullYear().toString() + ((d.getMonth() + 1) < 10 ? '0' + (d.getMonth() + 1) : d.getMonth() + 1) ;

  var i = 0;
  var monthArray = new Array();

  while (strTermCnt >= 0) {

    //var d = new Date(year, month, day, hours, minutes, seconds, milliseconds)
    var date = new Date(from_month.substring(0,4), (from_month.substring(4, 6) - 1), 1, 0, 0, 0);
    var date_ = new Date(date.setMonth(date.getMonth() + i));

    // 날짜 객체를 생성하고 정보를 삽입한다.
    var rtnObject =  new Object() ;
    var pDate  = date_.getFullYear().toString() + ((date_.getMonth() + 1) < 10 ? '0' + (date_.getMonth() + 1) : date_.getMonth() + 1) ;

    // 현재월 인 경우 lastday를 현재 시간으로 설정한다.
    if (pDate==yyyymmToday){
      rtnObject.yyyymm = pDate;
      rtnObject.lastday = d.getTime();
    } else {
      rtnObject.yyyymm = pDate;
      rtnObject.lastday = lastDayOfMonth(date_.getFullYear().toString(), (date_.getMonth() + 1));
    }

    monthArray.push(rtnObject);
    i++;
    strTermCnt--;

    // 현재 날짜 보다 미래 인 경우 break
    if (pDate==yyyymmToday){
      break;
    }
  }

  return monthArray;
};

// api 가 호출된 시점에서 당해년도의 month timewindow 배열을 리턴한다.
var monthIndexCurrent = function() {
  // 현재 날짜
  var d = new Date();
  var strM = 10 < d.getMonth() + 1 ? d.getMonth() + 1:'0' + (d.getMonth() + 1);
  return monthIndex(d.getFullYear().toString() + '01', d.getFullYear().toString() + strM);

}

// 두 파라미터 사이의 개월 수를 구한다.
var fn_calcDayMonthCount = function(from_month, to_month ) {

  var strSDT = new Date(from_month.substring(0, 4),from_month.substring(4, 6) - 1,'01');
  var strEDT = new Date(to_month.substring(0, 4),to_month.substring(4, 6) - 1,'01');
  var strTermCnt = 0;

  // 년도가 같으면 단순히 월을 마이너스 한다.
  if (to_month.substring(0, 4) == from_month.substring(0, 4)) {
    strTermCnt = to_month.substring(4, 6) * 1 - from_month.substring(4, 6) * 1;
  } else {
    strTermCnt = Math.round((strEDT.getTime()-strSDT.getTime())/(1000 * 60 * 60 * 24 * 365 / 12));
  }

  return strTermCnt;
}

// 현재 월의 마지막 날을 리턴한다.
var lastDayOfMonth = function(current_year, current_month){
  var d = new Date(current_year, current_month, 0);
  var lastd = d.getDate();
  var lastday = new Date(current_year, current_month - 1, lastd, 23, 59, 0);
  return lastday.getTime();
}

module.exports.monthIndex = monthIndex;
module.exports.monthIndexCurrent = monthIndexCurrent;
//  console.log(monthIndex('201610', '201610'));
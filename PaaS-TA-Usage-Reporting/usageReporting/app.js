var express = require('express');
var oauth = require('abacus-oauth');

var getOrgUsage = require('./getOrgUsage');
var getOrgMonthlyUsage = require('./getOrgMonthlyUsage');
var getAppMonthlyUsage = require('./getAppMonthlyUsage');

var app = express();
var timeUtil = require('./getTimeUtil');

// Use secure routes or not
var secured = process.env.SECURED === 'true';

// Abacus System Token Scope
var scope = 'abacus.usage.write abacus.usage.read';

// Token for app usage events
var cfAdminToken = oauth.cache(process.env.API,
  process.env.CF_CLIENT_ID, process.env.CF_CLIENT_SECRET);
  
// Token for reporting usage
var abacusToken = secured ? oauth.cache(process.env.AUTH_SERVER,
  process.env.CLIENT_ID, process.env.CLIENT_SECRET, scope) : undefined;

cfAdminToken.start();

if (secured)
  abacusToken.start();

app.set('port', process.env.PORT || 9507);

// COR 설정 (OPEN)
app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

app.get('/',function(req, res){
  res.type('text/plain');
  res.send('Main Page');
});

// API 01 : 현재시간 까지의  사용량
app.get('/v1/org/:org_id/space/:space_id', function(req, res){

  // org_id 파라미터를 입력하지 않은 경우, 400 error 리턴
  if (!req.params.org_id)
    return res.status(400).send(err.toString());

  getOrgUsage.getdata(cfAdminToken, abacusToken, req.params.org_id, req.params.space_id, function(err, str) {

    if (err)
      return res.status(500).send(err.toString());

    return res.status(200).send(str);
  });
});

// API 02 : 기간 별 월별 사용량 집계
app.get('/v1/org/:org_id/space/:space_id/from/:from_time/to/:to_month', function(req, res) {

  // 파라미터를 입력하지 않은 경우, 400 error 리턴
  if (!req.params.org_id || !req.params.space_id || !req.params.from_time || !req.params.to_month)
    return res.status(400).send('Param is wrong.');

  // yyyymm 형식이 아닌 경우
  if (req.params.from_time.length < 6 || req.params.to_month.length < 6 ){
    return res.status(400).send('Param must be YYYYMM.');
  }

  var monthIndex = timeUtil.monthIndex(req.params.from_time, req.params.to_month);

  getOrgMonthlyUsage.api002(cfAdminToken, abacusToken, req.params.org_id, req.params.space_id, monthIndex, function(err, str){

    if (err)
      return res.status(500).send(err.toString());

    return res.status(200).send(str);
  });
});

// API 03 : 당해년도 앱 단위 월별 사용량 집계
app.get('/v1/org/:org_id/space/:space_id/app/:app_id/from/:from_time/to/:to_month', function(req, res) {

  // 파라미터를 입력하지 않은 경우, 400 error 리턴
  if (!req.params.org_id || !req.params.space_id || !req.params.app_id)
    return res.status(400).send(err.toString());

  var monthIndex = timeUtil.monthIndex(req.params.from_time, req.params.to_month);

  getAppMonthlyUsage.api003(cfAdminToken, abacusToken, req.params.org_id, req.params.space_id, req.params.app_id, monthIndex, function(err, str) {

    if (err)
      return res.status(500).send(err.toString());

    return res.status(200).send(str);
  });
});

app.use(function(req, res){
  res.type('text/plain');
  res.status(404);
  res.send('404 not found');
});

app.listen(app.get('port'), function(){
  console.log( 'Express started in localhost:' + app.get('port') + ';pressCtrl-C to terminate.');
});

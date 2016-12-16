'use strict';

// Implemented in ES5 for now
/* eslint no-var: 0 */

var express = require('express');
var request = require('request');
var bodyParser = require('body-parser');
var cp = require('child_process');
var commander = require('commander');
var oauth = require('abacus-oauth');

// Create router
var routes = express.Router();

// Abacus Collector App's URL
var abacusCollectorUrl = process.env.COLLECTOR;

// Abacus System Token Scope
var scope = 'abacus.usage.write abacus.usage.read';

// COR
var accessControlAllowHeader = 'Origin,X-Requested-With,Content-Type,Accept';

// 하기 샘플 usage 에서는 1번의 api call 을 각각 light_api_calls 1000 call과
// heavy_api_calls 100 call 로 rating 한 것으로 가정하였다.
// 구현 하려는 서비스 정책에 맞게 변경한다.
var resourceId = 'object-storage';
var measure1 = 'storage';
var measure2 = 'light_api_calls';
var measure3 = 'heavy_api_calls';
var serviceKey = '[cloudfoundry]';

// OAuth bearer access token with Abacus system access scopes
var abacusToken = void 0;

// Secure the routes or not
var secured = function secured() {
  return process.env.SECURED === 'true' ? true : false;
};

// Take secured abacus request Header
var authHeader = function authHeader(token) {
  return token ? { authorization: token() } : {};
};

// abacus로 전송할 데이터 포맷을 만든다.
var buildAppUsage =
  function buildAppUsage(orgid, spaceid, appid, insid, planid, eventTime) {

    var appUsage = { usage: null };

    // sample api plan id가 'standard'
    if (planid == 'standard')
      appUsage = {
        usage: {
          start: eventTime,
          end: eventTime,
          organization_id: orgid,
          space_id: spaceid,
          consumer_id: 'app:' + appid,
          resource_id: resourceId,
          plan_id: planid,
          resource_instance_id: insid,
          measured_usage: [
            {
              measure: measure1,
              quantity: 1073741824
            },
            {
              measure: measure2,
              quantity: 1000
            },
            {
              measure: measure3,
              quantity: 0
            }
          ]
        }
      };

    return appUsage;
  };


// COR 설정 (OPEN)
routes.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', accessControlAllowHeader);
  next();
});

// to support JSON-encoded bodies
routes.use(bodyParser.json());

// to support URL-encoded bodies
routes.use(bodyParser.urlencoded({
  extended: true
}));

var resourceInstanceId = function(reqs) {
  return reqs.body.instance_id ? reqs.body.instance_id : reqs.body.consumer_id;
};

/*
 Sample API 'Plan1'
 1. Caller의 요청에 API 서비스를 처리 응답 (Sample에서는 생략)
 2. abacus에 api usage 전송
 */
routes.post('/plan1', function(req, res, next) {

  // Call Event 발생 시각
  var d = new Date();
  var eventTime = Date.parse(d);

  var orgid = req.body.organization_id;
  var spaceid = req.body.space_id;
  var instanceid = resourceInstanceId(req);
  var appid = req.body.consumer_id;
  var planid = req.body.plan_id;
  var credential = req.body.credential;

  // 실제 서비스로 리턴할 파라메타 정보
  // var inputs = req.body.inputs;

  // 암호가 일치 하지 않는 경우, 401 error 리턴
  if (credential.serviceKey != serviceKey)
    return res.status(401).send();

  // 파라미터를 입력하지 않은 경우, 400 error 리턴
  if (!orgid || !spaceid || !appid)
    return res.status(400).send();

  // abacus 컬렉터에 리포팅할 JSON 을 작성한다.
  var usage =
    buildAppUsage(orgid, spaceid, appid, instanceid, planid, eventTime);

  // Not Supported Service
  if (usage.usage === null) return res.status(400).send();

  // Set request options
  var options = {
    uri: abacusCollectorUrl,
    headers: authHeader(abacusToken),
    json: usage.usage
  };

  // api usage를 abacus에 전송
  request.post(options, function(error, response, body) {

    if (error) console.log(error);
    else if (response.statusCode === 201 || response.statusCode === 200) {
      // console.log('Successfully reported usage %j with headers %j',
      //   usage, response.headers);
      res.status(201).send(response.body);
      return;
    }
    else if (response.statusCode === 409) {
      // console.log('Conflicting usage %j. Response: %j',
      //   usage, response);
      res.sendStatus(409);
      return;
    }
    else {
      // console.log('failed report usage %j with headers %j',
      //   usage, response.headers);
      res.sendStatus(response.statusCode);
      return;
    }
  });
  return res;
});

var sampleApiService = function sampleApiService() {

  var app = express();

  // Cache and schedule the system token renewal
  if (secured()) {
    /*
     AUTH_SERVER:   Authorization Server URL used to get access token endpoint
                    in the format of https://hostname:port or just
                    https://hostname
     CLIENT_ID:     Client identifier registered with the specified
                    authorization server
     CLIENT_SECRET: Client secret used to authenticate the client identifier
                    with the authorization server
     SCOPE:         abacus system token scope
     */

    abacusToken = oauth.cache(process.env.AUTH_SERVER, process.env.CLIENT_ID,
      process.env.CLIENT_SECRET, scope);

    // abacus Token renewal
    abacusToken.start();
  };

  // Secure API Service routes using an OAuth bearer access token
  // if (secured())
  //   app.use(/^\/plan[0-9]/,
  //     oauth.validator(process.env.JWTKEY, process.env.JWTALGO));

  app.use(routes);

  return app;
};

// Set default port and host name, command line has higher priority then
// the existing env, then rc files
var conf = function conf() {
  process.env.PORT = commander.port || process.env.PORT || 9602;
};

// Command line interface
var runCLI = function runCLI() {

  commander
    .option('-p, --port <port>', 'port number [9602]')
    .option('start', 'start the server')
    .option('stop', 'stop the server')
    .parse(process.argv);

  // Start API server
  if (commander.start) {
    conf();

    // Create app and listen on the configured port
    var app = sampleApiService();

    app.listen({
      port: parseInt(process.env.PORT)
    });
  }
  else if (commander.stop)

    // Stop API App server
    cp.exec(
      'pkill -f "node ./sampleApiService"', function(err, stdout, stderr) {
        if (err) console.log('Stop error %o', err);
      });
};

// Export our public functions
module.exports = sampleApiService;
module.exports.runCLI = runCLI;

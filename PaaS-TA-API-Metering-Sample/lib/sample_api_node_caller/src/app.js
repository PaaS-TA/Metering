'use strict';

// Implemented in ES5 for now
/* eslint no-var: 0 */

var express = require('express');
var request = require('request');
var bodyParser = require('body-parser');
var cp = require('child_process');
var commander = require('commander');
var handlebars = require('express-handlebars').create({ defaultLayout:'main' });

// COR
var accessControlAllowHeader = 'Origin,X-Requested-With,Content-Type,Accept';

var vcapApp = undefined;
var vcapService = undefined;
var dummyOrgId = undefined;
var vcapBindServices = undefined;

var vcapAppSample = {
  'limits': {
    'fds': 16384,
    'mem': 512,
    'disk': 512
  },
  'application_name': 'sample-api-node-caller',
  'application_uris': [
    'sample-api-node-caller.bosh-lite.com'
  ],
  'name': 'sample-api-node-caller',
  'space_name': 'test',
  'space_id': '7b85dc3f-85f0-40bc-8532-0dabd0bc7bae',
  'uris': [
    'sample-api-node-caller.bosh-lite.com'
  ],
  'users': null,
  'version': '0a28ea02-b701-40c5-b589-b951d326ebb2',
  'application_version': '0a28ea02-b701-40c5-b589-b951d326ebb2',
  'application_id': '9272d372-2cda-4f8e-a0fc-6b34a903c037',
  'instance_id': 'd8a3a96c34c04f00b90591f1e0db3ca6',
  'instance_index': 0,
  'host': '0.0.0.0',
  'port': 61066,
  'started_at': '2016-09-2709: 10: 41+0000',
  'started_at_timestamp': 1474967441,
  'start': '2016-09-2709: 10: 41+0000',
  'state_timestamp': 1474967441
};

var vcapServiceSample = {
  'sample_api_node_service': [
    {
      'name': 'test-service',
      'label': 'sample_api_node_service',
      'tags': [
        'SampleAPIService'
      ],
      'plan': 'standard',
      'credentials': {
        'serviceKey': '[cloudfoundry]',
        'url': 'http://sample-api-node-service.bosh-lite.com/plan1',
        'documentUrl': 'http://sample-api-node-service.bosh-lite.com/doc'
      },
      'syslog_drain_url': 'PASTA_SERVICE_METERING'
    }
  ]
};


// 로컬 실행일 경우 or CF 상 실행
if (process.env.VCAP_APPLICATION) {
  vcapApp = JSON.parse(process.env.VCAP_APPLICATION);
  vcapService = JSON.parse(process.env.VCAP_SERVICES);
  dummyOrgId = process.env.ORG_ID;
}
else {
  vcapApp = vcapAppSample;
  vcapService = vcapServiceSample;
  dummyOrgId = 'sample_api_node_caller_org_dummy_guid';
}

// VCAP_SERVICE에서 바인한 특정 서비스를 가져온다.
vcapBindServices = vcapService[Object.keys(vcapService)[0]];

// 서비스로 보낼 데이타를 작성한다.
var buildSendData = function buildSendData(args, bindApiService) {

  return {
    organization_id: dummyOrgId,
    space_id: vcapApp.space_id,
    consumer_id: vcapApp.application_id,
    instance_id: vcapApp.instance_id ?
      vcapApp.instance_id : vcapApp.application_id,
    plan_id: bindApiService.plan,
    credential: bindApiService.credentials,
    inputs: args
  };
};

var sampleApiCaller = function sampleApiCaller() {

  var app = express();

  app.engine('handlebars', handlebars.engine);
  app.set('view engine', 'handlebars');

  // COR 설정 (OPEN)
  app.use(function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', accessControlAllowHeader);
    next();
  });

  // mount web Service dependencies
  app.use('/bower_components',
    express.static(__dirname + '/bower_components'));

  // mount web Main page
  app.get('/', function(req, res) {
    res.type('text/html');
    res.render('apiCaller');
  });

  // to support JSON-encoded bodies
  app.use(bodyParser.json());

  // to support URL-encoded bodies
  app.use(bodyParser.urlencoded({
    extended: true
  }));

  /*
   Sample Web Service
   1. API 서비스를 요청
   */
  app.post('/sampleApiSerivceCall', function(req, res, next) {

    // Bind 정보가 없는 경우
    if (typeof vcapBindServices !== 'object') {
      return res.status(502).send('unbind service called');
      next();
    };

    // API Service와 연동 할 서비스를 구한다.
    var bindApiService = vcapBindServices[0];

    // get API Service url
    var serviceUrl = bindApiService.credentials.uri ?
      bindApiService.credentials.uri : bindApiService.credentials.url;

    // API Service에 요청 할 JSON 을 작성한다.
    var callEvent = buildSendData(req.body, bindApiService);

    // Set request options
    var options = {
      uri: serviceUrl,
      json: callEvent
    };

    // api Service에 요청하고 결과를 응답한다.
    request.post(options, function(error, response, body) {

      if (error) console.log(error);
      else if (response.statusCode === 201 || response.statusCode === 200) {
        // console.log('Successfully reported usage %j with headers %j',
        //   usage, response.headers);
        res.status(201).send(response.body);
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

  // Not found
  app.use(function(req, res) {
    res.type('text/plain');
    res.status(404);
    res.send('404 not found');
  });

  return app;
};

// Set default port and host name, command line has higher priority then
// the existing env, then rc files
var conf = function conf() {
  process.env.PORT = commander.port || process.env.PORT || 9601;
};

// Command line interface
var runCLI = function runCLI() {

  commander
    .option('-p, --port <port>', 'port number [9601]')
    .option('start', 'start the server')
    .option('stop', 'stop the server')
    .parse(process.argv);

  // Start Caller server
  if (commander.start) {
    conf();

    // Create app and listen on the configured port
    var app = sampleApiCaller();

    app.listen({
      port: parseInt(process.env.PORT)
    });
  }
  else if (commander.stop)

  // Stop Caller App server
    cp.exec(
      'pkill -f "node ./sampleApiCaller"', function(err, stdout, stderr) {
        if (err) console.log('Stop error %o', err);
      });
};

// Export our public functions
module.exports = sampleApiCaller;
module.exports.runCLI = runCLI;

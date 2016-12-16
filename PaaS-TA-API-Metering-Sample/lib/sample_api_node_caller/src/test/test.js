'use strict';

// Implemented in ES5 for now
/* eslint no-var: 0 */
/* eslint-disable camelcase */
/* eslint handle-callback-err: 1 */

var _ = require('underscore');
var request = require('request');
var extend = _.extend;

// Mock the request module
var getspy = void 0,
  postspy = void 0;

var reqmock = extend({}, request, {
  post: function post(reqs, cb) {
    return postspy(reqs, cb);
  },
  get: function get(reqs, cb) {
    return getspy(reqs, cb);
  }
});

require.cache[require.resolve('request')].exports = reqmock;

describe('sample-api-node-Coller', function() {

  var apiCaller = void 0;
  var server = void 0;

  var vcapServices = {
    'standard_obejct_storage_light_api_calls': [
      {
        'credentials': {
          'serviceKey': '[cloudfoundry]',
          'url': 'http://localhost:9602/plan1'
        },
        'label': 'standard_obejct_storage_light_api_calls',
        'name': 'sampleNodejslightCallApi',
        'plan': 'standard',
        'provider': null,
        'syslog_drain_url': 'PASTA_SAMPLE_API',
        'tags': [
          'Sample API Service'
        ],
        'volume_mounts': []
      }]
  };

  var vcaApplication = {
    'application_id': 'ff7476f9-f5b6-420c-96f0-ac39be43de8c',
    'application_name': 'sample-api-node-caller',
    'application_uris': [
      'sample-api-node-caller.bosh-lite.com'
    ],
    'application_version': '2e769349-e86e-457d-ae66-f22d04497c6b',
    'limits': {
      'disk': 512,
      'fds': 16384,
      'mem': 512
    },
    'name': 'sample-api-node-caller',
    'space_id': 'ab63eaed-7932-4f24-804d-dccb40a68752',
    'space_name': 'dev',
    'uris': [
      'sample-api-node-caller.bosh-lite.com'
    ],
    'users': null,
    'version': '2e769349-e86e-457d-ae66-f22d04497c6b'
  };

  var expectedEventData = void 0;

  beforeEach(function() {
    process.env.VCAP_APPLICATION = JSON.stringify(vcaApplication);
    process.env.ORG_ID = 'd6ce3670-ab9c-4453-b993-f2821f54846b';

    expectedEventData = {
      organization_id: 'd6ce3670-ab9c-4453-b993-f2821f54846b',
      space_id: 'ab63eaed-7932-4f24-804d-dccb40a68752',
      consumer_id: 'ff7476f9-f5b6-420c-96f0-ac39be43de8c',
      instance_id: 'ff7476f9-f5b6-420c-96f0-ac39be43de8c',
      plan_id: 'standard',
      credential: {
        'serviceKey': '[cloudfoundry]',
        'url': 'http://localhost:9602/plan1'
      },
      inputs: {
        key1: 'val1',
        key2: 'val2'
      }
    };
  });

  afterEach(function() {

    // clean Cached Data
    delete require.cache[require.resolve('../app.js')];

    apiCaller = undefined;
    server = undefined;

    delete process.env.VCAP_SERVICES;
    delete process.env.VCAP_APPLICATION;
    delete process.env.ORG_ID;
  });

  it('provides a local caller web service', function(done) {

    process.env.VCAP_SERVICES = JSON.stringify(vcapServices);
    apiCaller = require('../app.js');

    // Create a test sample Call Service app
    var app = apiCaller();

    // Listen on an ephemeral port
    server = app.listen(0);

    // set request url
    var base_url = 'http://localhost:' + server.address().port;

    request.get(base_url, function(err, response, body) {
      expect(err).to.equal(null);
      expect(response.statusCode).to.equal(200);

      done();
    });
  });

  it('bad request', function(done) {

    process.env.VCAP_SERVICES = JSON.stringify(vcapServices);
    apiCaller = require('../app.js');

    // Create a test sample Call Service app
    var app = apiCaller();

    // Listen on an ephemeral port
    server = app.listen(0);

    // set request url
    var base_url = 'http://localhost:' + server.address().port + '/test';

    request.get(base_url, function(err, response, body) {
      expect(err).to.equal(null);
      expect(response.statusCode).to.equal(404);

      done();
    });
  });

  it('Call API Service is success', function(done) {

    process.env.VCAP_SERVICES = JSON.stringify(vcapServices);
    apiCaller = require('../app.js');

    var agrs = {
      key1: 'val1',
      key2: 'val2'
    };

    // Create a test sample Call Service app
    var app = apiCaller();

    // Listen on an ephemeral port
    server = app.listen(0);

    // Handle callback checks
    var checks = 0;
    var check = function check() {
      if (++checks == 2) done();
    };

    postspy = function postspy(reqs, cb) {
      // Expect usage to be posted to the api service
      expect(reqs.uri).to.equal('http://localhost:9602/plan1');
      expect(reqs.json).to.deep.equal(expectedEventData);

      // api service return 200
      cb(null, { statusCode: 201 });

      check();
    };

    var base_url = 'http://localhost:' + server.address().port
      + '/sampleApiSerivceCall';
    // Set request options
    var options = {
      uri: base_url,
      method: 'POST',
      json: agrs
    };

    // Post usage for a resource, expecting a 201 response
    request.post(options, function(err, res, body) {
      expect(err).to.equal(null);
      expect(res.statusCode).to.equal(201);

      check();
    });
  });

  it('Call API Service is fail', function(done) {

    process.env.VCAP_SERVICES = JSON.stringify(vcapServices);

    expectedEventData.inputs = {};

    apiCaller = require('../app.js');

    // Create a test sample Call Service app
    var app = apiCaller();

    // Listen on an ephemeral port
    server = app.listen(0);

    // Handle callback checks
    var checks = 0;
    var check = function check() {
      if (++checks == 2) done();
    };

    postspy = function postspy(reqs, cb) {
      // Expect usage to be posted to the api service
      expect(reqs.uri).to.equal('http://localhost:9602/plan1');
      expect(reqs.json).to.deep.equal(expectedEventData);

      // api service return 502
      cb(null, { statusCode: 502 });
      check();
    };

    var base_url = 'http://localhost:' + server.address().port
      + '/sampleApiSerivceCall';
    // Set request options
    var options = {
      uri: base_url,
      method: 'POST',
      json: undefined
    };

    // Post usage for a resource, expecting a 502 response
    request.post(options, function(err, res, body) {
      expect(err).to.equal(null);
      expect(res.statusCode).to.equal(502);

      check();
    });
  });

  it('Unbinded service call', function(done) {

    // unset vcap_services
    process.env.VCAP_SERVICES = JSON.stringify({});
    apiCaller = require('../app.js');

    // Create a test sample Call Service app
    var app = apiCaller();

    // Listen on an ephemeral port
    server = app.listen(0);

    var base_url = 'http://localhost:' + server.address().port
      + '/sampleApiSerivceCall';
    // Set request options
    var options = {
      uri: base_url,
      method: 'POST',
      json: undefined
    };

    // Post usage for a resource, expecting a 502 response
    request.post(options, function(err, res, body) {
      expect(err).to.equal(null);
      expect(res.statusCode).to.equal(502);
      expect(res.body).to.equal('unbind service called');

      done();
    });
  });
});

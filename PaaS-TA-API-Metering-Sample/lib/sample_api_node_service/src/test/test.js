'use strict';

// Implemented in ES5 for now
/* eslint no-var: 0 */

var _ = require('underscore');
var request = require('request');
var oauth = require('abacus-oauth');

var extend = _.extend;
var omit = _.omit;

// Configure API and COLLECTOR URLs
process.env.COLLECTOR = 'http://localhost:9200/v1/metering/metered/usage';

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

// Mock the oauth module with a spy
var validatorspy = void 0,
  authorizespy = void 0,
  cachespy = void 0;
var oauthmock = extend({}, oauth, {
  validator: function validator() {
    return function(req, res, next) {
      return validatorspy(req, res, next);
    };
  },
  authorize: function authorize(auth, escope) {
    return authorizespy(auth, escope);
  },
  cache: function cache() {
    return cachespy();
  }
});

require.cache[require.resolve('abacus-oauth')].exports = oauthmock;

describe('sample-api-node-service', function() {

  var apiService = void 0;
  var server = void 0;
  var callEvent = void 0;

  beforeEach(function() {
    apiService = require('../app.js');

    callEvent = {
      organization_id: 'e8139b76-e829-4af3-b332-87316b1c0a6c',
      space_id: 'a7e44fcd-25bf-4023-8a87-03fba4882995',
      consumer_id: '35c4ff2f1',
      instance_id: '35c4ff2f2',
      plan_id: 'standard',
      credential: { serviceKey: '[cloudfoundry]' },
      inputs: {
        input_param1: 'value1',
        input_param2: 'value2'
      }
    };
  });

  afterEach(function() {

    // clean Cached Data
    delete require.cache[require.resolve('../app.js')];

    process.env.SECURED = false;
    apiService = undefined;
    server = undefined;
    callEvent = undefined;
  });

  it('Send API usage data to Abacus', function(done) {

    var verify = function verify(secured, done) {

      var expectedUsage = {
        organization_id: 'e8139b76-e829-4af3-b332-87316b1c0a6c',
        space_id: 'a7e44fcd-25bf-4023-8a87-03fba4882995',
        consumer_id: 'app:35c4ff2f1',
        resource_id: 'object-storage',
        plan_id: 'standard',
        resource_instance_id: '35c4ff2f2',
        measured_usage: [{
          measure: 'storage',
          quantity: 1073741824
        }, {
          measure: 'light_api_calls',
          quantity: 1000
        }, {
          measure: 'heavy_api_calls',
          quantity: 0
        }]
      };

      // Set the SECURED environment variable
      process.env.SECURED = secured ? 'true' : 'false';

      cachespy = spy(function() {
        var f = function f() {
          return 'bearer OVNTKTvu-yHI6QXmYxtPeJZofNddX36Mx1q4PDWuYQE';
        };
        f.start = function() {
          return undefined;
        };
        return f;
      });

      // Create a test sample API Service app
      var app = apiService();

      // Listen on an ephemeral port
      server = app.listen(0);

      // Handle callback checks
      var checks = 0;
      var check = function check() {
        if (++checks == 2) done();
      };

      postspy = function postspy(reqs, cb) {
        // Expect usage to be posted to the meter service
        expect(reqs.uri).to.equal(
          'http://localhost:9200/v1/metering/metered/usage');
        expect(omit(reqs.json, 'start', 'end')).to.deep.equal(expectedUsage);
        expect(reqs.headers).to.deep.equal(secured ? {
          authorization: 'bearer OVNTKTvu-yHI6QXmYxtPeJZofNddX36Mx1q4PDWuYQE'
        } : {});

        cb(null, { statusCode: 201 });

        check();
      };

      validatorspy = spy(function(req, res, next) {
        return next();
      });
      authorizespy = spy(function() {});

      // Set request options
      var options = {
        uri: 'http://localhost:' + server.address().port + '/plan1',
        method: 'POST',
        json: callEvent
      };

      // Post usage for a resource, expecting a 201 response
      request.post(options, function(err, res, body) {
        expect(err).to.equal(null);
        expect(res.statusCode).to.equal(201);
        expect(cachespy.callCount).to.equal(secured ? 1 : 0);

        check();
      });
    };

    // Verify without and with security
    verify(false, function() {
      return verify(true, done);
    });
  });

  it('Missing metering parameter', function(done) {

    callEvent.organization_id = undefined;

    // Create a test sample API Service app
    var app = apiService();

    // Listen on an ephemeral port
    server = app.listen(0);

    // Set request options
    var options = {
      uri: 'http://localhost:' + server.address().port + '/plan1',
      method: 'POST',
      json: callEvent
    };

    // Post usage for a resource, expecting a 201 response
    request.post(options, function(err, res, body) {
      expect(err).to.equal(null);
      expect(res.statusCode).to.equal(400);

      done();
    });

  });

  it('Not serviced plan', function(done) {

    callEvent.plan_id = 'test';

    // Create a test sample API Service app
    var app = apiService();

    // Listen on an ephemeral port
    server = app.listen(0);

    // Set request options
    var options = {
      uri: 'http://localhost:' + server.address().port + '/plan1',
      method: 'POST',
      json: callEvent
    };

    // Post usage for a resource, expecting a 201 response
    request.post(options, function(err, res, body) {
      expect(err).to.equal(null);
      expect(res.statusCode).to.equal(400);

      done();
    });

  });

  it('Missing credentials', function(done) {

    // Set credential is null
    callEvent.credential = { };

    // Create a test sample API Service app
    var app = apiService();

    // Listen on an ephemeral port
    server = app.listen(0);

    // Set request options
    var options = {
      uri: 'http://localhost:' + server.address().port + '/plan1',
      method: 'POST',
      json: callEvent
    };

    // Post usage for a resource, expecting a 201 response
    request.post(options, function(err, res, body) {
      expect(err).to.equal(null);
      expect(res.statusCode).to.equal(401);

      done();
    });

  });

  it('Send duplicated data to Abacus', function(done) {

    // Handle callback checks
    var checks = 0;
    var check = function check() {
      if (++checks == 2) done();
    };

    postspy = function postspy(reqs, cb) {

      cb(null, { statusCode: 409 });

      check();
    };

    // Create a test sample API Service app
    var app = apiService();

    // Listen on an ephemeral port
    server = app.listen(0);

    // Set request options
    var options = {
      uri: 'http://localhost:' + server.address().port + '/plan1',
      method: 'POST',
      json: callEvent
    };

    // Post usage for a resource, expecting a 201 response
    request.post(options, function(err, res, body) {
      expect(err).to.equal(null);
      expect(res.statusCode).to.equal(409);

      check();
    });
  });

  it('Abacus is not serviced', function(done) {

    // Handle callback checks
    var checks = 0;
    var check = function check() {
      if (++checks == 2) done();
    };

    postspy = function postspy(reqs, cb) {

      cb(null, { statusCode: 500 });

      check();
    };

    // Create a test sample API Service app
    var app = apiService();

    // Listen on an ephemeral port
    server = app.listen(0);

    // Set request options
    var options = {
      uri: 'http://localhost:' + server.address().port + '/plan1',
      method: 'POST',
      json: callEvent
    };

    // Post usage for a resource, expecting a 201 response
    request.post(options, function(err, res, body) {
      expect(err).to.equal(null);
      expect(res.statusCode).to.equal(500);

      check();
    });
  });
});

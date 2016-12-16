/*
'use strict';

// Usage reporting service.

var _ = require('underscore');
var request = require('abacus-request');
var batch = require('abacus-batch');
var cluster = require('abacus-cluster');
var oauth = require('abacus-oauth');
var dataflow = require('abacus-dataflow');
var yieldable = require('abacus-yieldable');
var dbclient = require('abacus-dbclient');

var map = _.map;
var extend = _.extend;

var brequest = batch(request);

/!* eslint quotes: 1 *!/

// Configure test db URL prefix
process.env.DB = process.env.DB || 'test';

// Mock the request module
var getspy = function getspy(reqs, cb) {
    // Expect a call to account
    expect(reqs[0][0]).to.equal('http://localhost:9881/v1/organizations/:org_id/account/:time');

    cb(undefined, map(reqs, function(req) {
        return [undefined, {
            statusCode: /unauthorized/.test(req[1].org_id || req[1].account_id) ? 401 : 200
        }];
    }));
};

var reqmock = extend({}, request, {
    batch_get: function batch_get(reqs, cb) {
        return getspy(reqs, cb);
    }
});
require.cache[require.resolve('abacus-request')].exports = reqmock;

// Mock the cluster module
require.cache[require.resolve('abacus-cluster')].exports = extend(function(app) {
    return app;
}, cluster);

// Mock the oauth module with a spy
var validatorspy = spy(function(req, res, next) {
    return next();
});
var cachespy = spy(function() {
    var f = function f() {
        return undefined;
    };
    f.start = function() {
        return undefined;
    };
    return f;
});
var oauthmock = extend({}, oauth, {
    validator: function validator() {
        return validatorspy;
    },
    cache: function cache() {
        return cachespy();
    }
});
require.cache[require.resolve('abacus-oauth')].exports = oauthmock;

var buildWindow = function buildWindow(qDay, qMonth, s, cDay, cMonth, ch) {
    var windows = [[null], [null], [null], [{}, null], [{}, null]];
    var setWindowProperty = function setWindowProperty(k, vDay, vMonth) {
        if (typeof vDay !== 'undefined' && typeof vMonth !== 'undefined') {
            windows[3][0][k] = vDay;
            windows[4][0][k] = vMonth;
        }
    };
    setWindowProperty('quantity', qDay, qMonth);
    setWindowProperty('summary', s, s);
    setWindowProperty('cost', cDay, cMonth);
    setWindowProperty('charge', ch, ch);
    return windows;
};

var report = require('..');

var storeAccumulatedUsage = function storeAccumulatedUsage(accUsage) {
    var cb = arguments.length <= 1 || arguments[1] === undefined ? function() {} : arguments[1];

    var accumulatordb = dataflow.db('abacus-accumulator-accumulated-usage');
    yieldable.functioncb(accumulatordb.put)(extend({}, accUsage, {
        _id: accUsage.id
    }), function(err, val) {
        expect(err).to.equal(null);
        cb();
    });
};

var storeRatedUsage = function storeRatedUsage(ratedUsage) {
    var cb = arguments.length <= 1 || arguments[1] === undefined ? function() {} : arguments[1];

    var aggregatordb = dataflow.db('abacus-aggregator-aggregated-usage');
    yieldable.functioncb(aggregatordb.put)(extend({}, ratedUsage, {
        _id: ratedUsage.id
    }), function(err, val) {
        expect(err).to.equal(null);
        cb();
    });
};

// Org id
var oid = 'a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27';
// Space id
var sid = 'aaeae239-f3f8-483c-9dd0-de5d41c38b6a';
// One of the two consumers at a given org based on plan id.
var cid = function cid(p) {
    return p !== 'standard' ? 'UNKNOWN' : 'external:bbeae239-f3f8-483c-9dd0-de6781c38bab';
};
// construct consumer doc id
var cdid = function cdid(orgid, sid, cid, t) {
    return ['k', orgid, sid, cid, 't', t].join('/');
};
// the metering plan id
var mpid = 'test-metering-plan';
// the rating plan id
var rpid = function rpid(p) {
    return p !== 'standard' ? 'test-rating-plan' : 'test-rating-plan-standard';
};
// the pricing plan id
var ppid = function ppid(p) {
    return p !== 'standard' ? 'test-pricing-basic' : 'test-pricing-standard';
};
// the plan id
var pid = function pid(p, mpid, rpid, ppid) {
    return [p, mpid, rpid, ppid].join('/');
};

// accumulated usage id
var accid = 'k/a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27/' + '0b39fa70-a65f-4183-bae8-385633ca5c87/UNKNOWN/basic/' + 'test-metering-plan/test-rating-plan/' + 'test-pricing-basic/t/0001446418800000';

// resource_instance_id
var rid = '0b39fa70-a65f-4183-bae8-385633ca5c87';

// cost -> cost for memory
var buildAggregatedUsage = function buildAggregatedUsage(s, l, h, md, mm, sc, lc, hc, mc, ms, mch, summary, cost, charge) {
    return [{
        metric: 'storage',
        windows: buildWindow(s, s, summary && s, cost && sc, cost && sc, charge && sc)
    }, {
        metric: 'thousand_light_api_calls',
        windows: buildWindow(l, l, summary && l, cost && lc, cost && lc, charge && lc)
    }, {
        metric: 'heavy_api_calls',
        windows: buildWindow(h, h, summary && h, cost && hc, cost && hc, charge && hc)
    }, {
        metric: 'memory',
        windows: buildWindow(md, mm, summary && ms, cost && extend({}, md, mc), cost && extend({}, mm, mc), mch)
    }];
};

var planTemplate = function planTemplate(plan) {
    return {
        plan_id: plan || 'basic',
        metering_plan_id: mpid,
        rating_plan_id: rpid(plan),
        pricing_plan_id: ppid(plan)
    };
};

var buildPlanUsage = function buildPlanUsage(plan, planUsage) {
    return extend(planTemplate(plan), {
        plan_id: pid(plan || 'basic', mpid, rpid(plan), ppid(plan)),
        aggregated_usage: planUsage
    });
};

var ratedConsumerTemplate = function ratedConsumerTemplate(orgid, start, end, plan, a, p, processed, coid) {
    return {
        id: cdid(orgid, sid, coid || cid(plan), processed),
        consumer_id: coid || cid(plan),
        organization_id: orgid,
        resource_instance_id: 'rid',
        start: start,
        end: end,
        processed: processed,
        resources: [{
            resource_id: 'test-resource',
            aggregated_usage: a,
            plans: p
        }]
    };
};

var consumerReferenceTemplate = function consumerReferenceTemplate(orgid, sid, plan, processed, conid) {
    return {
        id: conid || cid(plan),
        t: processed + ''
    };
};

var buildSpaceUsage = function buildSpaceUsage(a, p, c) {
    return [{
        space_id: sid,
        resources: [{
            resource_id: 'test-resource',
            aggregated_usage: a,
            plans: p
        }],
        consumers: c
    }];
};

var buildResourceUsage = function buildResourceUsage(a, p) {
    return [{
        resource_id: 'test-resource',
        aggregated_usage: a,
        plans: p
    }];
};

var ratedTemplate = function ratedTemplate(id, orgid, start, end, processed, a, p, c) {
    return {
        id: id,
        organization_id: orgid,
        account_id: '1234',
        resource_instance_id: 'rid',
        consumer_id: 'cid',
        start: start,
        end: end,
        resource_id: 'test-resource',
        plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
        pricing_country: 'USA',
        prices: {
            metrics: [{ name: 'heavy_api_calls', price: 0.15 }, { name: 'light_api_calls', price: 0.03 }, { name: 'storage', price: 1 }]
        },
        processed: processed,
        resources: buildResourceUsage(a, p),
        spaces: buildSpaceUsage(a, p, c)
    };
};

var planReportTemplate = function planReportTemplate(plan, planUsage, planWindow) {
    return extend(buildPlanUsage(plan, planUsage), { windows: planWindow });
};

var consumerReportTemplate = function consumerReportTemplate(plan, a, p, planWindow) {
    return {
        consumer_id: cid(plan),
        windows: planWindow,
        resources: [{
            resource_id: 'test-resource',
            windows: planWindow,
            aggregated_usage: a,
            plans: p
        }]
    };
};

var spaceReportTemplate = function spaceReportTemplate(tw, au, plans, consumers) {
    return [{
        space_id: sid,
        windows: tw,
        resources: [{
            resource_id: 'test-resource',
            windows: tw,
            aggregated_usage: au,
            plans: plans
        }],
        consumers: consumers
    }];
};

var reportTemplate = function reportTemplate(id, tw, au, plans, consumers) {
    return {
        id: id,
        organization_id: oid,
        account_id: '1234',
        start: 1420502400000,
        end: 1420502500000,
        processed: 1420502500000,
        windows: tw,
        resources: [{
            resource_id: 'test-resource',
            windows: tw,
            aggregated_usage: au,
            plans: plans
        }],
        spaces: spaceReportTemplate(tw, au, plans, consumers)
    };
};

var buildAccumulatedUsage = function buildAccumulatedUsage(s, l, h, sc, lc, hc, summary, cost, charge) {
    return [{
        metric: 'storage',
        windows: buildWindow(s, s, summary && s, cost && sc, cost && sc, charge && sc)
    }, {
        metric: 'thousand_light_api_calls',
        windows: buildWindow(l, l, summary && l, cost && lc, cost && lc, charge && lc)
    }, {
        metric: 'heavy_api_calls',
        windows: buildWindow(h, h, summary && h, cost && hc, cost && hc, charge && hc)
    }];
};

var accumulatedTemplate = function accumulatedTemplate(acc) {
    return extend(planTemplate(), {
        id: accid,
        organization_id: oid,
        space_id: sid,
        resource_id: 'test-resource',
        consumer_id: 'UNKNOWN',
        resource_instance_id: rid,
        start: 1446415200000,
        end: 1446415200000,
        processed: 1446418800000,
        accumulated_usage: acc
    });
};

describe('abacus-usage-report', function() {
    before(function(done) {
        // Delete test dbs on the configured db server
        dbclient.drop(process.env.DB, /^abacus-aggregator|^abacus-accumulator/, done);
    });

    // Convenient test case:
    // Space A, consumer A, plan basic basic/basic/basic
    var planAUsage = buildAggregatedUsage(1, 100, 300, {
        consumed: 475200000,
        consuming: 6
    }, {
        consumed: 10843200000,
        consuming: 6
    }, 1, 3, 45, { price: 0.00014 }, undefined, undefined, undefined, true);

    // Space A, consumer B, plan standard/basic/standard/standard
    var planBUsage = buildAggregatedUsage(20, 200, 3000, {
        consumed: 633600000,
        consuming: 8
    }, {
        consumed: 14457600000,
        consuming: 8
    }, 10, 8, 540, { price: 0.00028 }, undefined, undefined, undefined, true);

    context('when rated usage contains small numbers', function() {
        before(function(done) {
            // Doc id
            var id = 'k/a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27/t/0001420502400000';
            var orgid = 'a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27';

            var rated = ratedTemplate(id, oid, 1420502400000, 1420502500000, 1420502500000, buildAggregatedUsage(21, 300, 3300, {
                consumed: 1108800000,
                consuming: 14
            }, {
                consumed: 25300800000,
                consuming: 14
            }), [buildPlanUsage('basic', planAUsage), buildPlanUsage('standard', planBUsage)], [consumerReferenceTemplate(orgid, sid, 'basic', 1420502500000, 'UNKNOWN'), consumerReferenceTemplate(orgid, sid, 'standard', 1420502500000, 'external:bbeae239-f3f8-483c-9dd0-de6781c38bab')]);

            var consumer1 = ratedConsumerTemplate(orgid, 1420502400000, 1420502500000, 'basic', buildAggregatedUsage(1, 100, 300, {
                consumed: 475200000,
                consuming: 6
            }, {
                consumed: 10843200000,
                consuming: 6
            }), [buildPlanUsage('basic', planAUsage)], 1420502500000);

            var consumer2 = ratedConsumerTemplate(orgid, 1420502400000, 1420502500000, 'standard', buildAggregatedUsage(20, 200, 3000, {
                consumed: 633600000,
                consuming: 8
            }, {
                consumed: 14457600000,
                consuming: 8
            }), [buildPlanUsage('standard', planBUsage)], 1420502500000);

            storeRatedUsage(rated, function() {
                return storeRatedUsage(consumer1, function() {
                    return storeRatedUsage(consumer2, done);
                });
            });
        });

        it('retrieves rated usage for an organization', function(done) {
            // Define the expected usage report
            var planAReport = planReportTemplate('basic', buildAggregatedUsage(1, 100, 300, {
                consumed: 475200000,
                consuming: 6
            }, {
                consumed: 10843200000,
                consuming: 6
            }, 1, 3, 45, { price: 0.00014 }, 114, 0.01596, true, true, true), buildWindow(undefined, undefined, undefined, undefined, undefined, 49.01596));
            var planBReport = planReportTemplate('standard', buildAggregatedUsage(20, 200, 3000, {
                consumed: 633600000,
                consuming: 8
            }, {
                consumed: 14457600000,
                consuming: 8
            }, 10, 8, 540, { price: 0.00028 }, 152, 0.04256, true, true, true), buildWindow(undefined, undefined, undefined, undefined, undefined, 558.04256));

            var consumer1 = consumerReportTemplate('basic', buildAggregatedUsage(undefined, undefined, undefined, undefined, undefined, 1, 3, 45, undefined, undefined, 0.01596, undefined, undefined, true), [planAReport], buildWindow(undefined, undefined, undefined, undefined, undefined, 49.01596));
            var consumer2 = consumerReportTemplate('standard', buildAggregatedUsage(undefined, undefined, undefined, undefined, undefined, 10, 8, 540, undefined, undefined, 0.04256, undefined, undefined, true), [planBReport], buildWindow(undefined, undefined, undefined, undefined, undefined, 558.04256));

            var id = 'k/a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27/t/0001420502400000';

            var expected = reportTemplate(id, buildWindow(undefined, undefined, undefined, undefined, undefined, 607.05852), buildAggregatedUsage(undefined, undefined, undefined, undefined, undefined, 11, 11, 585, undefined, undefined, 0.05852, undefined, undefined, true), [planAReport, planBReport], [consumer1, consumer2]);

            var verify = function verify(secured, done) {
                process.env.SECURED = secured ? 'true' : 'false';
                validatorspy.reset();

                // Create a test report app
                var app = report();

                // Listen on an ephemeral port
                var server = app.listen(0);

                var cbs = 0;
                var cb = function cb() {
                    if (++cbs === 2) {
                        // Check oauth validator spy
                        expect(validatorspy.callCount).to.equal(secured ? 2 : 0);

                        done();
                    }
                };

                // Get the rated usage
                request.get('http://localhost::p/v1/metering/organizations/' + ':organization_id/aggregated/usage/:time', {
                    p: server.address().port,
                    organization_id: oid,
                    time: 1420574400000
                }, function(err, val) {
                    expect(err).to.equal(undefined);

                    // Expect our test rated usage
                    expect(val.statusCode).to.equal(200);
                    expect(val.body).to.deep.equal(expected);
                    cb();
                });

                // Attempt to get the rated usage for a time in the next month
                request.get('http://localhost::p/v1/metering/organizations/' + ':organization_id/aggregated/usage/:time', {
                    p: server.address().port,
                    organization_id: oid,
                    time: 1422921800000
                }, function(err, val) {
                    expect(err).to.equal(undefined);

                    // Expect an empty usage report for the month
                    expect(val.statusCode).to.equal(200);
                    expect(val.body).to.deep.equal({
                        id: 'k/a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27/t/0001422921800000',
                        organization_id: oid,
                        start: 1422748800000,
                        end: 1422921800000,
                        resources: [],
                        spaces: []
                    });
                    cb();
                });
            };

            // Verify using an unsecured server and then verify using a secured server
            verify(false, function() {
                return verify(true, done);
            });
        });

        it('queries rated usage for an organization', function(done) {

            // Define a GraphQL query and the corresponding expected result
            var query = '{ organization(organization_id: ' + '"a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27", time: 1420574400000) { ' + 'organization_id, windows { charge }, resources { resource_id, ' + 'aggregated_usage { metric, windows { charge } }}}}';

            var expected = {
                organization: {
                    organization_id: 'a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27',
                    windows: buildWindow(undefined, undefined, undefined, undefined, undefined, 607.05852),
                    resources: [{
                        resource_id: 'test-resource',
                        aggregated_usage: buildAggregatedUsage(undefined, undefined, undefined, undefined, undefined, 11, 11, 585, undefined, undefined, 0.05852, undefined, undefined, true)
                    }]
                }
            };

            var verify = function verify(secured, done) {
                process.env.SECURED = secured ? 'true' : 'false';
                validatorspy.reset();

                // Create a test report app
                var app = report();

                // Listen on an ephemeral port
                var server = app.listen(0);

                // Get the rated usage
                request.get('http://localhost::p/v1/metering/aggregated/usage/graph/:query', {
                    p: server.address().port,
                    query: query
                }, function(err, val) {
                    expect(err).to.equal(undefined);

                    // Expect our test rated usage
                    expect(val.statusCode).to.equal(200);
                    expect(val.body).to.deep.equal(expected);

                    // Check oauth validator spy
                    expect(validatorspy.callCount).to.equal(secured ? 1 : 0);

                    done();
                });
            };

            // Verify using an unsecured server and then verify using a secured server
            verify(false, function() {
                return verify(true, done);
            });
        });

        it('queries rated usage using GraphQL queries', function(done) {

            // Define the GraphQL query and the corresponding expected result
            var query = '{ organizations(organization_ids: ' + '["a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27"], time: 1420574400000) { ' + 'organization_id, windows { charge }, resources { resource_id, ' + 'aggregated_usage { metric, windows { charge }}}}}';
            var expected = {
                organizations: [{
                    organization_id: oid,
                    windows: buildWindow(undefined, undefined, undefined, undefined, undefined, 607.05852),
                    resources: [{
                        resource_id: 'test-resource',
                        aggregated_usage: buildAggregatedUsage(undefined, undefined, undefined, undefined, undefined, 11, 11, 585, undefined, undefined, 0.05852, undefined, undefined, true)
                    }]
                }]
            };

            var verify = function verify(secured, done) {
                process.env.SECURED = secured ? 'true' : 'false';
                validatorspy.reset();

                // Create a test report app
                var app = report();

                // Listen on an ephemeral port
                var server = app.listen(0);

                var cbs = 0;
                var cb = function cb() {
                    if (++cbs === 4) {
                        // Check oauth validator spy
                        expect(validatorspy.callCount).to.equal(secured ? 6 : 0);

                        done();
                    }
                };

                // Get the rated usage
                brequest.get('http://localhost::p/v1/metering/aggregated/usage/graph/:query', {
                    p: server.address().port,
                    query: query
                }, function(err, val) {
                    expect(err).to.equal(undefined);

                    // Expect our test rated usage
                    expect(val.statusCode).to.equal(200);
                    expect(val.body).to.deep.equal(expected);

                    cb();
                });

                // Unauthorized organizations and account queries
                var uqueries = ['{ organizations(organization_ids: ' + '["unauthorized"]) { ' + 'organization_id, windows { charge }, resources { resource_id, ' + 'aggregated_usage { metric, windows { charge }}}}}', '{ organization(organization_id: ' + '"unauthorized") { ' + 'organization_id, windows { charge }, resources { resource_id, ' + 'aggregated_usage { metric, windows { charge }}}}}', '{ account(account_id: ' + '"unauthorized") { ' + 'organization_id, windows { charge }, resources { resource_id, ' + 'aggregated_usage { metric, windows { charge }}}}}'];

                // Get the rated usage for unauthorized org and account
                map(uqueries, function(uquery) {
                    brequest.get('http://localhost::p/v1/metering/aggregated/usage/graph/:query', {
                        headers: {
                            authorization: 'Bearer test'
                        },
                        p: server.address().port,
                        query: uquery
                    }, function(err, val) {
                        expect(err).to.equal(undefined);

                        // Expect our test rated usage as empty
                        expect(val.statusCode).to.equal(400);
                        expect(val.body.error).to.contain('query');

                        cb();
                    });
                });
            };

            // Verify using an unsecured server and then verify using a secured server
            verify(false, function() {
                return verify(true, done);
            });
        });
    });

    context('when rated usage contains big numbers', function() {
        before(function(done) {
            var bigNumberRated = {
                organization_id: '610f6508-8b5d-4840-888d-0615ade33117',
                consumer_id: 'UNKNOWN',
                resource_instance_id: rid,
                resources: [{
                    resource_id: 'test-resource',
                    plans: [{
                        plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                        metering_plan_id: 'test-metering-plan',
                        rating_plan_id: 'test-rating-plan',
                        pricing_plan_id: 'test-pricing-basic',
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[null], [{
                                quantity: {
                                    consumed: 0,
                                    consuming: 0.5
                                },
                                cost: {
                                    consumed: 0,
                                    consuming: 0.5,
                                    price: 0.00014
                                },
                                summary: 0.036679722222222225,
                                charge: 5.13516111111111e-06
                            }], [{
                                quantity: {
                                    consumed: 156250,
                                    consuming: 0.625
                                },
                                cost: {
                                    consumed: 156250,
                                    consuming: 0.625,
                                    price: 0.00014
                                },
                                summary: 0.08925243055555555,
                                charge: 1.249534027777778e-05
                            }], [{
                                quantity: {
                                    consumed: 19690125,
                                    consuming: 7.125
                                },
                                cost: {
                                    consumed: 19690125,
                                    consuming: 7.125,
                                    price: 0.00014
                                },
                                summary: 5.992165208333334,
                                charge: 0.0008389031291666666
                            }], [{
                                quantity: {
                                    consumed: 1454053167.96875,
                                    consuming: 9.28515625
                                },
                                cost: {
                                    consumed: 1454053167.96875,
                                    consuming: 9.28515625,
                                    price: 0.00014
                                },
                                summary: 404.58481167317706,
                                charge: 0.05664187363424479
                            }]]
                        }],
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 5.13516111111111e-06
                        }], [{
                            charge: 1.249534027777778e-05
                        }], [{
                            charge: 0.0008389031291666666
                        }], [{
                            charge: 0.05664187363424479
                        }]]
                    }],
                    aggregated_usage: [{
                        metric: 'memory',
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 5.13516111111111e-06
                        }], [{
                            charge: 1.249534027777778e-05
                        }], [{
                            charge: 0.0008389031291666666
                        }], [{
                            charge: 0.05664187363424479
                        }]]
                    }],
                    windows: [[{
                        charge: 0
                    }], [{
                        charge: 5.13516111111111e-06
                    }], [{
                        charge: 1.249534027777778e-05
                    }], [{
                        charge: 0.0008389031291666666
                    }], [{
                        charge: 0.05664187363424479
                    }]]
                }],
                spaces: [{
                    space_id: '582018c9-e396-4f59-9945-b1bd579a819b',
                    resources: [{
                        resource_id: 'test-resource',
                        plans: [{
                            plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                            metering_plan_id: 'test-metering-plan',
                            rating_plan_id: 'test-rating-plan',
                            pricing_plan_id: 'test-pricing-basic',
                            aggregated_usage: [{
                                metric: 'memory',
                                windows: [[{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: {
                                        consumed: 0,
                                        consuming: 0.03125
                                    },
                                    cost: {
                                        consumed: 0,
                                        consuming: 0.03125,
                                        price: 0.00014
                                    },
                                    summary: 1.5000789409722222,
                                    charge: 0.0002100110517361111
                                }]]
                            }],
                            windows: [[{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0.0002100110517361111
                            }]]
                        }],
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0.0002100110517361111
                            }]]
                        }],
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.0002100110517361111
                        }]]
                    }],
                    consumers: { id: 'UNKNOWN', t: '1448457444188' },
                    windows: [[{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0.0002100110517361111
                    }]]
                }, {
                    space_id: 'c228ecc8-15eb-446f-a4e6-a2d05a729b98',
                    resources: [{
                        resource_id: 'test-resource',
                        plans: [{
                            plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                            metering_plan_id: 'test-metering-plan',
                            rating_plan_id: 'test-rating-plan',
                            pricing_plan_id: 'test-pricing-basic',
                            aggregated_usage: [{
                                metric: 'memory',
                                windows: [[{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: {
                                        consumed: 0,
                                        consuming: 0.03125
                                    },
                                    cost: {
                                        consumed: 0,
                                        consuming: 0.03125,
                                        price: 0.00014
                                    },
                                    summary: 1.5000789409722222,
                                    charge: 0.0002100110517361111
                                }]]
                            }],
                            windows: [[{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0.0002100110517361111
                            }]]
                        }],
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0.0002100110517361111
                            }]]
                        }],
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.0002100110517361111
                        }]]
                    }],
                    consumers: { id: 'UNKNOWN', t: '1448457444188' },
                    windows: [[{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0.0002100110517361111
                    }]]
                }, {
                    space_id: '69d4d85b-03f7-436e-b293-94d1803b42bf',
                    resources: [{
                        resource_id: 'test-resource',
                        plans: [{
                            plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                            metering_plan_id: 'test-metering-plan',
                            rating_plan_id: 'test-rating-plan',
                            pricing_plan_id: 'test-pricing-basic',
                            aggregated_usage: [{
                                metric: 'memory',
                                windows: [[{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: 0,
                                    cost: 0,
                                    summary: 0,
                                    charge: 0
                                }], [{
                                    quantity: {
                                        consumed: 78616062.5,
                                        consuming: 2.09765625
                                    },
                                    cost: {
                                        consumed: 78616062.5,
                                        consuming: 2.09765625,
                                        price: 0.00014
                                    },
                                    summary: 80.0006135828993,
                                    charge: 0.011200085901605903
                                }]]
                            }],
                            windows: [[{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0.011200085901605903
                            }]]
                        }],
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0
                            }], [{
                                charge: 0.011200085901605903
                            }]]
                        }],
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.011200085901605903
                        }]]
                    }],
                    consumers: { id: 'UNKNOWN', t: '1448457444188' },
                    windows: [[null], [null], [null], [null], [{
                        charge: 0.011200085901605903
                    }]]
                }, {
                    space_id: '4ef2f706-f2ae-4be5-a18c-40a969cf8fb6',
                    resources: [{
                        resource_id: 'test-resource',
                        plans: [{
                            plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                            metering_plan_id: 'test-metering-plan',
                            rating_plan_id: 'test-rating-plan',
                            pricing_plan_id: 'test-pricing-basic',
                            aggregated_usage: [{
                                metric: 'memory',
                                windows: [[null], [{
                                    quantity: {
                                        consumed: 0,
                                        consuming: 0.5
                                    },
                                    cost: {
                                        consumed: 0,
                                        consuming: 0.5,
                                        price: 0.00014
                                    },
                                    summary: 0.036679722222222225,
                                    charge: 5.13516111111111e-06
                                }], [{
                                    quantity: {
                                        consumed: 156250,
                                        consuming: 0.625
                                    },
                                    cost: {
                                        consumed: 156250,
                                        consuming: 0.625,
                                        price: 0.00014
                                    },
                                    summary: 0.08925243055555555,
                                    charge: 1.249534027777778e-05
                                }], [{
                                    quantity: {
                                        consumed: 19684375,
                                        consuming: 7.125
                                    },
                                    cost: {
                                        consumed: 19684375,
                                        consuming: 7.125,
                                        price: 0.00014
                                    },
                                    summary: 5.990567986111111,
                                    charge: 0.0008386795180555555
                                }], [{
                                    quantity: {
                                        consumed: 1155809375,
                                        consuming: 7.125
                                    },
                                    cost: {
                                        consumed: 1155809375,
                                        consuming: 7.125,
                                        price: 0.00014
                                    },
                                    summary: 321.5808457638889,
                                    charge: 0.04502131840694444
                                }]]
                            }],
                            windows: [[null], [{
                                charge: 5.13516111111111e-06
                            }], [{
                                charge: 1.249534027777778e-05
                            }], [{
                                charge: 0.0008386795180555555
                            }], [{
                                charge: 0.04502131840694444
                            }]]
                        }],
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[null], [{
                                charge: 5.13516111111111e-06
                            }], [{
                                charge: 1.249534027777778e-05
                            }], [{
                                charge: 0.0008386795180555555
                            }], [{
                                charge: 0.04502131840694444
                            }]]
                        }],
                        windows: [[null], [{
                            charge: 5.13516111111111e-06
                        }], [{
                            charge: 1.249534027777778e-05
                        }], [{
                            charge: 0.0008386795180555555
                        }], [{
                            charge: 0.04502131840694444
                        }]]
                    }],
                    consumers: { id: 'UNKNOWN', t: '1448457444188' },
                    windows: [[null], [{
                        charge: 5.13516111111111e-06
                    }], [{
                        charge: 1.249534027777778e-05
                    }], [{
                        charge: 0.0008386795180555555
                    }], [{
                        charge: 0.04502131840694444
                    }]]
                }, {
                    space_id: 'eac5125c-74ff-4984-9ba6-2eea7158490f',
                    resources: [{
                        resource_id: 'test-resource',
                        plans: [{
                            plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                            metering_plan_id: 'test-metering-plan',
                            rating_plan_id: 'test-rating-plan',
                            pricing_plan_id: 'test-pricing-basic',
                            aggregated_usage: [{
                                metric: 'memory',
                                windows: [[null], [null], [null], [{
                                    quantity: {
                                        consumed: 5750,
                                        consuming: 0
                                    },
                                    cost: {
                                        consumed: 5750,
                                        consuming: 0,
                                        price: 0.00014
                                    },
                                    summary: 0.0015972222222222223,
                                    charge: 2.2361111111111e-07
                                }], [{
                                    quantity: {
                                        consumed: 11500,
                                        consuming: 0
                                    },
                                    cost: {
                                        consumed: 11500,
                                        consuming: 0,
                                        price: 0.00014
                                    },
                                    summary: 0.0031944444444444446,
                                    charge: 4.4722222222222e-07
                                }]]
                            }],
                            windows: [[null], [null], [null], [{
                                charge: 2.2361111111111e-07
                            }], [{
                                charge: 4.4722222222222e-07
                            }]]
                        }],
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[null], [null], [null], [{
                                charge: 2.2361111111111e-07
                            }], [{
                                charge: 4.4722222222222e-07
                            }]]
                        }],
                        windows: [[null], [null], [null], [{
                            charge: 2.2361111111111e-07
                        }], [{
                            charge: 4.4722222222222e-07
                        }]]
                    }],
                    consumers: { id: 'UNKNOWN', t: '1448457444188' },
                    windows: [[null], [null], [null], [{
                        charge: 2.2361111111111e-07
                    }], [{
                        charge: 4.4722222222222e-07
                    }]]
                }],
                start: 1448284898000,
                end: 1448457443000,
                id: 'k/610f6508-8b5d-4840-888d-0615ade33117/t/0001448457444188-0-0-1-0',
                processed: 1448457444188,
                windows: [[null], [{
                    charge: 5.13516111111111e-06
                }], [{
                    charge: 1.249534027777778e-05
                }], [{
                    charge: 0.0008389031291666666
                }], [{
                    charge: 0.05664187363424479
                }]]
            };
            var consumer1 = {
                id: 'k/610f6508-8b5d-4840-888d-0615ade33117/' + '582018c9-e396-4f59-9945-b1bd579a819b/UNKNOWN/t/1448457444188',
                consumer_id: 'UNKNOWN',
                organization_id: '610f6508-8b5d-4840-888d-0615ade33117',
                resource_instance_id: rid,
                start: 1448284898000,
                end: 1448457443000,
                resources: [{
                    resource_id: 'test-resource',
                    plans: [{
                        plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                        metering_plan_id: 'test-metering-plan',
                        rating_plan_id: 'test-rating-plan',
                        pricing_plan_id: 'test-pricing-basic',
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: {
                                    consumed: 0,
                                    consuming: 0.03125,
                                    since: 1448284898000
                                },
                                cost: {
                                    consumed: 0,
                                    consuming: 0.03125,
                                    price: 0.00014
                                },
                                summary: 1.5000789409722222,
                                charge: 0.0002100110517361111
                            }]]
                        }],
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.0002100110517361111
                        }]]
                    }],
                    aggregated_usage: [{
                        metric: 'memory',
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.0002100110517361111
                        }]]
                    }],
                    windows: [[{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0.0002100110517361111
                    }]]
                }],
                windows: [[{
                    charge: 0
                }], [{
                    charge: 0
                }], [{
                    charge: 0
                }], [{
                    charge: 0
                }], [{
                    charge: 0.0002100110517361111
                }]]
            };
            var consumer2 = {
                id: 'k/610f6508-8b5d-4840-888d-0615ade33117/' + 'c228ecc8-15eb-446f-a4e6-a2d05a729b98/UNKNOWN/t/1448457444188',
                consumer_id: 'UNKNOWN',
                organization_id: '610f6508-8b5d-4840-888d-0615ade33117',
                resource_instance_id: rid,
                start: 1448284898000,
                end: 1448457443000,
                resources: [{
                    resource_id: 'test-resource',
                    plans: [{
                        plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                        metering_plan_id: 'test-metering-plan',
                        rating_plan_id: 'test-rating-plan',
                        pricing_plan_id: 'test-pricing-basic',
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: {
                                    consumed: 0,
                                    consuming: 0.03125
                                },
                                cost: {
                                    consumed: 0,
                                    consuming: 0.03125,
                                    price: 0.00014
                                },
                                summary: 1.5000789409722222,
                                charge: 0.0002100110517361111
                            }]]
                        }],
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.0002100110517361111
                        }]]
                    }],
                    aggregated_usage: [{
                        metric: 'memory',
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.0002100110517361111
                        }]]
                    }],
                    windows: [[{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0
                    }], [{
                        charge: 0.0002100110517361111
                    }]]
                }],
                windows: [[{
                    charge: 0
                }], [{
                    charge: 0
                }], [{
                    charge: 0
                }], [{
                    charge: 0
                }], [{
                    charge: 0.0002100110517361111
                }]]
            };
            var consumer3 = {
                id: 'k/610f6508-8b5d-4840-888d-0615ade33117/' + '69d4d85b-03f7-436e-b293-94d1803b42bf/UNKNOWN/t/1448457444188',
                consumer_id: 'UNKNOWN',
                organization_id: '610f6508-8b5d-4840-888d-0615ade33117',
                resource_instance_id: rid,
                start: 1448284898000,
                end: 1448457443000,
                resources: [{
                    resource_id: 'test-resource',
                    plans: [{
                        plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                        metering_plan_id: 'test-metering-plan',
                        rating_plan_id: 'test-rating-plan',
                        pricing_plan_id: 'test-pricing-basic',
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: 0,
                                cost: 0,
                                summary: 0,
                                charge: 0
                            }], [{
                                quantity: {
                                    consumed: 78616062.5,
                                    consuming: 2.09765625
                                },
                                cost: {
                                    consumed: 78616062.5,
                                    consuming: 2.09765625,
                                    price: 0.00014
                                },
                                summary: 80.0006135828993,
                                charge: 0.011200085901605903
                            }]]
                        }],
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.011200085901605903
                        }]]
                    }],
                    aggregated_usage: [{
                        metric: 'memory',
                        windows: [[{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0
                        }], [{
                            charge: 0.011200085901605903
                        }]]
                    }],
                    windows: [[null], [null], [null], [null], [{
                        charge: 0.011200085901605903
                    }]]
                }],
                windows: [[null], [null], [null], [null], [{
                    charge: 0.011200085901605903
                }]]
            };
            var consumer4 = {
                id: 'k/610f6508-8b5d-4840-888d-0615ade33117/' + '4ef2f706-f2ae-4be5-a18c-40a969cf8fb6/UNKNOWN/t/1448457444188',
                consumer_id: 'UNKNOWN',
                organization_id: '610f6508-8b5d-4840-888d-0615ade33117',
                resource_instance_id: rid,
                start: 1448284898000,
                end: 1448457443000,
                resources: [{
                    resource_id: 'test-resource',
                    plans: [{
                        plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                        metering_plan_id: 'test-metering-plan',
                        rating_plan_id: 'test-rating-plan',
                        pricing_plan_id: 'test-pricing-basic',
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[null], [{
                                quantity: {
                                    consumed: 0,
                                    consuming: 0.5
                                },
                                cost: {
                                    consumed: 0,
                                    consuming: 0.5,
                                    price: 0.00014
                                },
                                summary: 0.036679722222222225,
                                charge: 5.13516111111111e-06
                            }], [{
                                quantity: {
                                    consumed: 156250,
                                    consuming: 0.625
                                },
                                cost: {
                                    consumed: 156250,
                                    consuming: 0.625,
                                    price: 0.00014
                                },
                                summary: 0.08925243055555555,
                                charge: 1.249534027777778e-05
                            }], [{
                                quantity: {
                                    consumed: 19684375,
                                    consuming: 7.125
                                },
                                cost: {
                                    consumed: 19684375,
                                    consuming: 7.125,
                                    price: 0.00014
                                },
                                summary: 5.990567986111111,
                                charge: 0.0008386795180555555
                            }], [{
                                quantity: {
                                    consumed: 1155809375,
                                    consuming: 7.125
                                },
                                cost: {
                                    consumed: 1155809375,
                                    consuming: 7.125,
                                    price: 0.00014
                                },
                                summary: 321.5808457638889,
                                charge: 0.04502131840694444
                            }]]
                        }],
                        windows: [[null], [{
                            charge: 5.13516111111111e-06
                        }], [{
                            charge: 1.249534027777778e-05
                        }], [{
                            charge: 0.0008386795180555555
                        }], [{
                            charge: 0.04502131840694444
                        }]]
                    }],
                    aggregated_usage: [{
                        metric: 'memory',
                        windows: [[null], [{
                            charge: 5.13516111111111e-06
                        }], [{
                            charge: 1.249534027777778e-05
                        }], [{
                            charge: 0.0008386795180555555
                        }], [{
                            charge: 0.04502131840694444
                        }]]
                    }],
                    windows: [[null], [{
                        charge: 5.13516111111111e-06
                    }], [{
                        charge: 1.249534027777778e-05
                    }], [{
                        charge: 0.0008386795180555555
                    }], [{
                        charge: 0.04502131840694444
                    }]]
                }],
                windows: [[null], [{
                    charge: 5.13516111111111e-06
                }], [{
                    charge: 1.249534027777778e-05
                }], [{
                    charge: 0.0008386795180555555
                }], [{
                    charge: 0.04502131840694444
                }]]
            };
            var consumer5 = {
                id: 'k/610f6508-8b5d-4840-888d-0615ade33117/' + 'eac5125c-74ff-4984-9ba6-2eea7158490f/UNKNOWN/t/1448457444188',
                consumer_id: 'UNKNOWN',
                resources: [{
                    resource_id: 'test-resource',
                    plans: [{
                        plan_id: 'basic/test-metering-plan/' + 'test-rating-plan/test-pricing-basic',
                        metering_plan_id: 'test-metering-plan',
                        rating_plan_id: 'test-rating-plan',
                        pricing_plan_id: 'test-pricing-basic',
                        aggregated_usage: [{
                            metric: 'memory',
                            windows: [[null], [null], [null], [{
                                quantity: {
                                    consumed: 5750,
                                    consuming: 0
                                },
                                cost: {
                                    consumed: 5750,
                                    consuming: 0,
                                    price: 0.00014
                                },
                                summary: 0.0015972222222222223,
                                charge: 2.2361111111111e-07
                            }], [{
                                quantity: {
                                    consumed: 11500,
                                    consuming: 0
                                },
                                cost: {
                                    consumed: 11500,
                                    consuming: 0,
                                    price: 0.00014
                                },
                                summary: 0.0031944444444444446,
                                charge: 4.4722222222222e-07
                            }]]
                        }],
                        windows: [[null], [null], [null], [{
                            charge: 2.2361111111111e-07
                        }], [{
                            charge: 4.4722222222222e-07
                        }]]
                    }],
                    aggregated_usage: [{
                        metric: 'memory',
                        windows: [[null], [null], [null], [{
                            charge: 2.2361111111111e-07
                        }], [{
                            charge: 4.4722222222222e-07
                        }]]
                    }],
                    windows: [[null], [null], [null], [{
                        charge: 2.2361111111111e-07
                    }], [{
                        charge: 4.4722222222222e-07
                    }]]
                }],
                windows: [[null], [null], [null], [{
                    charge: 2.2361111111111e-07
                }], [{
                    charge: 4.4722222222222e-07
                }]]
            };
            storeRatedUsage(bigNumberRated, function() {
                return storeRatedUsage(consumer1, function() {
                    return storeRatedUsage(consumer2, function() {
                        return storeRatedUsage(consumer3, function() {
                            return storeRatedUsage(consumer4, function() {
                                return storeRatedUsage(consumer5, done);
                            });
                        });
                    });
                });
            });
        });

        it('retrieves rated usage with 16 significant digits', function(done) {
            var verify = function verify(secured, done) {
                process.env.SECURED = secured ? 'true' : 'false';
                validatorspy.reset();

                // Create a test report app
                var app = report();

                // Listen on an ephemeral port
                var server = app.listen(0);

                // Get the rated usage
                request.get('http://localhost::p/v1/metering/organizations/' + ':organization_id/aggregated/usage', {
                    p: server.address().port,
                    organization_id: oid
                }, function(err, val) {
                    expect(err).to.equal(undefined);

                    // Expect test rated usage without error
                    expect(val.statusCode).to.equal(200);
                    expect(validatorspy.callCount).to.equal(secured ? 1 : 0);
                    done();
                });
            };

            // Verify using an unsecured server and then verify using a secured server
            verify(false, function() {
                return verify(true, done);
            });
        });
    });

    context('when rated usage contains a slack', function() {
        before(function(done) {
            // This test only care about October 31st.
            var planWindow = [[{ quantity: 0, cost: 0, previous_quantity: null }], [{ quantity: 0, cost: 0, previous_quantity: null }], [{ quantity: 0, cost: 0, previous_quantity: null }], [{
                quantity: {
                    consumed: 158400000,
                    consuming: 1
                },
                previous_quantity: null,
                cost: {
                    consumed: 158400000,
                    consuming: 1,
                    price: 0.00014
                }
            }, {
                quantity: {
                    consumed: 172800000,
                    consuming: 2
                },
                cost: {
                    consumed: 172800000,
                    consuming: 2,
                    price: 0.00014
                }
            }, { quantity: 0, cost: 0 }], [{
                quantity: {
                    consumed: 158400000,
                    consuming: 1
                },
                previous_quantity: null,
                cost: {
                    consumed: 158400000,
                    consuming: 1,
                    price: 0.00014
                }
            }, {
                quantity: {
                    consumed: -5011200000,
                    consuming: 2
                },
                cost: {
                    consumed: -5011200000,
                    consuming: 2,
                    price: 0.00014
                }
            }]];

            var aggrWindow = [[{ quantity: 0,
                previous_quantity: null }], [{ quantity: 0,
                previous_quantity: null }], [{ quantity: 0,
                previous_quantity: null }], [{
                quantity: {
                    consumed: 158400000,
                    consuming: 1
                },
                previous_quantity: null
            }, {
                quantity: {
                    consumed: 172800000,
                    consuming: 2
                }
            }, { quantity: 0 }], [{
                quantity: {
                    consumed: 158400000,
                    consuming: 1
                },
                previous_quantity: null
            }, {
                quantity: {
                    consumed: -5011200000,
                    consuming: 2
                }
            }]];
            var id = 'k/a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf29/t/0001446418800000';
            var orgid = 'a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf29';

            var rated = ratedTemplate(id, orgid, 1446415200000, 1446415200000, 1446418800000, [{
                metric: 'memory',
                windows: aggrWindow
            }], [buildPlanUsage('basic', [{
                metric: 'memory',
                windows: planWindow
            }])], [consumerReferenceTemplate(orgid, sid, 'basic', 1446418800000, 'UNKNOWN'), consumerReferenceTemplate(orgid, sid, 'basic', 1446163200000, 'UNKNOWN2')]);

            var consumer = ratedConsumerTemplate(orgid, 1446415200000, 1446415200000, 'basic', [{
                metric: 'memory',
                windows: aggrWindow
            }], [buildPlanUsage('basic', [{
                metric: 'memory',
                windows: planWindow
            }])], 1446418800000);

            var consumer2 = ratedConsumerTemplate(orgid, 1446415200000, 1446415200000, 'basic', [{
                metric: 'memory',
                windows: aggrWindow
            }], [buildPlanUsage('basic', [{
                metric: 'memory',
                windows: planWindow
            }])], 1446163200000, 'UNKNOWN2');

            storeRatedUsage(rated, function() {
                return storeRatedUsage(consumer, function() {
                    return storeRatedUsage(consumer2, done);
                });
            });
        });

        it('checks that time-based resource uses its bounds', function(done) {

            // Define the expected values for the october 31st window
            var expectedDay = {
                summary: 48,
                charge: 0.00672,
                quantity: {
                    consumed: 172800000,
                    consuming: 2
                },
                cost: {
                    consumed: 172800000,
                    consuming: 2,
                    price: 0.00014
                }
            };
            // Define the expected values for the month window
            var expectedMonth = {
                summary: 48,
                charge: 0.00672,
                quantity: {
                    consumed: -5011200000,
                    consuming: 2
                },
                cost: {
                    consumed: -5011200000,
                    consuming: 2,
                    price: 0.00014
                }
            };

            var verify = function verify(done) {
                // Create a test report app
                var app = report();

                // Listen on an ephemeral port
                var server = app.listen(0);

                // Get the rated usage
                request.get('http://localhost::p/v1/metering/organizations/' + ':organization_id/aggregated/usage/:time', {
                    p: server.address().port,
                    organization_id: 'a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf29',
                    time: 1446508800000
                }, function(err, val) {
                    expect(err).to.equal(undefined);

                    // Expect the october window value to be based in october only
                    expect(val.statusCode).to.equal(200);
                    var au = val.body.resources[0].plans[0].aggregated_usage[0];
                    expect(au.windows[3][1]).to.deep.equal(expectedDay);
                    expect(au.windows[4][1]).to.deep.equal(expectedMonth);

                    // Expect UNKNOWN2's day windows to be null and month window shifted
                    expect(val.body.spaces[0].consumers[1].resources[0].aggregated_usage[0].windows[3][0]).to.equal(null);
                    expect(val.body.spaces[0].consumers[1].resources[0].aggregated_usage[0].windows[3][1]).to.equal(null);
                    expect(val.body.spaces[0].consumers[1].resources[0].aggregated_usage[0].windows[4][0]).to.equal(null);
                    done();
                });
            };

            // Verify using an unsecured server and then verify using a secured server
            verify(done);
        });
    });

    context('when accumulated usage has small numbers', function() {
        before(function(done) {

            var accumulated = accumulatedTemplate(buildAccumulatedUsage({ current: 1 }, { current: 1 }, { current: 100 }, 1, 0.03, 15, undefined, true, undefined));

            storeAccumulatedUsage(accumulated, done);
        });

        it('Retrieve accumulated usage', function(done) {
            var verify = function verify(done) {
                // Create a test report app
                var app = report();

                // Listen on an ephemeral port
                var server = app.listen(0);

                var expected = {
                    id: accid,
                    end: 1446415200000,
                    processed: 1446418800000,
                    start: 1446415200000,
                    resource_id: 'test-resource',
                    space_id: 'aaeae239-f3f8-483c-9dd0-de5d41c38b6a',
                    organization_id: oid,
                    consumer_id: 'UNKNOWN',
                    resource_instance_id: rid,
                    plan_id: 'basic',
                    metering_plan_id: 'test-metering-plan',
                    rating_plan_id: 'test-rating-plan',
                    pricing_plan_id: 'test-pricing-basic',
                    accumulated_usage: buildAccumulatedUsage(1, 1, 100, 1, 0.03, 15, true, true, true),
                    windows: [[null], [null], [null], [{
                        charge: 16.03
                    }, null], [{
                        charge: 16.03
                    }, null]]
                };

                // Get the accumulated usage
                request.get('http://localhost::p/v1/metering/organizations/:organization_id/' + 'spaces/:space_id/resource_instances/:resource_instance_id/' + 'consumers/:consumer_id/plans/:plan_id/metering_plans/' + ':metering_plan_id/rating_plans/:rating_plan_id/' + 'pricing_plans/:pricing_plan_id/t/:t/aggregated/usage/:time', {
                    p: server.address().port,
                    organization_id: 'a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27',
                    resource_instance_id: '0b39fa70-a65f-4183-bae8-385633ca5c87',
                    consumer_id: 'UNKNOWN',
                    plan_id: 'basic',
                    space_id: 'aaeae239-f3f8-483c-9dd0-de5d41c38b6a',
                    metering_plan_id: 'test-metering-plan',
                    rating_plan_id: 'test-rating-plan',
                    pricing_plan_id: 'test-pricing-basic',
                    t: '0001446418800000',
                    time: 1446418800000
                }, function(err, val) {
                    expect(err).to.equal(undefined);
                    expect(val.body).to.deep.equal(expected);
                    done();
                });
            };

            // Verify using an unsecured server and then verify using a secured server
            verify(done);
        });

        it('Retrieve accumulated usage using a GraphQL query', function(done) {
            var verify = function verify(done) {
                // Create a test report app
                var app = report();

                // Listen on an ephemeral port
                var server = app.listen(0);

                // Define the graphql query
                var query = '{ resource_instance(organization_id: ' + '"a3d7fe4d-3cb1-4cc3-a831-ffe98e20cf27", space_id: ' + '"aaeae239-f3f8-483c-9dd0-de5d41c38b6a", consumer_id: "UNKNOWN", ' + 'resource_instance_id: "0b39fa70-a65f-4183-bae8-385633ca5c87", ' + 'plan_id: "basic", metering_plan_id: "test-metering-plan", ' + 'rating_plan_id: "test-rating-plan", pricing_plan_id: ' + '"test-pricing-basic", t: "0001446418800000", ' + 'time: 1446418800000 ) ' + '{ organization_id, consumer_id, resource_instance_id, plan_id, ' + 'accumulated_usage { metric, windows { quantity, cost, charge, ' + 'summary } }, windows { charge }}}';

                var expected = {
                    resource_instance: {
                        organization_id: oid,
                        consumer_id: 'UNKNOWN',
                        resource_instance_id: rid,
                        plan_id: 'basic',
                        accumulated_usage: buildAccumulatedUsage(1, 1, 100, 1, 0.03, 15, true, true, true),
                        windows: [[null], [null], [null], [{
                            charge: 16.03
                        }, null], [{
                            charge: 16.03
                        }, null]]
                    }
                };

                // Get the accumulated usage
                request.get('http://localhost::p/v1/metering/aggregated/usage/graph/:query', {
                    p: server.address().port,
                    query: query
                }, function(err, val) {
                    expect(err).to.equal(undefined);

                    // Expect our test accumulated usage
                    expect(val.statusCode).to.equal(200);
                    expect(val.body).to.deep.equal(expected);

                    // Check oauth validator spy
                    // expect(validatorspy.callCount).to.equal(secured ? 1 : 0);

                    done();
                });
            };

            // Verify using an unsecured server and then verify using a secured server
            verify(done);
        });
    });

    context('when querying complex usage with graphql', function() {

        before(function(done) {
            var accumulated = {
                id: 'k/org/ins/con/basic/' + 'test-metering-plan/test-rating-plan/' + 'test-pricing-basic/t/0001456185600000',
                organization_id: 'org',
                space_id: 'spa',
                resource_id: 'test-resource',
                consumer_id: 'con',
                resource_instance_id: 'ins',
                plan_id: 'basic',
                metering_plan_id: 'test-metering-plan',
                rating_plan_id: 'test-rating-plan',
                pricing_plan_id: 'test-pricing-basic',
                start: 1456099200000,
                end: 1456099200000,
                processed: 1456185600000,
                accumulated_usage: [{
                    metric: 'memory',
                    windows: [[null], [null], [null], [null], [{
                        quantity: {
                            current: { consuming: 0, consumed: 3628800000 },
                            previous: { consuming: 2, consumed: 0 }
                        },
                        cost: 50803200
                    }]]
                }]
            };

            storeAccumulatedUsage(accumulated, done);
        });

        it('Retrieve complex accumulated usage using a GraphQL query', function(done) {
            var expected = {
                resource_instance: {
                    organization_id: 'org',
                    consumer_id: 'con',
                    resource_instance_id: 'ins',
                    plan_id: 'basic',
                    accumulated_usage: [{
                        metric: 'memory',
                        windows: [[null], [null], [null], [null], [{
                            quantity: {
                                consuming: 0,
                                consumed: 3628800000
                            }
                        }]]
                    }]
                }
            };

            var verify = function verify(done) {
                // Create a test report app
                var app = report();

                // Listen on an ephemeral port
                var server = app.listen(0);

                // Query with no sub selections in quantity
                var query1 = '{ resource_instance(organization_id: ' + '"org", space_id: "spa", consumer_id: "con", resource_instance_id: ' + '"ins", plan_id: "basic", metering_plan_id: "test-metering-plan", ' + 'rating_plan_id: "test-rating-plan", pricing_plan_id: ' + '"test-pricing-basic", t: "0001456185600000", ' + 'time: 1456185600000 ) ' + '{ organization_id, consumer_id, resource_instance_id, plan_id, ' + 'accumulated_usage { metric, windows { quantity }}}}';

                request.get('http://localhost::p/v1/metering/aggregated/usage/graph/:query', {
                    p: server.address().port,
                    query: query1
                }, function(err, val) {
                    expect(err).to.equal(undefined);

                    // No sub selections will return the query with a null value
                    expect(val.statusCode).to.equal(200);
                    expect(val.body).to.deep.equal(expected);
                    done();
                });
            };

            // Verify
            verify(done);
        });
    });
});
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3NyYy90ZXN0L3Rlc3QuanMiXSwibmFtZXMiOlsiXyIsInJlcXVpcmUiLCJyZXF1ZXN0IiwiYmF0Y2giLCJjbHVzdGVyIiwib2F1dGgiLCJkYXRhZmxvdyIsInlpZWxkYWJsZSIsImRiY2xpZW50IiwibWFwIiwiZXh0ZW5kIiwiYnJlcXVlc3QiLCJwcm9jZXNzIiwiZW52IiwiREIiLCJnZXRzcHkiLCJyZXFzIiwiY2IiLCJleHBlY3QiLCJ0byIsImVxdWFsIiwidW5kZWZpbmVkIiwicmVxIiwic3RhdHVzQ29kZSIsInRlc3QiLCJvcmdfaWQiLCJhY2NvdW50X2lkIiwicmVxbW9jayIsImJhdGNoX2dldCIsImNhY2hlIiwicmVzb2x2ZSIsImV4cG9ydHMiLCJhcHAiLCJ2YWxpZGF0b3JzcHkiLCJzcHkiLCJyZXMiLCJuZXh0IiwiY2FjaGVzcHkiLCJmIiwic3RhcnQiLCJvYXV0aG1vY2siLCJ2YWxpZGF0b3IiLCJidWlsZFdpbmRvdyIsInFEYXkiLCJxTW9udGgiLCJzIiwiY0RheSIsImNNb250aCIsImNoIiwid2luZG93cyIsInNldFdpbmRvd1Byb3BlcnR5IiwiayIsInZEYXkiLCJ2TW9udGgiLCJyZXBvcnQiLCJzdG9yZUFjY3VtdWxhdGVkVXNhZ2UiLCJhY2NVc2FnZSIsImFjY3VtdWxhdG9yZGIiLCJkYiIsImZ1bmN0aW9uY2IiLCJwdXQiLCJfaWQiLCJpZCIsImVyciIsInZhbCIsInN0b3JlUmF0ZWRVc2FnZSIsInJhdGVkVXNhZ2UiLCJhZ2dyZWdhdG9yZGIiLCJvaWQiLCJzaWQiLCJjaWQiLCJwIiwiY2RpZCIsIm9yZ2lkIiwidCIsImpvaW4iLCJtcGlkIiwicnBpZCIsInBwaWQiLCJwaWQiLCJhY2NpZCIsInJpZCIsImJ1aWxkQWdncmVnYXRlZFVzYWdlIiwibCIsImgiLCJtZCIsIm1tIiwic2MiLCJsYyIsImhjIiwibWMiLCJtcyIsIm1jaCIsInN1bW1hcnkiLCJjb3N0IiwiY2hhcmdlIiwibWV0cmljIiwicGxhblRlbXBsYXRlIiwicGxhbiIsInBsYW5faWQiLCJtZXRlcmluZ19wbGFuX2lkIiwicmF0aW5nX3BsYW5faWQiLCJwcmljaW5nX3BsYW5faWQiLCJidWlsZFBsYW5Vc2FnZSIsInBsYW5Vc2FnZSIsImFnZ3JlZ2F0ZWRfdXNhZ2UiLCJyYXRlZENvbnN1bWVyVGVtcGxhdGUiLCJlbmQiLCJhIiwicHJvY2Vzc2VkIiwiY29pZCIsImNvbnN1bWVyX2lkIiwib3JnYW5pemF0aW9uX2lkIiwicmVzb3VyY2VfaW5zdGFuY2VfaWQiLCJyZXNvdXJjZXMiLCJyZXNvdXJjZV9pZCIsInBsYW5zIiwiY29uc3VtZXJSZWZlcmVuY2VUZW1wbGF0ZSIsImNvbmlkIiwiYnVpbGRTcGFjZVVzYWdlIiwiYyIsInNwYWNlX2lkIiwiY29uc3VtZXJzIiwiYnVpbGRSZXNvdXJjZVVzYWdlIiwicmF0ZWRUZW1wbGF0ZSIsInByaWNpbmdfY291bnRyeSIsInByaWNlcyIsIm1ldHJpY3MiLCJuYW1lIiwicHJpY2UiLCJzcGFjZXMiLCJwbGFuUmVwb3J0VGVtcGxhdGUiLCJwbGFuV2luZG93IiwiY29uc3VtZXJSZXBvcnRUZW1wbGF0ZSIsInNwYWNlUmVwb3J0VGVtcGxhdGUiLCJ0dyIsImF1IiwicmVwb3J0VGVtcGxhdGUiLCJidWlsZEFjY3VtdWxhdGVkVXNhZ2UiLCJhY2N1bXVsYXRlZFRlbXBsYXRlIiwiYWNjIiwiYWNjdW11bGF0ZWRfdXNhZ2UiLCJkZXNjcmliZSIsImJlZm9yZSIsImRvbmUiLCJkcm9wIiwicGxhbkFVc2FnZSIsImNvbnN1bWVkIiwiY29uc3VtaW5nIiwicGxhbkJVc2FnZSIsImNvbnRleHQiLCJyYXRlZCIsImNvbnN1bWVyMSIsImNvbnN1bWVyMiIsIml0IiwicGxhbkFSZXBvcnQiLCJwbGFuQlJlcG9ydCIsImV4cGVjdGVkIiwidmVyaWZ5Iiwic2VjdXJlZCIsIlNFQ1VSRUQiLCJyZXNldCIsInNlcnZlciIsImxpc3RlbiIsImNicyIsImNhbGxDb3VudCIsImdldCIsImFkZHJlc3MiLCJwb3J0IiwidGltZSIsImJvZHkiLCJkZWVwIiwicXVlcnkiLCJvcmdhbml6YXRpb24iLCJvcmdhbml6YXRpb25zIiwidXF1ZXJpZXMiLCJ1cXVlcnkiLCJoZWFkZXJzIiwiYXV0aG9yaXphdGlvbiIsImVycm9yIiwiY29udGFpbiIsImJpZ051bWJlclJhdGVkIiwicXVhbnRpdHkiLCJzaW5jZSIsImNvbnN1bWVyMyIsImNvbnN1bWVyNCIsImNvbnN1bWVyNSIsInByZXZpb3VzX3F1YW50aXR5IiwiYWdncldpbmRvdyIsImNvbnN1bWVyIiwiZXhwZWN0ZWREYXkiLCJleHBlY3RlZE1vbnRoIiwiYWNjdW11bGF0ZWQiLCJjdXJyZW50IiwicmVzb3VyY2VfaW5zdGFuY2UiLCJwcmV2aW91cyIsInF1ZXJ5MSJdLCJtYXBwaW5ncyI6IkFBQUE7O0FBRUE7O0FBRUEsSUFBTUEsSUFBSUMsUUFBUSxZQUFSLENBQVY7QUFDQSxJQUFNQyxVQUFVRCxRQUFRLGdCQUFSLENBQWhCO0FBQ0EsSUFBTUUsUUFBUUYsUUFBUSxjQUFSLENBQWQ7QUFDQSxJQUFNRyxVQUFVSCxRQUFRLGdCQUFSLENBQWhCO0FBQ0EsSUFBTUksUUFBUUosUUFBUSxjQUFSLENBQWQ7QUFDQSxJQUFNSyxXQUFXTCxRQUFRLGlCQUFSLENBQWpCO0FBQ0EsSUFBTU0sWUFBWU4sUUFBUSxrQkFBUixDQUFsQjtBQUNBLElBQU1PLFdBQVdQLFFBQVEsaUJBQVIsQ0FBakI7O0FBRUEsSUFBTVEsTUFBTVQsRUFBRVMsR0FBZDtBQUNBLElBQU1DLFNBQVNWLEVBQUVVLE1BQWpCOztBQUVBLElBQU1DLFdBQVdSLE1BQU1ELE9BQU4sQ0FBakI7O0FBRUE7O0FBRUE7QUFDQVUsUUFBUUMsR0FBUixDQUFZQyxFQUFaLEdBQWlCRixRQUFRQyxHQUFSLENBQVlDLEVBQVosSUFBa0IsTUFBbkM7O0FBRUE7QUFDQSxJQUFNQyxTQUFTLFNBQVRBLE1BQVMsQ0FBQ0MsSUFBRCxFQUFPQyxFQUFQLEVBQWM7QUFDM0I7QUFDQUMsU0FBT0YsS0FBSyxDQUFMLEVBQVEsQ0FBUixDQUFQLEVBQW1CRyxFQUFuQixD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RUFBYztBQUNmOUMsaUJBQU82QyxHQUFQLEVBQVk1QyxFQUFaLENBQWVDLEtBQWYsQ0FBcUJDLFNBQXJCOztBQUVBO0FBQ0FILGlCQUFPOEMsSUFBSXpDLFVBQVgsRUFBdUJKLEVBQXZCLENBQTBCQyxLQUExQixDQUFnQyxHQUFoQztBQUNBRixpQkFBTzhDLElBQUkwRyxJQUFYLEVBQWlCdkosRUFBakIsQ0FBb0J3SixJQUFwQixDQUF5QnZKLEtBQXpCLENBQStCeUksUUFBL0I7QUFDQWI7QUFDRCxTQVhIO0FBWUQsT0E3QkQ7O0FBK0JBO0FBQ0FjLGFBQU9kLElBQVA7QUFDRCxLQXhERDtBQXlERCxHQTdGRDtBQThGRCxDQW5vRkQiLCJmaWxlIjoidGVzdC5qcyIsInNvdXJjZXNDb250ZW50IjpbIid1c2Ugc3RyaWN0JztcblxuLy8gVXNhZ2UgcmVwb3J0aW5nIHNlcnZpY2UuXG5cbmNvbnN0IF8gPSByZXF1aXJlKCd1bmRlcnNjb3JlJyk7XG5jb25zdCByZXF1ZXN0ID0gcmVxdWlyZSgnYWJhY3VzLXJlcXVlc3QnKTtcbmNvbnN0IGJhdGNoID0gcmVxdWlyZSgnYWJhY3VzLWJhdGNoJyk7XG5jb25zdCBjbHVzdGVyID0gcmVxdWlyZSgnYWJhY3VzLWNsdXN0ZXInKTtcbmNvbnN0IG9hdXRoID0gcmVxdWlyZSgnYWJhY3VzLW9hdXRoJyk7XG5jb25zdCBkYXRhZmxvdyA9IHJlcXVpcmUoJ2FiYWN1cy1kYXRhZmxvdycpO1xuY29uc3QgeWllbGRhYmxlID0gcmVxdWlyZSgnYWJhY3VzLXlpZWxkYWJsZScpO1xuY29uc3QgZGJjbGllbnQgPSByZXF1aXJlKCdhYmFjdXMtZGJjbGllbnQnKTtcblxuY29uc3QgbWFwID0gXy5tYXA7XG5jb25zdCBleHRlbmQgPSBfLmV4dGVuZDtcblxuY29uc3QgYnJlcXVlc3QgPSBiYXRjaChyZXF1ZXN0KTtcblxuLyogZXNsaW50IHF1b3RlczogMSAqL1xuXG4vLyBDb25maWd1cmUgdGVzdCBkYiBVUkwgcHJlZml4XG5wcm9jZXNzLmVudi5EQiA9IHByb2Nlc3MuZW52LkRCIHx8ICd0ZXN0JztcblxuLy8gTW9jayB0aGUgcmVxdWVzdCBtb2R1bGVcbmNvbnN0IGdldHNweSA9IChyZXFzLCBjYikgPT4ge1xuICAvLyBFeHBlY3QgYSBjYWxsIHRvIGFjY291bnRcbiAgZXhwZWN0KHJlcXNbMF1bMF0pLnRvLmVxdWFsKFxuICAgICdodHRwOi8vbG9jYWxob3N0Ojk4ODEvdjEvb3JnYW5pemF0aW9ucy86b3JnX2lkL2FjY291bnQvOnRpbWUnKTtcblxuICBjYih1bmRlZmluZWQsIG1hcChyZXFzLCAocmVxKSA9PiBbdW5kZWZpbmVkLCB7XG4gICAgc3RhdHVzQ29kZTpcbiAgICAgIC91bmF1dGhvcml6ZWQvLnRlc3QocmVxWzFdLm9yZ19pZCB8fCByZXFbMV0uYWNjb3VudF9pZCkgPyA0MDEgOiAyMDBcbiAgfV0pKTtcbn07XG5cbmNvbnN0IHJlcW1vY2sgPSBleHRlbmQoe30sIHJlcXVlc3QsIHtcbiAgYmF0Y2hfZ2V0OiAocmVxcywgY2IpID0+IGdldHNweShyZXFzLCBjYilcbn0pO1xucmVxdWlyZS5jYWNoZVtyZXF1aXJlLnJlc29sdmUoJ2FiYWN1cy1yZXF1ZXN0JyldLmV4cG9ydHMgPSByZXFtb2NrO1xuXG4vLyBNb2NrIHRoZSBjbHVzdGVyIG1vZHVsZVxucmVxdWlyZS5jYWNoZVtyZXF1aXJlLnJlc29sdmUoJ2FiYWN1cy1jbHVzdGVyJyldLmV4cG9ydHMgPVxuICBleHRlbmQoKGFwcCkgPT4gYXBwLCBjbHVzdGVyKTtcblxuLy8gTW9jayB0aGUgb2F1dGggbW9kdWxlIHdpdGggYSBzcHlcbmNvbnN0IHZhbGlkYXRvcnNweSA9IHNweSgocmVxLCByZXMsIG5leHQpID0+IG5leHQoKSk7XG5jb25zdCBjYWNoZXNweSA9IHNweSgoKSA9PiB7XG4gIGNvbnN0IGYgPSAoKSA9PiB1bmRlZmluZWQ7XG4gIGYuc3RhcnQgPSAoKSA9PiB1bmRlZmluZWQ7XG4gIHJldHVybiBmO1xufSk7XG5jb25zdCBvYXV0aG1vY2sgPSBleHRlbmQoe30sIG9hdXRoLCB7XG4gIHZhbGlkYXRvcjogKCkgPT4gdmFsaWRhdG9yc3B5LFxuICBjYWNoZTogKCkgPT4gY2FjaGVzcHkoKVxufSk7XG5yZXF1aXJlLmNhY2hlW3JlcXVpcmUucmVzb2x2ZSgnYWJhY3VzLW9hdXRoJyldLmV4cG9ydHMgPSBvYXV0aG1vY2s7XG5cbmNvbnN0IGJ1aWxkV2luZG93ID0gKHFEYXksIHFNb250aCwgcywgY0RheSwgY01vbnRoLCBjaCkgPT4ge1xuICBjb25zdCB3aW5kb3dzID0gW1tudWxsXSwgW251bGxdLCBbbnVsbF0sIFt7fSwgbnVsbF0sIFt7fSwgbnVsbF1dO1xuICBjb25zdCBzZXRXaW5kb3dQcm9wZXJ0eSA9IChrLCB2RGF5LCB2TW9udGgpID0+IHtcbiAgICBpZih0eXBlb2YgdkRheSAhPT0gJ3VuZGVmaW5lZCcgJiYgdHlwZW9mIHZNb250aCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgIHdpbmRvd3NbM11bMF1ba10gPSB2RGF5O1xuICAgICAgd2luZG93c1s0XVswXVtrXSA9IHZNb250aDtcbiAgICB9XG4gIH07XG4gIHNldFdpbmRvd1Byb3BlcnR5KCdxdWFudGl0eScsIHFEYXksIHFNb250aCk7XG4gIHNldFdpbmRvd1Byb3BlcnR5KCdzdW1tYXJ5Jywgcywgcyk7XG4gIHNldFdpbmRvd1Byb3BlcnR5KCdjb3N0JywgY0RheSwgY01vbnRoKTtcbiAgc2V0V2luZG93UHJvcGVydHkoJ2NoYXJnZScsIGNoLCBjaCk7XG4gIHJldHVybiB3aW5kb3dzO1xufTtcblxuY29uc3QgcmVwb3J0ID0gcmVxdWlyZSgnLi4nKTtcblxuY29uc3Qgc3RvcmVBY2N1bXVsYXRlZFVzYWdlID0gKGFjY1VzYWdlLCBjYiA9ICgpID0+IHt9KSA9PiB7XG4gIGNvbnN0IGFjY3VtdWxhdG9yZGIgPSBkYXRhZmxvdy5kYignYWJhY3VzLWFjY3VtdWxhdG9yLWFjY3VtdWxhdGVkLXVzYWdlJyk7XG4gIHlpZWxkYWJsZS5mdW5jdGlvbmNiKGFjY3VtdWxhdG9yZGIucHV0KShleHRlbmQoe30sIGFjY1VzYWdlLCB7XG4gICAgX2lkOiBhY2NVc2FnZS5pZFxuICB9KSwgKGVyciwgdmFsKSA9PiB7XG4gICAgZXhwZWN0KGVycikudG8uZXF1YWwobnVsbCk7XG4gICAgY2IoKTtcbiAgfSk7XG59O1xuXG5jb25zdCBzdG9yZVJhdGVkVXNhZ2UgPSAocmF0ZWRVc2FnZSwgY2IgPSAoKSA9PiB7fSkgPT4ge1xuICBjb25zdCBhZ2dyZWdhdG9yZGIgPSBkYXRhZmxvdy5kYignYWJhY3VzLWFnZ3JlZ2F0b3ItYWdncmVnYXRlZC11c2FnZScpO1xuICB5aWVsZGFibGUuZnVuY3Rpb25jYihhZ2dyZWdhdG9yZGIucHV0KShleHRlbmQoe30sIHJhdGVkVXNhZ2UsIHtcbiAgICBfaWQ6IHJhdGVkVXNhZ2UuaWRcbiAgfSksIChlcnIsIHZhbCkgPT4ge1xuICAgIGV4cGVjdChlcnIpLnRvLmVxdWFsKG51bGwpO1xuICAgIGNiKCk7XG4gIH0pO1xufTtcblxuLy8gT3JnIGlkXG5jb25zdCBvaWQgPSAnYTNkN2ZlNGQtM2NiMS00Y2MzLWE4MzEtZmZlOThlMjBjZjI3Jztcbi8vIFNwYWNlIGlkXG5jb25zdCBzaWQgPSAnYWFlYWUyMzktZjNmOC00ODNjLTlkZDAtZGU1ZDQxYzM4YjZhJztcbi8vIE9uZSBvZiB0aGUgdHdvIGNvbnN1bWVycyBhdCBhIGdpdmVuIG9yZyBiYXNlZCBvbiBwbGFuIGlkLlxuY29uc3QgY2lkID0gKHApID0+IHAgIT09ICdzdGFuZGFyZCcgPyAnVU5LTk9XTicgOlxuICAnZXh0ZXJuYWw6YmJlYWUyMzktZjNmOC00ODNjLTlkZDAtZGU2NzgxYzM4YmFiJztcbi8vIGNvbnN0cnVjdCBjb25zdW1lciBkb2MgaWRcbmNvbnN0IGNkaWQgPSAob3JnaWQsIHNpZCwgY2lkLCB0KSA9PlxuICBbJ2snLCBvcmdpZCwgc2lkLCBjaWQsICd0JywgdF0uam9pbignLycpO1xuLy8gdGhlIG1ldGVyaW5nIHBsYW4gaWRcbmNvbnN0IG1waWQgPSAndGVzdC1tZXRlcmluZy1wbGFuJztcbi8vIHRoZSByYXRpbmcgcGxhbiBpZFxuY29uc3QgcnBpZCA9IChwKSA9PiBwICE9PSAnc3RhbmRhcmQnID8gJ3Rlc3QtcmF0aW5nLXBsYW4nIDpcbiAgJ3Rlc3QtcmF0aW5nLXBsYW4tc3RhbmRhcmQnO1xuLy8gdGhlIHByaWNpbmcgcGxhbiBpZFxuY29uc3QgcHBpZCA9IChwKSA9PiBwICE9PSAnc3RhbmRhcmQnID8gJ3Rlc3QtcHJpY2luZy1iYXNpYycgOlxuICAndGVzdC1wcmljaW5nLXN0YW5kYXJkJztcbi8vIHRoZSBwbGFuIGlkXG5jb25zdCBwaWQgPSAocCwgbXBpZCwgcnBpZCwgcHBpZCkgPT5cbiAgW3AsIG1waWQsIHJwaWQsIHBwaWRdLmpvaW4oJy8nKTtcblxuLy8gYWNjdW11bGF0ZWQgdXNhZ2UgaWRcbmNvbnN0IGFjY2lkID0gJ2svYTNkN2ZlNGQtM2NiMS00Y2MzLWE4MzEtZmZlOThlMjBjZjI3LycgK1xuICAnMGIzOWZhNzAtYTY1Zi00MTgzLWJhZTgtMzg1NjMzY2E1Yzg3L1VOS05PV04vYmFzaWMvJyArXG4gICd0ZXN0LW1ldGVyaW5nLXBsYW4vdGVzdC1yYXRpbmctcGxhbi8nICtcbiAgJ3Rlc3QtcHJpY2luZy1iYXNpYy90LzAwMDE0NDY0MTg4MDAwMDAnO1xuXG4vLyByZXNvdXJjZV9pbnN0YW5jZV9pZFxuY29uc3QgcmlkID0gJzBiMzlmYTcwLWE2NWYtNDE4My1iYWU4LTM4NTYzM2NhNWM4Nyc7XG5cbi8vIGNvc3QgLT4gY29zdCBmb3IgbWVtb3J5XG5jb25zdCBidWlsZEFnZ3JlZ2F0ZWRVc2FnZSA9IChzLCBsLCBoLCBtZCwgbW0sIHNjLCBsYywgaGMsIG1jLCBtcywgbWNoLFxuICBzdW1tYXJ5LCBjb3N0LCBjaGFyZ2UpID0+IFt7XG4gICAgbWV0cmljOiAnc3RvcmFnZScsXG4gICAgd2luZG93czogYnVpbGRXaW5kb3cocywgcywgc3VtbWFyeSAmJiBzLCBjb3N0ICYmIHNjLCBjb3N0ICYmIHNjLFxuICAgICAgY2hhcmdlICYmIHNjKVxuICB9LCB7XG4gICAgbWV0cmljOiAndGhvdXNhbmRfbGlnaHRfYXBpX2NhbGxzJyxcbiAgICB3aW5kb3dzOiBidWlsZFdpbmRvdyhsLCBsLCBzdW1tYXJ5ICYmIGwsIGNvc3QgJiYgbGMsIGNvc3QgJiYgbGMsXG4gICAgICBjaGFyZ2UgJiYgbGMpXG4gIH0sIHtcbiAgICBtZXRyaWM6ICdoZWF2eV9hcGlfY2FsbHMnLFxuICAgIHdpbmRvd3M6IGJ1aWxkV2luZG93KGgsIGgsIHN1bW1hcnkgJiYgaCwgY29zdCAmJiBoYywgY29zdCAmJiBoYyxcbiAgICAgIGNoYXJnZSAmJiBoYylcbiAgfSwge1xuICAgIG1ldHJpYzogJ21lbW9yeScsXG4gICAgd2luZG93czogYnVpbGRXaW5kb3cobWQsIG1tLCBzdW1tYXJ5ICYmIG1zLCBjb3N0ICYmIGV4dGVuZCh7fSwgbWQsIG1jKSxcbiAgICAgIGNvc3QgJiYgZXh0ZW5kKHt9LCBtbSwgbWMpLCBtY2gpXG4gIH1dO1xuXG5jb25zdCBwbGFuVGVtcGxhdGUgPSAocGxhbikgPT4gKHtcbiAgcGxhbl9pZDogcGxhbiB8fCAnYmFzaWMnLFxuICBtZXRlcmluZ19wbGFuX2lkOiBtcGlkLFxuICByYXRpbmdfcGxhbl9pZDogcnBpZChwbGFuKSxcbiAgcHJpY2luZ19wbGFuX2lkOiBwcGlkKHBsYW4pXG59KTtcblxuY29uc3QgYnVpbGRQbGFuVXNhZ2UgPSAocGxhbiwgcGxhblVzYWdlKSA9PiBleHRlbmQocGxhblRlbXBsYXRlKHBsYW4pLCB7XG4gIHBsYW5faWQ6IHBpZChwbGFuIHx8ICdiYXNpYycsIG1waWQsIHJwaWQocGxhbiksIHBwaWQocGxhbikpLFxuICBhZ2dyZWdhdGVkX3VzYWdlOiBwbGFuVXNhZ2Vcbn0pO1xuXG5jb25zdCByYXRlZENvbnN1bWVyVGVtcGxhdGUgPSAob3JnaWQsIHN0YXJ0LCBlbmQsIHBsYW4sIGEsIHAsXG4gICAgcHJvY2Vzc2VkLCBjb2lkKSA9PiAoe1xuICAgICAgaWQ6IGNkaWQob3JnaWQsIHNpZCwgY29pZCB8fCBjaWQocGxhbiksIHByb2Nlc3NlZCksXG4gICAgICBjb25zdW1lcl9pZDogY29pZCB8fCBjaWQocGxhbiksXG4gICAgICBvcmdhbml6YXRpb25faWQ6IG9yZ2lkLFxuICAgICAgcmVzb3VyY2VfaW5zdGFuY2VfaWQ6ICdyaWQnLFxuICAgICAgc3RhcnQ6IHN0YXJ0LFxuICAgICAgZW5kOiBlbmQsXG4gICAgICBwcm9jZXNzZWQ6IHByb2Nlc3NlZCxcbiAgICAgIHJlc291cmNlczogW3tcbiAgICAgICAgcmVzb3VyY2VfaWQ6ICd0ZXN0LXJlc291cmNlJyxcbiAgICAgICAgYWdncmVnYXRlZF91c2FnZTogYSxcbiAgICAgICAgcGxhbnM6IHBcbiAgICAgIH1dXG4gICAgfSk7XG5cbmNvbnN0IGNvbnN1bWVyUmVmZXJlbmNlVGVtcGxhdGUgPSAob3JnaWQsIHNpZCwgcGxhbiwgcHJvY2Vzc2VkLCBjb25pZCkgPT4gKHtcbiAgaWQ6IGNvbmlkIHx8IGNpZChwbGFuKSxcbiAgdDogcHJvY2Vzc2VkICsgJydcbn0pO1xuXG5jb25zdCBidWlsZFNwYWNlVXNhZ2UgPSAoYSwgcCwgYykgPT4gW3tcbiAgc3BhY2VfaWQ6IHNpZCxcbiAgcmVzb3VyY2VzOiBbe1xuICAgIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgYWdncmVnYXRlZF91c2FnZTogYSxcbiAgICBwbGFuczogcFxuICB9XSxcbiAgY29uc3VtZXJzOiBjXG59XTtcblxuY29uc3QgYnVpbGRSZXNvdXJjZVVzYWdlID0gKGEsIHApID0+IFt7XG4gIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gIGFnZ3JlZ2F0ZWRfdXNhZ2U6IGEsXG4gIHBsYW5zOiBwXG59XTtcblxuY29uc3QgcmF0ZWRUZW1wbGF0ZSA9IChpZCwgb3JnaWQsIHN0YXJ0LCBlbmQsIHByb2Nlc3NlZCwgYSwgcCwgYykgPT4gKHtcbiAgaWQ6IGlkLFxuICBvcmdhbml6YXRpb25faWQ6IG9yZ2lkLFxuICBhY2NvdW50X2lkOiAnMTIzNCcsXG4gIHJlc291cmNlX2luc3RhbmNlX2lkOiAncmlkJyxcbiAgY29uc3VtZXJfaWQ6ICdjaWQnLFxuICBzdGFydDogc3RhcnQsXG4gIGVuZDogZW5kLFxuICByZXNvdXJjZV9pZDogJ3Rlc3QtcmVzb3VyY2UnLFxuICBwbGFuX2lkOiAnYmFzaWMvdGVzdC1tZXRlcmluZy1wbGFuLycgK1xuICAgICd0ZXN0LXJhdGluZy1wbGFuL3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gIHByaWNpbmdfY291bnRyeTogJ1VTQScsXG4gIHByaWNlczoge1xuICAgIG1ldHJpY3M6IFtcbiAgICAgIHsgbmFtZTogJ2hlYXZ5X2FwaV9jYWxscycsIHByaWNlOiAwLjE1IH0sXG4gICAgICB7IG5hbWU6ICdsaWdodF9hcGlfY2FsbHMnLCBwcmljZTogMC4wMyB9LFxuICAgICAgeyBuYW1lOiAnc3RvcmFnZScsIHByaWNlOiAxIH1cbiAgICBdXG4gIH0sXG4gIHByb2Nlc3NlZDogcHJvY2Vzc2VkLFxuICByZXNvdXJjZXM6IGJ1aWxkUmVzb3VyY2VVc2FnZShhLCBwKSxcbiAgc3BhY2VzOiBidWlsZFNwYWNlVXNhZ2UoYSwgcCwgYylcbn0pO1xuXG5jb25zdCBwbGFuUmVwb3J0VGVtcGxhdGUgPSAocGxhbiwgcGxhblVzYWdlLCBwbGFuV2luZG93KSA9PlxuICBleHRlbmQoYnVpbGRQbGFuVXNhZ2UocGxhbiwgcGxhblVzYWdlKSwgeyB3aW5kb3dzOiBwbGFuV2luZG93IH0pO1xuXG5jb25zdCBjb25zdW1lclJlcG9ydFRlbXBsYXRlID0gKHBsYW4sIGEsIHAsIHBsYW5XaW5kb3cpID0+ICh7XG4gIGNvbnN1bWVyX2lkOiBjaWQocGxhbiksXG4gIHdpbmRvd3M6IHBsYW5XaW5kb3csXG4gIHJlc291cmNlczogW3tcbiAgICByZXNvdXJjZV9pZDogJ3Rlc3QtcmVzb3VyY2UnLFxuICAgIHdpbmRvd3M6IHBsYW5XaW5kb3csXG4gICAgYWdncmVnYXRlZF91c2FnZTogYSxcbiAgICBwbGFuczogcFxuICB9XVxufSk7XG5cbmNvbnN0IHNwYWNlUmVwb3J0VGVtcGxhdGUgPSAodHcsIGF1LCBwbGFucywgY29uc3VtZXJzKSA9PiBbe1xuICBzcGFjZV9pZDogc2lkLFxuICB3aW5kb3dzOiB0dyxcbiAgcmVzb3VyY2VzOiBbe1xuICAgIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgd2luZG93czogdHcsXG4gICAgYWdncmVnYXRlZF91c2FnZTogYXUsXG4gICAgcGxhbnM6IHBsYW5zXG4gIH1dLFxuICBjb25zdW1lcnM6IGNvbnN1bWVyc1xufV07XG5cbmNvbnN0IHJlcG9ydFRlbXBsYXRlID0gKGlkLCB0dywgYXUsIHBsYW5zLCBjb25zdW1lcnMpID0+ICh7XG4gIGlkOiBpZCxcbiAgb3JnYW5pemF0aW9uX2lkOiBvaWQsXG4gIGFjY291bnRfaWQ6ICcxMjM0JyxcbiAgc3RhcnQ6IDE0MjA1MDI0MDAwMDAsXG4gIGVuZDogMTQyMDUwMjUwMDAwMCxcbiAgcHJvY2Vzc2VkOiAxNDIwNTAyNTAwMDAwLFxuICB3aW5kb3dzOiB0dyxcbiAgcmVzb3VyY2VzOiBbe1xuICAgIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgd2luZG93czogdHcsXG4gICAgYWdncmVnYXRlZF91c2FnZTogYXUsXG4gICAgcGxhbnM6IHBsYW5zXG4gIH1dLFxuICBzcGFjZXM6IHNwYWNlUmVwb3J0VGVtcGxhdGUodHcsIGF1LCBwbGFucywgY29uc3VtZXJzKVxufSk7XG5cbmNvbnN0IGJ1aWxkQWNjdW11bGF0ZWRVc2FnZSA9IChzLCBsLCBoLCBzYywgbGMsIGhjLFxuICBzdW1tYXJ5LCBjb3N0LCBjaGFyZ2UpID0+IFt7XG4gICAgbWV0cmljOiAnc3RvcmFnZScsXG4gICAgd2luZG93czogYnVpbGRXaW5kb3cocywgcywgc3VtbWFyeSAmJiBzLCBjb3N0ICYmIHNjLCBjb3N0ICYmIHNjLFxuICAgICAgY2hhcmdlICYmIHNjKVxuICB9LCB7XG4gICAgbWV0cmljOiAndGhvdXNhbmRfbGlnaHRfYXBpX2NhbGxzJyxcbiAgICB3aW5kb3dzOiBidWlsZFdpbmRvdyhsLCBsLCBzdW1tYXJ5ICYmIGwsIGNvc3QgJiYgbGMsIGNvc3QgJiYgbGMsXG4gICAgICBjaGFyZ2UgJiYgbGMpXG4gIH0sIHtcbiAgICBtZXRyaWM6ICdoZWF2eV9hcGlfY2FsbHMnLFxuICAgIHdpbmRvd3M6IGJ1aWxkV2luZG93KGgsIGgsIHN1bW1hcnkgJiYgaCwgY29zdCAmJiBoYywgY29zdCAmJiBoYyxcbiAgICAgIGNoYXJnZSAmJiBoYylcbiAgfV07XG5cbmNvbnN0IGFjY3VtdWxhdGVkVGVtcGxhdGUgPSAoYWNjKSA9PiBleHRlbmQocGxhblRlbXBsYXRlKCksIHtcbiAgaWQ6IGFjY2lkLFxuICBvcmdhbml6YXRpb25faWQ6IG9pZCxcbiAgc3BhY2VfaWQ6IHNpZCxcbiAgcmVzb3VyY2VfaWQ6ICd0ZXN0LXJlc291cmNlJyxcbiAgY29uc3VtZXJfaWQ6ICdVTktOT1dOJyxcbiAgcmVzb3VyY2VfaW5zdGFuY2VfaWQ6IHJpZCxcbiAgc3RhcnQ6IDE0NDY0MTUyMDAwMDAsXG4gIGVuZDogMTQ0NjQxNTIwMDAwMCxcbiAgcHJvY2Vzc2VkOiAxNDQ2NDE4ODAwMDAwLFxuICBhY2N1bXVsYXRlZF91c2FnZTogYWNjXG59KTtcblxuZGVzY3JpYmUoJ2FiYWN1cy11c2FnZS1yZXBvcnQnLCAoKSA9PiB7XG4gIGJlZm9yZSgoZG9uZSkgPT4ge1xuICAgIC8vIERlbGV0ZSB0ZXN0IGRicyBvbiB0aGUgY29uZmlndXJlZCBkYiBzZXJ2ZXJcbiAgICBkYmNsaWVudC5kcm9wKHByb2Nlc3MuZW52LkRCLFxuICAgICAgL15hYmFjdXMtYWdncmVnYXRvcnxeYWJhY3VzLWFjY3VtdWxhdG9yLywgZG9uZSk7XG4gIH0pO1xuXG4gIC8vIENvbnZlbmllbnQgdGVzdCBjYXNlOlxuICAvLyBTcGFjZSBBLCBjb25zdW1lciBBLCBwbGFuIGJhc2ljIGJhc2ljL2Jhc2ljL2Jhc2ljXG4gIGNvbnN0IHBsYW5BVXNhZ2UgPSBidWlsZEFnZ3JlZ2F0ZWRVc2FnZSgxLCAxMDAsIDMwMCwge1xuICAgIGNvbnN1bWVkOiA0NzUyMDAwMDAsXG4gICAgY29uc3VtaW5nOiA2XG4gIH0sIHtcbiAgICBjb25zdW1lZDogMTA4NDMyMDAwMDAsXG4gICAgY29uc3VtaW5nOiA2XG4gIH0sIDEsIDMsIDQ1LCB7IHByaWNlOiAwLjAwMDE0IH0sIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHRydWUpO1xuXG4gIC8vIFNwYWNlIEEsIGNvbnN1bWVyIEIsIHBsYW4gc3RhbmRhcmQvYmFzaWMvc3RhbmRhcmQvc3RhbmRhcmRcbiAgY29uc3QgcGxhbkJVc2FnZSA9IGJ1aWxkQWdncmVnYXRlZFVzYWdlKDIwLCAyMDAsIDMwMDAsIHtcbiAgICBjb25zdW1lZDogNjMzNjAwMDAwLFxuICAgIGNvbnN1bWluZzogOFxuICB9LCB7XG4gICAgY29uc3VtZWQ6IDE0NDU3NjAwMDAwLFxuICAgIGNvbnN1bWluZzogOFxuICB9LCAxMCwgOCwgNTQwLCB7IHByaWNlOiAwLjAwMDI4IH0sIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHRydWUpO1xuXG4gIGNvbnRleHQoJ3doZW4gcmF0ZWQgdXNhZ2UgY29udGFpbnMgc21hbGwgbnVtYmVycycsICgpID0+IHtcbiAgICBiZWZvcmUoKGRvbmUpID0+IHtcbiAgICAgIC8vIERvYyBpZFxuICAgICAgY29uc3QgaWQgPSAnay9hM2Q3ZmU0ZC0zY2IxLTRjYzMtYTgzMS1mZmU5OGUyMGNmMjcvdC8wMDAxNDIwNTAyNDAwMDAwJztcbiAgICAgIGNvbnN0IG9yZ2lkID0gJ2EzZDdmZTRkLTNjYjEtNGNjMy1hODMxLWZmZTk4ZTIwY2YyNyc7XG5cbiAgICAgIGNvbnN0IHJhdGVkID0gcmF0ZWRUZW1wbGF0ZShpZCwgb2lkLCAxNDIwNTAyNDAwMDAwLCAxNDIwNTAyNTAwMDAwLFxuICAgICAgICAxNDIwNTAyNTAwMDAwLCBidWlsZEFnZ3JlZ2F0ZWRVc2FnZSgyMSwgMzAwLCAzMzAwLCB7XG4gICAgICAgICAgY29uc3VtZWQ6IDExMDg4MDAwMDAsXG4gICAgICAgICAgY29uc3VtaW5nOiAxNFxuICAgICAgICB9LCB7XG4gICAgICAgICAgY29uc3VtZWQ6IDI1MzAwODAwMDAwLFxuICAgICAgICAgIGNvbnN1bWluZzogMTRcbiAgICAgICAgfSksIFtcbiAgICAgICAgICBidWlsZFBsYW5Vc2FnZSgnYmFzaWMnLCBwbGFuQVVzYWdlKSxcbiAgICAgICAgICBidWlsZFBsYW5Vc2FnZSgnc3RhbmRhcmQnLCBwbGFuQlVzYWdlKVxuICAgICAgICBdLCBbXG4gICAgICAgICAgY29uc3VtZXJSZWZlcmVuY2VUZW1wbGF0ZShvcmdpZCwgc2lkLCAnYmFzaWMnLCAxNDIwNTAyNTAwMDAwLFxuICAgICAgICAgICAnVU5LTk9XTicpLFxuICAgICAgICAgIGNvbnN1bWVyUmVmZXJlbmNlVGVtcGxhdGUob3JnaWQsIHNpZCwgJ3N0YW5kYXJkJywgMTQyMDUwMjUwMDAwMCxcbiAgICAgICAgICAgJ2V4dGVybmFsOmJiZWFlMjM5LWYzZjgtNDgzYy05ZGQwLWRlNjc4MWMzOGJhYicpXG4gICAgICAgIF0pO1xuXG4gICAgICBjb25zdCBjb25zdW1lcjEgPSByYXRlZENvbnN1bWVyVGVtcGxhdGUob3JnaWQsIDE0MjA1MDI0MDAwMDAsXG4gICAgICAgIDE0MjA1MDI1MDAwMDAsICdiYXNpYycsXG4gICAgICAgIGJ1aWxkQWdncmVnYXRlZFVzYWdlKDEsIDEwMCwgMzAwLCB7XG4gICAgICAgICAgY29uc3VtZWQ6IDQ3NTIwMDAwMCxcbiAgICAgICAgICBjb25zdW1pbmc6IDZcbiAgICAgICAgfSwge1xuICAgICAgICAgIGNvbnN1bWVkOiAxMDg0MzIwMDAwMCxcbiAgICAgICAgICBjb25zdW1pbmc6IDZcbiAgICAgICAgfSksIFtidWlsZFBsYW5Vc2FnZSgnYmFzaWMnLCBwbGFuQVVzYWdlKV0sIDE0MjA1MDI1MDAwMDApO1xuXG4gICAgICBjb25zdCBjb25zdW1lcjIgPSByYXRlZENvbnN1bWVyVGVtcGxhdGUob3JnaWQsIDE0MjA1MDI0MDAwMDAsXG4gICAgICAgIDE0MjA1MDI1MDAwMDAsICdzdGFuZGFyZCcsXG4gICAgICAgIGJ1aWxkQWdncmVnYXRlZFVzYWdlKDIwLCAyMDAsIDMwMDAsIHtcbiAgICAgICAgICBjb25zdW1lZDogNjMzNjAwMDAwLFxuICAgICAgICAgIGNvbnN1bWluZzogOFxuICAgICAgICB9LCB7XG4gICAgICAgICAgY29uc3VtZWQ6IDE0NDU3NjAwMDAwLFxuICAgICAgICAgIGNvbnN1bWluZzogOFxuICAgICAgICB9KSwgW2J1aWxkUGxhblVzYWdlKCdzdGFuZGFyZCcsIHBsYW5CVXNhZ2UpXSwgMTQyMDUwMjUwMDAwMCk7XG5cbiAgICAgIHN0b3JlUmF0ZWRVc2FnZShyYXRlZCwgKCkgPT4gc3RvcmVSYXRlZFVzYWdlKGNvbnN1bWVyMSxcbiAgICAgICAgKCkgPT4gc3RvcmVSYXRlZFVzYWdlKGNvbnN1bWVyMiwgZG9uZSkpKTtcbiAgICB9KTtcblxuICAgIGl0KCdyZXRyaWV2ZXMgcmF0ZWQgdXNhZ2UgZm9yIGFuIG9yZ2FuaXphdGlvbicsIChkb25lKSA9PiB7XG4gICAgICAvLyBEZWZpbmUgdGhlIGV4cGVjdGVkIHVzYWdlIHJlcG9ydFxuICAgICAgY29uc3QgcGxhbkFSZXBvcnQgPSBwbGFuUmVwb3J0VGVtcGxhdGUoJ2Jhc2ljJywgYnVpbGRBZ2dyZWdhdGVkVXNhZ2UoMSxcbiAgICAgICAgMTAwLCAzMDAsIHtcbiAgICAgICAgICBjb25zdW1lZDogNDc1MjAwMDAwLFxuICAgICAgICAgIGNvbnN1bWluZzogNlxuICAgICAgICB9LCB7XG4gICAgICAgICAgY29uc3VtZWQ6IDEwODQzMjAwMDAwLFxuICAgICAgICAgIGNvbnN1bWluZzogNlxuICAgICAgICB9LCAxLCAzLCA0NSwgeyBwcmljZTogMC4wMDAxNCB9LCAxMTQsIDAuMDE1OTYsIHRydWUsIHRydWUsIHRydWUpLFxuICAgICAgICBidWlsZFdpbmRvdyh1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgNDkuMDE1OTYpKTtcbiAgICAgIGNvbnN0IHBsYW5CUmVwb3J0ID0gcGxhblJlcG9ydFRlbXBsYXRlKCdzdGFuZGFyZCcsIGJ1aWxkQWdncmVnYXRlZFVzYWdlKFxuICAgICAgICAyMCwgMjAwLCAzMDAwLCB7XG4gICAgICAgICAgY29uc3VtZWQ6IDYzMzYwMDAwMCxcbiAgICAgICAgICBjb25zdW1pbmc6IDhcbiAgICAgICAgfSwge1xuICAgICAgICAgIGNvbnN1bWVkOiAxNDQ1NzYwMDAwMCxcbiAgICAgICAgICBjb25zdW1pbmc6IDhcbiAgICAgICAgfSwgMTAsIDgsIDU0MCwgeyBwcmljZTogMC4wMDAyOCB9LCAxNTIsIDAuMDQyNTYsIHRydWUsIHRydWUsIHRydWUpLFxuICAgICAgICBidWlsZFdpbmRvdyh1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgICAgdW5kZWZpbmVkLCA1NTguMDQyNTYpKTtcblxuICAgICAgY29uc3QgY29uc3VtZXIxID0gY29uc3VtZXJSZXBvcnRUZW1wbGF0ZSgnYmFzaWMnLCBidWlsZEFnZ3JlZ2F0ZWRVc2FnZShcbiAgICAgICAgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLFxuICAgICAgICB1bmRlZmluZWQsXG4gICAgICAgIDEsIDMsIDQ1LCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgMC4wMTU5NiwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgIHRydWUpLCBbcGxhbkFSZXBvcnRdLCBidWlsZFdpbmRvdyh1bmRlZmluZWQsXG4gICAgICAgIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgNDkuMDE1OTYpKTtcbiAgICAgIGNvbnN0IGNvbnN1bWVyMiA9IGNvbnN1bWVyUmVwb3J0VGVtcGxhdGUoJ3N0YW5kYXJkJywgYnVpbGRBZ2dyZWdhdGVkVXNhZ2UoXG4gICAgICAgIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLFxuICAgICAgICAxMCwgOCwgNTQwLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgMC4wNDI1NiwgdW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgIHRydWUpLCBbcGxhbkJSZXBvcnRdLCBidWlsZFdpbmRvdyh1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgICB1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCA1NTguMDQyNTYpKTtcblxuICAgICAgY29uc3QgaWQgPSAnay9hM2Q3ZmU0ZC0zY2IxLTRjYzMtYTgzMS1mZmU5OGUyMGNmMjcvdC8wMDAxNDIwNTAyNDAwMDAwJztcblxuICAgICAgY29uc3QgZXhwZWN0ZWQgPSByZXBvcnRUZW1wbGF0ZShpZCwgYnVpbGRXaW5kb3codW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIDYwNy4wNTg1MiksXG4gICAgICAgIGJ1aWxkQWdncmVnYXRlZFVzYWdlKHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgICB1bmRlZmluZWQsIDExLCAxMSwgNTg1LCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgMC4wNTg1MixcbiAgICAgICAgICB1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgdHJ1ZSksIFtwbGFuQVJlcG9ydCwgcGxhbkJSZXBvcnRdLCBbY29uc3VtZXIxLCBjb25zdW1lcjJdKTtcblxuICAgICAgY29uc3QgdmVyaWZ5ID0gKHNlY3VyZWQsIGRvbmUpID0+IHtcbiAgICAgICAgcHJvY2Vzcy5lbnYuU0VDVVJFRCA9IHNlY3VyZWQgPyAndHJ1ZScgOiAnZmFsc2UnO1xuICAgICAgICB2YWxpZGF0b3JzcHkucmVzZXQoKTtcblxuICAgICAgICAvLyBDcmVhdGUgYSB0ZXN0IHJlcG9ydCBhcHBcbiAgICAgICAgY29uc3QgYXBwID0gcmVwb3J0KCk7XG5cbiAgICAgICAgLy8gTGlzdGVuIG9uIGFuIGVwaGVtZXJhbCBwb3J0XG4gICAgICAgIGNvbnN0IHNlcnZlciA9IGFwcC5saXN0ZW4oMCk7XG5cbiAgICAgICAgbGV0IGNicyA9IDA7XG4gICAgICAgIGNvbnN0IGNiID0gKCkgPT4ge1xuICAgICAgICAgIGlmKCsrY2JzID09PSAyKSB7XG4gICAgICAgICAgICAvLyBDaGVjayBvYXV0aCB2YWxpZGF0b3Igc3B5XG4gICAgICAgICAgICBleHBlY3QodmFsaWRhdG9yc3B5LmNhbGxDb3VudCkudG8uZXF1YWwoc2VjdXJlZCA/IDIgOiAwKTtcblxuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfTtcblxuICAgICAgICAvLyBHZXQgdGhlIHJhdGVkIHVzYWdlXG4gICAgICAgIHJlcXVlc3QuZ2V0KFxuICAgICAgICAgICdodHRwOi8vbG9jYWxob3N0OjpwL3YxL21ldGVyaW5nL29yZ2FuaXphdGlvbnMvJyArXG4gICAgICAgICAgJzpvcmdhbml6YXRpb25faWQvYWdncmVnYXRlZC91c2FnZS86dGltZScsIHtcbiAgICAgICAgICAgIHA6IHNlcnZlci5hZGRyZXNzKCkucG9ydCxcbiAgICAgICAgICAgIG9yZ2FuaXphdGlvbl9pZDogb2lkLFxuICAgICAgICAgICAgdGltZTogMTQyMDU3NDQwMDAwMFxuICAgICAgICAgIH0sIChlcnIsIHZhbCkgPT4ge1xuICAgICAgICAgICAgZXhwZWN0KGVycikudG8uZXF1YWwodW5kZWZpbmVkKTtcblxuICAgICAgICAgICAgLy8gRXhwZWN0IG91ciB0ZXN0IHJhdGVkIHVzYWdlXG4gICAgICAgICAgICBleHBlY3QodmFsLnN0YXR1c0NvZGUpLnRvLmVxdWFsKDIwMCk7XG4gICAgICAgICAgICBleHBlY3QodmFsLmJvZHkpLnRvLmRlZXAuZXF1YWwoZXhwZWN0ZWQpO1xuICAgICAgICAgICAgY2IoKTtcbiAgICAgICAgICB9KTtcblxuICAgICAgICAvLyBBdHRlbXB0IHRvIGdldCB0aGUgcmF0ZWQgdXNhZ2UgZm9yIGEgdGltZSBpbiB0aGUgbmV4dCBtb250aFxuICAgICAgICByZXF1ZXN0LmdldChcbiAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDo6cC92MS9tZXRlcmluZy9vcmdhbml6YXRpb25zLycgK1xuICAgICAgICAgICc6b3JnYW5pemF0aW9uX2lkL2FnZ3JlZ2F0ZWQvdXNhZ2UvOnRpbWUnLCB7XG4gICAgICAgICAgICBwOiBzZXJ2ZXIuYWRkcmVzcygpLnBvcnQsXG4gICAgICAgICAgICBvcmdhbml6YXRpb25faWQ6IG9pZCxcbiAgICAgICAgICAgIHRpbWU6IDE0MjI5MjE4MDAwMDBcbiAgICAgICAgICB9LCAoZXJyLCB2YWwpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdChlcnIpLnRvLmVxdWFsKHVuZGVmaW5lZCk7XG5cbiAgICAgICAgICAgIC8vIEV4cGVjdCBhbiBlbXB0eSB1c2FnZSByZXBvcnQgZm9yIHRoZSBtb250aFxuICAgICAgICAgICAgZXhwZWN0KHZhbC5zdGF0dXNDb2RlKS50by5lcXVhbCgyMDApO1xuICAgICAgICAgICAgZXhwZWN0KHZhbC5ib2R5KS50by5kZWVwLmVxdWFsKHtcbiAgICAgICAgICAgICAgaWQ6ICdrL2EzZDdmZTRkLTNjYjEtNGNjMy1hODMxLWZmZTk4ZTIwY2YyNy90LzAwMDE0MjI5MjE4MDAwMDAnLFxuICAgICAgICAgICAgICBvcmdhbml6YXRpb25faWQ6IG9pZCxcbiAgICAgICAgICAgICAgc3RhcnQ6IDE0MjI3NDg4MDAwMDAsXG4gICAgICAgICAgICAgIGVuZDogMTQyMjkyMTgwMDAwMCxcbiAgICAgICAgICAgICAgcmVzb3VyY2VzOiBbXSxcbiAgICAgICAgICAgICAgc3BhY2VzOiBbXVxuICAgICAgICAgICAgfSk7XG4gICAgICAgICAgICBjYigpO1xuICAgICAgICAgIH0pO1xuICAgICAgfTtcblxuICAgICAgLy8gVmVyaWZ5IHVzaW5nIGFuIHVuc2VjdXJlZCBzZXJ2ZXIgYW5kIHRoZW4gdmVyaWZ5IHVzaW5nIGEgc2VjdXJlZCBzZXJ2ZXJcbiAgICAgIHZlcmlmeShmYWxzZSwgKCkgPT4gdmVyaWZ5KHRydWUsIGRvbmUpKTtcbiAgICB9KTtcblxuICAgIGl0KCdxdWVyaWVzIHJhdGVkIHVzYWdlIGZvciBhbiBvcmdhbml6YXRpb24nLCAoZG9uZSkgPT4ge1xuXG4gICAgICAvLyBEZWZpbmUgYSBHcmFwaFFMIHF1ZXJ5IGFuZCB0aGUgY29ycmVzcG9uZGluZyBleHBlY3RlZCByZXN1bHRcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gJ3sgb3JnYW5pemF0aW9uKG9yZ2FuaXphdGlvbl9pZDogJyArXG4gICAgICAgICdcImEzZDdmZTRkLTNjYjEtNGNjMy1hODMxLWZmZTk4ZTIwY2YyN1wiLCB0aW1lOiAxNDIwNTc0NDAwMDAwKSB7ICcgK1xuICAgICAgICAnb3JnYW5pemF0aW9uX2lkLCB3aW5kb3dzIHsgY2hhcmdlIH0sIHJlc291cmNlcyB7IHJlc291cmNlX2lkLCAnICtcbiAgICAgICAgJ2FnZ3JlZ2F0ZWRfdXNhZ2UgeyBtZXRyaWMsIHdpbmRvd3MgeyBjaGFyZ2UgfSB9fX19JztcblxuICAgICAgY29uc3QgZXhwZWN0ZWQgPSB7XG4gICAgICAgIG9yZ2FuaXphdGlvbjoge1xuICAgICAgICAgIG9yZ2FuaXphdGlvbl9pZDogJ2EzZDdmZTRkLTNjYjEtNGNjMy1hODMxLWZmZTk4ZTIwY2YyNycsXG4gICAgICAgICAgd2luZG93czogYnVpbGRXaW5kb3codW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgdW5kZWZpbmVkLFxuICAgICAgICAgICAgdW5kZWZpbmVkLCA2MDcuMDU4NTIpLFxuICAgICAgICAgIHJlc291cmNlczogW3tcbiAgICAgICAgICAgIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgICAgICAgICBhZ2dyZWdhdGVkX3VzYWdlOiBidWlsZEFnZ3JlZ2F0ZWRVc2FnZSh1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgMTEsIDExLCA1ODUsIHVuZGVmaW5lZCxcbiAgICAgICAgICAgICAgdW5kZWZpbmVkLCAwLjA1ODUyLCB1bmRlZmluZWQsIHVuZGVmaW5lZCwgdHJ1ZSlcbiAgICAgICAgICB9XVxuICAgICAgICB9XG4gICAgICB9O1xuXG4gICAgICBjb25zdCB2ZXJpZnkgPSAoc2VjdXJlZCwgZG9uZSkgPT4ge1xuICAgICAgICBwcm9jZXNzLmVudi5TRUNVUkVEID0gc2VjdXJlZCA/ICd0cnVlJyA6ICdmYWxzZSc7XG4gICAgICAgIHZhbGlkYXRvcnNweS5yZXNldCgpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBhIHRlc3QgcmVwb3J0IGFwcFxuICAgICAgICBjb25zdCBhcHAgPSByZXBvcnQoKTtcblxuICAgICAgICAvLyBMaXN0ZW4gb24gYW4gZXBoZW1lcmFsIHBvcnRcbiAgICAgICAgY29uc3Qgc2VydmVyID0gYXBwLmxpc3RlbigwKTtcblxuICAgICAgICAvLyBHZXQgdGhlIHJhdGVkIHVzYWdlXG4gICAgICAgIHJlcXVlc3QuZ2V0KFxuICAgICAgICAgICdodHRwOi8vbG9jYWxob3N0OjpwL3YxL21ldGVyaW5nL2FnZ3JlZ2F0ZWQvdXNhZ2UvZ3JhcGgvOnF1ZXJ5Jywge1xuICAgICAgICAgICAgcDogc2VydmVyLmFkZHJlc3MoKS5wb3J0LFxuICAgICAgICAgICAgcXVlcnk6IHF1ZXJ5XG4gICAgICAgICAgfSwgKGVyciwgdmFsKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZXJyKS50by5lcXVhbCh1bmRlZmluZWQpO1xuXG4gICAgICAgICAgICAvLyBFeHBlY3Qgb3VyIHRlc3QgcmF0ZWQgdXNhZ2VcbiAgICAgICAgICAgIGV4cGVjdCh2YWwuc3RhdHVzQ29kZSkudG8uZXF1YWwoMjAwKTtcbiAgICAgICAgICAgIGV4cGVjdCh2YWwuYm9keSkudG8uZGVlcC5lcXVhbChleHBlY3RlZCk7XG5cbiAgICAgICAgICAgIC8vIENoZWNrIG9hdXRoIHZhbGlkYXRvciBzcHlcbiAgICAgICAgICAgIGV4cGVjdCh2YWxpZGF0b3JzcHkuY2FsbENvdW50KS50by5lcXVhbChzZWN1cmVkID8gMSA6IDApO1xuXG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9O1xuXG4gICAgICAvLyBWZXJpZnkgdXNpbmcgYW4gdW5zZWN1cmVkIHNlcnZlciBhbmQgdGhlbiB2ZXJpZnkgdXNpbmcgYSBzZWN1cmVkIHNlcnZlclxuICAgICAgdmVyaWZ5KGZhbHNlLCAoKSA9PiB2ZXJpZnkodHJ1ZSwgZG9uZSkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3F1ZXJpZXMgcmF0ZWQgdXNhZ2UgdXNpbmcgR3JhcGhRTCBxdWVyaWVzJywgKGRvbmUpID0+IHtcblxuICAgICAgLy8gRGVmaW5lIHRoZSBHcmFwaFFMIHF1ZXJ5IGFuZCB0aGUgY29ycmVzcG9uZGluZyBleHBlY3RlZCByZXN1bHRcbiAgICAgIGNvbnN0IHF1ZXJ5ID0gJ3sgb3JnYW5pemF0aW9ucyhvcmdhbml6YXRpb25faWRzOiAnICtcbiAgICAgICAgJ1tcImEzZDdmZTRkLTNjYjEtNGNjMy1hODMxLWZmZTk4ZTIwY2YyN1wiXSwgdGltZTogMTQyMDU3NDQwMDAwMCkgeyAnICtcbiAgICAgICAgJ29yZ2FuaXphdGlvbl9pZCwgd2luZG93cyB7IGNoYXJnZSB9LCByZXNvdXJjZXMgeyByZXNvdXJjZV9pZCwgJyArXG4gICAgICAgICdhZ2dyZWdhdGVkX3VzYWdlIHsgbWV0cmljLCB3aW5kb3dzIHsgY2hhcmdlIH19fX19JztcbiAgICAgIGNvbnN0IGV4cGVjdGVkID0ge1xuICAgICAgICBvcmdhbml6YXRpb25zOiBbe1xuICAgICAgICAgIG9yZ2FuaXphdGlvbl9pZDogb2lkLFxuICAgICAgICAgIHdpbmRvd3M6IGJ1aWxkV2luZG93KHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHVuZGVmaW5lZCxcbiAgICAgICAgICAgIHVuZGVmaW5lZCwgNjA3LjA1ODUyKSxcbiAgICAgICAgICByZXNvdXJjZXM6IFt7XG4gICAgICAgICAgICByZXNvdXJjZV9pZDogJ3Rlc3QtcmVzb3VyY2UnLFxuICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogYnVpbGRBZ2dyZWdhdGVkVXNhZ2UodW5kZWZpbmVkLCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIDExLCAxMSwgNTg1LCB1bmRlZmluZWQsXG4gICAgICAgICAgICAgIHVuZGVmaW5lZCwgMC4wNTg1MiwgdW5kZWZpbmVkLCB1bmRlZmluZWQsIHRydWUpXG4gICAgICAgICAgfV1cbiAgICAgICAgfV1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHZlcmlmeSA9IChzZWN1cmVkLCBkb25lKSA9PiB7XG4gICAgICAgIHByb2Nlc3MuZW52LlNFQ1VSRUQgPSBzZWN1cmVkID8gJ3RydWUnIDogJ2ZhbHNlJztcbiAgICAgICAgdmFsaWRhdG9yc3B5LnJlc2V0KCk7XG5cbiAgICAgICAgLy8gQ3JlYXRlIGEgdGVzdCByZXBvcnQgYXBwXG4gICAgICAgIGNvbnN0IGFwcCA9IHJlcG9ydCgpO1xuXG4gICAgICAgIC8vIExpc3RlbiBvbiBhbiBlcGhlbWVyYWwgcG9ydFxuICAgICAgICBjb25zdCBzZXJ2ZXIgPSBhcHAubGlzdGVuKDApO1xuXG4gICAgICAgIGxldCBjYnMgPSAwO1xuICAgICAgICBjb25zdCBjYiA9ICgpID0+IHtcbiAgICAgICAgICBpZiAoKytjYnMgPT09IDQpIHtcbiAgICAgICAgICAgIC8vIENoZWNrIG9hdXRoIHZhbGlkYXRvciBzcHlcbiAgICAgICAgICAgIGV4cGVjdCh2YWxpZGF0b3JzcHkuY2FsbENvdW50KS50by5lcXVhbChzZWN1cmVkID8gNiA6IDApO1xuXG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEdldCB0aGUgcmF0ZWQgdXNhZ2VcbiAgICAgICAgYnJlcXVlc3QuZ2V0KFxuICAgICAgICAgICdodHRwOi8vbG9jYWxob3N0OjpwL3YxL21ldGVyaW5nL2FnZ3JlZ2F0ZWQvdXNhZ2UvZ3JhcGgvOnF1ZXJ5Jywge1xuICAgICAgICAgICAgcDogc2VydmVyLmFkZHJlc3MoKS5wb3J0LFxuICAgICAgICAgICAgcXVlcnk6IHF1ZXJ5XG4gICAgICAgICAgfSwgKGVyciwgdmFsKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZXJyKS50by5lcXVhbCh1bmRlZmluZWQpO1xuXG4gICAgICAgICAgICAvLyBFeHBlY3Qgb3VyIHRlc3QgcmF0ZWQgdXNhZ2VcbiAgICAgICAgICAgIGV4cGVjdCh2YWwuc3RhdHVzQ29kZSkudG8uZXF1YWwoMjAwKTtcbiAgICAgICAgICAgIGV4cGVjdCh2YWwuYm9keSkudG8uZGVlcC5lcXVhbChleHBlY3RlZCk7XG5cbiAgICAgICAgICAgIGNiKCk7XG4gICAgICAgICAgfSk7XG5cbiAgICAgICAgLy8gVW5hdXRob3JpemVkIG9yZ2FuaXphdGlvbnMgYW5kIGFjY291bnQgcXVlcmllc1xuICAgICAgICBjb25zdCB1cXVlcmllcyA9IFsneyBvcmdhbml6YXRpb25zKG9yZ2FuaXphdGlvbl9pZHM6ICcgK1xuICAgICAgICAgICdbXCJ1bmF1dGhvcml6ZWRcIl0pIHsgJyArXG4gICAgICAgICAgJ29yZ2FuaXphdGlvbl9pZCwgd2luZG93cyB7IGNoYXJnZSB9LCByZXNvdXJjZXMgeyByZXNvdXJjZV9pZCwgJyArXG4gICAgICAgICAgJ2FnZ3JlZ2F0ZWRfdXNhZ2UgeyBtZXRyaWMsIHdpbmRvd3MgeyBjaGFyZ2UgfX19fX0nLFxuICAgICAgICAgICd7IG9yZ2FuaXphdGlvbihvcmdhbml6YXRpb25faWQ6ICcgK1xuICAgICAgICAgICdcInVuYXV0aG9yaXplZFwiKSB7ICcgK1xuICAgICAgICAgICdvcmdhbml6YXRpb25faWQsIHdpbmRvd3MgeyBjaGFyZ2UgfSwgcmVzb3VyY2VzIHsgcmVzb3VyY2VfaWQsICcgK1xuICAgICAgICAgICdhZ2dyZWdhdGVkX3VzYWdlIHsgbWV0cmljLCB3aW5kb3dzIHsgY2hhcmdlIH19fX19JyxcbiAgICAgICAgICAneyBhY2NvdW50KGFjY291bnRfaWQ6ICcgK1xuICAgICAgICAgICdcInVuYXV0aG9yaXplZFwiKSB7ICcgK1xuICAgICAgICAgICdvcmdhbml6YXRpb25faWQsIHdpbmRvd3MgeyBjaGFyZ2UgfSwgcmVzb3VyY2VzIHsgcmVzb3VyY2VfaWQsICcgK1xuICAgICAgICAgICdhZ2dyZWdhdGVkX3VzYWdlIHsgbWV0cmljLCB3aW5kb3dzIHsgY2hhcmdlIH19fX19J107XG5cbiAgICAgICAgLy8gR2V0IHRoZSByYXRlZCB1c2FnZSBmb3IgdW5hdXRob3JpemVkIG9yZyBhbmQgYWNjb3VudFxuICAgICAgICBtYXAodXF1ZXJpZXMsICh1cXVlcnkpID0+IHtcbiAgICAgICAgICBicmVxdWVzdC5nZXQoXG4gICAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDo6cC92MS9tZXRlcmluZy9hZ2dyZWdhdGVkL3VzYWdlL2dyYXBoLzpxdWVyeScsIHtcbiAgICAgICAgICAgICAgaGVhZGVyczoge1xuICAgICAgICAgICAgICAgIGF1dGhvcml6YXRpb246ICdCZWFyZXIgdGVzdCdcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgcDogc2VydmVyLmFkZHJlc3MoKS5wb3J0LFxuICAgICAgICAgICAgICBxdWVyeTogdXF1ZXJ5XG4gICAgICAgICAgICB9LCAoZXJyLCB2YWwpID0+IHtcbiAgICAgICAgICAgICAgZXhwZWN0KGVycikudG8uZXF1YWwodW5kZWZpbmVkKTtcblxuICAgICAgICAgICAgICAvLyBFeHBlY3Qgb3VyIHRlc3QgcmF0ZWQgdXNhZ2UgYXMgZW1wdHlcbiAgICAgICAgICAgICAgZXhwZWN0KHZhbC5zdGF0dXNDb2RlKS50by5lcXVhbCg0MDApO1xuICAgICAgICAgICAgICBleHBlY3QodmFsLmJvZHkuZXJyb3IpLnRvLmNvbnRhaW4oJ3F1ZXJ5Jyk7XG5cbiAgICAgICAgICAgICAgY2IoKTtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcbiAgICAgIH07XG5cbiAgICAgIC8vIFZlcmlmeSB1c2luZyBhbiB1bnNlY3VyZWQgc2VydmVyIGFuZCB0aGVuIHZlcmlmeSB1c2luZyBhIHNlY3VyZWQgc2VydmVyXG4gICAgICB2ZXJpZnkoZmFsc2UsICgpID0+IHZlcmlmeSh0cnVlLCBkb25lKSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGNvbnRleHQoJ3doZW4gcmF0ZWQgdXNhZ2UgY29udGFpbnMgYmlnIG51bWJlcnMnLCAoKSA9PiB7XG4gICAgYmVmb3JlKChkb25lKSA9PiB7XG4gICAgICBjb25zdCBiaWdOdW1iZXJSYXRlZCA9IHtcbiAgICAgICAgb3JnYW5pemF0aW9uX2lkOiAnNjEwZjY1MDgtOGI1ZC00ODQwLTg4OGQtMDYxNWFkZTMzMTE3JyxcbiAgICAgICAgY29uc3VtZXJfaWQ6ICdVTktOT1dOJyxcbiAgICAgICAgcmVzb3VyY2VfaW5zdGFuY2VfaWQ6IHJpZCxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcmVzb3VyY2VfaWQ6ICd0ZXN0LXJlc291cmNlJyxcbiAgICAgICAgICAgIHBsYW5zOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBwbGFuX2lkOiAnYmFzaWMvdGVzdC1tZXRlcmluZy1wbGFuLycgK1xuICAgICAgICAgICAgICAgICAgJ3Rlc3QtcmF0aW5nLXBsYW4vdGVzdC1wcmljaW5nLWJhc2ljJyxcbiAgICAgICAgICAgICAgICBtZXRlcmluZ19wbGFuX2lkOiAndGVzdC1tZXRlcmluZy1wbGFuJyxcbiAgICAgICAgICAgICAgICByYXRpbmdfcGxhbl9pZDogJ3Rlc3QtcmF0aW5nLXBsYW4nLFxuICAgICAgICAgICAgICAgIHByaWNpbmdfcGxhbl9pZDogJ3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAuNVxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwLjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMC4wMzY2Nzk3MjIyMjIyMjIyMjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogNS4xMzUxNjExMTExMTExMWUtMDZcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTU2MjUwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMC42MjVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAxNTYyNTAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwLjYyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmljZTogMC4wMDAxNFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLjA4OTI1MjQzMDU1NTU1NTU1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDEuMjQ5NTM0MDI3Nzc3Nzc4ZS0wNVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAxOTY5MDEyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDcuMTI1XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTk2OTAxMjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiA3LjEyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmljZTogMC4wMDAxNFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiA1Ljk5MjE2NTIwODMzMzMzNCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDgzODkwMzEyOTE2NjY2NjZcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTQ1NDA1MzE2Ny45Njg3NSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDkuMjg1MTU2MjVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAxNDU0MDUzMTY3Ljk2ODc1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogOS4yODUxNTYyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmljZTogMC4wMDAxNFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiA0MDQuNTg0ODExNjczMTc3MDYsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wNTY2NDE4NzM2MzQyNDQ3OVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDEuMjQ5NTM0MDI3Nzc3Nzc4ZS0wNVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDgzODkwMzEyOTE2NjY2NjZcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wNTY2NDE4NzM2MzQyNDQ3OVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogNS4xMzUxNjExMTExMTExMWUtMDZcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMS4yNDk1MzQwMjc3Nzc3NzhlLTA1XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwODM4OTAzMTI5MTY2NjY2NlxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjA1NjY0MTg3MzYzNDI0NDc5XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAxLjI0OTUzNDAyNzc3Nzc3OGUtMDVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwODM4OTAzMTI5MTY2NjY2NlxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wNTY2NDE4NzM2MzQyNDQ3OVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgc3BhY2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3BhY2VfaWQ6ICc1ODIwMThjOS1lMzk2LTRmNTktOTk0NS1iMWJkNTc5YTgxOWInLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICByZXNvdXJjZV9pZDogJ3Rlc3QtcmVzb3VyY2UnLFxuICAgICAgICAgICAgICAgIHBsYW5zOiBbXG4gICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHBsYW5faWQ6ICdiYXNpYy90ZXN0LW1ldGVyaW5nLXBsYW4vJyArXG4gICAgICAgICAgICAgICAgICAgICAgJ3Rlc3QtcmF0aW5nLXBsYW4vdGVzdC1wcmljaW5nLWJhc2ljJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0ZXJpbmdfcGxhbl9pZDogJ3Rlc3QtbWV0ZXJpbmctcGxhbicsXG4gICAgICAgICAgICAgICAgICAgIHJhdGluZ19wbGFuX2lkOiAndGVzdC1yYXRpbmctcGxhbicsXG4gICAgICAgICAgICAgICAgICAgIHByaWNpbmdfcGxhbl9pZDogJ3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZWRfdXNhZ2U6IFtcbiAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAuMDMxMjVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAuMDMxMjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByaWNlOiAwLjAwMDE0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMS41MDAwNzg5NDA5NzIyMjIyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDIxMDAxMTA1MTczNjExMTFcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwMjEwMDExMDUxNzM2MTExMVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDIxMDAxMTA1MTczNjExMTFcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDIxMDAxMTA1MTczNjExMTFcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIGNvbnN1bWVyczogeyBpZDogJ1VOS05PV04nLCB0OiAnMTQ0ODQ1NzQ0NDE4OCcgfSxcbiAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMDAyMTAwMTEwNTE3MzYxMTExXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBzcGFjZV9pZDogJ2MyMjhlY2M4LTE1ZWItNDQ2Zi1hNGU2LWEyZDA1YTcyOWI5OCcsXG4gICAgICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgICAgICAgICAgICAgcGxhbnM6IFtcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgcGxhbl9pZDogJ2Jhc2ljL3Rlc3QtbWV0ZXJpbmctcGxhbi8nICtcbiAgICAgICAgICAgICAgICAgICAgICAndGVzdC1yYXRpbmctcGxhbi90ZXN0LXByaWNpbmctYmFzaWMnLFxuICAgICAgICAgICAgICAgICAgICBtZXRlcmluZ19wbGFuX2lkOiAndGVzdC1tZXRlcmluZy1wbGFuJyxcbiAgICAgICAgICAgICAgICAgICAgcmF0aW5nX3BsYW5faWQ6ICd0ZXN0LXJhdGluZy1wbGFuJyxcbiAgICAgICAgICAgICAgICAgICAgcHJpY2luZ19wbGFuX2lkOiAndGVzdC1wcmljaW5nLWJhc2ljJyxcbiAgICAgICAgICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgIG1ldHJpYzogJ21lbW9yeScsXG4gICAgICAgICAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMC4wMzEyNVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMC4wMzEyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAxLjUwMDA3ODk0MDk3MjIyMjIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwMjEwMDExMDUxNzM2MTExMVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMDAyMTAwMTEwNTE3MzYxMTExXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBhZ2dyZWdhdGVkX3VzYWdlOiBbXG4gICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG1ldHJpYzogJ21lbW9yeScsXG4gICAgICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwMjEwMDExMDUxNzM2MTExMVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwMjEwMDExMDUxNzM2MTExMVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgY29uc3VtZXJzOiB7IGlkOiAnVU5LTk9XTicsIHQ6ICcxNDQ4NDU3NDQ0MTg4JyB9LFxuICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDIxMDAxMTA1MTczNjExMTFcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNwYWNlX2lkOiAnNjlkNGQ4NWItMDNmNy00MzZlLWIyOTMtOTRkMTgwM2I0MmJmJyxcbiAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgcmVzb3VyY2VfaWQ6ICd0ZXN0LXJlc291cmNlJyxcbiAgICAgICAgICAgICAgICBwbGFuczogW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBwbGFuX2lkOiAnYmFzaWMvdGVzdC1tZXRlcmluZy1wbGFuLycgK1xuICAgICAgICAgICAgICAgICAgICAgICd0ZXN0LXJhdGluZy1wbGFuL3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgICAgICAgICAgIG1ldGVyaW5nX3BsYW5faWQ6ICd0ZXN0LW1ldGVyaW5nLXBsYW4nLFxuICAgICAgICAgICAgICAgICAgICByYXRpbmdfcGxhbl9pZDogJ3Rlc3QtcmF0aW5nLXBsYW4nLFxuICAgICAgICAgICAgICAgICAgICBwcmljaW5nX3BsYW5faWQ6ICd0ZXN0LXByaWNpbmctYmFzaWMnLFxuICAgICAgICAgICAgICAgICAgICBhZ2dyZWdhdGVkX3VzYWdlOiBbXG4gICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogNzg2MTYwNjIuNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAyLjA5NzY1NjI1XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogNzg2MTYwNjIuNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAyLjA5NzY1NjI1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmljZTogMC4wMDAxNFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDgwLjAwMDYxMzU4Mjg5OTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDExMjAwMDg1OTAxNjA1OTAzXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAxMTIwMDA4NTkwMTYwNTkwM1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAxMTIwMDA4NTkwMTYwNTkwM1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDExMjAwMDg1OTAxNjA1OTAzXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBjb25zdW1lcnM6IHsgaWQ6ICdVTktOT1dOJywgdDogJzE0NDg0NTc0NDQxODgnIH0sXG4gICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMTEyMDAwODU5MDE2MDU5MDNcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIHNwYWNlX2lkOiAnNGVmMmY3MDYtZjJhZS00YmU1LWExOGMtNDBhOTY5Y2Y4ZmI2JyxcbiAgICAgICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgcmVzb3VyY2VfaWQ6ICd0ZXN0LXJlc291cmNlJyxcbiAgICAgICAgICAgICAgICBwbGFuczogW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBwbGFuX2lkOiAnYmFzaWMvdGVzdC1tZXRlcmluZy1wbGFuLycgK1xuICAgICAgICAgICAgICAgICAgICAgICd0ZXN0LXJhdGluZy1wbGFuL3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgICAgICAgICAgIG1ldGVyaW5nX3BsYW5faWQ6ICd0ZXN0LW1ldGVyaW5nLXBsYW4nLFxuICAgICAgICAgICAgICAgICAgICByYXRpbmdfcGxhbl9pZDogJ3Rlc3QtcmF0aW5nLXBsYW4nLFxuICAgICAgICAgICAgICAgICAgICBwcmljaW5nX3BsYW5faWQ6ICd0ZXN0LXByaWNpbmctYmFzaWMnLFxuICAgICAgICAgICAgICAgICAgICBhZ2dyZWdhdGVkX3VzYWdlOiBbXG4gICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMC41XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwLjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByaWNlOiAwLjAwMDE0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMC4wMzY2Nzk3MjIyMjIyMjIyMjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDE1NjI1MCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwLjYyNVxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDE1NjI1MCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwLjYyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLjA4OTI1MjQzMDU1NTU1NTU1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAxLjI0OTUzNDAyNzc3Nzc3OGUtMDVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTk2ODQzNzUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogNy4xMjVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAxOTY4NDM3NSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiA3LjEyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiA1Ljk5MDU2Nzk4NjExMTExMSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMDA4Mzg2Nzk1MTgwNTU1NTU1XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDExNTU4MDkzNzUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogNy4xMjVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAxMTU1ODA5Mzc1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDcuMTI1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmljZTogMC4wMDAxNFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDMyMS41ODA4NDU3NjM4ODg5LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjA0NTAyMTMxODQwNjk0NDQ0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiA1LjEzNTE2MTExMTExMTExZS0wNlxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDEuMjQ5NTM0MDI3Nzc3Nzc4ZS0wNVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwODM4Njc5NTE4MDU1NTU1NVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDQ1MDIxMzE4NDA2OTQ0NDRcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZWRfdXNhZ2U6IFtcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogNS4xMzUxNjExMTExMTExMWUtMDZcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAxLjI0OTUzNDAyNzc3Nzc3OGUtMDVcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDgzODY3OTUxODA1NTU1NTVcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjA0NTAyMTMxODQwNjk0NDQ0XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDEuMjQ5NTM0MDI3Nzc3Nzc4ZS0wNVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDgzODY3OTUxODA1NTU1NTVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wNDUwMjEzMTg0MDY5NDQ0NFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgY29uc3VtZXJzOiB7IGlkOiAnVU5LTk9XTicsIHQ6ICcxNDQ4NDU3NDQ0MTg4JyB9LFxuICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAxLjI0OTUzNDAyNzc3Nzc3OGUtMDVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwODM4Njc5NTE4MDU1NTU1NVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wNDUwMjEzMTg0MDY5NDQ0NFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgc3BhY2VfaWQ6ICdlYWM1MTI1Yy03NGZmLTQ5ODQtOWJhNi0yZWVhNzE1ODQ5MGYnLFxuICAgICAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICByZXNvdXJjZV9pZDogJ3Rlc3QtcmVzb3VyY2UnLFxuICAgICAgICAgICAgICAgIHBsYW5zOiBbXG4gICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIHBsYW5faWQ6ICdiYXNpYy90ZXN0LW1ldGVyaW5nLXBsYW4vJyArXG4gICAgICAgICAgICAgICAgICAgICAgJ3Rlc3QtcmF0aW5nLXBsYW4vdGVzdC1wcmljaW5nLWJhc2ljJyxcbiAgICAgICAgICAgICAgICAgICAgbWV0ZXJpbmdfcGxhbl9pZDogJ3Rlc3QtbWV0ZXJpbmctcGxhbicsXG4gICAgICAgICAgICAgICAgICAgIHJhdGluZ19wbGFuX2lkOiAndGVzdC1yYXRpbmctcGxhbicsXG4gICAgICAgICAgICAgICAgICAgIHByaWNpbmdfcGxhbl9pZDogJ3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZWRfdXNhZ2U6IFtcbiAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDU3NTAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDU3NTAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLjAwMTU5NzIyMjIyMjIyMjIyMjMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDIuMjM2MTExMTExMTExMWUtMDdcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTE1MDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDExNTAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByaWNlOiAwLjAwMDE0XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMC4wMDMxOTQ0NDQ0NDQ0NDQ0NDQ2LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiA0LjQ3MjIyMjIyMjIyMjJlLTA3XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDIuMjM2MTExMTExMTExMWUtMDdcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiA0LjQ3MjIyMjIyMjIyMjJlLTA3XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICBhZ2dyZWdhdGVkX3VzYWdlOiBbXG4gICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG1ldHJpYzogJ21lbW9yeScsXG4gICAgICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMi4yMzYxMTExMTExMTExZS0wN1xuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDQuNDcyMjIyMjIyMjIyMmUtMDdcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMi4yMzYxMTExMTExMTExZS0wN1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiA0LjQ3MjIyMjIyMjIyMjJlLTA3XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBjb25zdW1lcnM6IHsgaWQ6ICdVTktOT1dOJywgdDogJzE0NDg0NTc0NDQxODgnIH0sXG4gICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDIuMjM2MTExMTExMTExMWUtMDdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDQuNDcyMjIyMjIyMjIyMmUtMDdcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIF0sXG4gICAgICAgIHN0YXJ0OiAxNDQ4Mjg0ODk4MDAwLFxuICAgICAgICBlbmQ6IDE0NDg0NTc0NDMwMDAsXG4gICAgICAgIGlkOiAnay82MTBmNjUwOC04YjVkLTQ4NDAtODg4ZC0wNjE1YWRlMzMxMTcvdC8wMDAxNDQ4NDU3NDQ0MTg4LTAtMC0xLTAnLFxuICAgICAgICBwcm9jZXNzZWQ6IDE0NDg0NTc0NDQxODgsXG4gICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNoYXJnZTogMS4yNDk1MzQwMjc3Nzc3NzhlLTA1XG4gICAgICAgICAgICB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNoYXJnZTogMC4wMDA4Mzg5MDMxMjkxNjY2NjY2XG4gICAgICAgICAgICB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNoYXJnZTogMC4wNTY2NDE4NzM2MzQyNDQ3OVxuICAgICAgICAgICAgfVxuICAgICAgICAgIF1cbiAgICAgICAgXVxuICAgICAgfTtcbiAgICAgIGNvbnN0IGNvbnN1bWVyMSA9IHtcbiAgICAgICAgaWQ6ICdrLzYxMGY2NTA4LThiNWQtNDg0MC04ODhkLTA2MTVhZGUzMzExNy8nICtcbiAgICAgICAgICAnNTgyMDE4YzktZTM5Ni00ZjU5LTk5NDUtYjFiZDU3OWE4MTliL1VOS05PV04vdC8xNDQ4NDU3NDQ0MTg4JyxcbiAgICAgICAgY29uc3VtZXJfaWQ6ICdVTktOT1dOJyxcbiAgICAgICAgb3JnYW5pemF0aW9uX2lkOiAnNjEwZjY1MDgtOGI1ZC00ODQwLTg4OGQtMDYxNWFkZTMzMTE3JyxcbiAgICAgICAgcmVzb3VyY2VfaW5zdGFuY2VfaWQ6IHJpZCxcbiAgICAgICAgc3RhcnQ6IDE0NDgyODQ4OTgwMDAsXG4gICAgICAgIGVuZDogMTQ0ODQ1NzQ0MzAwMCxcbiAgICAgICAgcmVzb3VyY2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgcmVzb3VyY2VfaWQ6ICd0ZXN0LXJlc291cmNlJyxcbiAgICAgICAgICAgIHBsYW5zOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBwbGFuX2lkOiAnYmFzaWMvdGVzdC1tZXRlcmluZy1wbGFuLycgK1xuICAgICAgICAgICAgICAgICAgJ3Rlc3QtcmF0aW5nLXBsYW4vdGVzdC1wcmljaW5nLWJhc2ljJyxcbiAgICAgICAgICAgICAgICBtZXRlcmluZ19wbGFuX2lkOiAndGVzdC1tZXRlcmluZy1wbGFuJyxcbiAgICAgICAgICAgICAgICByYXRpbmdfcGxhbl9pZDogJ3Rlc3QtcmF0aW5nLXBsYW4nLFxuICAgICAgICAgICAgICAgIHByaWNpbmdfcGxhbl9pZDogJ3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwLjAzMTI1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHNpbmNlOiAxNDQ4Mjg0ODk4MDAwXG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAuMDMxMjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMS41MDAwNzg5NDA5NzIyMjIyLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwMjEwMDExMDUxNzM2MTExMVxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwMjEwMDExMDUxNzM2MTExMVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMDAyMTAwMTEwNTE3MzYxMTExXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwMjEwMDExMDUxNzM2MTExMVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgd2luZG93czogW1xuICAgICAgICAgIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNoYXJnZTogMC4wMDAyMTAwMTEwNTE3MzYxMTExXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICBdXG4gICAgICB9O1xuICAgICAgY29uc3QgY29uc3VtZXIyID0ge1xuICAgICAgICBpZDogJ2svNjEwZjY1MDgtOGI1ZC00ODQwLTg4OGQtMDYxNWFkZTMzMTE3LycgK1xuICAgICAgICAgICdjMjI4ZWNjOC0xNWViLTQ0NmYtYTRlNi1hMmQwNWE3MjliOTgvVU5LTk9XTi90LzE0NDg0NTc0NDQxODgnLFxuICAgICAgICBjb25zdW1lcl9pZDogJ1VOS05PV04nLFxuICAgICAgICBvcmdhbml6YXRpb25faWQ6ICc2MTBmNjUwOC04YjVkLTQ4NDAtODg4ZC0wNjE1YWRlMzMxMTcnLFxuICAgICAgICByZXNvdXJjZV9pbnN0YW5jZV9pZDogcmlkLFxuICAgICAgICBzdGFydDogMTQ0ODI4NDg5ODAwMCxcbiAgICAgICAgZW5kOiAxNDQ4NDU3NDQzMDAwLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICByZXNvdXJjZV9pZDogJ3Rlc3QtcmVzb3VyY2UnLFxuICAgICAgICAgICAgcGxhbnM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIHBsYW5faWQ6ICdiYXNpYy90ZXN0LW1ldGVyaW5nLXBsYW4vJyArXG4gICAgICAgICAgICAgICAgICAndGVzdC1yYXRpbmctcGxhbi90ZXN0LXByaWNpbmctYmFzaWMnLFxuICAgICAgICAgICAgICAgIG1ldGVyaW5nX3BsYW5faWQ6ICd0ZXN0LW1ldGVyaW5nLXBsYW4nLFxuICAgICAgICAgICAgICAgIHJhdGluZ19wbGFuX2lkOiAndGVzdC1yYXRpbmctcGxhbicsXG4gICAgICAgICAgICAgICAgcHJpY2luZ19wbGFuX2lkOiAndGVzdC1wcmljaW5nLWJhc2ljJyxcbiAgICAgICAgICAgICAgICBhZ2dyZWdhdGVkX3VzYWdlOiBbXG4gICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG1ldHJpYzogJ21lbW9yeScsXG4gICAgICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAuMDMxMjVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMC4wMzEyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmljZTogMC4wMDAxNFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAxLjUwMDA3ODk0MDk3MjIyMjIsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMDAyMTAwMTEwNTE3MzYxMTExXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMDAyMTAwMTEwNTE3MzYxMTExXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICBhZ2dyZWdhdGVkX3VzYWdlOiBbXG4gICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDIxMDAxMTA1MTczNjExMTFcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMDAyMTAwMTEwNTE3MzYxMTExXG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICB9XG4gICAgICAgICAgXSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgfVxuICAgICAgICAgIF0sXG4gICAgICAgICAgW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDIxMDAxMTA1MTczNjExMTFcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIF1cbiAgICAgIH07XG4gICAgICBjb25zdCBjb25zdW1lcjMgPSB7XG4gICAgICAgIGlkOiAnay82MTBmNjUwOC04YjVkLTQ4NDAtODg4ZC0wNjE1YWRlMzMxMTcvJyArXG4gICAgICAgICAgJzY5ZDRkODViLTAzZjctNDM2ZS1iMjkzLTk0ZDE4MDNiNDJiZi9VTktOT1dOL3QvMTQ0ODQ1NzQ0NDE4OCcsXG4gICAgICAgIGNvbnN1bWVyX2lkOiAnVU5LTk9XTicsXG4gICAgICAgIG9yZ2FuaXphdGlvbl9pZDogJzYxMGY2NTA4LThiNWQtNDg0MC04ODhkLTA2MTVhZGUzMzExNycsXG4gICAgICAgIHJlc291cmNlX2luc3RhbmNlX2lkOiByaWQsXG4gICAgICAgIHN0YXJ0OiAxNDQ4Mjg0ODk4MDAwLFxuICAgICAgICBlbmQ6IDE0NDg0NTc0NDMwMDAsXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgICAgICAgICBwbGFuczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgcGxhbl9pZDogJ2Jhc2ljL3Rlc3QtbWV0ZXJpbmctcGxhbi8nICtcbiAgICAgICAgICAgICAgICAgICd0ZXN0LXJhdGluZy1wbGFuL3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgICAgICAgbWV0ZXJpbmdfcGxhbl9pZDogJ3Rlc3QtbWV0ZXJpbmctcGxhbicsXG4gICAgICAgICAgICAgICAgcmF0aW5nX3BsYW5faWQ6ICd0ZXN0LXJhdGluZy1wbGFuJyxcbiAgICAgICAgICAgICAgICBwcmljaW5nX3BsYW5faWQ6ICd0ZXN0LXByaWNpbmctYmFzaWMnLFxuICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZWRfdXNhZ2U6IFtcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiA3ODYxNjA2Mi41LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMi4wOTc2NTYyNVxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDc4NjE2MDYyLjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAyLjA5NzY1NjI1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByaWNlOiAwLjAwMDE0XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDgwLjAwMDYxMzU4Mjg5OTMsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMTEyMDAwODU5MDE2MDU5MDNcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAxMTIwMDA4NTkwMTYwNTkwM1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwXG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDBcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMTEyMDAwODU5MDE2MDU5MDNcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgIF1cbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAxMTIwMDA4NTkwMTYwNTkwM1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgd2luZG93czogW1xuICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgW251bGxdLFxuICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNoYXJnZTogMC4wMTEyMDAwODU5MDE2MDU5MDNcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIF1cbiAgICAgIH07XG4gICAgICBjb25zdCBjb25zdW1lcjQgPSB7XG4gICAgICAgIGlkOiAnay82MTBmNjUwOC04YjVkLTQ4NDAtODg4ZC0wNjE1YWRlMzMxMTcvJyArXG4gICAgICAgICAgJzRlZjJmNzA2LWYyYWUtNGJlNS1hMThjLTQwYTk2OWNmOGZiNi9VTktOT1dOL3QvMTQ0ODQ1NzQ0NDE4OCcsXG4gICAgICAgIGNvbnN1bWVyX2lkOiAnVU5LTk9XTicsXG4gICAgICAgIG9yZ2FuaXphdGlvbl9pZDogJzYxMGY2NTA4LThiNWQtNDg0MC04ODhkLTA2MTVhZGUzMzExNycsXG4gICAgICAgIHJlc291cmNlX2luc3RhbmNlX2lkOiByaWQsXG4gICAgICAgIHN0YXJ0OiAxNDQ4Mjg0ODk4MDAwLFxuICAgICAgICBlbmQ6IDE0NDg0NTc0NDMwMDAsXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgICAgICAgICBwbGFuczogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgcGxhbl9pZDogJ2Jhc2ljL3Rlc3QtbWV0ZXJpbmctcGxhbi8nICtcbiAgICAgICAgICAgICAgICAgICd0ZXN0LXJhdGluZy1wbGFuL3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgICAgICAgbWV0ZXJpbmdfcGxhbl9pZDogJ3Rlc3QtbWV0ZXJpbmctcGxhbicsXG4gICAgICAgICAgICAgICAgcmF0aW5nX3BsYW5faWQ6ICd0ZXN0LXJhdGluZy1wbGFuJyxcbiAgICAgICAgICAgICAgICBwcmljaW5nX3BsYW5faWQ6ICd0ZXN0LXByaWNpbmctYmFzaWMnLFxuICAgICAgICAgICAgICAgIGFnZ3JlZ2F0ZWRfdXNhZ2U6IFtcbiAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwLjVcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMC41LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByaWNlOiAwLjAwMDE0XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAuMDM2Njc5NzIyMjIyMjIyMjI1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDE1NjI1MCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAuNjI1XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTU2MjUwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogMC42MjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMC4wODkyNTI0MzA1NTU1NTU1NSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAxLjI0OTUzNDAyNzc3Nzc3OGUtMDVcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTk2ODQzNzUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiA3LjEyNVxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDE5Njg0Mzc1LFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN1bWluZzogNy4xMjUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogNS45OTA1Njc5ODYxMTExMTEsXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wMDA4Mzg2Nzk1MTgwNTU1NTU1XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDExNTU4MDkzNzUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiA3LjEyNVxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjb3N0OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDExNTU4MDkzNzUsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiA3LjEyNSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwcmljZTogMC4wMDAxNFxuICAgICAgICAgICAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgICAgICAgICAgICBzdW1tYXJ5OiAzMjEuNTgwODQ1NzYzODg4OSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjA0NTAyMTMxODQwNjk0NDQ0XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDEuMjQ5NTM0MDI3Nzc3Nzc4ZS0wNVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDgzODY3OTUxODA1NTU1NTVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wNDUwMjEzMTg0MDY5NDQ0NFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDEuMjQ5NTM0MDI3Nzc3Nzc4ZS0wNVxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDgzODY3OTUxODA1NTU1NTVcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wNDUwMjEzMTg0MDY5NDQ0NFxuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDUuMTM1MTYxMTExMTExMTFlLTA2XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAxLjI0OTUzNDAyNzc3Nzc3OGUtMDVcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBjaGFyZ2U6IDAuMDAwODM4Njc5NTE4MDU1NTU1NVxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgW1xuICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgIGNoYXJnZTogMC4wNDUwMjEzMTg0MDY5NDQ0NFxuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgXVxuICAgICAgICAgIH1cbiAgICAgICAgXSxcbiAgICAgICAgd2luZG93czogW1xuICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGNoYXJnZTogNS4xMzUxNjExMTExMTExMWUtMDZcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2hhcmdlOiAxLjI0OTUzNDAyNzc3Nzc3OGUtMDVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2hhcmdlOiAwLjAwMDgzODY3OTUxODA1NTU1NTVcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2hhcmdlOiAwLjA0NTAyMTMxODQwNjk0NDQ0XG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICBdXG4gICAgICB9O1xuICAgICAgY29uc3QgY29uc3VtZXI1ID0ge1xuICAgICAgICBpZDogJ2svNjEwZjY1MDgtOGI1ZC00ODQwLTg4OGQtMDYxNWFkZTMzMTE3LycgK1xuICAgICAgICAgICdlYWM1MTI1Yy03NGZmLTQ5ODQtOWJhNi0yZWVhNzE1ODQ5MGYvVU5LTk9XTi90LzE0NDg0NTc0NDQxODgnLFxuICAgICAgICBjb25zdW1lcl9pZDogJ1VOS05PV04nLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICByZXNvdXJjZV9pZDogJ3Rlc3QtcmVzb3VyY2UnLFxuICAgICAgICAgICAgcGxhbnM6IFtcbiAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgIHBsYW5faWQ6ICdiYXNpYy90ZXN0LW1ldGVyaW5nLXBsYW4vJyArXG4gICAgICAgICAgICAgICAgICAndGVzdC1yYXRpbmctcGxhbi90ZXN0LXByaWNpbmctYmFzaWMnLFxuICAgICAgICAgICAgICAgIG1ldGVyaW5nX3BsYW5faWQ6ICd0ZXN0LW1ldGVyaW5nLXBsYW4nLFxuICAgICAgICAgICAgICAgIHJhdGluZ19wbGFuX2lkOiAndGVzdC1yYXRpbmctcGxhbicsXG4gICAgICAgICAgICAgICAgcHJpY2luZ19wbGFuX2lkOiAndGVzdC1wcmljaW5nLWJhc2ljJyxcbiAgICAgICAgICAgICAgICBhZ2dyZWdhdGVkX3VzYWdlOiBbXG4gICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgIG1ldHJpYzogJ21lbW9yeScsXG4gICAgICAgICAgICAgICAgICAgIHdpbmRvd3M6IFtcbiAgICAgICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgIHF1YW50aXR5OiB7XG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtZWQ6IDU3NTAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogNTc1MCxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICAgICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgc3VtbWFyeTogMC4wMDE1OTcyMjIyMjIyMjIyMjIzLFxuICAgICAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDIuMjM2MTExMTExMTExMWUtMDdcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTE1MDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwXG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdW1lZDogMTE1MDAsXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3VtaW5nOiAwLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByaWNlOiAwLjAwMDE0XG4gICAgICAgICAgICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgICAgICAgICAgIHN1bW1hcnk6IDAuMDAzMTk0NDQ0NDQ0NDQ0NDQ0NixcbiAgICAgICAgICAgICAgICAgICAgICAgICAgY2hhcmdlOiA0LjQ3MjIyMjIyMjIyMjJlLTA3XG4gICAgICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDIuMjM2MTExMTExMTExMWUtMDdcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogNC40NzIyMjIyMjIyMjIyZS0wN1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgYWdncmVnYXRlZF91c2FnZTogW1xuICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgICAgICAgICBjaGFyZ2U6IDIuMjM2MTExMTExMTExMWUtMDdcbiAgICAgICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgICAgXSxcbiAgICAgICAgICAgICAgICAgIFtcbiAgICAgICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgICAgIGNoYXJnZTogNC40NzIyMjIyMjIyMjIyZS0wN1xuICAgICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgICBdXG4gICAgICAgICAgICAgICAgXVxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2luZG93czogW1xuICAgICAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICAgICAgW251bGxdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiAyLjIzNjExMTExMTExMTFlLTA3XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICBbXG4gICAgICAgICAgICAgICAge1xuICAgICAgICAgICAgICAgICAgY2hhcmdlOiA0LjQ3MjIyMjIyMjIyMjJlLTA3XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdXG4gICAgICAgICAgICBdXG4gICAgICAgICAgfVxuICAgICAgICBdLFxuICAgICAgICB3aW5kb3dzOiBbXG4gICAgICAgICAgW251bGxdLFxuICAgICAgICAgIFtudWxsXSxcbiAgICAgICAgICBbbnVsbF0sXG4gICAgICAgICAgW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBjaGFyZ2U6IDIuMjM2MTExMTExMTExMWUtMDdcbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdLFxuICAgICAgICAgIFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgY2hhcmdlOiA0LjQ3MjIyMjIyMjIyMjJlLTA3XG4gICAgICAgICAgICB9XG4gICAgICAgICAgXVxuICAgICAgICBdXG4gICAgICB9O1xuICAgICAgc3RvcmVSYXRlZFVzYWdlKGJpZ051bWJlclJhdGVkLCAoKSA9PiBzdG9yZVJhdGVkVXNhZ2UoY29uc3VtZXIxLCAoKSA9PlxuICAgICAgICBzdG9yZVJhdGVkVXNhZ2UoY29uc3VtZXIyLCAoKSA9PiBzdG9yZVJhdGVkVXNhZ2UoY29uc3VtZXIzLCAoKSA9PlxuICAgICAgICBzdG9yZVJhdGVkVXNhZ2UoY29uc3VtZXI0LCAoKSA9PiBzdG9yZVJhdGVkVXNhZ2UoY29uc3VtZXI1LCBkb25lKSkpKSkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ3JldHJpZXZlcyByYXRlZCB1c2FnZSB3aXRoIDE2IHNpZ25pZmljYW50IGRpZ2l0cycsIChkb25lKSA9PiB7XG4gICAgICBjb25zdCB2ZXJpZnkgPSAoc2VjdXJlZCwgZG9uZSkgPT4ge1xuICAgICAgICBwcm9jZXNzLmVudi5TRUNVUkVEID0gc2VjdXJlZCA/ICd0cnVlJyA6ICdmYWxzZSc7XG4gICAgICAgIHZhbGlkYXRvcnNweS5yZXNldCgpO1xuXG4gICAgICAgIC8vIENyZWF0ZSBhIHRlc3QgcmVwb3J0IGFwcFxuICAgICAgICBjb25zdCBhcHAgPSByZXBvcnQoKTtcblxuICAgICAgICAvLyBMaXN0ZW4gb24gYW4gZXBoZW1lcmFsIHBvcnRcbiAgICAgICAgY29uc3Qgc2VydmVyID0gYXBwLmxpc3RlbigwKTtcblxuICAgICAgICAvLyBHZXQgdGhlIHJhdGVkIHVzYWdlXG4gICAgICAgIHJlcXVlc3QuZ2V0KFxuICAgICAgICAgICdodHRwOi8vbG9jYWxob3N0OjpwL3YxL21ldGVyaW5nL29yZ2FuaXphdGlvbnMvJyArXG4gICAgICAgICAgJzpvcmdhbml6YXRpb25faWQvYWdncmVnYXRlZC91c2FnZScsIHtcbiAgICAgICAgICAgIHA6IHNlcnZlci5hZGRyZXNzKCkucG9ydCxcbiAgICAgICAgICAgIG9yZ2FuaXphdGlvbl9pZDogb2lkXG4gICAgICAgICAgfSwgKGVyciwgdmFsKSA9PiB7XG4gICAgICAgICAgICBleHBlY3QoZXJyKS50by5lcXVhbCh1bmRlZmluZWQpO1xuXG4gICAgICAgICAgICAvLyBFeHBlY3QgdGVzdCByYXRlZCB1c2FnZSB3aXRob3V0IGVycm9yXG4gICAgICAgICAgICBleHBlY3QodmFsLnN0YXR1c0NvZGUpLnRvLmVxdWFsKDIwMCk7XG4gICAgICAgICAgICBleHBlY3QodmFsaWRhdG9yc3B5LmNhbGxDb3VudCkudG8uZXF1YWwoc2VjdXJlZCA/IDEgOiAwKTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH07XG5cbiAgICAgIC8vIFZlcmlmeSB1c2luZyBhbiB1bnNlY3VyZWQgc2VydmVyIGFuZCB0aGVuIHZlcmlmeSB1c2luZyBhIHNlY3VyZWQgc2VydmVyXG4gICAgICB2ZXJpZnkoZmFsc2UsICgpID0+IHZlcmlmeSh0cnVlLCBkb25lKSk7XG4gICAgfSk7XG4gIH0pO1xuXG4gIGNvbnRleHQoJ3doZW4gcmF0ZWQgdXNhZ2UgY29udGFpbnMgYSBzbGFjaycsICgpID0+IHtcbiAgICBiZWZvcmUoKGRvbmUpID0+IHtcbiAgICAgIC8vIFRoaXMgdGVzdCBvbmx5IGNhcmUgYWJvdXQgT2N0b2JlciAzMXN0LlxuICAgICAgY29uc3QgcGxhbldpbmRvdyA9IFtcbiAgICAgICAgW3sgcXVhbnRpdHk6IDAsIGNvc3Q6IDAsIHByZXZpb3VzX3F1YW50aXR5OiBudWxsIH1dLFxuICAgICAgICBbeyBxdWFudGl0eTogMCwgY29zdDogMCwgcHJldmlvdXNfcXVhbnRpdHk6IG51bGwgfV0sXG4gICAgICAgIFt7IHF1YW50aXR5OiAwLCBjb3N0OiAwLCBwcmV2aW91c19xdWFudGl0eTogbnVsbCB9XSxcbiAgICAgICAgW3tcbiAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgY29uc3VtZWQ6IDE1ODQwMDAwMCxcbiAgICAgICAgICAgIGNvbnN1bWluZzogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJldmlvdXNfcXVhbnRpdHk6IG51bGwsXG4gICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgY29uc3VtZWQ6IDE1ODQwMDAwMCxcbiAgICAgICAgICAgIGNvbnN1bWluZzogMSxcbiAgICAgICAgICAgIHByaWNlOiAwLjAwMDE0XG4gICAgICAgICAgfVxuICAgICAgICB9LCB7XG4gICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgIGNvbnN1bWVkOiAxNzI4MDAwMDAsXG4gICAgICAgICAgICBjb25zdW1pbmc6IDJcbiAgICAgICAgICB9LFxuICAgICAgICAgIGNvc3Q6IHtcbiAgICAgICAgICAgIGNvbnN1bWVkOiAxNzI4MDAwMDAsXG4gICAgICAgICAgICBjb25zdW1pbmc6IDIsXG4gICAgICAgICAgICBwcmljZTogMC4wMDAxNFxuICAgICAgICAgIH1cbiAgICAgICAgfSwgeyBxdWFudGl0eTogMCwgY29zdDogMCB9XSxcbiAgICAgICAgW3tcbiAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgY29uc3VtZWQ6IDE1ODQwMDAwMCxcbiAgICAgICAgICAgIGNvbnN1bWluZzogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJldmlvdXNfcXVhbnRpdHk6IG51bGwsXG4gICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgY29uc3VtZWQ6IDE1ODQwMDAwMCxcbiAgICAgICAgICAgIGNvbnN1bWluZzogMSxcbiAgICAgICAgICAgIHByaWNlOiAwLjAwMDE0XG4gICAgICAgICAgfVxuICAgICAgICB9LCB7XG4gICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgIGNvbnN1bWVkOiAtNTAxMTIwMDAwMCxcbiAgICAgICAgICAgIGNvbnN1bWluZzogMlxuICAgICAgICAgIH0sXG4gICAgICAgICAgY29zdDoge1xuICAgICAgICAgICAgY29uc3VtZWQ6IC01MDExMjAwMDAwLFxuICAgICAgICAgICAgY29uc3VtaW5nOiAyLFxuICAgICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgICB9XG4gICAgICAgIH1dXG4gICAgICBdO1xuXG4gICAgICBjb25zdCBhZ2dyV2luZG93ID0gW1xuICAgICAgICBbeyBxdWFudGl0eTogMCxcbiAgICAgICAgICAgcHJldmlvdXNfcXVhbnRpdHk6IG51bGwgfV0sXG4gICAgICAgIFt7IHF1YW50aXR5OiAwLFxuICAgICAgICAgIHByZXZpb3VzX3F1YW50aXR5OiBudWxsIH1dLFxuICAgICAgICBbeyBxdWFudGl0eTogMCxcbiAgICAgICAgICAgcHJldmlvdXNfcXVhbnRpdHk6IG51bGwgfV0sXG4gICAgICAgIFt7XG4gICAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICAgIGNvbnN1bWVkOiAxNTg0MDAwMDAsXG4gICAgICAgICAgICBjb25zdW1pbmc6IDFcbiAgICAgICAgICB9LFxuICAgICAgICAgIHByZXZpb3VzX3F1YW50aXR5OiBudWxsXG4gICAgICAgIH0sIHtcbiAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgY29uc3VtZWQ6IDE3MjgwMDAwMCxcbiAgICAgICAgICAgIGNvbnN1bWluZzogMlxuICAgICAgICAgIH1cbiAgICAgICAgfSwgeyBxdWFudGl0eTogMCB9XSxcbiAgICAgICAgW3tcbiAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgY29uc3VtZWQ6IDE1ODQwMDAwMCxcbiAgICAgICAgICAgIGNvbnN1bWluZzogMVxuICAgICAgICAgIH0sXG4gICAgICAgICAgcHJldmlvdXNfcXVhbnRpdHk6IG51bGxcbiAgICAgICAgfSwge1xuICAgICAgICAgIHF1YW50aXR5OiB7XG4gICAgICAgICAgICBjb25zdW1lZDogLTUwMTEyMDAwMDAsXG4gICAgICAgICAgICBjb25zdW1pbmc6IDJcbiAgICAgICAgICB9XG4gICAgICAgIH1dXG4gICAgICBdO1xuICAgICAgY29uc3QgaWQgPSAnay9hM2Q3ZmU0ZC0zY2IxLTRjYzMtYTgzMS1mZmU5OGUyMGNmMjkvdC8wMDAxNDQ2NDE4ODAwMDAwJztcbiAgICAgIGNvbnN0IG9yZ2lkID0gJ2EzZDdmZTRkLTNjYjEtNGNjMy1hODMxLWZmZTk4ZTIwY2YyOSc7XG5cbiAgICAgIGNvbnN0IHJhdGVkID0gcmF0ZWRUZW1wbGF0ZShpZCwgb3JnaWQsIDE0NDY0MTUyMDAwMDAsIDE0NDY0MTUyMDAwMDAsXG4gICAgICAgIDE0NDY0MTg4MDAwMDAsIFt7XG4gICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICB3aW5kb3dzOiBhZ2dyV2luZG93XG4gICAgICAgIH1dLCBbYnVpbGRQbGFuVXNhZ2UoJ2Jhc2ljJywgW3tcbiAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgIHdpbmRvd3M6IHBsYW5XaW5kb3dcbiAgICAgICAgfV0pXSwgW2NvbnN1bWVyUmVmZXJlbmNlVGVtcGxhdGUob3JnaWQsIHNpZCwgJ2Jhc2ljJywgMTQ0NjQxODgwMDAwMCxcbiAgICAgICAgICAgJ1VOS05PV04nKSxjb25zdW1lclJlZmVyZW5jZVRlbXBsYXRlKG9yZ2lkLCBzaWQsICdiYXNpYycsXG4gICAgICAgICAgIDE0NDYxNjMyMDAwMDAsICdVTktOT1dOMicpXSk7XG5cbiAgICAgIGNvbnN0IGNvbnN1bWVyID0gcmF0ZWRDb25zdW1lclRlbXBsYXRlKG9yZ2lkLCAxNDQ2NDE1MjAwMDAwLFxuICAgICAgICAxNDQ2NDE1MjAwMDAwLCAnYmFzaWMnLCBbe1xuICAgICAgICAgIG1ldHJpYzogJ21lbW9yeScsXG4gICAgICAgICAgd2luZG93czogYWdncldpbmRvd1xuICAgICAgICB9XSwgW2J1aWxkUGxhblVzYWdlKCdiYXNpYycsIFt7XG4gICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICB3aW5kb3dzOiBwbGFuV2luZG93XG4gICAgICAgIH1dKV0sIDE0NDY0MTg4MDAwMDApO1xuXG4gICAgICBjb25zdCBjb25zdW1lcjIgPSByYXRlZENvbnN1bWVyVGVtcGxhdGUob3JnaWQsIDE0NDY0MTUyMDAwMDAsXG4gICAgICAgIDE0NDY0MTUyMDAwMDAsICdiYXNpYycsIFt7XG4gICAgICAgICAgbWV0cmljOiAnbWVtb3J5JyxcbiAgICAgICAgICB3aW5kb3dzOiBhZ2dyV2luZG93XG4gICAgICAgIH1dLCBbYnVpbGRQbGFuVXNhZ2UoJ2Jhc2ljJywgW3tcbiAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgIHdpbmRvd3M6IHBsYW5XaW5kb3dcbiAgICAgICAgfV0pXSwgMTQ0NjE2MzIwMDAwMCwgJ1VOS05PV04yJyk7XG5cbiAgICAgIHN0b3JlUmF0ZWRVc2FnZShyYXRlZCwgKCkgPT4gc3RvcmVSYXRlZFVzYWdlKGNvbnN1bWVyLFxuICAgICAgICAoKSA9PiBzdG9yZVJhdGVkVXNhZ2UoY29uc3VtZXIyLCBkb25lKSkpO1xuICAgIH0pO1xuXG4gICAgaXQoJ2NoZWNrcyB0aGF0IHRpbWUtYmFzZWQgcmVzb3VyY2UgdXNlcyBpdHMgYm91bmRzJywgKGRvbmUpID0+IHtcblxuICAgICAgLy8gRGVmaW5lIHRoZSBleHBlY3RlZCB2YWx1ZXMgZm9yIHRoZSBvY3RvYmVyIDMxc3Qgd2luZG93XG4gICAgICBjb25zdCBleHBlY3RlZERheSA9IHtcbiAgICAgICAgc3VtbWFyeTogNDgsXG4gICAgICAgIGNoYXJnZTogMC4wMDY3MixcbiAgICAgICAgcXVhbnRpdHk6IHtcbiAgICAgICAgICBjb25zdW1lZDogMTcyODAwMDAwLFxuICAgICAgICAgIGNvbnN1bWluZzogMlxuICAgICAgICB9LFxuICAgICAgICBjb3N0OiB7XG4gICAgICAgICAgY29uc3VtZWQ6IDE3MjgwMDAwMCxcbiAgICAgICAgICBjb25zdW1pbmc6IDIsXG4gICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgfVxuICAgICAgfTtcbiAgICAgIC8vIERlZmluZSB0aGUgZXhwZWN0ZWQgdmFsdWVzIGZvciB0aGUgbW9udGggd2luZG93XG4gICAgICBjb25zdCBleHBlY3RlZE1vbnRoID0ge1xuICAgICAgICBzdW1tYXJ5OiA0OCxcbiAgICAgICAgY2hhcmdlOiAwLjAwNjcyLFxuICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgIGNvbnN1bWVkOiAtNTAxMTIwMDAwMCxcbiAgICAgICAgICBjb25zdW1pbmc6IDJcbiAgICAgICAgfSxcbiAgICAgICAgY29zdDoge1xuICAgICAgICAgIGNvbnN1bWVkOiAtNTAxMTIwMDAwMCxcbiAgICAgICAgICBjb25zdW1pbmc6IDIsXG4gICAgICAgICAgcHJpY2U6IDAuMDAwMTRcbiAgICAgICAgfVxuICAgICAgfTtcblxuICAgICAgY29uc3QgdmVyaWZ5ID0gKGRvbmUpID0+IHtcbiAgICAgICAgLy8gQ3JlYXRlIGEgdGVzdCByZXBvcnQgYXBwXG4gICAgICAgIGNvbnN0IGFwcCA9IHJlcG9ydCgpO1xuXG4gICAgICAgIC8vIExpc3RlbiBvbiBhbiBlcGhlbWVyYWwgcG9ydFxuICAgICAgICBjb25zdCBzZXJ2ZXIgPSBhcHAubGlzdGVuKDApO1xuXG4gICAgICAgIC8vIEdldCB0aGUgcmF0ZWQgdXNhZ2VcbiAgICAgICAgcmVxdWVzdC5nZXQoXG4gICAgICAgICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6OnAvdjEvbWV0ZXJpbmcvb3JnYW5pemF0aW9ucy8nICtcbiAgICAgICAgICAnOm9yZ2FuaXphdGlvbl9pZC9hZ2dyZWdhdGVkL3VzYWdlLzp0aW1lJywge1xuICAgICAgICAgICAgcDogc2VydmVyLmFkZHJlc3MoKS5wb3J0LFxuICAgICAgICAgICAgb3JnYW5pemF0aW9uX2lkOiAnYTNkN2ZlNGQtM2NiMS00Y2MzLWE4MzEtZmZlOThlMjBjZjI5JyxcbiAgICAgICAgICAgIHRpbWU6IDE0NDY1MDg4MDAwMDBcbiAgICAgICAgICB9LCAoZXJyLCB2YWwpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdChlcnIpLnRvLmVxdWFsKHVuZGVmaW5lZCk7XG5cbiAgICAgICAgICAgIC8vIEV4cGVjdCB0aGUgb2N0b2JlciB3aW5kb3cgdmFsdWUgdG8gYmUgYmFzZWQgaW4gb2N0b2JlciBvbmx5XG4gICAgICAgICAgICBleHBlY3QodmFsLnN0YXR1c0NvZGUpLnRvLmVxdWFsKDIwMCk7XG4gICAgICAgICAgICBjb25zdCBhdSA9IHZhbC5ib2R5LnJlc291cmNlc1swXS5wbGFuc1swXS5hZ2dyZWdhdGVkX3VzYWdlWzBdO1xuICAgICAgICAgICAgZXhwZWN0KGF1LndpbmRvd3NbM11bMV0pLnRvLmRlZXAuZXF1YWwoZXhwZWN0ZWREYXkpO1xuICAgICAgICAgICAgZXhwZWN0KGF1LndpbmRvd3NbNF1bMV0pLnRvLmRlZXAuZXF1YWwoZXhwZWN0ZWRNb250aCk7XG5cbiAgICAgICAgICAgIC8vIEV4cGVjdCBVTktOT1dOMidzIGRheSB3aW5kb3dzIHRvIGJlIG51bGwgYW5kIG1vbnRoIHdpbmRvdyBzaGlmdGVkXG4gICAgICAgICAgICBleHBlY3QodmFsLmJvZHkuc3BhY2VzWzBdLmNvbnN1bWVyc1sxXS5yZXNvdXJjZXNbMF1cbiAgICAgICAgICAgICAgLmFnZ3JlZ2F0ZWRfdXNhZ2VbMF0ud2luZG93c1szXVswXSkudG8uZXF1YWwobnVsbCk7XG4gICAgICAgICAgICBleHBlY3QodmFsLmJvZHkuc3BhY2VzWzBdLmNvbnN1bWVyc1sxXS5yZXNvdXJjZXNbMF1cbiAgICAgICAgICAgICAgLmFnZ3JlZ2F0ZWRfdXNhZ2VbMF0ud2luZG93c1szXVsxXSkudG8uZXF1YWwobnVsbCk7XG4gICAgICAgICAgICBleHBlY3QodmFsLmJvZHkuc3BhY2VzWzBdLmNvbnN1bWVyc1sxXS5yZXNvdXJjZXNbMF1cbiAgICAgICAgICAgICAgLmFnZ3JlZ2F0ZWRfdXNhZ2VbMF0ud2luZG93c1s0XVswXSkudG8uZXF1YWwobnVsbCk7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9O1xuXG4gICAgICAvLyBWZXJpZnkgdXNpbmcgYW4gdW5zZWN1cmVkIHNlcnZlciBhbmQgdGhlbiB2ZXJpZnkgdXNpbmcgYSBzZWN1cmVkIHNlcnZlclxuICAgICAgdmVyaWZ5KGRvbmUpO1xuICAgIH0pO1xuICB9KTtcblxuICBjb250ZXh0KCd3aGVuIGFjY3VtdWxhdGVkIHVzYWdlIGhhcyBzbWFsbCBudW1iZXJzJywgKCkgPT4ge1xuICAgIGJlZm9yZSgoZG9uZSkgPT4ge1xuXG4gICAgICBjb25zdCBhY2N1bXVsYXRlZCA9IGFjY3VtdWxhdGVkVGVtcGxhdGUoYnVpbGRBY2N1bXVsYXRlZFVzYWdlKFxuICAgICAgICB7IGN1cnJlbnQ6IDEgfSwgeyBjdXJyZW50OiAxIH0sIHsgY3VycmVudDogMTAwIH0sIDEsIDAuMDMsIDE1LFxuICAgICAgICB1bmRlZmluZWQsIHRydWUsIHVuZGVmaW5lZCkpO1xuXG4gICAgICBzdG9yZUFjY3VtdWxhdGVkVXNhZ2UoYWNjdW11bGF0ZWQsIGRvbmUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ1JldHJpZXZlIGFjY3VtdWxhdGVkIHVzYWdlJywgKGRvbmUpID0+IHtcbiAgICAgIGNvbnN0IHZlcmlmeSA9IChkb25lKSA9PiB7XG4gICAgICAgIC8vIENyZWF0ZSBhIHRlc3QgcmVwb3J0IGFwcFxuICAgICAgICBjb25zdCBhcHAgPSByZXBvcnQoKTtcblxuICAgICAgICAvLyBMaXN0ZW4gb24gYW4gZXBoZW1lcmFsIHBvcnRcbiAgICAgICAgY29uc3Qgc2VydmVyID0gYXBwLmxpc3RlbigwKTtcblxuICAgICAgICBjb25zdCBleHBlY3RlZCA9IHtcbiAgICAgICAgICBpZDogYWNjaWQsXG4gICAgICAgICAgZW5kOiAxNDQ2NDE1MjAwMDAwLFxuICAgICAgICAgIHByb2Nlc3NlZDogMTQ0NjQxODgwMDAwMCxcbiAgICAgICAgICBzdGFydDogMTQ0NjQxNTIwMDAwMCxcbiAgICAgICAgICByZXNvdXJjZV9pZDogJ3Rlc3QtcmVzb3VyY2UnLFxuICAgICAgICAgIHNwYWNlX2lkOiAnYWFlYWUyMzktZjNmOC00ODNjLTlkZDAtZGU1ZDQxYzM4YjZhJyxcbiAgICAgICAgICBvcmdhbml6YXRpb25faWQ6IG9pZCxcbiAgICAgICAgICBjb25zdW1lcl9pZDogJ1VOS05PV04nLFxuICAgICAgICAgIHJlc291cmNlX2luc3RhbmNlX2lkOiByaWQsXG4gICAgICAgICAgcGxhbl9pZDogJ2Jhc2ljJyxcbiAgICAgICAgICBtZXRlcmluZ19wbGFuX2lkOiAndGVzdC1tZXRlcmluZy1wbGFuJyxcbiAgICAgICAgICByYXRpbmdfcGxhbl9pZDogJ3Rlc3QtcmF0aW5nLXBsYW4nLFxuICAgICAgICAgIHByaWNpbmdfcGxhbl9pZDogJ3Rlc3QtcHJpY2luZy1iYXNpYycsXG4gICAgICAgICAgYWNjdW11bGF0ZWRfdXNhZ2U6IGJ1aWxkQWNjdW11bGF0ZWRVc2FnZSgxLCAxLCAxMDAsIDEsIDAuMDMsIDE1LFxuICAgICAgICAgICAgdHJ1ZSwgdHJ1ZSwgdHJ1ZSksXG4gICAgICAgICAgd2luZG93czogW1tudWxsXSwgW251bGxdLCBbbnVsbF0sXG4gICAgICAgICAgICBbe1xuICAgICAgICAgICAgICBjaGFyZ2U6IDE2LjAzXG4gICAgICAgICAgICB9LCBudWxsXSxcbiAgICAgICAgICAgIFt7XG4gICAgICAgICAgICAgIGNoYXJnZTogMTYuMDNcbiAgICAgICAgICAgIH0sIG51bGxdXG4gICAgICAgICAgXVxuICAgICAgICB9O1xuXG4gICAgICAgIC8vIEdldCB0aGUgYWNjdW11bGF0ZWQgdXNhZ2VcbiAgICAgICAgcmVxdWVzdC5nZXQoXG4gICAgICAgICAgJ2h0dHA6Ly9sb2NhbGhvc3Q6OnAvdjEvbWV0ZXJpbmcvb3JnYW5pemF0aW9ucy86b3JnYW5pemF0aW9uX2lkLycgK1xuICAgICAgICAgICdzcGFjZXMvOnNwYWNlX2lkL3Jlc291cmNlX2luc3RhbmNlcy86cmVzb3VyY2VfaW5zdGFuY2VfaWQvJyArXG4gICAgICAgICAgJ2NvbnN1bWVycy86Y29uc3VtZXJfaWQvcGxhbnMvOnBsYW5faWQvbWV0ZXJpbmdfcGxhbnMvJyArXG4gICAgICAgICAgJzptZXRlcmluZ19wbGFuX2lkL3JhdGluZ19wbGFucy86cmF0aW5nX3BsYW5faWQvJyArXG4gICAgICAgICAgJ3ByaWNpbmdfcGxhbnMvOnByaWNpbmdfcGxhbl9pZC90Lzp0L2FnZ3JlZ2F0ZWQvdXNhZ2UvOnRpbWUnLCB7XG4gICAgICAgICAgICBwOiBzZXJ2ZXIuYWRkcmVzcygpLnBvcnQsXG4gICAgICAgICAgICBvcmdhbml6YXRpb25faWQ6ICdhM2Q3ZmU0ZC0zY2IxLTRjYzMtYTgzMS1mZmU5OGUyMGNmMjcnLFxuICAgICAgICAgICAgcmVzb3VyY2VfaW5zdGFuY2VfaWQ6ICcwYjM5ZmE3MC1hNjVmLTQxODMtYmFlOC0zODU2MzNjYTVjODcnLFxuICAgICAgICAgICAgY29uc3VtZXJfaWQ6ICdVTktOT1dOJyxcbiAgICAgICAgICAgIHBsYW5faWQ6ICdiYXNpYycsXG4gICAgICAgICAgICBzcGFjZV9pZDogJ2FhZWFlMjM5LWYzZjgtNDgzYy05ZGQwLWRlNWQ0MWMzOGI2YScsXG4gICAgICAgICAgICBtZXRlcmluZ19wbGFuX2lkOiAndGVzdC1tZXRlcmluZy1wbGFuJyxcbiAgICAgICAgICAgIHJhdGluZ19wbGFuX2lkOiAndGVzdC1yYXRpbmctcGxhbicsXG4gICAgICAgICAgICBwcmljaW5nX3BsYW5faWQ6ICd0ZXN0LXByaWNpbmctYmFzaWMnLFxuICAgICAgICAgICAgdDogJzAwMDE0NDY0MTg4MDAwMDAnLFxuICAgICAgICAgICAgdGltZTogMTQ0NjQxODgwMDAwMFxuICAgICAgICAgIH0sIChlcnIsIHZhbCkgPT4ge1xuICAgICAgICAgICAgZXhwZWN0KGVycikudG8uZXF1YWwodW5kZWZpbmVkKTtcbiAgICAgICAgICAgIGV4cGVjdCh2YWwuYm9keSkudG8uZGVlcC5lcXVhbChleHBlY3RlZCk7XG4gICAgICAgICAgICBkb25lKCk7XG4gICAgICAgICAgfSk7XG4gICAgICB9O1xuXG4gICAgICAvLyBWZXJpZnkgdXNpbmcgYW4gdW5zZWN1cmVkIHNlcnZlciBhbmQgdGhlbiB2ZXJpZnkgdXNpbmcgYSBzZWN1cmVkIHNlcnZlclxuICAgICAgdmVyaWZ5KGRvbmUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ1JldHJpZXZlIGFjY3VtdWxhdGVkIHVzYWdlIHVzaW5nIGEgR3JhcGhRTCBxdWVyeScsIChkb25lKSA9PiB7XG4gICAgICBjb25zdCB2ZXJpZnkgPSAoZG9uZSkgPT4ge1xuICAgICAgICAvLyBDcmVhdGUgYSB0ZXN0IHJlcG9ydCBhcHBcbiAgICAgICAgY29uc3QgYXBwID0gcmVwb3J0KCk7XG5cbiAgICAgICAgLy8gTGlzdGVuIG9uIGFuIGVwaGVtZXJhbCBwb3J0XG4gICAgICAgIGNvbnN0IHNlcnZlciA9IGFwcC5saXN0ZW4oMCk7XG5cbiAgICAgICAgLy8gRGVmaW5lIHRoZSBncmFwaHFsIHF1ZXJ5XG4gICAgICAgIGNvbnN0IHF1ZXJ5ID0gJ3sgcmVzb3VyY2VfaW5zdGFuY2Uob3JnYW5pemF0aW9uX2lkOiAnICtcbiAgICAgICAgICAnXCJhM2Q3ZmU0ZC0zY2IxLTRjYzMtYTgzMS1mZmU5OGUyMGNmMjdcIiwgc3BhY2VfaWQ6ICcgK1xuICAgICAgICAgICdcImFhZWFlMjM5LWYzZjgtNDgzYy05ZGQwLWRlNWQ0MWMzOGI2YVwiLCBjb25zdW1lcl9pZDogXCJVTktOT1dOXCIsICcgK1xuICAgICAgICAgICdyZXNvdXJjZV9pbnN0YW5jZV9pZDogXCIwYjM5ZmE3MC1hNjVmLTQxODMtYmFlOC0zODU2MzNjYTVjODdcIiwgJyArXG4gICAgICAgICAgJ3BsYW5faWQ6IFwiYmFzaWNcIiwgbWV0ZXJpbmdfcGxhbl9pZDogXCJ0ZXN0LW1ldGVyaW5nLXBsYW5cIiwgJyArXG4gICAgICAgICAgJ3JhdGluZ19wbGFuX2lkOiBcInRlc3QtcmF0aW5nLXBsYW5cIiwgcHJpY2luZ19wbGFuX2lkOiAnICtcbiAgICAgICAgICAnXCJ0ZXN0LXByaWNpbmctYmFzaWNcIiwgdDogXCIwMDAxNDQ2NDE4ODAwMDAwXCIsICcgK1xuICAgICAgICAgICd0aW1lOiAxNDQ2NDE4ODAwMDAwICkgJyArXG4gICAgICAgICAgJ3sgb3JnYW5pemF0aW9uX2lkLCBjb25zdW1lcl9pZCwgcmVzb3VyY2VfaW5zdGFuY2VfaWQsIHBsYW5faWQsICcgK1xuICAgICAgICAgICdhY2N1bXVsYXRlZF91c2FnZSB7IG1ldHJpYywgd2luZG93cyB7IHF1YW50aXR5LCBjb3N0LCBjaGFyZ2UsICcgK1xuICAgICAgICAgICdzdW1tYXJ5IH0gfSwgd2luZG93cyB7IGNoYXJnZSB9fX0nO1xuXG4gICAgICAgIGNvbnN0IGV4cGVjdGVkID0ge1xuICAgICAgICAgIHJlc291cmNlX2luc3RhbmNlOiB7XG4gICAgICAgICAgICBvcmdhbml6YXRpb25faWQ6IG9pZCxcbiAgICAgICAgICAgIGNvbnN1bWVyX2lkOiAnVU5LTk9XTicsXG4gICAgICAgICAgICByZXNvdXJjZV9pbnN0YW5jZV9pZDogcmlkLFxuICAgICAgICAgICAgcGxhbl9pZDogJ2Jhc2ljJyxcbiAgICAgICAgICAgIGFjY3VtdWxhdGVkX3VzYWdlOiBidWlsZEFjY3VtdWxhdGVkVXNhZ2UoMSwgMSwgMTAwLCAxLCAwLjAzLCAxNSxcbiAgICAgICAgICAgICAgdHJ1ZSwgdHJ1ZSwgdHJ1ZSksXG4gICAgICAgICAgICB3aW5kb3dzOiBbW251bGxdLCBbbnVsbF0sIFtudWxsXSxcbiAgICAgICAgICAgICAgW3tcbiAgICAgICAgICAgICAgICBjaGFyZ2U6IDE2LjAzXG4gICAgICAgICAgICAgIH0sIG51bGxdLFxuICAgICAgICAgICAgICBbe1xuICAgICAgICAgICAgICAgIGNoYXJnZTogMTYuMDNcbiAgICAgICAgICAgICAgfSwgbnVsbF1cbiAgICAgICAgICAgIF1cbiAgICAgICAgICB9XG4gICAgICAgIH07XG5cbiAgICAgICAgLy8gR2V0IHRoZSBhY2N1bXVsYXRlZCB1c2FnZVxuICAgICAgICByZXF1ZXN0LmdldChcbiAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDo6cC92MS9tZXRlcmluZy9hZ2dyZWdhdGVkL3VzYWdlL2dyYXBoLzpxdWVyeScsIHtcbiAgICAgICAgICAgIHA6IHNlcnZlci5hZGRyZXNzKCkucG9ydCxcbiAgICAgICAgICAgIHF1ZXJ5OiBxdWVyeVxuICAgICAgICAgIH0sIChlcnIsIHZhbCkgPT4ge1xuICAgICAgICAgICAgZXhwZWN0KGVycikudG8uZXF1YWwodW5kZWZpbmVkKTtcblxuICAgICAgICAgICAgLy8gRXhwZWN0IG91ciB0ZXN0IGFjY3VtdWxhdGVkIHVzYWdlXG4gICAgICAgICAgICBleHBlY3QodmFsLnN0YXR1c0NvZGUpLnRvLmVxdWFsKDIwMCk7XG4gICAgICAgICAgICBleHBlY3QodmFsLmJvZHkpLnRvLmRlZXAuZXF1YWwoZXhwZWN0ZWQpO1xuXG4gICAgICAgICAgICAvLyBDaGVjayBvYXV0aCB2YWxpZGF0b3Igc3B5XG4gICAgICAgICAgICAvLyBleHBlY3QodmFsaWRhdG9yc3B5LmNhbGxDb3VudCkudG8uZXF1YWwoc2VjdXJlZCA/IDEgOiAwKTtcblxuICAgICAgICAgICAgZG9uZSgpO1xuICAgICAgICAgIH0pO1xuICAgICAgfTtcblxuICAgICAgLy8gVmVyaWZ5IHVzaW5nIGFuIHVuc2VjdXJlZCBzZXJ2ZXIgYW5kIHRoZW4gdmVyaWZ5IHVzaW5nIGEgc2VjdXJlZCBzZXJ2ZXJcbiAgICAgIHZlcmlmeShkb25lKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgY29udGV4dCgnd2hlbiBxdWVyeWluZyBjb21wbGV4IHVzYWdlIHdpdGggZ3JhcGhxbCcsICgpID0+IHtcblxuICAgIGJlZm9yZSgoZG9uZSkgPT4ge1xuICAgICAgY29uc3QgYWNjdW11bGF0ZWQgPSB7XG4gICAgICAgIGlkOiAnay9vcmcvaW5zL2Nvbi9iYXNpYy8nICtcbiAgICAgICAgICAndGVzdC1tZXRlcmluZy1wbGFuL3Rlc3QtcmF0aW5nLXBsYW4vJyArXG4gICAgICAgICAgJ3Rlc3QtcHJpY2luZy1iYXNpYy90LzAwMDE0NTYxODU2MDAwMDAnLFxuICAgICAgICBvcmdhbml6YXRpb25faWQ6ICdvcmcnLFxuICAgICAgICBzcGFjZV9pZDogJ3NwYScsXG4gICAgICAgIHJlc291cmNlX2lkOiAndGVzdC1yZXNvdXJjZScsXG4gICAgICAgIGNvbnN1bWVyX2lkOiAnY29uJyxcbiAgICAgICAgcmVzb3VyY2VfaW5zdGFuY2VfaWQ6ICdpbnMnLFxuICAgICAgICBwbGFuX2lkOiAnYmFzaWMnLFxuICAgICAgICBtZXRlcmluZ19wbGFuX2lkOiAndGVzdC1tZXRlcmluZy1wbGFuJyxcbiAgICAgICAgcmF0aW5nX3BsYW5faWQ6ICd0ZXN0LXJhdGluZy1wbGFuJyxcbiAgICAgICAgcHJpY2luZ19wbGFuX2lkOiAndGVzdC1wcmljaW5nLWJhc2ljJyxcbiAgICAgICAgc3RhcnQ6IDE0NTYwOTkyMDAwMDAsXG4gICAgICAgIGVuZDogMTQ1NjA5OTIwMDAwMCxcbiAgICAgICAgcHJvY2Vzc2VkOiAxNDU2MTg1NjAwMDAwLFxuICAgICAgICBhY2N1bXVsYXRlZF91c2FnZTogW3tcbiAgICAgICAgICBtZXRyaWM6ICdtZW1vcnknLFxuICAgICAgICAgIHdpbmRvd3M6IFtbbnVsbF0sIFtudWxsXSwgW251bGxdLCBbbnVsbF0sXG4gICAgICAgICAgICBbe1xuICAgICAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgICAgIGN1cnJlbnQ6IHsgY29uc3VtaW5nOiAwLCBjb25zdW1lZDogMzYyODgwMDAwMCB9LFxuICAgICAgICAgICAgICAgIHByZXZpb3VzOiB7IGNvbnN1bWluZzogMiwgY29uc3VtZWQ6IDAgfVxuICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICBjb3N0OiA1MDgwMzIwMFxuICAgICAgICAgICAgfV1cbiAgICAgICAgICBdXG4gICAgICAgIH1dXG4gICAgICB9O1xuXG4gICAgICBzdG9yZUFjY3VtdWxhdGVkVXNhZ2UoYWNjdW11bGF0ZWQsIGRvbmUpO1xuICAgIH0pO1xuXG4gICAgaXQoJ1JldHJpZXZlIGNvbXBsZXggYWNjdW11bGF0ZWQgdXNhZ2UgdXNpbmcgYSBHcmFwaFFMIHF1ZXJ5JywgKGRvbmUpID0+IHtcbiAgICAgIGNvbnN0IGV4cGVjdGVkID0ge1xuICAgICAgICByZXNvdXJjZV9pbnN0YW5jZToge1xuICAgICAgICAgIG9yZ2FuaXphdGlvbl9pZDogJ29yZycsXG4gICAgICAgICAgY29uc3VtZXJfaWQ6ICdjb24nLFxuICAgICAgICAgIHJlc291cmNlX2luc3RhbmNlX2lkOiAnaW5zJyxcbiAgICAgICAgICBwbGFuX2lkOiAnYmFzaWMnLFxuICAgICAgICAgIGFjY3VtdWxhdGVkX3VzYWdlOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIG1ldHJpYzogJ21lbW9yeScsXG4gICAgICAgICAgICAgIHdpbmRvd3M6IFsgWyBudWxsIF0sIFsgbnVsbCBdLCBbIG51bGwgXSwgWyBudWxsIF0sIFtcbiAgICAgICAgICAgICAgICB7XG4gICAgICAgICAgICAgICAgICBxdWFudGl0eToge1xuICAgICAgICAgICAgICAgICAgICBjb25zdW1pbmc6IDAsXG4gICAgICAgICAgICAgICAgICAgIGNvbnN1bWVkOiAzNjI4ODAwMDAwXG4gICAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICBdIF1cbiAgICAgICAgICAgIH1cbiAgICAgICAgICBdXG4gICAgICAgIH1cbiAgICAgIH07XG5cbiAgICAgIGNvbnN0IHZlcmlmeSA9IChkb25lKSA9PiB7XG4gICAgICAgIC8vIENyZWF0ZSBhIHRlc3QgcmVwb3J0IGFwcFxuICAgICAgICBjb25zdCBhcHAgPSByZXBvcnQoKTtcblxuICAgICAgICAvLyBMaXN0ZW4gb24gYW4gZXBoZW1lcmFsIHBvcnRcbiAgICAgICAgY29uc3Qgc2VydmVyID0gYXBwLmxpc3RlbigwKTtcblxuICAgICAgICAvLyBRdWVyeSB3aXRoIG5vIHN1YiBzZWxlY3Rpb25zIGluIHF1YW50aXR5XG4gICAgICAgIGNvbnN0IHF1ZXJ5MSA9ICd7IHJlc291cmNlX2luc3RhbmNlKG9yZ2FuaXphdGlvbl9pZDogJyArXG4gICAgICAgICAgJ1wib3JnXCIsIHNwYWNlX2lkOiBcInNwYVwiLCBjb25zdW1lcl9pZDogXCJjb25cIiwgcmVzb3VyY2VfaW5zdGFuY2VfaWQ6ICcgK1xuICAgICAgICAgICdcImluc1wiLCBwbGFuX2lkOiBcImJhc2ljXCIsIG1ldGVyaW5nX3BsYW5faWQ6IFwidGVzdC1tZXRlcmluZy1wbGFuXCIsICcgK1xuICAgICAgICAgICdyYXRpbmdfcGxhbl9pZDogXCJ0ZXN0LXJhdGluZy1wbGFuXCIsIHByaWNpbmdfcGxhbl9pZDogJyArXG4gICAgICAgICAgJ1widGVzdC1wcmljaW5nLWJhc2ljXCIsIHQ6IFwiMDAwMTQ1NjE4NTYwMDAwMFwiLCAnICtcbiAgICAgICAgICAndGltZTogMTQ1NjE4NTYwMDAwMCApICcgK1xuICAgICAgICAgICd7IG9yZ2FuaXphdGlvbl9pZCwgY29uc3VtZXJfaWQsIHJlc291cmNlX2luc3RhbmNlX2lkLCBwbGFuX2lkLCAnICtcbiAgICAgICAgICAnYWNjdW11bGF0ZWRfdXNhZ2UgeyBtZXRyaWMsIHdpbmRvd3MgeyBxdWFudGl0eSB9fX19JztcblxuICAgICAgICByZXF1ZXN0LmdldChcbiAgICAgICAgICAnaHR0cDovL2xvY2FsaG9zdDo6cC92MS9tZXRlcmluZy9hZ2dyZWdhdGVkL3VzYWdlL2dyYXBoLzpxdWVyeScsIHtcbiAgICAgICAgICAgIHA6IHNlcnZlci5hZGRyZXNzKCkucG9ydCxcbiAgICAgICAgICAgIHF1ZXJ5OiBxdWVyeTFcbiAgICAgICAgICB9LCAoZXJyLCB2YWwpID0+IHtcbiAgICAgICAgICAgIGV4cGVjdChlcnIpLnRvLmVxdWFsKHVuZGVmaW5lZCk7XG5cbiAgICAgICAgICAgIC8vIE5vIHN1YiBzZWxlY3Rpb25zIHdpbGwgcmV0dXJuIHRoZSBxdWVyeSB3aXRoIGEgbnVsbCB2YWx1ZVxuICAgICAgICAgICAgZXhwZWN0KHZhbC5zdGF0dXNDb2RlKS50by5lcXVhbCgyMDApO1xuICAgICAgICAgICAgZXhwZWN0KHZhbC5ib2R5KS50by5kZWVwLmVxdWFsKGV4cGVjdGVkKTtcbiAgICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgICB9KTtcbiAgICAgIH07XG5cbiAgICAgIC8vIFZlcmlmeVxuICAgICAgdmVyaWZ5KGRvbmUpO1xuICAgIH0pO1xuICB9KTtcbn0pO1xuIl19*/

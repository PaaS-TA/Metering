'use strict';

module.exports = {
    plan_id: 'basic-api-call',
    measures: [{
        name: 'light_api_calls',
        unit: 'CALL'
    }],
    metrics: [{
        name: 'thousand_light_api_calls',
        unit: 'THOUSAND_CALLS',
        type: 'discrete',
        meter: function(m) {
            return new BigNumber(m.light_api_calls).div(1000).toNumber();
        }.toString(),
        aggregate: function(a, prev, curr, aggTwCell, accTwCell) {
            return new BigNumber(a || 0).add(curr).sub(prev).toNumber();
        }.toString()
    }]
};
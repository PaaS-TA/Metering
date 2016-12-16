/*

var assert = require("assert");
var request = require("request");

require("./server");

describe("Server", function() {
    it("responds with JSON message 'Hello, World!' at the root", function(done) {
        request("http://localhost:3000", function(err, response, body) {
            if (err) done(err);

            var payload = JSON.parse(body);
            assert.equal(payload.message, "Hello, World!");

            done();
        });
    });
});
*/

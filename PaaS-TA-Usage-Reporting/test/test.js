/*

var supertest = require("supertest");
var should = require("should");
var request = require("request");
var assert = require("assert");

// This agent refers to PORT where program is runninng.

var server = supertest.agent("http://localhost:9507");

// UNIT test begin

describe("SAMPLE unit test",function(){

    it("responds with JSON message 'This is Main Page.' at the root", function(done) {
        request("http://localhost:9507", function(err, response, body) {
            if (err) done(err);

            var payload = body;
            console.log(body);
            assert.equal(payload, "Main Page");

            done();
        });
    });

    it("API test 1",function(done){

        // calling home page api
        server
            .get("/abc")
            .expect("Content-type",/json/)
            .expect(400) // THis is HTTP response
            .end(function(err,res){
                // HTTP status should be 200
                res.status.should.equal(200);
                // Error key should be false.
                res.body.error.should.equal(false);
                done();
            });
    });

});*/

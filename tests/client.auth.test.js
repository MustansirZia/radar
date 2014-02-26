var http = require('http'),
  assert = require('assert'),
  Radar = require('../server/server.js'),
  Client = require('radar_client').constructor,
  Type = require('../core').Type,
  common = require('./common.js'),
  configuration = require('./configuration.js');

exports['auth: given a server and a client'] = {
  beforeEach: function(done) {
    var self = this;
    common.startRadar(this, function() {
      self.client = common.getClient('client_auth', 111, 0,
        { name: 'tester0' }, done);
    });
  },

  afterEach: function(done) {
    this.client.dealloc('test');
    common.endRadar(this, done);
  },

  // GET /radar/message?accountName=test&scope=chat/1
  'failed authentication should return the original message': function(done) {

    Type.add([{
      name: 'client_auth',
      expression: /^message:\/client_auth\/test$/,
      type: 'MessageList',
      authProvider: {
        authorize: function() { return false; }
      }
    }]);

    var originalMessage = { hello: 'world', timestamp: Date.now()};

    this.client.message('test').publish(originalMessage);

    this.client.on('err', function(message) {
      assert.ok(message.origin);
      assert.equal(message.origin.op, 'publish');
      assert.equal(message.origin.to, 'message:/client_auth/test');
      assert.deepEqual(message.origin.value, originalMessage);
      done();
    });

  }
};

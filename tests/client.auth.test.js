var assert = require('assert'),
    Type = require('../core').Type,
    common = require('./common.js'),
    Tracker = require('callback_tracker'),
    Persistence = require('persistence');

exports['auth: given a server and a client'] = {
  beforeEach: function(done) {
    var self = this,
        track = Tracker.create('before each', done);
    common.startRadar(this, function() {
      Persistence.delWildCard('*', track('cleanup redis'));
      self.client = common.getClient('client_auth', 111, 0,
        { name: 'tester0' }, track('client ready'));
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

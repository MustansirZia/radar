var common = require('./common.js'),
    assert = require('assert'),
    configuration = require('./configuration.js'),
    Persistence = require('../core').Persistence,
    Tracker = require('callback_tracker');
    Client = require('radar_client').constructor;

exports['given two clients'] = {
  before: function(done) {
    common.startRadar(this, done);
  },

  after: function(done) {
    common.endRadar(this, function() {
      Persistence.disconnect(done);
    });
  },

  beforeEach: function(done) {
    var track = Tracker.create('beforeEach', done);
    this.client = common.getClient('dev', 123, 0, {}, track('client 1 ready'));
    this.client2 = common.getClient('dev', 246, 0, {}, track('client 2 ready'));
    Persistence.delWildCard('*', track('cleanup redis'));
  },

  afterEach: function() {
    this.client.dealloc('test');
    this.client2.dealloc('test');
  },

  'can subscribe a presence scope': function(done) {
    var client = this.client, client2 = this.client2;

    var messages = [];

    client.presence('ticket/21')
    .on(function(m) {
      messages.push(m);
    }).subscribe(function() {
      client2.presence('ticket/21').set('online', function() {
        client2.presence('ticket/21').set('offline', function() {
          // ensure that async tasks have run
          setTimeout(function() {
            assert.equal('online', messages[0].op);
            assert.deepEqual({ '246': 0 }, messages[0].value);
            assert.equal('client_online', messages[1].op);
            assert.deepEqual(messages[1].value.userId, 246);
            assert.equal('client_offline', messages[2].op);
            assert.deepEqual(messages[2].value.userId, 246);
            assert.equal('offline', messages[3].op);
            assert.deepEqual({ '246': 0 }, messages[3].value);
            done();
          }, 5);
        });
      });
    });
  },


  'can unsubscribe a presence scope': function(done) {
    var client = this.client, client2 = this.client2;
    client.presence('ticket/21').subscribe(function() {
      client.once('presence:/dev/ticket/21', function(message) {
        assert.equal('online', message.op);
        assert.deepEqual({ '246': 0 }, message.value);
        client.presence('ticket/21').unsubscribe(function() {
          client.once('presence:/dev/ticket/21', function() {
            assert.ok(false); // should not receive message
          });
          client2.presence('ticket/21').set('offline');
          setTimeout(function() {
            done();
          }, 10);
        });
      });
      client2.presence('ticket/21').set('online');
    });
  },

  'can subscribe a status scope': function(done) {
    this.timeout(10000);

    var client = this.client, client2 = this.client2;
    client.status('voice/status').subscribe(function() {
      client.once('status:/dev/voice/status', function(message) {
        assert.equal('246', message.key);
        assert.equal('foo', message.value);
        client.once('status:/dev/voice/status', function(message) {
          assert.equal('246', message.key);
          assert.equal('bar', message.value);
          done();
        });
        client2.status('voice/status').set('bar');
      });
      client2.status('voice/status').set('foo');
    });
  },

  'can subscribe a status scope with chainable interface': function(done) {
    var client = this.client, client2 = this.client2;
    client.status('voice/status').subscribe(function() {
      client2.status('voice/status').set('foo');
    }).once(function(message) {
      assert.equal('246', message.key);
      assert.equal('foo', message.value);
      client.once('status:/dev/voice/status', function(message) {
        assert.equal('246', message.key);
        assert.equal('bar', message.value);
        done();
      });
      client2.status('voice/status').set('bar');
    });
  },

  'can unsubscribe a status scope': function(done) {
    var client = this.client, client2 = this.client2;
    client.status('voice/status').subscribe(function() {
      client.once('status:/dev/voice/status', function(message) {
        assert.equal('246', message.key);
        assert.equal('foo', message.value);
        client.status('voice/status').unsubscribe(function() {
          client.once('status:/dev/voice/status', function() {
            assert.ok(false); // should not receive message
          });
          client2.status('voice/status').set('bar');
          setTimeout(function() {
            done();
          }, 10);
        });
      });
      client2.status('voice/status').set('foo');
    });
  }
};

var common = require('./common.js'),
    assert = require('assert'),
    logging = require('minilog')('test'),
    Persistence = require('../core').Persistence,
    Tracker = require('callback_tracker'),
    Client = require('radar_client').constructor,
    PresenceMessage = require('./lib/assert_helper.js').PresenceMessage,
    radar, client, client2;

describe('given two clients and a presence resource', function() {
  var p;
  before(function(done) {
    radar = common.spawnRadar();
    radar.sendCommand('start', common.configuration, done);
  });

  after(function(done) {
    common.stopRadar(radar, done);
  });

  beforeEach(function(done) {
    p = new PresenceMessage('dev', 'test');
    var track = Tracker.create('beforeEach', done);
    client = common.getClient('dev', 123, 0, { name: 'tester' }, track('client 1 ready'));
    client2 = common.getClient('dev', 246, 0, { name: 'tester2' }, track('client 2 ready'));
    client3 = common.getClient('dev', 300, 0, {}, track('client 3 ready'));
  });

  afterEach(function() {
    p.teardown();
    client.presence('test').set('offline').removeAllListeners();
    client2.presence('test').set('offline').removeAllListeners();
    client3.presence('test').set('offline').removeAllListeners();
    client.dealloc('test');
    client2.dealloc('test');
    client3.dealloc('test');
  });

  describe('when using subscribe/unsubscribe', function() {
    it('can subscribe a presence scope', function(done) {
      client.presence('test').on(p.notify).subscribe(function(message) {
        p.for_client(client).assert_ack_for_subscribe(message);
        client2.presence('test').set('online');
        client2.presence('test').set('offline');
      });

      p.fail_on_more_than(4);
      p.once(4, function() {
        // ensure that no more messages come
        setTimeout(function() {
          p.for_client(client2).assert_message_sequence([
            'online', 'client_online', 'client_explicit_offline', 'offline'
          ]);
          done();
        }, 5);
      });
    });

    it('can unsubscribe a presence scope', function(done) {
      client.presence('test').on(p.notify).subscribe();
      client2.presence('test').set('online');

      p.fail_on_more_than(2);
      p.on(2, function() {
        // online and client_online
        p.for_client(client2).assert_message_sequence(
          [ 'online', 'client_online' ]
        );
        client.presence('test').unsubscribe(function(message) {
          p.for_client(client).assert_ack_for_unsubscribe(message);
          client2.presence('test').set('offline');
          setTimeout(done,10);
        });
      });

    });

    describe('with a client subscribed', function() {
      it('should receive presence notifications if a client comes online', function(done) {
        // subscribe online with client 2
        client2.presence('test').on(p.notify).subscribe(function() {
          // set client 1 to online
          client.presence('test').set('online', function() {
            client2.presence('test').get(function(message) {
              // should show client 1 as online
              p.for_online_clients(client).assert_get_response(message);
              p.for_client(client).assert_message_sequence(
                [ 'online', 'client_online' ]
              );
              done();
            });
          });
        });
      });

      it('should not receive any notification if an offline client unsubscribes', function(done) {
        p.fail_on_any_message();
        // subscribe online with client 2
        client2.presence('test').on(p.notify).subscribe(function() {
          // client 1 disconnect
          client.presence('test').unsubscribe();
          setTimeout(done,20);
        });
      });

      it('should not receive notifications after we unsubscribe', function(done) {
        // subscribe online with client 2
        client2.presence('test').on(p.notify).subscribe(function() {
          client.presence('test').set('online');
        });

        p.fail_on_more_than(2);
        p.on(2, function() {
          p.for_client(client).assert_message_sequence(['online', 'client_online']);

          client2.presence('test').unsubscribe();
          client.presence('test').set('online');
          setTimeout(done, 20);
        });
      });
    });
  });

  describe('when using set()', function() {
    it('can set online', function(done) {
      client.presence('test').set('online', function(ack) {
        p.for_client(client).assert_ack_for_set_online(ack);
        client.presence('test').get(function(message) {
          p.for_online_clients(client).assert_get_response(message);
          done();
        });
      });
    });

    it('can set offline without setting online first', function(done) {
      client.presence('test').set('offline', function(ack) {
        p.for_client(client).assert_ack_for_set_offline(ack);
        client.presence('test').get(function(message) {
          p.for_online_clients().assert_get_response(message);
          done();
        });
      });
    });

    it('can set offline after setting online', function(done) {
      p = p.for_client(client);
      client.presence('test').set('online', function(ack) {
        p.assert_ack_for_set_online(ack);
        client.presence('test').set('offline', function(ack) {
          p.assert_ack_for_set_offline(ack);
          client.presence('test').get(function(message) {
            p.for_online_clients().assert_get_response(message);
            done();
          });
        });
      });
    });

    describe('with another client listening for notifications', function() {
      it('should remain online after a while if the state does not change', function(done) {
        client.presence('test').set('online', function() {
          var presence = client2.presence('test').sync({ version: 2 }, function(message) {
            p.for_online_clients(client).assert_sync_v2_response(message);
            setTimeout(function() {
              presence.get({ version: 2 }, function(message) {
                p.for_online_clients(client).assert_get_v2_response(message);
                done();
              });
            }, 1500); //reread after a while
          });
        });
      });

      it('should not send notifications for a set(offline) if already offline', function(done) {
        p.fail_on_any_message();
        // subscribe online with client 2
        client2.presence('test').on(p.notify).subscribe(function() {
          client.presence('test').set('offline');
          setTimeout(done, 50);
        });
      });

      it('should send online notification only once for multiple set(online)', function(done) {
        // subscribe online with client 2
        client2.presence('test').on(p.notify)
          .subscribe(function() {
            client.presence('test').set('online');
            client.presence('test').set('online');
            client.presence('test').set('online');
            setTimeout(done, 50);
          });

        p.fail_on_more_than(2);
        p.on(2, function() {
          p.for_client(client).assert_message_sequence([ 'online', 'client_online' ]);
        });
      });

      it('should send presence messages correctly when toggling back and forth', function(done) {
        var expected = [];
        var count = 8;

        var toggle = function(index) {
          if(index % 2 === 0) {
            expected = expected.concat(['online', 'client_online']);
            client.presence('test').set('online');
          } else {
            expected = expected.concat(['client_explicit_offline', 'offline']);
            client.presence('test').set('offline');
          }
        };

        client2.presence('test')
          .on(p.notify)
          .subscribe(function() {
            for(var i = 0; i < count; i++) {
              setTimeout(toggle, 10, i);
            }
          });

        var verify = function() {
          assert.equal(2*count, p.notifications.length);
          p.for_client(client).assert_message_sequence(expected);
          done();
        };

        p.on(count*2, function() {
          setTimeout(verify, 50);
        });
      });

      it('should implicitly disconnect after set(online) if unsubscribed', function(done){
        client2.presence('test').on(p.notify).subscribe(function() {
          client.presence('test').set('online');
        });

        p.on(2, function() {
          p.for_client(client).assert_message_sequence(
            [ 'online', 'client_online' ]
          );
          client.presence('test').unsubscribe();
        });

        p.on(4, function() {
          p.for_client(client).assert_message_sequence([
            'online', 'client_online', 'client_implicit_offline', 'offline'
          ]);
          done();
        });
      });

      it('should notify correctly if disconnecting immediately after online', function(done){
        client2.presence('test').on(p.notify).subscribe(function() {
          client.presence('test').set('online');
          client.presence('test').unsubscribe();
        });

        p.on(4, function() {
          p.for_client(client).assert_message_sequence(
            [ 'online', 'client_online', 'client_implicit_offline', 'offline']
          );
          done();
        });
      });
    });
  });

  describe('when using get()', function() {
    it('should respond correctly when using v1 API', function(done) {
      client.presence('test').get(function(message) {
        p.for_online_clients().assert_get_response(message);
        client.presence('test').set('online', function() {
          client.presence('test').get(function(message) {
            p.for_online_clients(client).assert_get_response(message);
            done();
          });
        });
      });
    });

    it('should respond correctly when using v2 API (with userData)', function(done) {
      client.presence('test').get({ version: 2 }, function(message) {
        p.for_online_clients().assert_get_v2_response(message);
        client.presence('test').set('online', function() {
          client.presence('test').get({ version: 2 }, function(message) {
            p.for_online_clients(client).assert_get_v2_response(message);
            done();
          });
        });
      });
    });

    it('should respond correctly when using v2 API (without userData)', function(done) {
      client3.presence('test').get({ version: 2 }, function(message) {
        p.for_online_clients().assert_get_v2_response(message);
        client3.presence('test').set('online', function() {
          client3.presence('test').get({ version: 2 }, function(message) {
            p.for_online_clients(client3).assert_get_v2_response(message);
            done();
          });
        });
      });
    });

    it('can be called multiple times without changing the result', function(done) {
      this.timeout(6000);
      client2.presence('test').on(p.notify).subscribe(function() {
        // set client 1 to online
        client.presence('test').set('online', function() {

          var foo = setInterval(function() {
            client2.presence('test').get(function(message) {
              // both should show client 1 as online
              p.for_online_clients(client).assert_get_response(message);
              p.for_client(client).assert_message_sequence(
                ['online', 'client_online']
              );
            });
          }, 200);

          setTimeout(function() {
            clearInterval(foo);
            done();
          }, 2000);
        });
      });
    });
  });

  describe('when using sync', function() {
    it('should respond correclty when using via v1 API', function(done) {

      client.presence('test').set('online', function() {
        client.presence('test').sync(function(message) {
          p.for_online_clients(client).assert_sync_response(message);
          done();
        });
      });
    });

    it('should respond correctly when using via v2 API (with userData)', function(done) {
      // not supported in v1 api because the result.op == "online" which is handled by the message
      // listener but not by the sync() callback

      client.presence('test').set('online', function() {
        client.presence('test').sync({ version: 2 }, function(message) {
          // sync is implemented as subscribe + get, hence the return op is "get"
          p.for_online_clients(client).assert_sync_v2_response(message);
          done();
        });
      });
    });

    it('should respond correctly when using via v2 API (without userData)', function(done) {
      // not supported in v1 api because the result.op == "online" which is handled by the message
      // listener but not by the sync() callback

      client3.presence('test').set('online', function() {
        client3.presence('test').sync({ version: 2 }, function(message) {
          // sync is implemented as subscribe + get, hence the return op is "get"
          p.for_online_clients(client3).assert_sync_v2_response(message);
          done();
        });
      });
    });

    it('should also subscribe to that resource', function(done) {
      client.presence('test').on(p.notify).sync(function(message) {
        // wait for sync to complete
        p.for_online_clients().assert_sync_response(message);
        client.presence('test').set('online');
      });

      p.fail_on_more_than(2);
      p.on(2, function() {
        p.for_client(client).assert_message_sequence(['online', 'client_online']);
        setTimeout(done, 10);
      });
    });

    it('can be called multiple times without changing the result', function(done) {
      this.timeout(6000);
      client2.presence('test').on(p.notify).subscribe(function() {
        // set client 1 to online
        client.presence('test').set('online', function() {

          var foo = setInterval(function() {
            client2.presence('test').sync(function(message) {
              // both should show client 1 as online
              p.for_online_clients(client).assert_sync_response(message);

              //Not more than 2 notifications ever
              p.for_client(client).assert_message_sequence(
                ['online', 'client_online']);
            });
          }, 200);

          setTimeout(function() {
            clearInterval(foo);
            done();
          }, 2000);
        });
      });
    });
  });

  it('should implicitly disconnect after a request timeout', function(done) {
    this.timeout(55*1000);
    client.presence('test').on(p.notify).subscribe(function() {
      client2.presence('test').set('online');
      setTimeout(function() {
        // Hack a bit so that socketId is saved
        var clientId = client2.currentClientId();
        client2.currentClientId = function() { return clientId; };
        //disconnect, causing a request timeout or socket close
        client2.manager.close();
      },10);
    });

    p.on(4, function() {
      p.for_client(client2).assert_message_sequence(
        ['online', 'client_online', 'client_implicit_offline', 'offline']
      );
      done();
    });
  });

  it('should keep a user online for a grace period for disconnections', function(done) {
    client2.presence('test').on(p.notify).subscribe(function() {
      client.presence('test').set('online');
    });

    p.on(2, function() {
      p.for_client(client).assert_message_sequence(
        ['online', 'client_online']
      );

      // Hack a bit so that socketId is saved
      var clientId = client.currentClientId();
      client.currentClientId = function() { return clientId; };

      client.dealloc('test');
      var time = Date.now();

      setTimeout(function() {
        client2.presence('test').get(function(message){
          p.for_online_clients(client).assert_get_response(message);
        });
        p.on(4, function() {
          assert.ok(Date.now() - time > 950); //timeout is 1 second
          p.for_client(client).assert_message_sequence([
            'online', 'client_online', 'client_implicit_offline', 'offline'
          ]);
          client2.presence('test').get(function(message) {
            p.for_online_clients().assert_get_response(message);
            client.alloc('test', done);
          });
        });
      }, 900);
    });
  });
});

var Resource = require('../../resource.js'),
    Persistence = require('../../persistence.js'),
    CrossServer = require('./cross_server.js'),
    logging = require('minilog')('presence');

function Presence(name, parent, options) {
  Resource.call(this, name, parent, options);
  var self = this;
  this.type = 'presence';

  this._disconnectQueue = [];
  this._xserver = new CrossServer();
  this._xserver.on('user_online', function(userId) {
    console.log('user_online', userId);
    var value = {};
    value[userId] = 0; // fixme
    self.broadcast(JSON.stringify({
      to: self.name,
      op: 'online',
      value: value
    }));
  });
  this._xserver.on('user_offline', function(userId) {
    console.log('user_offline (queue)', userId);
    if(self._disconnectQueue.indexOf(userId) == -1) {
      self._disconnectQueue.push(userId);
    }
    // here, we set a delay for the check
    setTimeout(function() { self._processDisconnects(); }, 15000);
  });
  this._xserver.on('client_online', function(clientId, userId) {
    console.log('client_online', userId);
    self.broadcast(JSON.stringify({
      to: self.name,
      op: 'client_online',
      value: {
        userId: userId,
        clientId: clientId
      }
    }));
  });
  this._xserver.on('client_offline', function(clientId, userId) {
    console.log('client_offline', userId);
    self.broadcast(JSON.stringify({
      to: self.name,
      op: 'client_offline',
      value: {
        userId: userId,
        clientId: clientId
      }
    }));
  });
}

Presence.prototype = new Resource();

Presence.prototype.redisIn = function(data) {
  try {
    var message = JSON.parse(data);
  } catch(e) { return; }

  if(this._xserver.isLocal(message.clientId)) {
    return;
  }

  this._xserver.remoteMessage(message);
};

Presence.prototype.setStatus = function(client, message, sendAck) {
  if(arguments.length == 1) {
    message = client; // client and sendAck are optional
  }
  var self = this,
      userId = message.key,
      userType = message.type,
      isOnline = (message.value != 'offline');

  function ackCheck() {
    sendAck && self.ack(client, sendAck);
  }

  if(isOnline) {
    // we use subscribe/unsubscribe to trap the "close" event, so subscribe now
    this.subscribe(client);
    this._xserver.addLocal(client.id, userId, ackCheck);
  } else {
    // remove from local
    this._xserver.removeLocal(client.id, userId, ackCheck);
  }
};

Presence.prototype.unsubscribe = function(client, sendAck) {
  var self = this;
  this._xserver.disconnectLocal(client.id);
  // garbage collect if the set of subscribers is empty
  if (Object.keys(this.subscribers).length == 1) {
    // this._counter = null;
  }
  // call parent
  Resource.prototype.unsubscribe.call(this, client, sendAck);
};

Presence.prototype.sync = function(client) {
  var self = this;
  this.fullRead(function(online) {
    client.send(JSON.stringify({
      op: 'online',
      to: self.name,
      value: online
    }));
  });
};

// this is a full sync of the online status from Redis
Presence.prototype.getStatus = function(client, key) {
  var self = this;
  this.fullRead(function(online) {
    client.send(JSON.stringify({
      op: 'get',
      to: self.name,
      value: online
    }));
  });
};

Presence.prototype.broadcast = function(message) {
  logging.debug('updateSubscribers', message);
  var self = this;
  Object.keys(this.subscribers).forEach(function(subscriber) {
    var client = self.parent.server.clients[subscriber];
    client && client.send(message);
  });
};

Presence.prototype.fullRead = function(callback) {
  var self = this;
  // sync scope presence
  logging.debug('Persistence.readHashAll', this.scope);
  Persistence.readHashAll(this.scope, function(replies) {
    logging.debug(self.scope, 'REPLIES', replies);

    if(!replies) {
      return callback && callback({});
    }

    // process all messages in one go before updating subscribers to avoid
    // sending multiple messages
    Object.keys(replies).forEach(function(key) {
      var data = replies[key];
      try {
        var message = JSON.parse(data);
        if(message.constructor !== Object) {
          throw new Error('JSON parse result is not an Object');
        }
      } catch(err) {
        logging.error('Persistence full read: invalid message', data, err);
        return callback && callback({});
      }
      self._xserver.remoteMessage(message);
    });

    callback && callback(self._xserver.getOnline());
  });
};

Presence.prototype._processDisconnects = function() {
  var value = {}, self = this;
  this._disconnectQueue.forEach(function(userId)  {
    if(self._counter.has(userId)) {
      logging.info('Cancel disconnect, as user has reconnected during grace period, userId:', userId);
    } else {
      value[userId] = 0; // fixme
      self.broadcast(JSON.stringify({
        to: self.name,
        op: 'offline',
        value: value
      }));
    }
  });
};

Presence.setBackend = function(backend) { Persistence = backend; };

module.exports = Presence;

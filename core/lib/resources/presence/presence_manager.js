var util = require("util");
var events = require("events");
var logger = require('minilog')('presence_manager');

var PresenceTimeoutManager = require('./presence_timeout_manager.js');

var DATA_EXPIRY     = 50 * 1000;
var OFFLINE_EXPIRY  = 15 * 1000;

function PresenceManager(scope, persistence, eventBus, policy) {
  events.EventEmitter.call(this);

  var self = this;
  this._scope = scope;
  this._persistence = persistence;
  if(policy) {
    this._policy = policy;
  }

  this._users = {};

  this.fullRead(function() {
  });
  self._attach(eventBus);

}

util.inherits(PresenceManager, events.EventEmitter);

PresenceManager.prototype._attach = function(eventBus) {

  var self = this;

  var timeoutManager = new PresenceTimeoutManager();

  timeoutManager.on('timeout', function(userId) {
    if(!self.isUserConnected(userId)) {
      var userType = null;
      if(self.userExists(userId)) {
        userType = self._users[userId].userType;
        self._removeUser(userId);
      }
      self.emit('user_offline', userId, undefined, userType);
    }
  });

  eventBus.on('client_online', function(userId, clientId, userType, userData) {
    // TODO: client online should fire whenever a new client comes online, not only when a new user comes online
    if(!self.isUserConnected(userId)) {
      if(timeoutManager.has(userId)) {
        logger.info('cancelling scheduled offline', userId);
        timeoutManager.cancel(userId);
        self.emit('client_online', userId, clientId, userType, userData);
      } else {
        self.emit('user_online', userId, clientId, userType, userData);
        self.emit('client_online', userId, clientId, userType, userData);
      }
    }
    self._add(userId, clientId, userType, userData);
  });

  eventBus.on('client_offline', function(userId, clientId, userType, userData, hard) {

    if(self.exists(userId, clientId)) {
      self._remove(userId, clientId);
      self.emit('client_offline', userId, clientId, userType, userData);
    }

    if(!self.isUserConnected(userId)) {
      if(hard) {
        self._removeUser(userId);
        self.emit('user_offline', userId, clientId, userType);
      } else {
        logger.info('scheduled offline', userId);
        timeoutManager.schedule(userId, OFFLINE_EXPIRY);
      }
    }

  });
}

PresenceManager.prototype._add = function(userId, clientId, userType, userData) {
  if(!this._users[userId]) {
    this._users[userId] = {
      clientsCount: 0,
      clients: {}
    };
  }
  this._users[userId].lastTouch = Date.now();
  this._users[userId].userType = userType;
  this._users[userId].clientsCount ++;
  this._users[userId].clients[clientId] = userData || {};
}

PresenceManager.prototype._remove = function(userId, clientId) {
  if(this._users[userId]) {
    this._users[userId].clientsCount --;
    delete this._users[userId].clients[clientId];
  }
}

PresenceManager.prototype._removeUser = function(userId) {
  if(this._users[userId]) {
    delete this._users[userId];
  }
}

PresenceManager.prototype.userExists = function(userId) {
  return  this._users.hasOwnProperty(userId);
}

PresenceManager.prototype.isUserConnected = function(userId) {
  return  (this._users.hasOwnProperty(userId) && this._users[userId].clientsCount > 0);
}

PresenceManager.prototype.exists = function(userId, clientId) {
  return this._users.hasOwnProperty(userId) && this._users[userId].clients[clientId];
}

PresenceManager.prototype.online = function(userId, clientId, userType, data, callback) {

  logger.debug('online', this._scope, userId, clientId, userType, data);

  var message = {
    userId: userId,
    userType: userType,
    clientId: clientId,
    userData: data,
    online: true,
    at: Date.now()
  };

  this._persistence.persistHash(this._scope, userId + '.' + clientId, message);

  if(this._policy && this._policy.maxPersistence) {
    this._persistence.expire(this._scope, this._policy.maxPersistence);
  }

  // online is called at regular intervals while a client is online
  // this allows to detect when something is wrong with this client or
  // the radar instance managing this client went down.
  // We know something is wrong if the 'at' timestamp is too old.
  if(!this.exists(userId, clientId)) {
    this._persistence.publish(this._scope, message, callback);
  }

};

PresenceManager.prototype.offline = function(userId, clientId, userType, data, hard, callback) {

  logger.debug('offline', this._scope, userId, clientId, userType, hard);
  this._persistence.deleteHash(this._scope, userId + '.' + clientId);

  this._persistence.publish(this._scope, {
    userId: userId,
    userType: userType,
    clientId: clientId,
    userData: data,
    hard: hard,
    online: false,
    at: Date.now()
  }, callback);

};

PresenceManager.prototype.getUsers = function() {
  return this._users;
};

PresenceManager.prototype.fullRead = function(callback) {
  var self = this;
  var readStartTimestamp = Date.now();
  this._persistence.readHashAll(this._scope, function(result) {
    if(result && result.length > 0) {
      var oldUsers = self._users;
      self._users = {};
      var staleTimeThreshold = Date.now() - DATA_EXPIRY;

      for(var key in result) {
        if(result.hasOwnProperty(key)) {
          if(result[key].at && result[key].at > staleTimeThreshold) {

            var userId = result[key].userId;
            var clientId = result[key].clientId;
            var userType = result[key].userType;
            var userData = result[key].userData;

            self._add(userId, clientId, userType, userData);
          }
        }
      }

      for(var userId in oldUsers) {
        if(oldUsers.hasOwnProperty(userId) && oldUsers[userId].lastTouch > readStartTimestamp) {
          self._users[userId] = oldUsers[userId];
        }
      }
    }
    callback();
  });
};

module.exports = PresenceManager;
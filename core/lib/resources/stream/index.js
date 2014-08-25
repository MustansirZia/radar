var Resource = require('../../resource.js'),
    Persistence = require('persistence'),
    logger = require('minilog')('radar:stream');

var default_options = {
  policy: {
    maxPersistence: 7 * 24 * 60 * 60, // 1 week in seconds
    maxLength: 100000
  }
};

function Stream(name, parent, options) {
  Resource.call(this, name, parent, options, default_options);
}

Stream.prototype = new Resource();
Stream.prototype.type = 'stream';

// get status
Stream.prototype.get = function(client, message) {
  var name = this.name, redis = Persistence.redis();
  logger.debug('#stream - get', this.name, (client && client.id));
  redis.lrange(name, 0, -1, function(error, replies) {
    var parsed = [];
    replies.forEach(function(reply) {
      parsed.push(JSON.parse(reply));
    });
    logger.debug('#stream -lrange', name, parsed);
    client.send({
      op: 'get',
      to: name,
      value: parsed || []
    });
  });
};

Stream.prototype.push = function(client, message) {
  var self = this, redis = Persistence.redis();
  var policy = this.options.policy || {};

  logger.debug('#stream - push', this.name, message, (client && client.id));

  this._push(message.resource, message.action, message.value, message.userData, function(error, length) {
    if(error) {
      logging.error(error);
      return;
    }

    if(policy.maxPersistence) {
      Persistence.expire(self.name, policy.maxPersistence);
    } else {
      logger.warn('resource created without ttl :', self.name, self.counter);
      logger.warn('resource policy was :', policy);
    }

    if(policy.maxLength && length > policy.maxLength) {
      redis.ltrim(self.name, 0, policy.maxLength);
    }

    Persistence.publish(self.name, message, function() {
      self.ack(client, message.ack);
    });
  });
};

Stream.prototype._push = function(resource, action, value, userData, callback) {
  Persistence.redis().rpush(this.name, JSON.stringify({
    resource: resource,
    action: action,
    value: value,
    userData: userData
  }), function(error, length) {
    if(error) {
      callback(error);
      return;
    }
    if(callback) callback(null, length);
  });
};

Stream.prototype.sync = function(client) {
  logger.debug('#stream - sync', this.name, (client && client.id));
  this.get(client);
  this.subscribe(client, false);
};

Stream.setBackend = function(backend) { Persistence = backend; };

module.exports = Stream;

var redisLib = require('redis'),
    logging = require('minilog')('persistence'),
    // defaults
    configuration = {
      redis_host: 'localhost',
      redis_port: 6379
    };

if(false) {
  var Minilog = require('minilog');
  Minilog.pipe(Minilog.backends.nodeConsole)
    .format(Minilog.backends.nodeConsole.formatWithStack);
}

function Persistence() { }

var client, subscriber,
    client_connected = false,
    subscriber_connected = false;

Persistence.connect = function(done) {

  if(client_connected && subscriber_connected) {
    done('already connected'); //already connected
    return;
  }
  //create a client (read/write)
  if(!client) {
    client = redisLib.createClient(configuration.redis_port, configuration.redis_host);
    if (configuration.redis_auth) {
      client.auth(configuration.redis_auth);
    }

    if(configuration.db) {
      client.select(configuration.db);
    }
    logging.info('Created a new Redis client.');
  }

  //create a pubsub client
  if(!subscriber) {
    subscriber = redisLib.createClient(configuration.redis_port, configuration.redis_host);
    if (configuration.redis_auth) {
      subscriber.auth(configuration.redis_auth);
    }
    logging.info('Created a new Redis subscriber.');
  }


  if(!client_connected) {
    client.once('ready', function() {
      client_connected = true;
      if(client_connected && subscriber_connected) {
        done();
      }
    });
  }

  if(!subscriber_connected) {
    subscriber.once('ready', function() {
      subscriber_connected = true;
      if(client_connected && subscriber_connected) {
        done();
      }
    });
  }

};

function redis() {
  if(!client || !client_connected) {
    throw new Error("Not connected to redis");
  }
  return client;
}

function pubsub() {
  if(!subscriber || !subscriber_connected) {
    throw new Error("Not connected to redis");
  }
  return subscriber;
}

Persistence.redis = function(value) {
  if (value) {
    client = value;
    client_connected = true;
  } else {
    return redis();
  }
};

Persistence.pubsub = function(value) {
  if(value) {
    subscriber = value;
    subscriber_connected = true;
  } else {
    return pubsub();
  }
}

Persistence.setConfig = function(config) {
  configuration = config;
};


Persistence.applyPolicy = function(multi, key, policy) {
  if(policy.maxCount) {
    multi.zremrangebyrank(key, 0, -policy.maxCount-1, function(err, res) {
      logging.info('Enforce max count: '+(0-policy.maxCount-1)+' removed '+res);
      if(err) throw new Error(err);
    });
  }

  if(policy.maxAgeSeconds) {
    var maxScore = Date.now()-policy.maxAgeSeconds * 1000;
    multi.zremrangebyscore(key, 0, maxScore, function(err, res) {
      logging.info('Enforce max age ('+key+'): '+new Date(maxScore).toUTCString()+' removed '+res);
      if(err) throw new Error(err);
    });
  }
};

Persistence.readOrderedWithScores = function(key, policy, callback) {
  var multi = redis().multi();

  switch(arguments.length) {
    case 3:
      if (policy) Persistence.applyPolicy(multi, key, policy);
      break;
    case 2:
      callback = policy; // policy is optional
  }

  // sync up to 100 messages, starting from the newest
  multi.zrange(key, -100, -1, 'WITHSCORES', function (err, replies) {
    if(err) throw new Error(err);
    logging.info(key+' '+ (replies.length /2) + ' items to sync');

    // (nherment) TODO: deserialize the result here because it is being serialized in persistOrdered()
    // The problem is that radar_client currently deserializes the response.
    // We need to make the client not deserialize the response so that we can deserialize it here.

    callback(replies);
  });

  multi.exec();
};

Persistence.persistOrdered = function(key, value, callback) {
  redis().zadd(key, Date.now(), JSON.stringify(value), callback);
};

Persistence.delWildCard = function(expr, callback) {
  redis().keys(expr, function(err, results) {
    if(err) throw new Error(err);
    var counter = 0;
    if(!results.length) {
      return callback();
    }
    results.forEach(function(key) {
      Persistence.del(key, function() {
        counter++;
        if (counter == results.length) {
          callback();
        }
      });
    });
  });
};

Persistence.del = function(key, callback) {
  logging.info('deleting', key);
  redis().del(key, callback);
};

Persistence.readHashAll = function(hash, callback) {
  redis().hgetall(hash, function (err, replies) {
    if(err) throw new Error(err);
    if(replies) {
      Object.keys(replies).forEach(function(attr) {
        try {
          replies[attr] = JSON.parse(replies[attr]);
        } catch(parseError) {
          logging.error('Corrupted key value in redis [' + hash + '][' + attr + ']. ' + parseError.message + ': '+ parseError.stack);
          delete replies[attr];
        }
      });
    }
    callback(replies);
  });
};

Persistence.persistHash = function(hash, key, value) {
  logging.info('persistHash:', hash, key, value);
  redis().hset(hash, key, JSON.stringify(value), Persistence.handler);
};

Persistence.expire = function(key, seconds) {
  logging.info('expire', key, seconds);
  redis().expire(key, seconds, Persistence.handler);
};

Persistence.ttl = function(key, callback) {
  redis().ttl(key, callback);
};

Persistence.deleteHash = function(hash, key) {
  logging.info('deleteHash:', hash, key);
  redis().hdel(hash, key, Persistence.handler);
};

Persistence.publish = function(key, value, callback) {
  logging.info('Redis pub:', key, value);
  redis().publish(key, JSON.stringify(value), callback);
};

Persistence.disconnect = function(callback) {
  var done = function() {
    if(!client && !client_connected &&
       !subscriber && !subscriber_connected &&
       callback) {
         callback();
       }
  }

  if(client || subscriber) {
    if(client && client.connected) {
      var res = client.quit(function() {
        logging.debug("client has quit");
        client = client_connected = false;
        done();
      });
    } else {
      client = client_connected = false;
    }

    if(subscriber && subscriber.connected) {
      res= subscriber.quit(function() {
        logging.debug("pubsub has quit");
        subscriber = subscriber_connected = false;
        done();
      });
    } else {
      subscriber = subscriber_connected = false;
    }
  }else
    done();
};

Persistence.keys = function(key, callback) {
  redis().keys(key, callback);
};

Persistence.handler = function(err) {
  if (err) {
    logging.error(err);
  }
};

Persistence.incrby = function(key, incr) {
  redis().incrby(key, incr, Persistence.handler);
};

Persistence.select = function(index) {
  redis().select(index, Persistence.handler);
};

module.exports = Persistence;

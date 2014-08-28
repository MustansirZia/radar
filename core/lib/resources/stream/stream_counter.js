var Persistence = require('persistence'),
    StreamLock = require('./stream_lock.js');

function StreamCounter(name) {
  this.name = name;
  this.scope = 'stream_counter:/'+name;
  this.lock = new StreamLock(name);
  this.listeners = [];
  this.processing = false;
  this.lock.on('expired', this.wakeUp.bind(this));
  this.lock.on('released', this.wakeUp.bind(this));
}

var processListener = function(counter) {
  var redis = Persistence.redis();

  if(counter.processing || counter.listeners.length === 0) return;

  counter.processing = true;
  counter.lock.acquire(function(error, success) {
    if(error) {
      counter.processing = false;
      throw new Error(error);
    }

    if(success) {
      redis.incr(counter.scope, function(error, value) {
        if(error) {
          counter.processing = false;
          throw new Error(error);
        }
        var callback = counter.listeners.shift();
        if(callback) callback(value);
        counter.processing = false;
        counter.lock.release();
      });
    } else { //not locked
      counter.processing = false;
    }
  });
};

StreamCounter.prototype.increment = function(callback) {
  if(callback) {
    this.listeners.push(callback);
  }
  this.wakeUp();
};

StreamCounter.prototype.wakeUp = function(callback) {
  processListener(this);
};

module.exports = StreamCounter;

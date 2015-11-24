var async = require('async')

var Middleware = {
  use: function (middleware) {
    this._middleware = this._middleware || []
    this._middleware.push(middleware)
  },

  runMiddleware: function () {
    var context = arguments[0],
      args = [].slice.call(arguments, 1, -1),
      callback = [].slice.call(arguments, -1)[0]

    if (!this._middleware) {
      callback()
      return
    }

    var process = function (middleware, next) {
      if (middleware[context]) {
        middleware[context].apply(middleware, args.concat(next))
      } else {
        next()
      }
    }

    async.each(this._middleware, process, callback)
  }
}

module.exports = {
  mixin: function (receiver) {
    var o = Middleware, k
    for (k in o) {
      if (o.hasOwnProperty(k)) {
        receiver.prototype[k] = o[k]
      }
    }
  }
}

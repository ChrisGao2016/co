
/**
 * slice()的引用
 */

var slice = Array.prototype.slice;

/**
 * Expose `co`.
 */

module.exports = co['default'] = co.co = co;

/**
 * 将作为参数的生成器函数fn封装成一个返回Promise对象普通函数
 * 这是一个单独调用的函数，用来防止每次调用co函数时产生一个新的
 * 并且不必要的闭包
 * 即当需要执行一个有参数的Generator函数时，可以使用此函数包裹Generator函数，然后调用传入参数
 * 
 * @param {GeneratorFunction} fn
 * @return {Function}
 * @api public
 */

co.wrap = function (fn) {
  createPromise.__generatorFunction__ = fn;
  return createPromise;
  function createPromise() {
    return co.call(this, fn.apply(this, arguments));
  }
};

/**
 * 执行一个Generator函数或者Generator对象
 * 返回一个Promise对象，当整个Generator对象执行完毕时
 * 返回的Promise对象状态才会改变
 *
 * @param {Function} fn
 * @return {Promise}
 * @api public
 */

function co(gen) {
  var ctx = this; // 保存上下文
  var args = slice.call(arguments, 1); // 如果有多个参数，将其抽出变成数组作为generator函数执行的参数

  // 将每一步都封装成一个promise对象避免导致内存泄漏的promise链式调用
  // 详情见 https://github.com/tj/co/issues/180
  return new Promise(function(resolve, reject) {
    // 如果gen是一个函数，则执行这个函数，并将结果赋值给gen
    if (typeof gen === 'function') gen = gen.apply(ctx, args); 
    // 如果上一步gen是一个generator函数，则执行完的结果是generator对象，检查gen是否是generator对象
    // 如果不是则直接resolve，将返回Promise状态改为resolve
    if (!gen || typeof gen.next !== 'function') return resolve(gen);

    
    onFulfilled();

    /**
     * @param {Mixed} res
     * @return {Promise}
     * @api private
     */
    // 封装gen.next，自动执行gen，将其作为上一次gen.next得到结果的value封装成的promise的onFulfilled参数 
    function onFulfilled(res) {
      var ret;
      try {
        ret = gen.next(res);
      } catch (e) {
        return reject(e); // 如果gen.next执行异常立即将co函数返回的Promise状态置为reject
      }
      next(ret); 
      return null;
    }

    /**
     * @param {Error} err
     * @return {Promise}
     * @api private
     */
    // 将其作为上一次gen.next得到结果的value封装成的promise的onRejected参数 
    function onRejected(err) {
      var ret;
      try {
        ret = gen.throw(err);
      } catch (e) {
        return reject(e);
      }
      next(ret);
    }

    /**
     * Get the next value in the generator,
     * return a promise.
     *
     * @param {Object} ret
     * @return {Promise}
     * @api private
     */

    function next(ret) {
      // 如果上一次gen.next执行完，整个gen对象执行完，则将co返回的Promise对象值为resolve，终止执行
      if (ret.done) return resolve(ret.value);
      // 如果gen没有执行完，将上一次gen.nenxt执行yield语句返回的值变成一个Promise对象
      var value = toPromise.call(ctx, ret.value);
      // 待promise执行完毕执行onFulfilled，在onFulfilled中调用gen.next继续向下执行
      if (value && isPromise(value)) return value.then(onFulfilled, onRejected);
      return onRejected(new TypeError('You may only yield a function, promise, generator, array, or object, '
        + 'but the following object was passed: "' + String(ret.value) + '"'));
    }
  });
}

/**
 * 将每一个yield后的值转换为一个Promise对象
 *
 * @param {Mixed} obj
 * @return {Promise}
 * @api private
 */

function toPromise(obj) {
  if (!obj) return obj;
  if (isPromise(obj)) return obj;
  if (isGeneratorFunction(obj) || isGenerator(obj)) return co.call(this, obj);
  if ('function' == typeof obj) return thunkToPromise.call(this, obj);
  if (Array.isArray(obj)) return arrayToPromise.call(this, obj);
  if (isObject(obj)) return objectToPromise.call(this, obj);
  return obj;
}

/**
 * 将一个thunk函数转换为promise
 *
 * @param {Function}
 * @return {Promise}
 * @api private
 */

function thunkToPromise(fn) {
  var ctx = this;
  return new Promise(function (resolve, reject) {
    fn.call(ctx, function (err, res) {
      if (err) return reject(err);
      // 如果回调函数的参数超过两个，则去掉第一个参数作为数组赋值给res
      if (arguments.length > 2) res = slice.call(arguments, 1);
      resolve(res);
    });
  });
}

/**
 * 将一个可yield的数组转换为promise对象
 * 在内部使用promise.all方法，等待转换后的每个promise对象执行完毕
 *
 * @param {Array} obj
 * @return {Promise}
 * @api private
 */

function arrayToPromise(obj) {
  return Promise.all(obj.map(toPromise, this));
}

/**
 * 将一个可yield的对象转换成promise
 * 在内部使用Promise.all方法
 *
 * @param {Object} obj
 * @return {Promise}
 * @api private
 */

function objectToPromise(obj){
  // 重新执行obj的构造函数，将结果保存，防止遍历obj时遗漏无法枚举的属性
  var results = new obj.constructor();
  var keys = Object.keys(obj);
  var promises = [];
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    // 将obj每个可以枚举的属性转换为promise
    var promise = toPromise.call(this, obj[key]);
    // 将promise执行完的结构放入results中，并将promise放入promises数组中
    if (promise && isPromise(promise)) defer(promise, key); 
    else results[key] = obj[key];
  }
  return Promise.all(promises).then(function () {
    return results;
  });

  function defer(promise, key) {
    // 在results中预先定义key
    results[key] = undefined;
    promises.push(promise.then(function (res) {
      results[key] = res;
    }));
  }
}

/**
 * 检查obj是否是promise对象
 *
 * @param {Object} obj
 * @return {Boolean}
 * @api private
 */

function isPromise(obj) {
  return 'function' == typeof obj.then;
}

/**
 * 检查obj是否是Generator对象
 *
 * @param {Mixed} obj
 * @return {Boolean}
 * @api private
 */

function isGenerator(obj) {
  return 'function' == typeof obj.next && 'function' == typeof obj.throw;
}

/**
 * 检查obj是否是一个Generator函数
 *
 * @param {Mixed} obj
 * @return {Boolean}
 * @api private
 */
 
function isGeneratorFunction(obj) {
  var constructor = obj.constructor; 
  if (!constructor) return false; // 如果obj没有构造函数，则返回false
  // Generator函数的构造函数是GeneratorFunction
  if ('GeneratorFunction' === constructor.name || 'GeneratorFunction' === constructor.displayName) return true;
  return isGenerator(constructor.prototype); // 如果obj不是Generator函数，查看obj是否是Generator对象
}

/**
 * 检查val是否是一个纯对象
 *
 * @param {Mixed} val
 * @return {Boolean}
 * @api private
 */

function isObject(val) {
  // 纯对象的构造函数是Object
  return Object == val.constructor;
}

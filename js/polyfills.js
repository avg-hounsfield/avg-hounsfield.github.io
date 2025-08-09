// js/polyfills.js - Cross-browser compatibility polyfills

(function() {
  'use strict';

  // Polyfill for Object.assign (IE 11 support)
  if (typeof Object.assign !== 'function') {
    Object.assign = function(target, varArgs) {
      if (target == null) {
        throw new TypeError('Cannot convert undefined or null to object');
      }

      var to = Object(target);

      for (var index = 1; index < arguments.length; index++) {
        var nextSource = arguments[index];

        if (nextSource != null) {
          for (var nextKey in nextSource) {
            if (Object.prototype.hasOwnProperty.call(nextSource, nextKey)) {
              to[nextKey] = nextSource[nextKey];
            }
          }
        }
      }
      return to;
    };
  }

  // Polyfill for Array.from (IE 11 support)
  if (!Array.from) {
    Array.from = function(arrayLike, mapFn, thisArg) {
      var C = this;
      var items = Object(arrayLike);
      if (arrayLike == null) {
        throw new TypeError('Array.from requires an array-like object - not null or undefined');
      }
      var mapFunction = mapFn === undefined ? undefined : mapFn;
      var T;
      if (typeof mapFunction !== 'undefined') {
        if (typeof mapFunction !== 'function') {
          throw new TypeError('Array.from: when provided, the second argument must be a function');
        }
        if (arguments.length > 2) {
          T = thisArg;
        }
      }
      var len = parseInt(items.length);
      var A = typeof C === 'function' ? Object(new C(len)) : new Array(len);
      var k = 0;
      var kValue;
      while (k < len) {
        kValue = items[k];
        if (mapFunction) {
          A[k] = typeof T === 'undefined' ? mapFunction(kValue, k) : mapFunction.call(T, kValue, k);
        } else {
          A[k] = kValue;
        }
        k += 1;
      }
      A.length = len;
      return A;
    };
  }

  // Polyfill for Array.includes (IE 11 support)
  if (!Array.prototype.includes) {
    Array.prototype.includes = function(searchElement, fromIndex) {
      return this.indexOf(searchElement, fromIndex) !== -1;
    };
  }

  // Polyfill for String.includes (IE 11 support)
  if (!String.prototype.includes) {
    String.prototype.includes = function(search, start) {
      if (typeof start !== 'number') {
        start = 0;
      }
      
      if (start + search.length > this.length) {
        return false;
      } else {
        return this.indexOf(search, start) !== -1;
      }
    };
  }

  // Polyfill for Element.closest (IE 11 support)
  if (!Element.prototype.matches) {
    Element.prototype.matches = Element.prototype.msMatchesSelector || 
                                Element.prototype.webkitMatchesSelector;
  }

  if (!Element.prototype.closest) {
    Element.prototype.closest = function(s) {
      var el = this;

      do {
        if (Element.prototype.matches.call(el, s)) return el;
        el = el.parentElement || el.parentNode;
      } while (el !== null && el.nodeType === 1);
      return null;
    };
  }

  // Polyfill for fetch API (IE 11 support)
  if (!window.fetch) {
    window.fetch = function(url, options) {
      return new Promise(function(resolve, reject) {
        var xhr = new XMLHttpRequest();
        options = options || {};
        
        xhr.open(options.method || 'GET', url);
        
        for (var header in options.headers || {}) {
          xhr.setRequestHeader(header, options.headers[header]);
        }
        
        xhr.onload = function() {
          resolve({
            ok: xhr.status >= 200 && xhr.status < 300,
            status: xhr.status,
            statusText: xhr.statusText,
            json: function() {
              return Promise.resolve(JSON.parse(xhr.responseText));
            },
            text: function() {
              return Promise.resolve(xhr.responseText);
            }
          });
        };
        
        xhr.onerror = function() {
          reject(new Error('Network Error'));
        };
        
        xhr.send(options.body);
      });
    };
  }

  // Polyfill for Promise (IE 11 support)
  if (typeof Promise === 'undefined') {
    window.Promise = function(executor) {
      var self = this;
      self.state = 'pending';
      self.value = undefined;
      self.handlers = [];

      function resolve(result) {
        if (self.state === 'pending') {
          self.state = 'fulfilled';
          self.value = result;
          self.handlers.forEach(handle);
          self.handlers = null;
        }
      }

      function reject(error) {
        if (self.state === 'pending') {
          self.state = 'rejected';
          self.value = error;
          self.handlers.forEach(handle);
          self.handlers = null;
        }
      }

      function handle(handler) {
        if (self.state === 'pending') {
          self.handlers.push(handler);
        } else {
          if (self.state === 'fulfilled' && typeof handler.onFulfilled === 'function') {
            handler.onFulfilled(self.value);
          }
          if (self.state === 'rejected' && typeof handler.onRejected === 'function') {
            handler.onRejected(self.value);
          }
        }
      }

      this.then = function(onFulfilled, onRejected) {
        return new Promise(function(resolve, reject) {
          handle({
            onFulfilled: function(result) {
              try {
                resolve(onFulfilled ? onFulfilled(result) : result);
              } catch (ex) {
                reject(ex);
              }
            },
            onRejected: function(error) {
              try {
                resolve(onRejected ? onRejected(error) : error);
              } catch (ex) {
                reject(ex);
              }
            }
          });
        });
      };

      executor(resolve, reject);
    };

    Promise.resolve = function(value) {
      return new Promise(function(resolve) {
        resolve(value);
      });
    };

    Promise.reject = function(reason) {
      return new Promise(function(resolve, reject) {
        reject(reason);
      });
    };
  }

  // Polyfill for requestAnimationFrame
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = window.webkitRequestAnimationFrame ||
                                   window.mozRequestAnimationFrame ||
                                   window.oRequestAnimationFrame ||
                                   window.msRequestAnimationFrame ||
                                   function(callback) {
                                     return window.setTimeout(callback, 1000 / 60);
                                   };
  }

  // CSS Custom Properties support check and fallback
  function supportsCSSVariables() {
    try {
      return CSS.supports('color', 'var(--fake-var)');
    } catch (e) {
      return false;
    }
  }

  if (!supportsCSSVariables()) {
    // Add fallback styles for browsers that don't support CSS variables
    var style = document.createElement('style');
    style.innerHTML = `
      body { background-color: #1e2329 !important; color: #e6e9ec !important; }
      .light-theme { background-color: #f0f2f4 !important; color: #2d333b !important; }
      .protocol-card { background: #252a31 !important; border: 1px solid #363c44 !important; }
      .left-card, .right-card, .scanner-notes-card { background: #2d333b !important; }
      h1, h2, h3, h4, h5, h6 { color: #40b4a6 !important; }
      .interactive-accent { color: #40b4a6 !important; }
    `;
    document.head.appendChild(style);
  }

})();

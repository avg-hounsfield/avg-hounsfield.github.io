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

  // Enhanced browser feature detection
  function supportsCSSVariables() {
    try {
      return CSS && CSS.supports && CSS.supports('color', 'var(--fake-var)');
    } catch (e) {
      return false;
    }
  }

  function supportsFlexbox() {
    try {
      return CSS && CSS.supports && (
        CSS.supports('display', 'flex') ||
        CSS.supports('display', '-webkit-flex') ||
        CSS.supports('display', '-moz-flex')
      );
    } catch (e) {
      var test = document.createElement('div');
      test.style.display = 'flex';
      return test.style.display === 'flex';
    }
  }

  function supportsGrid() {
    try {
      return CSS && CSS.supports && CSS.supports('display', 'grid');
    } catch (e) {
      return false;
    }
  }

  // CSS Variables fallback for IE and older browsers
  if (!supportsCSSVariables()) {
    var style = document.createElement('style');
    style.innerHTML = [
      '/* Fallback styles for browsers without CSS variable support */',
      'body { background-color: #1e2329 !important; color: #e6e9ec !important; }',
      '.light-theme { background-color: #f0f2f4 !important; color: #2d333b !important; }',
      '.protocol-card { background: #252a31 !important; border: 1px solid #363c44 !important; }',
      '.left-card, .right-card, .scanner-notes-card, .indications-card, .sequences-card { background: #2d333b !important; }',
      'h1, h2, h3, h4, h5, h6 { color: #40b4a6 !important; }',
      '.interactive-accent, .favorite-button:hover { color: #40b4a6 !important; }',
      '.sidebar-trigger { background: #40b4a6 !important; color: #ffffff !important; }',
      '.feedback-trigger { background: #40b4a6 !important; color: #ffffff !important; }',
      '.contrast-yes { color: #40b4a6 !important; }',
      '.contrast-no { color: #ff8c00 !important; }',
      'input, textarea, select { background: #2d333b !important; color: #e6e9ec !important; border: 1px solid #363c44 !important; }',
      'button { background: #40b4a6 !important; color: #ffffff !important; border: none !important; }'
    ].join('\n');
    document.head.appendChild(style);
    console.warn('CSS Variables not supported. Using fallback styles.');
  }

  // Flexbox fallback for IE9 and older
  if (!supportsFlexbox()) {
    var flexStyle = document.createElement('style');
    flexStyle.innerHTML = [
      '/* Flexbox fallback styles */',
      '.protocol-grid { display: block !important; }',
      '.protocol-card { display: block !important; margin-bottom: 20px !important; width: 100% !important; }',
      '.breadcrumb { display: block !important; }',
      '.breadcrumb-item { display: inline-block !important; margin-right: 8px !important; }',
      '.feedback-actions { display: block !important; }',
      '.feedback-cancel, .feedback-submit { display: block !important; width: 100% !important; margin-bottom: 8px !important; }'
    ].join('\n');
    document.head.appendChild(flexStyle);
    console.warn('Flexbox not supported. Using fallback layout.');
  }

  // Console polyfill for IE8 and older
  if (!window.console) {
    window.console = {
      log: function() {},
      warn: function() {},
      error: function() {},
      info: function() {},
      debug: function() {}
    };
  }

  // Enhanced graceful degradation
  function setupGracefulDegradation() {
    // Disable animations for browsers that don't support them properly
    if (!window.requestAnimationFrame || !supportsCSSVariables()) {
      var noAnimStyle = document.createElement('style');
      noAnimStyle.innerHTML = [
        '/* Disable animations for compatibility */',
        '*, *::before, *::after {',
        '  animation-duration: 0s !important;',
        '  animation-delay: 0s !important;',
        '  transition-duration: 0s !important;',
        '  transition-delay: 0s !important;',
        '}',
        '.loading-spinner { display: none !important; }',
        '.loading-container::after {',
        '  content: "Loading...";',
        '  display: block;',
        '  text-align: center;',
        '  font-weight: bold;',
        '}'
      ].join('\n');
      document.head.appendChild(noAnimStyle);
    }

    // Fallback for modern input types
    function setupInputFallbacks() {
      var inputs = document.querySelectorAll('input[type="search"]');
      for (var i = 0; i < inputs.length; i++) {
        if (inputs[i].type !== 'search') {
          inputs[i].type = 'text';
          inputs[i].placeholder = inputs[i].placeholder || 'Search...';
        }
      }
    }

    // Set up input fallbacks when DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', setupInputFallbacks);
    } else {
      setupInputFallbacks();
    }

    // Provide fallback for modern JavaScript features
    if (!Array.prototype.find) {
      Array.prototype.find = function(predicate) {
        for (var i = 0; i < this.length; i++) {
          if (predicate(this[i], i, this)) {
            return this[i];
          }
        }
        return undefined;
      };
    }

    if (!Array.prototype.filter) {
      Array.prototype.filter = function(callback, thisArg) {
        var result = [];
        for (var i = 0; i < this.length; i++) {
          if (callback.call(thisArg, this[i], i, this)) {
            result.push(this[i]);
          }
        }
        return result;
      };
    }

    // Storage compatibility layer
    if (typeof(Storage) === 'undefined') {
      window.sessionStorage = window.localStorage = {
        getItem: function() { return null; },
        setItem: function() {},
        removeItem: function() {},
        clear: function() {},
        length: 0
      };
    }
  }

  // Run graceful degradation setup
  setupGracefulDegradation();

  // Add browser info to global scope for debugging
  window.browserInfo = {
    cssVariables: supportsCSSVariables(),
    flexbox: supportsFlexbox(),
    grid: supportsGrid(),
    storage: typeof(Storage) !== 'undefined',
    requestAnimationFrame: typeof(requestAnimationFrame) !== 'undefined',
    modules: 'noModule' in HTMLScriptElement.prototype,
    fetch: typeof(fetch) !== 'undefined',
    promise: typeof(Promise) !== 'undefined'
  };

})();

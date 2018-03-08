'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }(); //  weak

var _path = require('path');

var _path2 = _interopRequireDefault(_path);

var _crypto = require('crypto');

var _crypto2 = _interopRequireDefault(_crypto);

var _webpack = require('webpack');

var _webpack2 = _interopRequireDefault(_webpack);

var _SingleEntryPlugin = require('webpack/lib/SingleEntryPlugin');

var _SingleEntryPlugin2 = _interopRequireDefault(_SingleEntryPlugin);

var _WebworkerTemplatePlugin = require('webpack/lib/webworker/WebworkerTemplatePlugin');

var _WebworkerTemplatePlugin2 = _interopRequireDefault(_WebworkerTemplatePlugin);

var _minimatch = require('minimatch');

var _minimatch2 = _interopRequireDefault(_minimatch);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function validatePaths(assets, options) {
  var depth = options.filename.replace(/^\//, '').split('/').length;
  var basePath = Array(depth).join('../') || './';

  return assets.filter(function (asset) {
    return !!asset;
  }).map(function (key) {
    // if absolute url, use it as is
    if (/^(?:\w+:)\/\//.test(key)) {
      return key;
    }

    key = key.replace(/^\//, '');

    if (options.publicPath !== '') {
      return options.publicPath + key;
    }

    return basePath + key;
  });
}

function hash(source, outputOptions) {
  var hashFunction = outputOptions.hashFunction;
  var hashDigest = outputOptions.hashDigest;
  var hashDigestLength = outputOptions.hashDigestLength;
  var hash = _crypto2.default.createHash(hashFunction);
  hash.update(source);
  return hash.digest(hashDigest).substr(0, hashDigestLength);
}

var PLUGIN_NAME = 'ServiceWorkerWebpackPlugin';
var COMPILER_NAME = 'serviceworker-plugin';

var ServiceWorkerPlugin = function () {
  function ServiceWorkerPlugin(options) {
    _classCallCheck(this, ServiceWorkerPlugin);

    this.options = [];
    this.warnings = [];

    this.options = Object.assign({
      publicPath: '/',
      excludes: ['**/.*', '**/*.map'],
      includes: ['**/*'],
      entry: null,
      filename: 'sw.js',
      chunksFilename: '[chunkhash].sw.js',
      template: function template() {
        return Promise.resolve('');
      },
      transformOptions: function transformOptions(serviceWorkerOption) {
        return {
          assets: serviceWorkerOption.assets
        };
      }
    }, options);

    if (this.options.filename.match(/\[hash/)) {
      throw new Error('The name of the service worker need to fixed across releases.\n        https://developers.google.com/web/fundamentals/instant-and-offline/service-worker/lifecycle#avoid_changing_the_url_of_your_service_worker_script');
    }
  }

  _createClass(ServiceWorkerPlugin, [{
    key: 'apply',
    value: function apply(compiler) {
      var _this = this;

      var runtimePath = _path2.default.resolve(__dirname, './runtime.js');

      compiler.hooks.normalModuleFactory.tap(PLUGIN_NAME, function (nmf) {
        nmf.hooks.afterResolve.tapAsync(PLUGIN_NAME, function (result, callback) {
          // Hijack the original module
          if (result.resource === runtimePath) {
            var data = {
              scriptURL: _this.options.publicPath + _this.options.filename
            };

            result.loaders.push(_path2.default.join(__dirname, 'runtimeLoader.js') + '?' + JSON.stringify(data));
          }

          callback(null, result);
        });
      });

      compiler.hooks.make.tapAsync(PLUGIN_NAME, function (compilation, callback) {
        if (_this.warnings.length) {
          var array = [];
          array.push.apply(compilation.warnings, _this.warnings);
        }

        _this.handleMake(compilation, compiler).then(function () {
          callback();
        }).catch(function () {
          callback(new Error('Something went wrong during the make event.'));
        });
      });

      compiler.hooks.emit.tapAsync(PLUGIN_NAME, function (compilation, callback) {
        _this.handleEmit(compilation, compiler, callback);
      });
    }
  }, {
    key: 'handleMake',
    value: function handleMake(compilation, compiler) {
      var ngTools = compilation._ngToolsWebpackPluginInstance;
      var childCompiler = compilation.createChildCompiler(COMPILER_NAME, {
        filename: this.options.filename,
        chunkFilename: this.options.chunksFilename
      });
      childCompiler.context = compiler.context;
      new _SingleEntryPlugin2.default(compiler.context, this.options.entry, "sw-entry").apply(childCompiler);
      childCompiler.hooks.thisCompilation.tap(PLUGIN_NAME, function (compilation2) {
        var a = compilation._ngToolsWebpackPluginInstance;
        compilation2._ngToolsWebpackPluginInstance = ngTools;
      });

      // Must come after above
      new _WebworkerTemplatePlugin2.default().apply(childCompiler);

      // Fix for "Uncaught TypeError: __webpack_require__(...) is not a function"
      // Hot module replacement requires that every child compiler has its own
      // cache. @see https://github.com/ampedandwired/html-webpack-plugin/pull/179
      childCompiler.hooks.compilation.tap(PLUGIN_NAME, function (compilation2) {
        if (compilation2.cache) {
          if (!compilation2.cache[COMPILER_NAME]) {
            compilation2.cache[COMPILER_NAME] = {};
          }
          compilation2.cache = compilation2.cache[COMPILER_NAME];
        }
      });

      // Compile and return a promise.
      return new Promise(function (resolve, reject) {
        childCompiler.runAsChild(function (err) {
          if (err) {
            reject(err);
            return;
          }

          resolve();
        });
      });
    }
  }, {
    key: 'handleEmit',
    value: function handleEmit(compilation, compiler, callback) {
      var _this2 = this;

      var asset = compilation.assets[this.options.filename];

      if (!asset) {
        compilation.errors.push(new Error('ServiceWorkerPlugin: the `entry` option is incorrect.'));
        callback();
        return;
      }

      var jsonStats = compilation.getStats().toJson({
        hash: false,
        publicPath: false,
        assets: true,
        chunks: false,
        modules: true,
        source: false,
        errorDetails: false,
        timings: false
      });

      delete compilation.assets[this.options.filename];

      var assets = Object.keys(compilation.assets);
      var excludes = this.options.excludes;

      if (excludes.length > 0) {
        assets = assets.filter(function (assetCurrent) {
          return !excludes.some(function (glob) {
            return (0, _minimatch2.default)(assetCurrent, glob);
          });
        });
      }

      var includes = this.options.includes;

      if (includes.length > 0) {
        assets = assets.filter(function (assetCurrent) {
          return includes.some(function (glob) {
            return (0, _minimatch2.default)(assetCurrent, glob);
          });
        });
      }

      assets = validatePaths(assets, this.options);

      var minify = (compiler.options.plugins || []).some(function (plugin) {
        return plugin.constructor.name === 'UglifyJsPlugin';
      });

      var assetsHash = hash(JSON.stringify(assets), compilation.options.output);

      var serviceWorkerOption = this.options.transformOptions({
        assets: assets,
        assetsHash: assetsHash,
        jsonStats: jsonStats
      });

      var templatePromise = this.options.template(serviceWorkerOption);

      templatePromise.then(function (template) {
        var serviceWorkerOptionInline = JSON.stringify(serviceWorkerOption, null, minify ? 0 : 2);

        var _source = ('\n        var serviceWorkerOption = ' + serviceWorkerOptionInline + ';\n        ' + template + '\n        ' + asset.source() + '\n      ').trim();

        compilation.assets[_this2.options.filename] = {
          source: function source() {
            return _source;
          },
          size: function size() {
            return Buffer.byteLength(_source, 'utf8');
          }
        };

        callback();
      });
    }
  }]);

  return ServiceWorkerPlugin;
}();

exports.default = ServiceWorkerPlugin;
module.exports = exports['default'];
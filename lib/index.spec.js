'use strict';

var _chai = require('chai');

var _index = require('./index');

var _index2 = _interopRequireDefault(_index);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; } //  weak
/* eslint-env mocha */

function trim(str) {
  return str.replace(/^\s+|\s+$/, '');
}

var filename = 'sw.js';

describe('ServiceWorkerPlugin', function () {
  describe('options: filename', function () {
    it('should throw if trying to hash the filename', function () {
      _chai.assert.throws(function () {
        // eslint-disable-next-line no-new
        new _index2.default({
          filename: 'sw-[hash:7].js'
        });
      }, /The name of the/);
    });
  });

  describe('options: includes', function () {
    it('should allow to have a white list parameter', function () {
      var _assets;

      var serviceWorkerPlugin = new _index2.default({
        filename: filename,
        includes: ['bar.*']
      });

      var compilation = {
        assets: (_assets = {}, _defineProperty(_assets, filename, {
          source: function source() {
            return '';
          }
        }), _defineProperty(_assets, 'bar.js', {}), _defineProperty(_assets, 'foo.js', {}), _assets),
        getStats: function getStats() {
          return {
            toJson: function toJson() {
              return {};
            }
          };
        }
      };

      return serviceWorkerPlugin.handleEmit(compilation, {
        options: {}
      }, function () {
        _chai.assert.strictEqual(compilation.assets[filename].source(), trim('\nvar serviceWorkerOption = {\n  "assets": [\n    "/bar.js"\n  ]\n};'));
      });
    });

    describe('options: transformOptions', function () {
      it('should be used', function () {
        var transformOptions = function transformOptions(serviceWorkerOption) {
          return {
            bar: 'foo',
            jsonStats: serviceWorkerOption.jsonStats
          };
        };

        var serviceWorkerPlugin = new _index2.default({
          filename: filename,
          transformOptions: transformOptions
        });

        var compilation = {
          assets: _defineProperty({}, filename, {
            source: function source() {
              return '';
            }
          }),
          getStats: function getStats() {
            return {
              toJson: function toJson() {
                return {
                  foo: 'bar'
                };
              }
            };
          }
        };

        return serviceWorkerPlugin.handleEmit(compilation, {
          options: {}
        }, function () {
          _chai.assert.strictEqual(compilation.assets[filename].source(), trim('\nvar serviceWorkerOption = {\n  "bar": "foo",\n  "jsonStats": {\n    "foo": "bar"\n  }\n};'));
        });
      });
    });
  });
});
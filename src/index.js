// @flow weak

import path from 'path'
import crypto from 'crypto'
import SingleEntryPlugin from 'webpack/lib/SingleEntryPlugin'
import SplitChunksPlugin from 'webpack/lib/optimize/SplitChunksPlugin'
import JsonpTemplatePlugin from 'webpack/lib/web/JsonpTemplatePlugin'
import minimatch from 'minimatch'

function validatePaths(assets, options) {
  const depth = options.filename.replace(/^\//, '').split('/').length
  const basePath = Array(depth).join('../') || './'

  return assets.filter(asset => !!asset).map(key => {
    // if absolute url, use it as is
    if (/^(?:\w+:)\/\//.test(key)) {
      return key
    }

    key = key.replace(/^\//, '')

    if (options.publicPath !== '') {
      return options.publicPath + key
    }

    return basePath + key
  })
}

function hash(source, outputOptions) {
  const hashFunction = outputOptions.hashFunction;
  const hashDigest = outputOptions.hashDigest;
  const hashDigestLength = outputOptions.hashDigestLength;
  const hash = crypto.createHash(hashFunction);
  hash.update(source);
  return hash.digest(hashDigest).substr(0, hashDigestLength);
}

const COMPILER_NAME = 'serviceworker-plugin'

export default class ServiceWorkerPlugin {
  options = []
  warnings = []
  compiledChunkFilenames = []

  constructor(options) {
    this.options = Object.assign(
      {
        publicPath: '/',
        excludes: ['**/.*', '**/*.map'],
        includes: ['**/*'],
        entry: null,
        filename: 'sw.js',
        chunksFilename: '[chunkhash].sw.js',
        template: () => Promise.resolve(''),
        transformOptions: serviceWorkerOption => ({
          assets: serviceWorkerOption.assets,
        }),
        minimize: process.env.NODE_ENV === 'production',
      },
      options
    )

    if (this.options.filename.match(/\[hash/)) {
      throw new Error(`The name of the service worker need to fixed across releases.
        https://developers.google.com/web/fundamentals/instant-and-offline/service-worker/lifecycle#avoid_changing_the_url_of_your_service_worker_script`)
    }
  }

  apply(compiler) {
    const runtimePath = path.resolve(__dirname, './runtime.js')

    compiler.hooks.normalModuleFactory.tap('sw-plugin-nmf', nmf => {
      nmf.hooks.afterResolve.tapAsync('sw-plugin-after-resolve', (result, callback) => {
        // Hijack the original module
        if (result.resource === runtimePath) {
          const data = {
            scriptURL: path.join(this.options.publicPath, this.options.filename),
          }

          result.loaders.push(`${path.join(__dirname, 'runtimeLoader.js')}?${JSON.stringify(data)}`)
        }

        callback(null, result)
      })
    })

    compiler.hooks.make.tapAsync('sw-plugin-make', (compilation, callback) => {
      if (this.warnings.length) {
        const array = []
        array.push.apply(compilation.warnings, this.warnings)
      }

      this.handleMake(compilation, compiler)
        .then(() => {
          callback()
        })
        .catch(() => {
          callback(new Error('Something went wrong during the make event.'))
        })
    })

    compiler.hooks.emit.tapAsync('sw-plugin-emit', (compilation, callback) => {
      this.handleEmit(compilation, compiler, callback)
    })
  }

  handleMake(compilation, compiler) {
    const childCompiler = compilation.createChildCompiler(COMPILER_NAME, {
      filename: this.options.filename,
      chunkFilename: this.options.chunksFilename,
      globalObject: 'self'
    })
    const childEntryCompiler = new SingleEntryPlugin(compiler.context, this.options.entry, "sw-entry")
    childEntryCompiler.apply(childCompiler)
    // create a vendors chunk
    new SplitChunksPlugin({
      maxInitialRequests: 10,
      cacheGroups: {
        vendors: {
            test: /[\\\/]node_modules[\\\/]/,
            name: "vendors",
            chunks: "all"
        }
    }
    }).apply(childCompiler);
    new JsonpTemplatePlugin().apply(childCompiler);
    childCompiler.hooks.afterCompile.tap('sw-plugin-get-chunkfilenames', (compilation2) => {
      this.compiledChunkFilenames = compilation2.entrypoints.get("sw-entry").chunks
        .map((chunk) => chunk.files[0])
        .filter((filename) => filename !== this.options.filename)
    });
    // to make ngTools compile the service worker
    const ngToolsInstance = compilation._ngToolsWebpackPluginInstance;
    childCompiler.hooks.thisCompilation.tap('sw-plugin-ng-tools', function (compilation2) {
      compilation2._ngToolsWebpackPluginInstance = ngToolsInstance;
    });

    // Fix for "Uncaught TypeError: __webpack_require__(...) is not a function"
    // Hot module replacement requires that every child compiler has its own
    // cache. @see https://github.com/ampedandwired/html-webpack-plugin/pull/179
    childCompiler.hooks.compilation.tap('sw-plugin-compilation', compilation2 => {
      if (compilation2.cache) {
        if (!compilation2.cache[COMPILER_NAME]) {
          compilation2.cache[COMPILER_NAME] = {}
        }
        compilation2.cache = compilation2.cache[COMPILER_NAME]
      }
    })

    // Compile and return a promise.
    return new Promise((resolve, reject) => {
      childCompiler.runAsChild(err => {
        if (err) {
          reject(err)
          return
        }

        resolve()
      })
    })
  }

  handleEmit(compilation, compiler, callback) {
    const asset = compilation.assets[this.options.filename]

    if (!asset) {
      compilation.errors.push(new Error('ServiceWorkerPlugin: the `entry` option is incorrect.'))
      callback()
      return
    }

    const jsonStats = compilation.getStats().toJson({
      hash: false,
      publicPath: false,
      assets: true,
      chunks: false,
      modules: true,
      source: false,
      errorDetails: false,
      timings: false,
    })

    delete compilation.assets[this.options.filename]

    let assets = Object.keys(compilation.assets)
    const excludes = this.options.excludes

    if (excludes.length > 0) {
      assets = assets.filter(assetCurrent => {
        return !excludes.some(glob => {
          return minimatch(assetCurrent, glob)
        })
      })
    }

    const includes = this.options.includes

    if (includes.length > 0) {
      assets = assets.filter(assetCurrent => {
        return includes.some(glob => {
          return minimatch(assetCurrent, glob)
        })
      })
    }

    assets = validatePaths(assets, this.options)

    const assetsHash = hash(JSON.stringify(assets), compilation.options.output)

    const serviceWorkerOption = this.options.transformOptions({
      assets,
      assetsHash,
      jsonStats,
    })

    const templatePromise = this.options.template(serviceWorkerOption)

    templatePromise.then(template => {
      const serviceWorkerOptionInline = JSON.stringify(
        serviceWorkerOption,
        null,
        this.options.minimize ? 0 : 2
      )

      const importSource = this.compiledChunkFilenames
        .map((filename) => "importScripts('" + filename + "');") 
        .join('\r\n')

      const source = `
        var serviceWorkerOption = ${serviceWorkerOptionInline};
        ${importSource}
        ${template}
        ${asset.source()}
      `.trim()

      compilation.assets[this.options.filename] = {
        source: () => source,
        size: () => Buffer.byteLength(source, 'utf8'),
      }

      callback()
    })
  }
}

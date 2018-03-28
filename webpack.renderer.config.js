"use strict"

process.env.BABEL_ENV = "renderer"

const path = require("path")
const settings = require("./config.js")
const webpack = require("webpack")
const stylus = require("stylus")
const fs = require("fs-extra")

const ExtractTextPlugin = require("extract-text-webpack-plugin")
const HtmlWebpackPlugin = require("html-webpack-plugin")

function resolve(dir) {
  return path.join(__dirname, dir)
}

let rendererConfig = {
  devtool: "#eval-source-map",
  entry: {
    renderer: path.join(__dirname, "app/src/renderer/main.js")
  },
  module: {
    rules: [
      {
        test: /\.css$/,
        use: ExtractTextPlugin.extract({
          fallback: "style-loader",
          use: "css-loader"
        })
      },
      {
        test: /\.html$/,
        use: "vue-html-loader"
      },
      {
        test: /\.js$/,
        use: "babel-loader",
        include: [path.resolve(__dirname, "app/src/renderer")],
        exclude: /node_modules/
      },
      {
        test: /\.json$/,
        use: "json-loader"
      },
      {
        test: /\.node$/,
        use: "node-loader"
      },
      {
        test: /\.vue$/,
        use: {
          loader: "vue-loader"
        }
      },
      {
        test: /\.(png|jpe?g|gif|svg)(\?.*)?$/,
        use: [
          {
            loader: "url-loader",
            query: {
              limit: 10000,
              name: "imgs/[name].[ext]"
            }
          }
        ]
      },
      {
        test: /\.(woff2?|eot|ttf|otf)(\?.*)?$/,
        use: [
          {
            loader: "url-loader",
            query: {
              limit: 10000,
              name: "fonts/[name].[ext]"
            }
          }
        ]
      }
    ]
  },
  node: {
    __dirname: false,
    __filename: false
  },
  plugins: [
    // the global.GENTLY below fixes a compile issue with superagent + webpack
    // https://github.com/visionmedia/superagent/issues/672
    new webpack.DefinePlugin({ "global.GENTLY": false }),
    new ExtractTextPlugin("styles.css"),
    new HtmlWebpackPlugin({
      filename: "index.html",
      template: "./app/index.ejs",
      appModules:
        process.env.NODE_ENV !== "production"
          ? path.resolve(__dirname, "app/node_modules")
          : false,
      styles: stylus(
        fs.readFileSync("./app/src/renderer/styles/index.styl", "utf8")
      )
        .import("./app/src/renderer/styles/variables.styl")
        .render()
    }),
    new webpack.NoEmitOnErrorsPlugin(),
    // warnings caused by websocket-stream, which has a server-part that is unavailable on the the client
    new webpack.IgnorePlugin(/(bufferutil|utf-8-validate)/),
    // put all modules in node_modules in chunk
    new webpack.optimize.CommonsChunkPlugin({
      name: "vendor"
    })
  ],
  output: {
    filename: "[name].js",
    libraryTarget: "commonjs2",
    path: path.join(__dirname, "app/dist")
  },
  resolve: {
    alias: {
      renderer: resolve("app/src/renderer"),
      "@": resolve("app/src/renderer"),
      assets: resolve("app/src/renderer/assets"),
      scripts: resolve("app/src/renderer/scripts"),
      common: resolve("app/src/renderer/components/common"),
      govern: resolve("app/src/renderer/components/govern"),
      monitor: resolve("app/src/renderer/components/monitor"),
      staking: resolve("app/src/renderer/components/staking"),
      wallet: resolve("app/src/renderer/components/wallet"),
      variables: resolve("app/src/renderer/styles/variables.styl")
    },
    extensions: [".js", ".vue", ".json", ".css", ".node", ".styl"],
    modules: [
      path.join(__dirname, "app/node_modules"),
      path.join(__dirname, "node_modules")
    ]
  },
  target: "electron-renderer"
}

if (process.env.NODE_ENV !== "production") {
  /**
   * Apply ESLint
   */
  if (settings.eslint) {
    rendererConfig.module.rules.push({
      test: /\.(js|vue)$/,
      loader: "eslint-loader",
      enforce: "pre",
      exclude: /node_modules/,
      options: { formatter: require("eslint-friendly-formatter") }
    })
  }
}

/**
 * Adjust rendererConfig for production settings
 */
if (process.env.NODE_ENV === "production") {
  rendererConfig.devtool = ""

  rendererConfig.plugins.push(
    new webpack.DefinePlugin({
      "process.env.NODE_ENV": '"production"'
    }),
    new webpack.LoaderOptionsPlugin({
      minimize: true
    })
  )
}

module.exports = rendererConfig

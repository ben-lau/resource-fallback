const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { ResourceFallbackWebpackPlugin } = require('@resource-fallback/webpack-plugin');

module.exports = {
  entry: './src/index.tsx',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].[contenthash:8].js',
    chunkFilename: '[name].[contenthash:8].js',
    publicPath: 'http://cdn-primary.example.invalid/',
    clean: true,
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.[jt]sx?$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: [
              ['@babel/preset-env', { targets: { esmodules: true } }],
              ['@babel/preset-react', { runtime: 'automatic' }],
              '@babel/preset-typescript',
            ],
          },
        },
      },
      {
        test: /\.css$/,
        use: [MiniCssExtractPlugin.loader, 'css-loader'],
      },
      {
        test: /\.(svg|woff2?|ttf)$/,
        type: 'asset/resource',
      },
    ],
  },
  plugins: [
    new MiniCssExtractPlugin({ filename: '[name].[contenthash:8].css' }),
    new HtmlWebpackPlugin({
      template: path.resolve(__dirname, 'src/index.html'),
    }),
    {
      apply(compiler) {
        compiler.hooks.thisCompilation.tap('ExternalScriptDemoAssetPlugin', (compilation) => {
          compilation.emitAsset(
            'external/lib.js',
            new compiler.webpack.sources.RawSource('window.__RF_EXTERNAL_LIB_LOADED__ = true;\n'),
          );
        });
      },
    },
    new ResourceFallbackWebpackPlugin({
      rules: [
        {
          base: 'http://cdn-primary.example.invalid/',
          urls: [
            'http://cdn-secondary.example.invalid/',
            'http://cdn-backup.example.invalid/',
            '/',
          ],
          retry: { max: 1, baseDelay: 300, maxDelay: 1000, jitter: false },
          circuit: { threshold: 2, cooldown: 15_000, storageTtl: 60_000 },
        },
      ],
      debug: true,
      serviceWorker: { fallbackOnOpaque: true },
    }),
  ],
};

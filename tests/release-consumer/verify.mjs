import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { chromium } from 'playwright';
import * as core from '@resource-fallback/core';

const bundler = process.argv[2];
assert.ok(bundler === 'vite' || bundler === 'webpack', 'Pass vite or webpack');

const require = createRequire(import.meta.url);
const pluginName = `@resource-fallback/${bundler}-plugin`;
const pluginRequire = createRequire(require.resolve(pluginName));
assert.equal(
  pluginRequire.resolve('@resource-fallback/core'),
  require.resolve('@resource-fallback/core'),
);
for (const entry of [core, require('@resource-fallback/core')]) {
  assert.ok(entry.getRuntimeCode().includes('__RF__'));
  assert.ok(entry.getServiceWorkerCode().length > 0);
}
const runtime = await readFile(require.resolve('@resource-fallback/core/runtime'), 'utf8');
assert.ok(runtime.includes('__RF__'));

const base = 'http://primary.example.invalid/';
const origin = 'http://consumer.example.test/';
const options = { rules: [{ base, urls: ['/'], retry: { max: 0 } }] };
const html = `<!doctype html>
<html>
  <head><meta charset="utf-8"><title>Release consumer</title></head>
  <body><button id="load">Load chunk</button><output id="status"></output></body>
</html>`;

if (bundler === 'vite') {
  const { build, version } = await import('vite');
  const { default: resourceFallback } = await import(pluginName);
  assert.equal(typeof require(pluginName).default, 'function');
  await writeFile(
    'index.html',
    html.replace('</body>', '<script type="module" src="/entry.js"></script></body>'),
  );
  console.log(`Building with Vite ${version} on Node ${process.version}`);
  await build({ configFile: false, base, plugins: [resourceFallback(options)] });
} else {
  const { default: webpack } = await import('webpack');
  const { default: HtmlWebpackPlugin } = await import('html-webpack-plugin');
  const { ResourceFallbackWebpackPlugin } = require(pluginName);
  assert.equal(typeof (await import(pluginName)).ResourceFallbackWebpackPlugin, 'function');
  console.log(`Building with Webpack ${webpack.version} on Node ${process.version}`);
  await new Promise((resolve, reject) => {
    webpack(
      {
        mode: 'production',
        entry: './entry.js',
        output: {
          path: join(process.cwd(), 'dist'),
          publicPath: base,
          filename: 'entry.[contenthash].js',
          chunkFilename: 'lazy.[contenthash].js',
        },
        plugins: [
          new HtmlWebpackPlugin({ templateContent: html }),
          new ResourceFallbackWebpackPlugin(options),
        ],
      },
      (error, stats) => {
        if (error) reject(error);
        else if (stats.hasErrors()) reject(new Error(stats.toString('errors-only')));
        else resolve();
      },
    );
  });
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(15_000);
  const primaryRequests = [];
  const servedScripts = new Set();
  await page.route(`${base}**`, (route) => {
    primaryRequests.push(new URL(route.request().url()).pathname);
    return route.abort('failed');
  });
  await page.route(`${origin}**`, async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path !== '/' && !path.endsWith('.js')) return route.fulfill({ status: 404 });
    await route.fulfill({ path: join('dist', path === '/' ? 'index.html' : path) });
    if (path.endsWith('.js')) servedScripts.add(path);
  });
  await page.goto(origin);
  await page.getByText('Entry loaded', { exact: true }).waitFor();
  await page.locator('#load').click();
  await page.getByText('Lazy chunk loaded', { exact: true }).waitFor();

  const recoveredScripts = primaryRequests.filter((path) => servedScripts.has(path));
  assert.ok(
    new Set(recoveredScripts).size >= 2,
    'The entry and lazy chunk must both recover from the CDN failure',
  );
  console.log('Recovered entry and lazy chunk from the origin:', recoveredScripts);
} finally {
  await browser.close();
}

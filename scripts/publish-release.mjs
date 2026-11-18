import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const directory = process.argv[2];
assert.ok(directory, 'Pass the directory containing the verified release packages');

const registry = 'https://registry.npmjs.org';
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const packages = ['core', 'vite-plugin', 'webpack-plugin'].map((packageName) => {
  const name = `@resource-fallback/${packageName}`;
  const path = resolve(directory, `${packageName}.tgz`);
  const manifest = JSON.parse(
    execFileSync('tar', ['-xOf', path, 'package/package.json'], { encoding: 'utf8' }),
  );
  assert.equal(manifest.name, name, path);
  assert.equal(manifest.version, version, path);
  if (packageName !== 'core') {
    assert.equal(manifest.dependencies?.['@resource-fallback/core'], version, path);
  }
  const integrity = `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`;
  return { name, path, integrity };
});

const unpublished = [];
for (const candidate of packages) {
  const specifier = `${candidate.name}@${version}`;
  const response = await fetch(`${registry}/${encodeURIComponent(candidate.name)}/${version}`, {
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 404) {
    unpublished.push(candidate);
    continue;
  }
  assert.ok(response.ok, `Could not check ${specifier} in npm (HTTP ${response.status})`);
  const published = await response.json();
  assert.equal(
    published.dist?.integrity,
    candidate.integrity,
    `${specifier} already exists in npm with different contents`,
  );
  console.log(`${specifier} already published with matching contents`);
}

for (const { path } of unpublished) {
  execFileSync(
    'npm',
    [
      'publish',
      path,
      '--ignore-scripts',
      '--provenance',
      '--access',
      'public',
      '--registry',
      registry,
    ],
    { stdio: 'inherit' },
  );
}

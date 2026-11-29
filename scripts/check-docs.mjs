import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root, 'docs/.vitepress/dist');
const base = '/resource-fallback/';
const origin = 'https://docs.example.test';
const errors = [];
const pages = new Map();
let checked = 0;

async function files(directory, extension) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path, extension)));
    else if (path.endsWith(extension)) output.push(path);
  }
  return output;
}

for (const path of await files(dist, '.html')) {
  const dom = new JSDOM(await readFile(path, 'utf8'));
  const ids = new Set();
  for (const element of dom.window.document.querySelectorAll('[id]')) {
    if (ids.has(element.id)) errors.push(`${relative(dist, path)}: duplicate id ${element.id}`);
    ids.add(element.id);
  }
  pages.set(path, {
    ids,
    links: [...dom.window.document.querySelectorAll('a[href]')].map((link) =>
      link.getAttribute('href'),
    ),
  });
  dom.window.close();
}

const available = new Set(await files(dist, ''));
function targetFile(pathname) {
  if (pathname === base.slice(0, -1)) pathname = base;
  if (!pathname.startsWith(base)) return undefined;
  const path = resolve(dist, decodeURIComponent(pathname.slice(base.length)));
  if (path !== dist && !path.startsWith(dist + '/')) return undefined;
  if (available.has(path)) return path;
  if (!extname(path) && available.has(path + '.html')) return path + '.html';
  const index = join(path, 'index.html');
  if (available.has(index)) return index;
  return undefined;
}

for (const [path, page] of pages) {
  const url = new URL(base + relative(dist, path), origin);
  for (const href of page.links) {
    const destination = new URL(href, url);
    if (destination.origin !== origin) continue;
    checked++;
    const target = targetFile(destination.pathname);
    if (!target) errors.push(`${relative(dist, path)}: missing target ${href}`);
    else if (
      destination.hash &&
      pages.has(target) &&
      !pages.get(target).ids.has(decodeURIComponent(destination.hash.slice(1)))
    ) {
      errors.push(`${relative(dist, path)}: missing anchor ${href}`);
    }
  }
}

for (const section of ['guide', 'experience', 'design', 'reference']) {
  const source = join(root, 'docs', section);
  const translated = join(root, 'docs/en', section);
  const chinese = new Set((await files(source, '.md')).map((path) => relative(source, path)));
  const english = new Set(
    (await files(translated, '.md')).map((path) => relative(translated, path)),
  );
  for (const name of new Set([...chinese, ...english])) {
    if (!chinese.has(name) || !english.has(name))
      errors.push(`${section}/${name}: missing locale counterpart`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Docs verified: ${pages.size} HTML pages, ${checked} internal links/anchors, unique IDs, and matching locale routes.`,
  );
}

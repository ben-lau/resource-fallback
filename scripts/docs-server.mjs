import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function serveDocs() {
  const root = fileURLToPath(new URL('../docs/.vitepress/dist/', import.meta.url));
  const base = '/resource-fallback/';
  const mime = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.woff2': 'font/woff2',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (!url.pathname.startsWith(base)) throw new Error('outside base');
      let path = resolve(root, decodeURIComponent(url.pathname.slice(base.length)));
      if (path !== root.slice(0, -1) && !path.startsWith(root)) throw new Error('outside output');
      try {
        if ((await stat(path)).isDirectory()) path = resolve(path, 'index.html');
      } catch {
        if (!extname(path)) path += '.html';
      }
      const body = await readFile(path);
      response.writeHead(200, {
        'content-type': mime[extname(path)] || 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end('Not found');
    }
  });
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}${base}`,
    close: () =>
      new Promise((accept, reject) => server.close((error) => (error ? reject(error) : accept()))),
  };
}

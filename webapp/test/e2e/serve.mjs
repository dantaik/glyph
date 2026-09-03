// serve.mjs — the built app (dist/) over HTTP, with the SPA fallback the
// hosting rewrites (vercel.json) provide: every path that isn't a file is
// index.html. Usage: node test/e2e/serve.mjs [port]   (default 4173)
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const PORT = Number(process.argv[2] || 4173);
const ROOT = resolve(import.meta.dirname, '../../dist');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

if (!existsSync(join(ROOT, 'index.html'))) {
  console.error(`nothing at ${ROOT}/index.html — run \`npm run build\` first`);
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/__health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end('{"ok":true}');
  }
  let file = join(ROOT, decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT) || !existsSync(file) || statSync(file).isDirectory()) file = join(ROOT, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  res.end(readFileSync(file));
}).listen(PORT, '127.0.0.1', () => console.log(`glyph dist on http://127.0.0.1:${PORT}`));

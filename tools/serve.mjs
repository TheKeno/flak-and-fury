// Tiny static file server for local development: node tools/serve.mjs [port]
// It also accepts PUT for the tuning panel's "Save to files", limited to existing data/*.json files.
import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2] || process.env.PORT || 8080);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ldtk': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SAVABLE = /^\/data\/[a-z_]+\.json$/;

async function save(req, res, path) {
  const file = normalize(join(root, path));
  if (!SAVABLE.test(path) || !(await stat(file)).isFile()) throw new Error('not savable');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error('too large');
  }
  JSON.parse(body); // refuse anything that isn't valid JSON
  await writeFile(file, body);
  res.writeHead(204);
  res.end();
}

createServer(async (req, res) => {
  if (req.method === 'PUT') {
    try {
      await save(req, res, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(String(e.message));
    }
    return;
  }
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path.endsWith('/')) path += 'index.html';
    const file = normalize(join(root, path));
    if (!file.startsWith(root)) throw new Error('outside root');
    if (!(await stat(file)).isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`Serving ${root} at http://localhost:${port}`));

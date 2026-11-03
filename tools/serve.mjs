// Tiny static file server for local development: node tools/serve.mjs [port]
// It also accepts PUT for the tuning panel's "Save to files", limited to existing data/*.json files.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
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
  '.flac': 'audio/flac',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const SAVABLE = /^\/data\/[a-z_]+\.json$/;

const AUDIO = 'assets/audio';
const hashOf = (buf) => createHash('sha256').update(buf).digest('hex');

// Where a file with these exact bytes already is, if anywhere: a second copy would only waste space
// and be decoded twice, while two sound entries can share one file and still keep their own cuts.
async function findCopy(hash, size, dir = AUDIO) {
  for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      const found = await findCopy(hash, size, path);
      if (found) return found;
    } else if ((await stat(join(root, path))).size === size && hashOf(await readFile(join(root, path))) === hash) return path;
  }
  return null;
}

// A recording from the Sound Lab goes to assets/audio/inbox/ under a clean name, never over another file.
async function saveRecording(req, res, name) {
  const match = /^(.+).(wav|mp3|ogg|flac)$/i.exec(name);
  if (!match) throw new Error('Only WAV, MP3, OGG and FLAC');
  const stem = match[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound';
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 100_000_000) throw new Error('Over 100 MB');
    chunks.push(chunk);
  }
  if (size === 0) throw new Error('The file is empty');
  const body = Buffer.concat(chunks);
  const copy = await findCopy(hashOf(body), size);
  if (copy) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ path: copy, size, existing: true }));
    return;
  }
  await mkdir(join(root, AUDIO, 'inbox'), { recursive: true });
  let file = `${AUDIO}/inbox/${stem}.${match[2].toLowerCase()}`;
  for (let n = 2; await stat(join(root, file)).then(() => true, () => false); n++) file = `${AUDIO}/inbox/${stem}-${n}.${match[2].toLowerCase()}`;
  await writeFile(join(root, file), body);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ path: file, size }));
}

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
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (path.startsWith('/recording/')) await saveRecording(req, res, path.slice('/recording/'.length));
      else await save(req, res, path);
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

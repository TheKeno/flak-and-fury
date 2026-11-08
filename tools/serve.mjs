// Tiny static file server for local development: node tools/serve.mjs [port]
// It also accepts PUT for the tuning panel's "Save to files", limited to existing data/*.json files
// (and data/outlines/*.json), POST /build-sprites[?plane=x] for the Outline Lab, GET /api/outlines.
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { IMAGE_TYPES, MAX_BYTES, libraryDir, listSheets, saveSheet, sheetPath } from './blueprints.mjs';

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
// The Outline Lab may also create a plane's outline file.
const OUTLINE = /^\/data\/outlines\/[a-z0-9_-]+\.json$/;

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

// The library's folders, one per kind of sound. A new file with no known place waits in inbox.
const FOLDERS = ['engines', 'guns', 'impacts', 'destruction', 'airframe', 'crew', 'ambience', 'voice', 'ui', 'inbox'];
const STEM = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The next free number for a name in a folder: the first file is -01, then -02.
async function nextNumber(dir, stem) {
  const taken = (await readdir(join(root, dir))).map((f) => new RegExp(`^${stem}-([0-9]{2})\\.`).exec(f)?.[1]).filter(Boolean).map(Number);
  return String(Math.max(0, ...taken) + 1).padStart(2, '0');
}

// A recording from the Sound Lab arrives as folder/name.ext, where the Lab has named it after the
// slot it was dropped on. It is saved as folder/name-NN.ext, never over another file.
async function saveRecording(req, res, name) {
  const [folder, file0] = name.includes('/') ? name.split('/') : ['inbox', name];
  if (!FOLDERS.includes(folder)) throw new Error(`Unknown folder ${folder}`);
  const match = /^(.+)\.(wav|mp3|ogg|flac)$/i.exec(file0);
  if (!match) throw new Error('Only WAV, MP3, OGG and FLAC');
  const stem = match[1].toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sound';
  if (!STEM.test(stem)) throw new Error('Use lowercase letters, digits and hyphens');
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
  const dir = `${AUDIO}/${folder}`;
  await mkdir(join(root, dir), { recursive: true });
  const file = `${dir}/${stem}-${await nextNumber(dir, stem)}.${match[2].toLowerCase()}`;
  await writeFile(join(root, file), body);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ path: file, size }));
}

async function save(req, res, path) {
  const file = normalize(join(root, path));
  if (OUTLINE.test(path)) await mkdir(join(root, 'data/outlines'), { recursive: true });
  else if (!SAVABLE.test(path) || !(await stat(file)).isFile()) throw new Error('not savable');
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

// The Outline Lab's Build sprites button: runs the sprite generator for one plane (or all).
function buildSprites(res, plane) {
  if (plane && !/^[a-z0-9_-]+$/.test(plane)) throw new Error('bad plane name');
  execFile(process.execPath, ['tools/make-sprites.mjs', ...(plane ? [plane] : [])], { cwd: root, timeout: 300_000 }, (err, stdout, stderr) => {
    res.writeHead(err ? 500 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: !err, output: String(stdout) + String(stderr) + (err ? `
${err.message}` : '') }));
  });
}

// The blueprint library (see tools/blueprints.mjs): GET /api/blueprints, GET /api/blueprints/<name>,
// PUT /api/blueprints/<name>. Local dev server only, never part of the public game.
async function blueprintApi(req, res) {
  const send = (code, type, body) => {
    res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  };
  const json = (code, obj) => send(code, 'application/json', JSON.stringify(obj));
  try {
    const dir = await libraryDir(root);
    const rest = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice('/api/blueprints'.length)).replace(/^\//, '');
    if (!rest && req.method === 'GET') return json(200, { configured: !!dir, dir, sheets: dir ? await listSheets(dir) : [] });
    if (!dir) return json(409, { error: 'Library folder not set: put its path in .blueprints-path or the BLUEPRINTS variable' });
    if (req.method === 'GET') {
      const file = sheetPath(dir, rest);
      if (!file) return json(400, { error: 'bad name' });
      return send(200, IMAGE_TYPES[extname(file).toLowerCase()], await readFile(file));
    }
    if (req.method === 'PUT') {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BYTES) return json(413, { error: 'Over 40 MB' });
        chunks.push(chunk);
      }
      return json(200, { name: await saveSheet(dir, rest, Buffer.concat(chunks)) });
    }
    return json(405, { error: 'method' });
  } catch (e) {
    json(e.code === 'ENOENT' ? 404 : 400, { error: String(e.message) });
  }
}

createServer(async (req, res) => {
  if (req.url.split('?')[0].startsWith('/api/blueprints')) return blueprintApi(req, res);
  if (req.method === 'POST' && req.url.startsWith('/build-sprites')) {
    try {
      buildSprites(res, new URL(req.url, 'http://x').searchParams.get('plane'));
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end(String(e.message));
    }
    return;
  }
  if (req.method === 'GET' && req.url.split('?')[0] === '/api/outlines') {
    const files = (await readdir(join(root, 'data/outlines')).catch(() => [])).filter((f) => f.endsWith('.json'));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(files.map((f) => f.replace('.json', ''))));
    return;
  }
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

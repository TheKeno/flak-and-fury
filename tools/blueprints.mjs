// The Outline Lab's blueprint library: a flat folder of image sheets outside the game repo (they are
// copyrighted working files; the repo is public). Where it is comes from the BLUEPRINTS env var or the
// git-ignored file `.blueprints-path` in the repo root. Only local dev use; nothing here is ever committed.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const MAX_BYTES = 40_000_000;
export const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp' };

// A file name that is safe to use inside the library folder: no directories, no odd characters, an image
// extension. Returns null when it can't be made safe.
export function safeName(raw) {
  if (typeof raw !== 'string') return null;
  const base = raw.split(/[\\/]/).pop().normalize('NFKD').replace(/[^\x20-\x7e]/g, '');
  const m = /^(.*?)(\.[A-Za-z0-9]+)$/.exec(base);
  if (!m) return null;
  const ext = m[2].toLowerCase();
  if (!IMAGE_TYPES[ext]) return null;
  const stem = m[1].replace(/[^A-Za-z0-9._ -]+/g, '-').replace(/\.{2,}/g, '.').replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 100);
  return stem ? stem + ext : null;
}

// The library folder, or null when not configured.
export async function libraryDir(root) {
  let dir = process.env.BLUEPRINTS;
  if (!dir) dir = (await readFile(join(root, '.blueprints-path'), 'utf8').catch(() => '')).split(/\r?\n/)[0].trim();
  return dir ? resolve(dir) : null;
}

export async function listSheets(dir) {
  const out = [];
  for (const name of await readdir(dir).catch(() => [])) {
    if (safeName(name) !== name) continue;
    const s = await stat(join(dir, name)).catch(() => null);
    if (s?.isFile()) out.push({ name, size: s.size, mtime: s.mtimeMs });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// Full path of a sheet by name, only if the name is already in its safe form.
export function sheetPath(dir, name) {
  return safeName(name) === name ? join(dir, name) : null;
}

// Saves a sheet under a safe name; never overwrites (a taken name gets -2, -3, ...). Returns the name.
export async function saveSheet(dir, rawName, body) {
  const name = safeName(rawName);
  if (!name) throw new Error('Only PNG, JPG, GIF, WEBP and BMP pictures');
  if (!body.length) throw new Error('The file is empty');
  if (body.length > MAX_BYTES) throw new Error('Over 40 MB');
  await mkdir(dir, { recursive: true });
  const dot = name.lastIndexOf('.');
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${name.slice(0, dot)}-${n}${name.slice(dot)}`;
    try {
      await writeFile(join(dir, candidate), body, { flag: 'wx' });
      return candidate;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
  }
}

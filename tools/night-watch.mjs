// A live log of a night run in a console window: follows notes/night-*.txt (the stage time stamps in
// night-status.txt and each tool's own log) and prints new lines as they come, marked with the file and
// the time they appeared. Read-only.
//   node tools/night-watch.mjs          everything so far, then live, in its own window (tools\night-watch.cmd,
//                                       e.g. mid-run): closing that window never touches the run
//   node tools/night-watch.mjs --new    only what a run started now writes; night-start.ps1 runs it inside the
//                                       run's own window, so closing that window stops the run (minimise it)
// Never ends by itself, so the window stays readable in the morning; close it when done.
import { readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const at = process.argv.indexOf('--dir'); // another folder (for testing it beside a real run)
const NOTES = at > 0 ? process.argv[at + 1] : fileURLToPath(new URL('../notes/', import.meta.url));
const fresh = process.argv.includes('--new');
const started = Date.now();
const files = new Map(); // name -> { offset, partial, live }
const COLOURS = { status: 33, train: 36, tune: 32 }; // yellow, cyan, green; anything else plain
const now = () => new Date().toTimeString().slice(0, 8);
const STAMP = /^\d\d:\d\d:\d\d /;

function print(label, line, live) {
  // The tuner stamps its own lines; the others get the time the line appeared (blank for old lines).
  const time = STAMP.test(line) ? '' : `${live ? now() : '        '} `;
  const c = COLOURS[label];
  const tag = c ? `\x1b[${c}m${label.padEnd(6)}\x1b[0m` : label.padEnd(6);
  console.log(`${tag} ${time}${line}`);
  if (label === 'status') process.title = `Night run: ${line.replace(/^\S+\s+\S+\s+/, '')}`;
}

function poll() {
  let names = [];
  try {
    names = readdirSync(NOTES).filter((n) => /^night-.*\.txt$/.test(n)).sort((a, b) => (a === 'night-status.txt' ? -1 : b === 'night-status.txt' ? 1 : a.localeCompare(b)));
  } catch {
    return;
  }
  for (const name of names) {
    let st;
    try {
      st = statSync(join(NOTES, name));
    } catch {
      continue;
    }
    // --new: a log is the new run's once it is written after we started (the run's '>' starts it afresh).
    if (fresh && !files.has(name) && st.mtimeMs < started - 1000) continue;
    const f = files.get(name) ?? { offset: 0, partial: '', live: fresh || Date.now() - started > 3000 };
    files.set(name, f);
    if (st.size < f.offset) Object.assign(f, { offset: 0, partial: '' }); // rewritten by a new run
    if (st.size === f.offset) continue;
    const buf = Buffer.alloc(st.size - f.offset);
    try {
      const fd = openSync(join(NOTES, name), 'r');
      readSync(fd, buf, 0, buf.length, f.offset);
      closeSync(fd);
    } catch {
      continue;
    }
    f.offset = st.size;
    const lines = (f.partial + buf.toString('utf8')).split(/\r?\n/);
    f.partial = lines.pop();
    const label = name.slice(6, -4);
    for (const line of lines) if (line.trim()) print(label, line, f.live);
    f.live = true;
  }
}

process.title = 'Night run log';
console.log(fresh
  ? 'Night run log (notes\\night-*.txt). This is the run\'s own window: minimise it, closing it stops the run.\n'
  : 'Night run log, everything so far, then live (notes\\night-*.txt). Closing this window does not stop the run.\n');
poll();
setInterval(poll, 1000);

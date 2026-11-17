// The Pixel Lab (pixel-lab.html): a simple pixel editor for the scenery drawn in tools/kursk-sprites.mjs
// (buildings, wrecks, the train, paratroopers, guns...). A sprite is rows of palette keys
// (tools/plane-palette.mjs); the dev server (tools/serve.mjs, /api/pixels) hands them out, saves an edited one
// as data/pixels/<name>.json and rebuilds the sprite file when the game uses it. From then on the saved rows
// are the sprite; "Revert to drawn" deletes them. The size is fixed (the hit box and the LDtk piece follow it).
// The editing itself (strokes, fill, undo) is in the pure functions at the top, so a test can use them.

// The pixels on the line from (x0, y0) to (x1, y1), so a fast drag leaves no gaps.
export function linePixels(x0, y0, x1, y1) {
  const out = [];
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= n; i++) out.push([Math.round(x0 + ((x1 - x0) * i) / (n || 1)), Math.round(y0 + ((y1 - y0) * i) / (n || 1))]);
  return out;
}

// Flood fill from (x, y) with key, through pixels of the colour that was there (4 ways). px: rows of arrays, changed in place.
export function floodFill(px, x, y, key) {
  const h = px.length;
  const w = px[0].length;
  const from = px[y]?.[x];
  if (from === undefined || from === key) return 0;
  const stack = [[x, y]];
  let n = 0;
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h || px[cy][cx] !== from) continue;
    px[cy][cx] = key;
    n++;
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  return n;
}

export const toGrid = (rows) => {
  const w = Math.max(...rows.map((r) => r.length));
  return rows.map((r) => [...r.padEnd(w, '.')]);
};
export const toRows = (px) => px.map((r) => r.join(''));

if (typeof document !== 'undefined') start();

async function start() {
  const $ = (id) => document.getElementById(id);
  const view = $('view');
  const ctx = view.getContext('2d');
  const status = (text, warn = false) => {
    $('status').textContent = text;
    $('status').className = warn ? 'warn' : '';
  };

  let data;
  try {
    const res = await fetch('/api/pixels');
    if (!res.ok) throw new Error((await res.json()).error ?? res.status);
    data = await res.json();
  } catch (e) {
    status(`Could not load the sprites (${e.message}). Is this the dev server, restarted after the Pixel Lab was added? (node tools/serve.mjs 8080)`, true);
    return;
  }
  const palette = data.palette;
  const css = (key) => {
    const [r, g, b, a] = palette[key].rgba;
    return `rgba(${r},${g},${b},${a / 255})`;
  };
  const sprites = new Map();
  for (const [group, list] of Object.entries(data.groups)) {
    const og = document.createElement('optgroup');
    og.label = group;
    for (const s of list) {
      sprites.set(s.name, s);
      const o = document.createElement('option');
      o.value = s.name;
      o.textContent = s.name;
      og.append(o);
    }
    $('sprite').append(og);
  }

  // What is being edited.
  let name = null;
  let px = [];
  let saved = '';
  let undo = [];
  let redo = [];
  let tool = 'pencil';
  let key = 'o';
  let zoom = 8;
  let ox = 0; // where the sprite's top left is on the canvas, in canvas pixels
  let oy = 0;
  let stroke = null; // { last: [x, y] } while drawing
  let pan = null;
  let space = false;
  const dirty = () => JSON.stringify(toRows(px)) !== saved;

  // Palette swatches.
  for (const k of Object.keys(palette)) {
    const b = document.createElement('button');
    b.dataset.key = k;
    b.title = `${k === '.' ? 'empty (see-through)' : palette[k].name || 'colour'}  [${k}]`;
    if (k === '.') b.className = 'empty';
    else b.style.background = css(k);
    b.onclick = () => setKey(k);
    $('palette').append(b);
  }
  function setKey(k) {
    key = k;
    for (const b of $('palette').children) b.classList.toggle('on', b.dataset.key === k);
    $('colour').textContent = k === '.' ? 'empty (see-through)' : `${palette[k].name || 'colour'}  [${k}]`;
  }
  function setTool(t) {
    tool = t;
    for (const b of $('tools').children) b.classList.toggle('on', b.dataset.tool === t);
  }
  for (const b of $('tools').children) b.onclick = () => setTool(b.dataset.tool);

  function fit() {
    const r = view.getBoundingClientRect();
    view.width = Math.max(1, Math.round(r.width));
    view.height = Math.max(1, Math.round(r.height));
  }
  function centre() {
    fit();
    const w = px[0].length;
    const h = px.length;
    zoom = Math.max(2, Math.min(24, Math.floor(Math.min((view.width - 40) / w, (view.height - 40) / h))));
    ox = Math.round((view.width - w * zoom) / 2);
    oy = Math.round((view.height - h * zoom) / 2);
  }

  function open(n) {
    const s = sprites.get(n);
    name = n;
    px = toGrid(s.rows);
    saved = JSON.stringify(toRows(px));
    undo = [];
    redo = [];
    $('sprite').value = n;
    $('size').textContent = `${px[0].length} x ${px.length}`;
    showTags();
    centre();
    draw();
    status('');
    history.replaceState(null, '', `?sprite=${encodeURIComponent(n)}`);
  }
  function showTags() {
    const s = sprites.get(name);
    $('tags').textContent = [s.inGame ? 'in the game' : 'draft (not in the game)', s.edited ? 'hand-edited' : 'as drawn by the code'].join(', ');
    $('revert').disabled = !s.edited;
  }

  function draw() {
    const w = px[0].length;
    const h = px.length;
    ctx.fillStyle = '#2a2f35';
    ctx.fillRect(0, 0, view.width, view.height);
    // Checker under the sprite, so see-through pixels show.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = px[y][x];
        ctx.fillStyle = c === '.' ? ((x + y) % 2 ? '#4a5058' : '#434950') : css(c);
        ctx.fillRect(ox + x * zoom, oy + y * zoom, zoom, zoom);
      }
    }
    if ($('grid').checked && zoom >= 6) {
      ctx.strokeStyle = 'rgba(0,0,0,0.22)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x++) {
        ctx.moveTo(ox + x * zoom + 0.5, oy);
        ctx.lineTo(ox + x * zoom + 0.5, oy + h * zoom);
      }
      for (let y = 0; y <= h; y++) {
        ctx.moveTo(ox, oy + y * zoom + 0.5);
        ctx.lineTo(ox + w * zoom, oy + y * zoom + 0.5);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#a8905c';
    ctx.strokeRect(ox - 0.5, oy - 0.5, w * zoom + 1, h * zoom + 1);
    // Previews on a strip of sky and ground, as it stands in the game.
    for (const [id, k] of [['p1', 1], ['p2', 2]]) {
      const c = $(id);
      c.width = (w + 12) * k;
      c.height = (h + 8) * k;
      const g = c.getContext('2d');
      g.fillStyle = '#60686c';
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = '#3a3428';
      g.fillRect(0, (h + 4) * k, c.width, 4 * k);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (px[y][x] === '.') continue;
        g.fillStyle = css(px[y][x]);
        g.fillRect((x + 6) * k, (y + 4) * k, k, k);
      }
    }
    $('undo').disabled = !undo.length;
    $('redo').disabled = !redo.length;
    $('save').disabled = !dirty();
    document.title = `${dirty() ? '* ' : ''}${name} - Pixel Lab`;
  }

  const at = (e) => {
    const r = view.getBoundingClientRect();
    const sx = (e.clientX - r.left) * (view.width / r.width);
    const sy = (e.clientY - r.top) * (view.height / r.height);
    return [Math.floor((sx - ox) / zoom), Math.floor((sy - oy) / zoom), sx, sy];
  };
  const inside = (x, y) => y >= 0 && y < px.length && x >= 0 && x < px[0].length;
  const snapshot = () => {
    undo.push(toRows(px));
    if (undo.length > 200) undo.shift();
    redo = [];
  };
  const paint = (x, y, k) => {
    if (inside(x, y)) px[y][x] = k;
  };

  view.addEventListener('contextmenu', (e) => e.preventDefault());
  view.addEventListener('pointerdown', (e) => {
    view.setPointerCapture(e.pointerId);
    const [x, y, sx, sy] = at(e);
    if (e.button === 1 || (e.button === 0 && space)) {
      pan = { sx, sy, ox, oy };
      return;
    }
    if (e.button === 2 || tool === 'pick') {
      if (inside(x, y)) setKey(px[y][x]);
      if (tool === 'pick' && e.button === 0) setTool('pencil');
      return;
    }
    if (e.button !== 0) return;
    snapshot();
    if (tool === 'fill') {
      if (inside(x, y)) floodFill(px, x, y, key);
    } else {
      paint(x, y, tool === 'erase' ? '.' : key);
      stroke = { last: [x, y] };
    }
    draw();
  });
  view.addEventListener('pointermove', (e) => {
    const [x, y, sx, sy] = at(e);
    $('hint').textContent = inside(x, y) ? `${x}, ${y}   ${px[y][x] === '.' ? 'empty' : palette[px[y][x]].name || px[y][x]}` : '';
    if (pan) {
      ox = Math.round(pan.ox + sx - pan.sx);
      oy = Math.round(pan.oy + sy - pan.sy);
      draw();
    } else if (stroke) {
      for (const [lx, ly] of linePixels(stroke.last[0], stroke.last[1], x, y)) paint(lx, ly, tool === 'erase' ? '.' : key);
      stroke.last = [x, y];
      draw();
    }
  });
  const end = () => {
    stroke = null;
    pan = null;
  };
  view.addEventListener('pointerup', end);
  view.addEventListener('pointercancel', end);
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const [, , sx, sy] = at(e);
    const z = Math.max(1, Math.min(40, zoom + (e.deltaY < 0 ? 1 : -1) * Math.max(1, Math.round(zoom / 6))));
    // Keep the pixel under the pointer where it is.
    ox = Math.round(sx - ((sx - ox) / zoom) * z);
    oy = Math.round(sy - ((sy - oy) / zoom) * z);
    zoom = z;
    draw();
  }, { passive: false });

  function step(from, to) {
    if (!from.length) return;
    to.push(toRows(px));
    px = toGrid(from.pop());
    draw();
  }
  $('undo').onclick = () => step(undo, redo);
  $('redo').onclick = () => step(redo, undo);
  $('grid').onchange = draw;
  $('flip').onclick = () => {
    snapshot();
    for (const r of px) r.reverse();
    draw();
  };

  async function save() {
    if (!dirty()) return;
    status('Saving...');
    try {
      const rows = toRows(px);
      const res = await fetch(`/api/pixels/${encodeURIComponent(name)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows }) });
      const out = await res.json();
      if (!res.ok || out.error || out.ok === false) throw new Error(out.error ?? out.output ?? res.status);
      const s = sprites.get(name);
      s.rows = rows;
      s.edited = true;
      saved = JSON.stringify(rows);
      showTags();
      draw();
      status(out.built ? 'Saved; the game\'s sprite is rebuilt (reload the game)' : 'Saved (a draft: not a sprite the game uses yet)');
    } catch (e) {
      status(`Not saved: ${e.message}`, true);
    }
  }
  $('save').onclick = save;
  $('revert').onclick = async () => {
    if (!confirm(`Throw away the hand-edited ${name} and go back to the drawn version?`)) return;
    try {
      const res = await fetch(`/api/pixels/${encodeURIComponent(name)}`, { method: 'DELETE' });
      const out = await res.json();
      if (!res.ok || out.error) throw new Error(out.error ?? res.status);
      const fresh = await (await fetch('/api/pixels')).json();
      for (const list of Object.values(fresh.groups)) for (const s of list) sprites.set(s.name, s);
      open(name);
      status('Back to the drawn version');
    } catch (e) {
      status(`Could not revert: ${e.message}`, true);
    }
  };
  $('sprite').onchange = () => {
    if (dirty() && !confirm(`${name} has changes that are not saved. Leave them?`)) {
      $('sprite').value = name;
      return;
    }
    open($('sprite').value);
  };

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') space = true;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') return e.preventDefault(), step(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo);
    if ((e.ctrlKey || e.metaKey) && k === 'y') return e.preventDefault(), step(redo, undo);
    if ((e.ctrlKey || e.metaKey) && k === 's') return e.preventDefault(), save();
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = { p: 'pencil', e: 'erase', f: 'fill', i: 'pick' }[k];
    if (t) setTool(t);
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') space = false;
  });
  window.addEventListener('resize', () => {
    fit();
    draw();
  });
  window.addEventListener('beforeunload', (e) => {
    if (dirty()) e.preventDefault();
  });

  setTool('pencil');
  setKey('o');
  const wanted = new URLSearchParams(location.search).get('sprite');
  open(sprites.has(wanted) ? wanted : sprites.keys().next().value);
}

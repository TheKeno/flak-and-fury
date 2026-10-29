// Draws the world into a low-resolution pixel buffer, then scales it up onto the screen with crisp pixels.
//
// World units vs pixels: the simulation measures everything in world units (480 x 270 of them fill
// the screen at normal zoom). The renderer draws SCALE buffer pixels per world unit, so sprites and
// terrain have SCALE x the detail without changing any gameplay numbers.
// The visible area grows with speed zoom. The HUD has its own fixed 480x270 layer so text stays put.
// Reads simulation state only; never changes it.
import { createRng, clamp } from '../sim/math.js';
import { frameIndex, paintSprite } from './sprites.js';
import { drawHud, damageLines } from './hud.js';
import { createParticles } from './particles.js';
import { drawText, textWidth } from './font.js';
import { createRadar, SCOPE } from './radar.js';
import { fireStage } from '../sim/fire.js';
import { surfaceAt } from '../sim/ground.js';

export const W = 480; // view width in world units at zoom 1
export const H = 270;
export const SCALE = 2; // buffer pixels per world unit; sprites are drawn at this scale
export const MAX_ZOOM = 1.8;

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const BAYER = [
  [0, 2],
  [3, 1],
];

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Tall, 2px-wide dithered sky strip in buffer pixels, used as a repeating pattern.
function buildSky(ctx, map) {
  const skyH = Math.ceil((map.ceiling + 500 + H * MAX_ZOOM) * SCALE);
  const c = makeCanvas(2, skyH);
  const g = c.getContext('2d');
  const img = g.createImageData(2, skyH);
  const low = hexToRgb(map.sky.low);
  const high = hexToRgb(map.sky.high);
  const space = hexToRgb(map.sky.space);
  for (let r = 0; r < skyH; r++) {
    const wy = (skyH - r) / SCALE;
    const t = wy / map.ceiling;
    const col = t <= 1 ? mix(low, high, t) : mix(high, space, clamp((t - 1) / 0.6, 0, 1));
    for (let x = 0; x < 2; x++) {
      const d = (BAYER[r % 2][x] - 1.5) * 3;
      const i = (r * 2 + x) * 4;
      for (let k = 0; k < 3; k++) img.data[i + k] = clamp(Math.round((col[k] + d) / 6) * 6, 0, 255);
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return { pattern: ctx.createPattern(c, 'repeat'), height: skyH };
}

// Distant hill silhouette: one height (world units) per buffer pixel column.
function buildRidge(seed, lengthPx, lo, hi, spacingPx) {
  const rng = createRng(seed);
  const pts = Array.from({ length: Math.ceil(lengthPx / spacingPx) + 2 }, () => rng.range(lo, hi));
  const out = new Float32Array(lengthPx + 1);
  for (let x = 0; x <= lengthPx; x++) {
    const i = Math.floor(x / spacingPx);
    const t = x / spacingPx - i;
    const s = t * t * (3 - 2 * t);
    out[x] = pts[i] + (pts[i + 1] - pts[i]) * s + Math.sin(x * 0.11) * 1.2 + Math.sin(x * 0.43) * 0.4;
  }
  return out;
}

function buildCloud(rng) {
  const w = Math.round(rng.range(30, 70) * SCALE);
  const h = Math.round(w * rng.range(0.3, 0.45));
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const blobs = Array.from({ length: 8 }, () => ({
    x: rng.range(w * 0.18, w * 0.82),
    y: rng.range(h * 0.45, h * 0.7),
    r: rng.range(h * 0.25, h * 0.55),
  }));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!blobs.some((b) => (x - b.x) ** 2 + ((y - b.y) * 1.6) ** 2 < b.r * b.r)) continue;
      const v = y / h + ((x * 7 + y * 13) % 5) * 0.012; // slight texture in the shading bands
      const shade = v > 0.66 ? [190, 202, 212] : v > 0.52 ? [212, 222, 230] : v > 0.38 ? [232, 238, 243] : [246, 249, 251];
      img.data.set([...shade, 235], (y * w + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

const METAL = new Set(['flak', 'mgNest', 'radar']); // these spark when hit; the rest throw up dust
const BLAST_SIZE = { flak: 0.8, mgNest: 0.5, tent: 0.5, tower: 0.7, building: 1.1, radar: 1.1 };

const hash = (n) => (Math.imul(n | 0, 2654435761) >>> 0) % 997;

export function createRenderer(canvas, world, assets) {
  const out = canvas.getContext('2d');
  const buffer = makeCanvas(Math.ceil(W * MAX_ZOOM * SCALE), Math.ceil(H * MAX_ZOOM * SCALE));
  const ctx = buffer.getContext('2d');
  const hudLayer = makeCanvas(W, H);
  const hud = hudLayer.getContext('2d');

  // Visible world area (world units) and its size in buffer pixels; both grow with zoom.
  let vw = W;
  let vh = H;
  let bw = W * SCALE;
  let bh = H * SCALE;
  let zoom = 1;

  // Match the screen canvas to its displayed size, so the final scale-up is sharp.
  function fitDisplay() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(W * SCALE, Math.round(canvas.clientWidth * dpr));
    const h = Math.round((w * H) / W);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    out.imageSmoothingEnabled = false;
  }

  const map = world.map;
  const sky = buildSky(ctx, map);
  const farRidge = buildRidge(map.seed + 7, Math.ceil((map.width * 0.2 + W * MAX_ZOOM) * SCALE), 70, 190, 90 * SCALE);
  const nearRidge = buildRidge(map.seed + 13, Math.ceil((map.width * 0.45 + W * MAX_ZOOM) * SCALE), 40, 120, 55 * SCALE);
  const cloudRng = createRng(map.seed + 21);
  const clouds = Array.from({ length: 22 }, () => ({
    img: buildCloud(cloudRng),
    x: cloudRng.range(0, map.width * 0.6 + W),
    y: cloudRng.range(220, map.ceiling + 120),
  }));

  const particles = createParticles();
  const radar = createRadar(world, assets.settings.radar);
  let shake = 0; // screen shake strength in buffer pixels, decays quickly
  const cam = { x: 0, y: 0, leadX: 0, leadY: 0, lookX: 0, lookY: 0, lookVX: 0, lookVY: 0, snapped: false };
  const camCfg = assets.settings.camera; // live: the tuning panel edits this object
  let frame = 0;

  // World position -> buffer pixel.
  const toScreenX = (wx) => (wx - cam.x) * SCALE;
  const toScreenY = (wy) => bh - (wy - cam.y) * SCALE;

  // Speed zoom: above zoomStartSpeed the view widens, reaching zoomMax at zoomFullSpeed.
  function updateZoom(focus, dt, widen = 0) {
    let target = 1 + widen;
    if (focus && focus.state === 'air') {
      const span = Math.max(1, camCfg.zoomFullSpeed - camCfg.zoomStartSpeed);
      const t = clamp((focus.speed - camCfg.zoomStartSpeed) / span, 0, 1);
      target = 1 + (camCfg.zoomMax - 1) * t * t * (3 - 2 * t);
    }
    target += camCfg.lookZoom * Math.min(1, Math.hypot(cam.lookX, cam.lookY)); // glancing around widens the view
    const k = cam.snapped ? 1 - Math.exp(-dt * camCfg.zoomSpeed) : 1;
    zoom += (clamp(target, 1, MAX_ZOOM) - zoom) * k;
    bw = Math.round(W * zoom * SCALE);
    bh = Math.round(H * zoom * SCALE);
    vw = bw / SCALE;
    vh = bh / SCALE;
  }

  // The camera looks ahead: the plane sits towards the back of the screen so you see what you're
  // flying into. When the plane turns around, the look-ahead swings smoothly to the other side.
  // Looking around (arrows, or hold right mouse): the camera slides towards where you look, up to
  // lookRange of the view, on top of the look-ahead. Looking back over your tail is limited by the
  // plane's rearView; looking ahead isn't.
  function updateLook(focus, dt, look) {
    const facing = Math.cos(focus.angle) >= 0 ? 1 : -1;
    let tx = look?.active ? look.x : 0;
    const ty = look?.active ? -look.y : 0;
    if (tx * facing < 0) tx *= focus.def.rearView ?? 1;
    // A critically damped spring rather than a straight chase: the head starts turning slowly, builds
    // up and settles, which feels like turning against resistance. lookSpeed is the spring's stiffness.
    const w = camCfg.lookSpeed;
    const step = Math.min(dt, 0.05);
    cam.lookVX += (w * w * (tx - cam.lookX) - 2 * w * cam.lookVX) * step;
    cam.lookVY += (w * w * (ty - cam.lookY) - 2 * w * cam.lookVY) * step;
    cam.lookX += cam.lookVX * step;
    cam.lookY += cam.lookVY * step;
  }

  // free: free look, { x, y, zoom } for the centre of the view; the camera goes where it's sent.
  function updateCamera(focus, dt, look, free) {
    if (free) {
      updateZoom(null, dt, free.zoom - 1);
      cam.x = free.x - vw / 2;
      cam.y = free.y - vh / 2;
      cam.back = { x: cam.x, y: cam.y, k: 1 }; // where to glide back from once free look ends
    } else if (!focus) return;
    if (!free && focus.state !== 'dead') {
      updateLook(focus, dt, look);
      updateZoom(focus, dt);
      // Sideways the view leads where the nose points; up and down it leads along the flight path,
      // so a stalling plane that's sinking nose-up still shows the ground it's falling towards.
      const speed = Math.hypot(focus.vx, focus.vy);
      const climb = speed > 20 ? focus.vy / speed : Math.sin(focus.angle);
      const targetX = Math.cos(focus.angle) * vw * camCfg.leadX;
      const targetY = climb * vh * camCfg.leadY;
      const k = cam.snapped ? 1 - Math.exp(-dt * camCfg.leadSpeed) : 1;
      const ky = cam.snapped ? 1 - Math.exp(-dt * camCfg.leadSpeedY) : 1;
      cam.leadX += (targetX - cam.leadX) * k;
      cam.leadY += (targetY - cam.leadY) * ky;
      // However you look, your own plane stays on screen. Sideways, looking ahead on top of the
      // look-ahead would run into that edge and stop dead, so beyond the normal look-ahead the view
      // eases into the limit instead.
      const margin = 0.08;
      const limit = vw * (0.5 - margin);
      const knee = Math.min(vw * camCfg.leadX, limit * 0.85);
      const off = cam.leadX + cam.lookX * vw * camCfg.lookRange;
      const past = Math.abs(off) - knee;
      const softOff = past <= 0 ? off : Math.sign(off) * (knee + (limit - knee) * Math.tanh(past / (limit - knee)));
      cam.x = focus.x + softOff - vw / 2;
      cam.y = focus.y + cam.leadY + cam.lookY * vh * camCfg.lookRange - vh * camCfg.height;
      cam.x = clamp(cam.x, focus.x - vw * (1 - margin), focus.x - vw * margin);
      cam.y = clamp(cam.y, focus.y - vh * (1 - margin), focus.y - vh * margin);
      cam.snapped = true;
      // Back from free look: glide from where it was over to the plane.
      if (cam.back && cam.back.k > 0.005) {
        cam.x += (cam.back.x - cam.x) * cam.back.k;
        cam.y += (cam.back.y - cam.y) * cam.back.k;
        cam.back.k *= Math.exp(-dt * 4);
      }
    }
    cam.x = clamp(cam.x, 0, map.width - vw);
    cam.y = clamp(cam.y, 0, Math.max(0, map.ceiling + 160 - vh));
    // Snap to whole buffer pixels so the scenery doesn't shimmer.
    cam.x = Math.round(cam.x * SCALE) / SCALE;
    cam.y = Math.round(cam.y * SCALE) / SCALE;
  }

  function drawBackground() {
    sky.pattern.setTransform(new DOMMatrix().translate(0, -(sky.height - cam.y * SCALE - bh)));
    ctx.fillStyle = sky.pattern;
    ctx.fillRect(0, 0, bw, bh);

    for (const c of clouds) {
      const sx = Math.round((c.x - cam.x * 0.6) * SCALE);
      const sy = Math.round(bh - (c.y - cam.y * 0.6) * SCALE);
      if (sx > bw || sx + c.img.width < 0 || sy > bh || sy + c.img.height < 0) continue;
      ctx.drawImage(c.img, sx, sy);
    }

    const ridge = (heights, parallax, colour) => {
      ctx.fillStyle = colour;
      const ox = Math.floor(cam.x * parallax * SCALE);
      for (let x = 0; x < bw; x++) {
        const top = Math.round(bh - (heights[ox + x] - cam.y * parallax) * SCALE);
        if (top < bh) ctx.fillRect(x, top, 1, bh - top);
      }
    };
    ridge(farRidge, 0.2, '#8aa6b6');
    ridge(nearRidge, 0.45, '#7a9a86');
  }

  // Ground, one buffer-pixel column at a time: grass (or runway, or scorched earth), then soil layers.
  function drawTerrain() {
    const t = world.terrain;
    const px0 = Math.round(cam.x * SCALE);
    const col = (x, y, h, colour) => {
      ctx.fillStyle = colour;
      ctx.fillRect(x, y, 1, h);
    };
    for (let x = 0; x < bw; x++) {
      const ix = px0 + x; // absolute buffer-pixel column, stable as the camera moves
      const wx = ix / SCALE;
      const top = Math.round(bh - (t.heightAt(wx) - cam.y) * SCALE);
      if (top >= bh) continue;
      const af = map.airfields.find((a) => wx >= a.x && wx < a.x + a.width);
      const n = hash(ix);
      const scorch = t.scorch[Math.floor(wx)] ?? 0;
      if (af) {
        col(x, top, 1, '#9c9a8e');
        col(x, top + 1, 3, '#8c8a7e');
        if (Math.floor((wx - af.x) / 10) % 2 === 0 && wx > af.x + 20 && wx < af.x + af.width - 20) col(x, top + 1, 1, '#e4e4d4');
        col(x, top + 4, 4, '#6a685e');
      } else if (scorch > 40) {
        const burnt = scorch > 140;
        col(x, top, 1, burnt ? '#3a3128' : '#5c5a34');
        col(x, top + 1, 6, burnt ? '#4a3c2c' : '#5d6a34');
        if (burnt && n % 6 === 0) col(x, top + 2, 1, '#2a231c');
      } else {
        // Grass with the odd tuft poking up, a lit top edge and a darker under-layer.
        if (n % 9 === 0) col(x, top - 1 - (n % 2), 1 + (n % 2), '#7fa548');
        col(x, top, 1, n % 4 === 0 ? '#b4d46c' : '#9ec45c');
        col(x, top + 1, 4 + (n % 3), '#7aa847');
        col(x, top + 5 + (n % 3), 2, '#5f8a38');
      }
      col(x, top + 7, bh - top - 7, '#6b5236');
      col(x, top + 22, bh - top - 22, '#5e4730');
      col(x, top + 44, bh - top - 44, '#513d29');
      if (n % 5 === 0) col(x, top + 10 + (n % 31), 1, '#45341f');
      if (n % 17 === 0) col(x, top + 14 + (n % 23), 2, '#7d6648'); // pebbles
      // River water over the channel bed, with a glinting, rippling surface.
      const river = map.rivers?.find((rv) => wx >= rv.x && wx <= rv.x + rv.width);
      if (river && t.heightAt(wx) < river.water) {
        const wy = Math.round(bh - (river.water - cam.y) * SCALE);
        col(x, wy, top - wy, '#3f6a88');
        col(x, wy + 3, top - wy - 3, '#365d79');
        col(x, wy, 1, (ix + Math.floor(frame / 8)) % 7 < 2 ? '#a8d0e0' : '#6c98b4');
      }
    }
  }

  // Ground objects stand on the ground, sunk in by a pixel. Guns face the enemy's side of the map; their
  // barrels and the radar aerial are drawn here so they can move. A destroyed object leaves a
  // blackened stump of its lower part.
  const groundFlashes = new Map(); // ground object id (soldiers: "id:index") -> frames of muzzle flash left
  const nationOf = (team) => map.airfields.find((a) => a.team === team)?.nation;
  const facingOf = (obj) => obj.dir ?? (obj.x < map.width / 2 ? 1 : -1);
  const spriteCache = new Map();
  // Tanks wear their nation's paint; everything else is drawn as it is.
  function spriteOf(obj) {
    const img = assets.images[obj.def.sprite];
    if (!img || obj.type !== 'tank') return [obj.def.sprite, img];
    const key = `tank|${obj.team}`;
    if (!spriteCache.has(key)) spriteCache.set(key, paintSprite(img, assets.nations[nationOf(obj.team)]?.paint ?? assets.nations.germany.paint));
    return [key, spriteCache.get(key)];
  }
  function flipped(name, img) {
    const key = `${name}|flip`;
    if (!spriteCache.has(key)) {
      const c = makeCanvas(img.width, img.height);
      const g = c.getContext('2d');
      g.scale(-1, 1);
      g.drawImage(img, -img.width, 0);
      spriteCache.set(key, c);
    }
    return spriteCache.get(key);
  }
  function wreckOf(name, img) {
    const key = `${name}|wreck`;
    if (!spriteCache.has(key)) {
      const h = Math.max(6, Math.round(img.height * 0.35));
      const c = makeCanvas(img.width, h);
      const g = c.getContext('2d');
      g.drawImage(img, 0, img.height - h, img.width, h, 0, 0, img.width, h);
      // Broken, jagged top edge, then scorch everything that's left.
      for (let x = 0; x < img.width; x++) g.clearRect(x, 0, 1, hash(x * 31 + h) % Math.ceil(h * 0.6));
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(26,20,16,0.72)';
      g.fillRect(0, 0, img.width, h);
      spriteCache.set(key, c);
    }
    return spriteCache.get(key);
  }

  function drawBarrel(x, y, angle, length, thick, colour) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    ctx.fillStyle = colour;
    for (let k = 0; k <= length; k++) ctx.fillRect(Math.round(x + c * k - thick / 2), Math.round(y - s * k - thick / 2), thick, thick);
  }

  // Radar aerial: a bedstead array turning on the mast, foreshortened as it rotates.
  function drawAerial(x, y, alive) {
    const phase = alive ? performance.now() / 700 : 0.9;
    const w = Math.max(1, Math.round(Math.abs(Math.cos(phase)) * 16));
    ctx.fillStyle = Math.cos(phase) > 0 ? '#a8aca4' : '#5a5e58';
    ctx.fillRect(x - Math.floor(w / 2), y - 8, w, 6);
    ctx.fillStyle = '#3c3e3a';
    for (let k = 0; k < w; k += 3) ctx.fillRect(x - Math.floor(w / 2) + k, y - 8, 1, 6);
    ctx.fillRect(x - Math.floor(w / 2), y - 5, w, 1);
  }

  function drawPennant(x, y, team) {
    const colour = assets.nations[nationOf(team)]?.paint.marking ?? '#c03030';
    ctx.fillStyle = '#3a3026';
    ctx.fillRect(x, y - 10, 1, 10);
    const wave = Math.floor(frame / 12) % 2;
    ctx.fillStyle = colour;
    ctx.fillRect(x + 1, y - 10, 5, 2);
    ctx.fillRect(x + 1, y - 8, 4 - wave, 1 + wave);
  }

  function drawSquad(obj, sx, frameNo) {
    const uniform = assets.nations[nationOf(obj.team)]?.uniform ?? '#6a6e5e';
    const engineers = obj.type === 'engineers';
    obj.soldiers.forEach((s, i) => {
      const wx = obj.x + s.dx;
      const gx = Math.round(toScreenX(wx));
      const gy = Math.round(toScreenY(surfaceAt(world, wx))) + 1;
      if (gx < -10 || gx > bw + 10) return;
      if (s.hp <= 0) {
        // Fallen: lying flat.
        ctx.fillStyle = uniform;
        ctx.fillRect(gx - 3, gy - 2, 5, 2);
        ctx.fillStyle = '#d6a77e';
        ctx.fillRect(gx + 2, gy - 2, 2, 2);
        return;
      }
      const dir = facingOf(obj);
      // Marching: legs stepping in turn. Standing: shuffling feet now and then.
      const step = obj.moving ? Math.floor((frameNo + i * 5) / 7) % 2 : Math.floor((frameNo + i * 13) / 40) % 3 === 0 ? 1 : 0;
      const other = obj.moving ? 1 - step : 0;
      ctx.fillStyle = '#2a2622';
      ctx.fillRect(gx - 1, gy - 3 + other, 1, 3 - other);
      ctx.fillRect(gx + 1, gy - 3 + step, 1, 3 - step);
      ctx.fillStyle = uniform;
      ctx.fillRect(gx - 1, gy - 9, 3, 6);
      ctx.fillStyle = '#d6a77e';
      ctx.fillRect(gx - 1, gy - 11, 2, 2);
      ctx.fillStyle = '#3a3e34'; // helmet
      ctx.fillRect(gx - 2, gy - 12, 4, 1);
      ctx.fillRect(gx - 1, gy - 13, 2, 1);
      // Engineers carry spades, and dig when they're rebuilding a bridge.
      if (engineers) {
        const dig = obj.working ? Math.floor((frameNo + i * 9) / 10) % 2 : 0;
        ctx.fillStyle = '#4a3624';
        for (let k = 0; k < 5; k++) ctx.fillRect(gx + dir * (2 + (dig ? k : 0)), gy - 8 + k + (dig ? 2 : 0), 1, 1);
        ctx.fillStyle = '#8a8e88';
        ctx.fillRect(gx + dir * (2 + (dig ? 5 : 0)), gy - 3 + (dig ? 2 : 0), 2, 2);
        return;
      }
      // Rifle held at the port, or raised at whatever they're shooting at.
      ctx.fillStyle = '#4a3624';
      if (obj.target != null) {
        const c = Math.cos(obj.aim);
        const sn = Math.sin(obj.aim);
        for (let k = 1; k < 7; k++) ctx.fillRect(Math.round(gx + c * k), Math.round(gy - 9 - sn * k), 1, 1);
      } else for (let k = 0; k < 6; k++) ctx.fillRect(gx + dir * (1 + Math.floor(k / 2)), gy - 6 - k, 1, 1);
      if (groundFlashes.get(`${obj.id}:${i}`) > 0) {
        groundFlashes.set(`${obj.id}:${i}`, groundFlashes.get(`${obj.id}:${i}`) - 1);
        ctx.fillStyle = '#ffd060';
        ctx.fillRect(Math.round(gx + Math.cos(obj.aim) * 8) - 1, Math.round(gy - 9 - Math.sin(obj.aim) * 8) - 1, 2, 2);
      }
    });
  }

  const SPAN_DARK = '#3e3428';
  const SPAN_LIGHT = '#6e5c44';
  // A bridge: timber deck on a steel truss with piers into the water. Destroyed, only broken ends
  // hang from the banks; while engineers rebuild it, the deck grows out from both banks.
  function drawBridge(obj) {
    const river = map.rivers?.find((rv) => Math.abs(rv.x + rv.width / 2 - obj.x) < 1);
    if (!river) return;
    const x0 = Math.round(toScreenX(river.x - 3));
    const x1 = Math.round(toScreenX(river.x + river.width + 3));
    const deck = Math.round(toScreenY(river.bank));
    const water = Math.round(toScreenY(river.water));
    const span = x1 - x0;
    ctx.fillStyle = SPAN_DARK;
    if (obj.alive) {
      ctx.fillRect(x0, deck + 1, span, 2);
      // Truss: top chord with diagonals down to the deck.
      const h = 10;
      ctx.fillRect(x0 + 6, deck - h, span - 12, 1);
      for (let k = 0; k + 12 <= span - 12; k += 12) {
        for (let j = 0; j < h; j++) {
          ctx.fillRect(x0 + 6 + k + Math.round((j / h) * 6), deck - h + j, 1, 1);
          ctx.fillRect(x0 + 18 + k - Math.round((j / h) * 6), deck - h + j, 1, 1);
        }
      }
      for (const px of [x0 + Math.round(span / 3), x0 + Math.round((span * 2) / 3)]) ctx.fillRect(px - 1, deck + 3, 3, water - deck + 6);
      ctx.fillStyle = SPAN_LIGHT;
      ctx.fillRect(x0, deck - 1, span, 2);
      return;
    }
    // Broken ends, plus whatever the engineers have put back.
    const built = obj.hp / obj.maxHp;
    const reach = Math.max(8, Math.round((span / 2) * built));
    for (let k = 0; k < reach; k++) {
      const sag = built > 0.02 ? 0 : Math.round(k * 0.5);
      ctx.fillRect(x0 + k, deck - 1 + sag, 1, 3);
      ctx.fillRect(x1 - k, deck - 1 + sag, 1, 3);
    }
    if (built < 0.02) {
      ctx.fillStyle = SPAN_LIGHT;
      for (let k = 0; k < 5; k++) ctx.fillRect(x0 + Math.round(span * (0.3 + k * 0.1)), water - 1 + (k % 2), 4, 2); // wreckage in the water
    }
  }

  // Tank: running tracks while it moves, the gun pointing where it last fired, muzzle flashes.
  // Drawn in the hull's frame (the gun's aim is kept relative to the hull).
  function drawTankDetails(obj, left, top, w, dir) {
    if (obj.moving) {
      ctx.fillStyle = '#2c2e2c';
      const shift = Math.floor(frame / 4) % 4;
      for (let k = shift; k < w - 4; k += 4) {
        const x = dir > 0 ? left + 3 + k : left + w - 4 - k;
        ctx.fillRect(x, top + 13, 2, 1);
        ctx.fillRect(x, top + 19, 2, 1);
      }
    }
    // The roof MG on its pintle, aimed in the world but drawn in the hull's tilted frame.
    if (obj.aa) {
      const ax = dir > 0 ? left + 18 : left + w - 19;
      const aaAim = obj.aa.aim - (obj.tilt ?? 0);
      ctx.fillStyle = '#24261f';
      ctx.fillRect(ax - 1, top - 1, 2, 2);
      drawBarrel(ax, top - 1, aaAim, 7, 1, '#24261f');
      const aaFlash = groundFlashes.get(`${obj.id}:aa`);
      if (aaFlash > 0) {
        groundFlashes.set(`${obj.id}:aa`, aaFlash - 1);
        ctx.fillStyle = '#ffd870';
        ctx.fillRect(Math.round(ax + Math.cos(aaAim) * 8) - 1, Math.round(top - 1 - Math.sin(aaAim) * 8) - 1, 2, 2);
      }
    }
    const px = dir > 0 ? left + 30 : left + w - 31;
    const py = top + 5;
    const aim = obj.gunAim ?? (dir > 0 ? 0 : Math.PI);
    drawBarrel(px, py, aim, 18, 2, '#2e3228');
    const flash = groundFlashes.get(obj.id);
    if (flash > 0) {
      groundFlashes.set(obj.id, flash - 1);
      const fx = Math.round(px + Math.cos(aim) * 20);
      const fy = Math.round(py - Math.sin(aim) * 20);
      ctx.fillStyle = '#ffc850';
      ctx.fillRect(fx - 3, fy - 3, 6, 6);
      ctx.fillStyle = '#fff6c8';
      ctx.fillRect(fx - 1, fy - 1, 3, 3);
    }
  }

  function drawGround() {
    for (const obj of world.ground) {
      const sx = Math.round(toScreenX(obj.x));
      if (sx < -60 || sx > bw + 60) continue;
      if (obj.soldiers) {
        drawSquad(obj, sx, frame);
        continue;
      }
      if (obj.type === 'bridge') {
        drawBridge(obj);
        continue;
      }
      const [name, img] = spriteOf(obj);
      if (!img) continue;
      const sy = Math.round(toScreenY(surfaceAt(world, obj.x))) + 2;
      const left = sx - Math.round(img.width / 2);
      const dir = facingOf(obj);
      const turns = obj.type === 'flak' || obj.type === 'mgNest' || obj.type === 'tank';
      const gun = obj.type === 'flak' || obj.type === 'mgNest';
      if (obj.type === 'tank') {
        // Drawn in the hull's own frame: turned about the middle of the tracks to the ground's slope.
        const tilt = obj.tilt ?? 0;
        const by = Math.round(toScreenY(obj.baseY ?? surfaceAt(world, obj.x))) + 2;
        const sprite = obj.alive ? img : wreckOf(name, img);
        ctx.save();
        ctx.translate(sx, by);
        ctx.rotate(-tilt);
        const l = -Math.round(img.width / 2);
        ctx.drawImage(dir < 0 ? flipped(obj.alive ? name : `${name}|wreck`, sprite) : sprite, l, -sprite.height);
        if (obj.alive) drawTankDetails(obj, l, -img.height, img.width, dir);
        ctx.restore();
        continue;
      }
      if (!obj.alive) {
        const w = wreckOf(name, img);
        ctx.drawImage(turns && dir < 0 ? flipped(`${name}|wreck`, w) : w, left, sy - w.height);
        continue;
      }
      ctx.drawImage(turns && dir < 0 ? flipped(name, img) : img, left, sy - img.height);
      const top = sy - img.height;
      // Barrel pivots, measured on the right-facing sprite.
      const pivot = (px) => (dir > 0 ? left + px : left + img.width - 1 - px);
      const aim = obj.aim ?? (dir > 0 ? 0.8 : Math.PI - 0.8); // resting elevation until it has a target
      if (obj.type === 'flak') drawBarrel(pivot(14), top + 6, aim, 20, 3, '#3e4630');
      if (obj.type === 'mgNest') drawBarrel(pivot(13), top + 2, aim, 9, 1, '#24261f');
      const flash = groundFlashes.get(obj.id);
      if (gun && flash > 0) {
        groundFlashes.set(obj.id, flash - 1);
        const [px, py, len, r] = obj.type === 'flak' ? [pivot(14), top + 6, 22, 3] : [pivot(13), top + 2, 11, 2];
        const fx = Math.round(px + Math.cos(aim) * len);
        const fy = Math.round(py - Math.sin(aim) * len);
        ctx.fillStyle = '#ffc850';
        ctx.fillRect(fx - r, fy - r, r * 2, r * 2);
        ctx.fillStyle = '#fff6c8';
        ctx.fillRect(fx - 1, fy - 1, 2, 2);
      }
      if (obj.type === 'radar') drawAerial(left + 26, top + 5, true);
      if (obj.type === 'tower') drawPennant(left + 10, top, obj.team);
    }
  }

  // Damaged objects smoke; wrecks burn, then smoulder for a while.
  function emitGroundEffects(dt) {
    for (const obj of world.ground) {
      if (obj.soldiers || obj.type === 'bridge') continue;
      const gy = surfaceAt(world, obj.x);
      if (obj.alive) {
        const hurt = 1 - obj.hp / obj.maxHp;
        if (hurt > 0.5 && Math.random() < (hurt - 0.4) * dt * 6) {
          particles.spawn('smoke', obj.x + (Math.random() - 0.5) * obj.def.width * 0.6, gy + obj.def.height * 0.7, 0, 6, 1.6 + Math.random(), 1.2);
        }
        continue;
      }
      const age = (world.tick - obj.wreckedAt) / 60;
      if (age > 30) continue;
      if (Math.random() < (1 - age / 30) * dt * 14) {
        particles.spawn('blacksmoke', obj.x + (Math.random() - 0.5) * obj.def.width * 0.6, gy + 3, (Math.random() - 0.5) * 3, 8, 2 + Math.random() * 1.5, 1.6);
      }
      if (age < 8 && Math.random() < dt * 30) {
        particles.spawn('fire', obj.x + (Math.random() - 0.5) * obj.def.width * 0.7, gy + 2, 0, 10, 0.3 + Math.random() * 0.4, 1.5);
      }
    }
  }

  // Taildraggers sit tail-down on the ground: tilted nose-up about the main wheels until the tail wheel
  // touches. As the take-off roll picks up speed the tail lifts, and the plane rolls level from about
  // tailUpSpeed (share of take-off speed). Visual only; the simulation keeps the plane level.
  const MAIN_WHEEL_BOTTOM = [3.5, -3.6 - 1.4];
  const TAIL_WHEEL_BOTTOM = [-10.5, -1.6 - 0.8];
  const TAIL_DOWN = Math.atan2(TAIL_WHEEL_BOTTOM[1] - MAIN_WHEEL_BOTTOM[1], MAIN_WHEEL_BOTTOM[0] - TAIL_WHEEL_BOTTOM[0]);
  const tilts = new Map(); // plane id -> current tail-down tilt (radians), eased
  let frameDt = 1 / 60;

  function groundAttitude(p) {
    let target = 0;
    if (p.state === 'ground' && !p.belly && p.gear >= 1) {
      const t = clamp(p.speed / (p.def.takeoffSpeed * (p.def.tailUpSpeed ?? 0.85)), 0, 1);
      target = TAIL_DOWN * (1 - t * t * (3 - 2 * t));
    }
    let tilt = tilts.get(p.id) ?? target;
    tilt += (target - tilt) * Math.min(1, frameDt * 3.5);
    tilts.set(p.id, tilt);
    if (Math.abs(tilt) < 0.001) return { angle: p.angle, x: p.x, y: p.y };
    // Rotate nose-up about the main wheel's contact point, so the main wheels stay on the ground.
    const angle = p.angle + (Math.cos(p.angle) >= 0 ? tilt : -tilt);
    const f = p.inverted ? -1 : 1;
    const [mx, my] = MAIN_WHEEL_BOTTOM;
    const off = (a) => [Math.cos(a) * mx - Math.sin(a) * my * f, Math.sin(a) * mx + Math.cos(a) * my * f];
    const [ox, oy] = off(p.angle);
    const [nx, ny] = off(angle);
    return { angle, x: p.x + ox - nx, y: p.y + oy - ny };
  }

  function drawPlane(p) {
    if (p.state === 'dead') return;
    const set = assets.planeSprite(p)[p.inverted ? 'inverted' : 'upright'];
    const view = groundAttitude(p);
    const sx = Math.round(toScreenX(view.x));
    const sy = Math.round(toScreenY(view.y));
    drawGear(p, sx, sy, view.angle);
    ctx.drawImage(set.frames[frameIndex(view.angle)], sx - set.radius, sy - set.radius);
    drawMuzzleFlash(p, sx, sy, view.angle);

    // Propeller disc: a flickering line across the nose.
    const c = Math.cos(view.angle);
    const s = Math.sin(view.angle);
    const r = (p.def.noseOffset[0] + 0.5) * SCALE;
    const px = sx + c * r;
    const py = sy - s * r;
    const spin = Math.floor(frame * (p.rpm / 400));
    const reach = 4 * SCALE + 1;
    for (let k = -reach; k <= reach; k++) {
      if ((k + spin) % 3 === 0) continue;
      ctx.fillStyle = Math.abs(k) > reach - 2 ? 'rgba(225,225,215,0.3)' : 'rgba(225,225,215,0.5)';
      ctx.fillRect(Math.round(px + s * k), Math.round(py + c * k), 1, 1);
    }
  }

  // Main wheels and tail wheel. They're drawn behind the plane, so as the gear retracts (p.gear 1 -> 0)
  // the wheels slide up along their legs and disappear into the wing and fuselage.
  const GEAR = [
    { leg: [3, -2], wheel: [3.5, -3.6], stowed: [3.5, -0.8], r: 1.4 },
    { leg: [-10, -0.5], wheel: [-10.5, -1.6], stowed: [-10.5, -0.1], r: 0.8, tail: true },
  ];
  function drawGear(p, sx, sy, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const f = p.inverted ? -1 : 1;
    const at = ([lx, ly]) => [sx + (c * lx - s * ly * f) * SCALE, sy - (s * lx + c * ly * f) * SCALE];
    for (const g of GEAR) {
      const out = g.tail && p.def.fixedTailWheel ? 1 : p.gear;
      if (out <= 0.02) continue;
      const e = out * out * (3 - 2 * out); // ease in and out
      const [ax, ay] = at(g.leg);
      const [bx, by] = at([g.stowed[0] + (g.wheel[0] - g.stowed[0]) * e, g.stowed[1] + (g.wheel[1] - g.stowed[1]) * e]);
      ctx.fillStyle = '#3a3a36';
      for (let t = 0; t <= 1; t += 0.25) ctx.fillRect(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t), 1, 1);
      // Round pixel tyre with a lighter hub.
      const cx = Math.round(bx);
      const cy = Math.round(by);
      const r = g.r * SCALE + 0.5;
      for (let dy = -Math.ceil(r); dy <= Math.ceil(r); dy++) {
        for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
          const d2 = dx * dx + dy * dy;
          if (d2 > r * r) continue;
          ctx.fillStyle = d2 <= (r * 0.45) ** 2 ? '#8a8a82' : d2 <= (r * 0.6) ** 2 ? '#4a4844' : '#1e1c1a';
          ctx.fillRect(cx + dx, cy + dy, 1, 1);
        }
      }
    }
  }

  // Ground crew: two mechanics walk out from the hangar side and work at the nose and the wing.
  const CREW = [
    { at: 9, from: -34, overalls: '#3c4a5c', bob: 0 },
    { at: -3, from: -46, overalls: '#5a5446', bob: 7 },
  ];
  function drawCrew(p) {
    const s = p.service;
    if (!s || s.phase === 'done' || p.state !== 'ground') return;
    const dir = Math.cos(p.angle) >= 0 ? 1 : -1;
    const walk = s.wait > 0 ? 1 - s.wait / world.servicing.crewDelay : 1;
    for (const c of CREW) {
      const wx = p.x + dir * (c.at + (c.from - c.at) * (1 - walk));
      const gx = Math.round(toScreenX(wx));
      const gy = Math.round(toScreenY(world.terrain.heightAt(wx)));
      const walking = walk < 1;
      const step = Math.floor((frame + c.bob) / 6) % 2;
      const working = !walking && Math.floor((frame + c.bob) / 10) % 2; // arm moving at the job
      // legs
      ctx.fillStyle = '#2a2622';
      ctx.fillRect(gx - 1, gy - 3, 1, 3 - (walking && step ? 1 : 0));
      ctx.fillRect(gx + 1, gy - 3, 1, 3 - (walking && !step ? 1 : 0));
      // overalls
      ctx.fillStyle = c.overalls;
      ctx.fillRect(gx - 1, gy - 8, 3, 5);
      // arm reaching towards the plane while working
      const toward = -Math.sign(dir * c.at);
      ctx.fillRect(gx + toward * 2, gy - 7 - (working ? 1 : 0), 1, 2);
      // head and cap
      ctx.fillStyle = '#d6a77e';
      ctx.fillRect(gx - 1, gy - 10, 2, 2);
      ctx.fillStyle = '#26221e';
      ctx.fillRect(gx - 1, gy - 11, 3, 1);
    }
  }

  // The last flight's damage report, frozen when the focused plane is lost. Shown while it's down
  // and for settings.hud.lastFlightTime seconds after it respawns, fading at the end.
  let lastFlight = null;
  const hudCfg = assets.settings.hud;

  const flashes = new Map(); // plane id -> frames of muzzle flash left
  const messages = [];

  function drawMuzzleFlash(p, sx, sy, angle) {
    const f = flashes.get(p.id);
    if (!f) return;
    flashes.set(p.id, f - 1);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r = (p.def.noseOffset[0] + 3) * SCALE;
    const fx = Math.round(sx + c * r);
    const fy = Math.round(sy - s * r);
    ctx.fillStyle = '#ffc850';
    ctx.fillRect(fx - 2, fy - 2, 4 + (f % 2), 4);
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(fx - 1, fy - 1, 2, 2);
  }

  function drawProjectiles() {
    for (const b of world.bullets) {
      const sx = toScreenX(b.x);
      const sy = toScreenY(b.y);
      if (sx < -10 || sx > bw + 10 || sy < -10 || sy > bh + 10) continue;
      // Drawn for contrast against a pale sky: tracers are thick orange streaks with a white-hot head
      // and a dark edge; ordinary rounds are short dark streaks.
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const dx = -b.vx / sp;
      const dy = b.vy / sp;
      const len = (b.tracer ? 6 : 3) * SCALE;
      const dot = (k, size, colour) => {
        ctx.fillStyle = colour;
        ctx.fillRect(Math.round(sx + dx * k - size / 2), Math.round(sy + dy * k - size / 2), size, size);
      };
      if (b.tracer) {
        for (let k = 0; k < len; k += 1) dot(k, 3, 'rgba(70,24,0,0.45)');
        for (let k = 0; k < len; k += 1) {
          const t = k / len;
          dot(k, 2, t < 0.15 ? '#fffbe8' : t < 0.45 ? '#ffc040' : t < 0.75 ? '#ff8420' : 'rgba(230,80,20,0.7)');
        }
      } else {
        for (let k = 0; k < len; k += 1) dot(k, 2, k < len / 2 ? 'rgba(40,34,26,0.9)' : 'rgba(40,34,26,0.45)');
      }
    }
    ctx.fillStyle = '#2a2824';
    for (const s of world.tankShells ?? []) ctx.fillRect(Math.round(toScreenX(s.x)) - 1, Math.round(toScreenY(s.y)) - 1, 3, 2);
    for (const s of world.shells) ctx.fillRect(Math.round(toScreenX(s.x)) - 1, Math.round(toScreenY(s.y)) - 1, 2, 2);
    for (const b of world.bombsInFlight) {
      const set = assets.bombSprite;
      const f = set.frames[frameIndex(Math.atan2(b.vy, b.vx))];
      ctx.drawImage(f, Math.round(toScreenX(b.x)) - set.radius, Math.round(toScreenY(b.y)) - set.radius);
    }
  }

  function drawMessages() {
    const now = performance.now();
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].until < now) messages.splice(i, 1);
    messages.slice(-4).forEach((m, i) => {
      hud.globalAlpha = Math.min(1, (m.until - now) / 600);
      const w = m.text.length * 4;
      drawText(hud, m.text, W - w - 6, 22 + i * 8, m.colour);
      hud.globalAlpha = 1;
    });
  }

  function emitEffects(p, dt) {
    if (p.state === 'dead') return;
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    const [ex, ey] = p.def.exhaustOffset;
    const flip = p.inverted ? -1 : 1;
    const wx = p.x + c * ex - s * ey * flip;
    const wy = p.y + s * ex + c * ey * flip;
    if (Math.random() < p.load * 0.5 * dt * 60) {
      particles.spawn('exhaust', wx, wy, p.vx * 0.2 - c * 12, p.vy * 0.2 - s * 12, 0.5 + Math.random() * 0.4, 0.6);
    }
    // Damage: grey smoke when hurt, black smoke and flames when burning or badly hit.
    const hurt = 1 - p.hp / p.def.hp;
    if (hurt > 0.35 && Math.random() < hurt * 0.9 * dt * 60) {
      const kind = p.burning || hurt > 0.7 ? 'blacksmoke' : 'smoke';
      particles.spawn(kind, wx, wy, p.vx * 0.1, p.vy * 0.1 + 4, 1.2 + Math.random(), 1.2);
    }
    // Flames grow as the fire takes hold.
    const stage = p.dying ? 1 : fireStage(world, p);
    if (p.burning && Math.random() < (0.5 + 1.3 * stage) * dt * 60) {
      const size = 1.2 + stage * 1.6;
      particles.spawn('fire', wx + (Math.random() - 0.5) * (3 + stage * 5), wy, p.vx * 0.3, p.vy * 0.3, 0.15 + Math.random() * (0.25 + stage * 0.3), size);
    }
    if (p.state === 'ground' && p.belly && p.speed > 3) {
      for (let i = 0; i < 3; i++) particles.spawn('spark', p.x - c * (2 + Math.random() * 8), p.y - 2.5, -c * p.speed * (0.2 + Math.random() * 0.4), 10 + Math.random() * 30, 0.15 + Math.random() * 0.25, 0.5);
      if (Math.random() < 0.7) particles.spawn('dust', p.x - c * 8, p.y - 2, -c * p.speed * 0.2, 5 + Math.random() * 10, 0.8 + Math.random(), 1.2);
    }
    if (p.state === 'ground' && p.speed > 12 && Math.random() < p.speed / 120) {
      particles.spawn('dust', p.x - c * 6, p.y - 3, -c * p.speed * 0.15, 6 + Math.random() * 8, 0.6 + Math.random() * 0.6, 0.8);
    }
  }

  return {
    cam,
    particles,
    get radar() {
      return radar;
    },
    get radarSweeps() {
      return radar.sweeps;
    },
    get zoom() {
      return zoom;
    },
    get zoom() {
      return zoom;
    },
    // World point at the centre of the view (where the ears go when no plane is focused).
    centre() {
      return { x: cam.x + vw / 2, y: cam.y + vh / 2 };
    },
    shake(amount) {
      shake = Math.max(shake, amount);
    },
    // Freeze the damage report of a plane that has just been lost, headed by what brought it down.
    recordLastFlight(plane, cause) {
      lastFlight = { lines: damageLines(plane).filter(([t]) => t !== 'ENGINE DEAD'), cause, until: null };
    },
    startLastFlightTimer() {
      if (lastFlight) lastFlight.until = performance.now() + hudCfg.lastFlightTime * 1000;
    },
    message(text, colour = '#f0e8c0') {
      messages.push({ text, colour, until: performance.now() + 3500 });
    },
    onEvent(e) {
      if (e.type === 'crash') particles.explosion(e.x, e.y, 1);
      if (e.type === 'shot') flashes.set(e.plane, 2);
      if (e.type === 'hit') particles.sparks(e.x, e.y, 3 + Math.min(6, e.damage));
      if (e.type === 'impact' && Math.random() < 0.5) particles.spawn('dust', e.x, e.y + 1, (Math.random() - 0.5) * 20, 15 + Math.random() * 20, 0.4, 0.6);
      if (e.type === 'explosion') {
        const onGround = e.y - world.terrain.heightAt(e.x) < 6;
        particles.explosion(e.x, e.y, 1.3);
        if (onGround) particles.dirtSpray(e.x, e.y, 1.2);
      }
      if (e.type === 'shotDown') particles.explosion(e.x, e.y, 0.5);
      if (e.type === 'groundHit') {
        if (METAL.has(e.kind)) particles.sparks(e.x, e.y, 2 + Math.min(4, e.damage));
        else particles.spawn('dust', e.x, e.y, (Math.random() - 0.5) * 16, 10 + Math.random() * 12, 0.4, 0.6);
      }
      if (e.type === 'groundDestroyed') {
        particles.explosion(e.x, e.y, BLAST_SIZE[e.kind] ?? 0.6);
        particles.dirtSpray(e.x, e.y, 0.6);
      }
      if (e.type === 'flakFire') {
        groundFlashes.set(e.id, 4);
        for (let i = 0; i < 6; i++) particles.spawn('smoke', e.x, e.y, Math.cos(e.angle) * 20 + (Math.random() - 0.5) * 10, Math.sin(e.angle) * 20, 0.8 + Math.random() * 0.6, 1.4);
      }
      if (e.type === 'tankFire') {
        groundFlashes.set(e.id, 3);
        for (let i = 0; i < 8; i++) particles.spawn('smoke', e.x, e.y, Math.cos(e.angle) * 25 + (Math.random() - 0.5) * 12, Math.sin(e.angle) * 25 + Math.random() * 6, 0.8 + Math.random() * 0.8, 1.6);
      }
      if (e.type === 'tankShellBurst') {
        particles.explosion(e.x, e.y, 0.3);
        particles.dirtSpray(e.x, e.y, 0.35);
      }
      if (e.type === 'groundShot') {
        const obj = world.ground.find((o) => o.id === e.id);
        if (obj?.soldiers) {
          const i = obj.soldiers.findIndex((s) => Math.abs(obj.x + s.dx - e.x) < 0.5);
          groundFlashes.set(`${e.id}:${i}`, 2);
        } else groundFlashes.set(e.mount ? `${e.id}:${e.mount}` : e.id, 2);
      }
      // A flak burst: a flash, then a black puff that hangs in the air.
      if (e.type === 'flakBurst') {
        for (let i = 0; i < 8; i++) particles.spawn('fire', e.x, e.y, (Math.random() - 0.5) * 40, (Math.random() - 0.5) * 40, 0.08 + Math.random() * 0.12, 2);
        for (let i = 0; i < 14; i++) {
          const a = Math.random() * Math.PI * 2;
          const s = Math.random() * 9;
          particles.spawn('flakpuff', e.x + Math.cos(a) * 2, e.y + Math.sin(a) * 2, Math.cos(a) * s, Math.sin(a) * s, 2.5 + Math.random() * 2, 2 + Math.random() * 1.5);
        }
        particles.sparks(e.x, e.y, 8);
      }
      if (e.type === 'shrapnel') particles.sparks(e.x, e.y, 3 + Math.min(6, e.damage / 3));
      if (e.type === 'soldierKilled') particles.spawn('dust', e.x, e.y + 2, 0, 8, 0.5, 0.7);
      if (e.type === 'collision') {
        if (e.severity === 'fatal') particles.explosion(e.x, e.y, 1.2);
        else if (e.severity === 'hard') {
          particles.sparks(e.x, e.y, 20);
          particles.explosion(e.x, e.y, 0.25);
        } else particles.sparks(e.x, e.y, 8);
      }
      if (e.type === 'bellyLanding') {
        particles.sparks(e.x, e.y - 2, 14);
        particles.dirtSpray(e.x, e.y - 2, 0.4);
      }
      if (e.type === 'touchdown' && e.speed > 40) {
        for (let i = 0; i < 6; i++) particles.spawn('dust', e.x, e.y - 3, (Math.random() - 0.5) * 30, 8, 0.8, 0.8);
      }
    },
    render(focus, dt, { showHelp, look, free, paused }) {
      frame++;
      frameDt = dt;
      fitDisplay();
      updateCamera(focus, dt, look, free);
      for (const p of world.planes) emitEffects(p, dt);
      emitGroundEffects(dt);
      particles.update(dt, world.terrain);

      drawBackground();
      drawTerrain();
      drawGround();
      particles.draw(ctx, toScreenX, toScreenY, SCALE);
      drawProjectiles();
      for (const p of world.planes) drawPlane(p);
      for (const p of world.planes) drawCrew(p);

      if (focus && focus.consciousness < 1) {
        ctx.fillStyle = `rgba(16,0,0,${((1 - focus.consciousness) * 0.88).toFixed(3)})`;
        ctx.fillRect(0, 0, bw, bh);
      }
      hud.clearRect(0, 0, W, H);
      let shownFlight = null;
      if (lastFlight) {
        const left = lastFlight.until === null ? Infinity : lastFlight.until - performance.now();
        if (left <= 0) lastFlight = null;
        else shownFlight = { ...lastFlight, alpha: Math.min(1, left / 1500) };
      }
      drawHud(hud, world, focus, W, H, { showHelp, lastFlight: shownFlight });
      drawMessages();
      const banner = (text, y, colour) => drawText(hud, text, Math.round((W - textWidth(text)) / 2), y, colour);
      if (free) {
        banner('FREE LOOK  ARROWS MOVE (SHIFT FAST)  WHEEL ZOOM  V BACK TO THE PLANE', 96, '#f0e8c0');
        banner(`1 FRONT  2 BRIDGE  3 YOUR PLANE   W/S SPEED: ${free.speed}X`, 104, free.speed > 1 ? '#ffd870' : '#f0e8c0');
      }
      if (paused) banner('PAUSED - P TO RESUME', 124, '#f0f0e0');
      // Under the scope: the state of your own radar, then whether you're under the enemy's.
      const labels = [];
      if (radar.health <= 0) {
        if (Math.floor(performance.now() / 500) % 2) labels.push(['NO SIGNAL - RADAR STATION LOST', '#ff7050']);
        else labels.push(['', '']);
      } else if (radar.health < 1) labels.push(['RADAR DAMAGED', '#e8b060']);
      if (focus && radar.belowRadar(focus)) labels.push(['BELOW RADAR', '#8fe8a0']);
      labels.forEach(([label, colour], i) => {
        if (label) drawText(hud, label, SCOPE.x + Math.round((SCOPE.w - textWidth(label)) / 2), SCOPE.y + SCOPE.h + 2 + i * 7, colour);
      });
      radar.update(dt, focus);

      const k = canvas.width / bw;
      const ox = shake > 0.2 ? (Math.random() - 0.5) * 2 * shake * k : 0;
      const oy = shake > 0.2 ? (Math.random() - 0.5) * 2 * shake * k : 0;
      shake *= Math.exp(-dt * 7);
      if (ox || oy) {
        out.fillStyle = '#000';
        out.fillRect(0, 0, canvas.width, canvas.height);
      }
      out.drawImage(buffer, 0, 0, bw, bh, ox, oy, canvas.width, canvas.height);
      out.drawImage(hudLayer, 0, 0, canvas.width, canvas.height);
      // The radar scope is scaled up smoothly for a soft phosphor glow.
      const hk = canvas.width / W;
      out.imageSmoothingEnabled = true;
      out.drawImage(radar.draw(performance.now() / 1000), SCOPE.x * hk, SCOPE.y * hk, SCOPE.w * hk, SCOPE.h * hk);
      out.imageSmoothingEnabled = false;
    },
  };
}

// Draws the world into a low-resolution pixel buffer, then scales it up onto the screen with crisp pixels.
//
// World units vs pixels: the simulation measures everything in world units (480 x 270 of them fill
// the screen at normal zoom). The renderer draws SCALE buffer pixels per world unit, so sprites and
// terrain have SCALE x the detail without changing any gameplay numbers.
// The visible area grows with speed zoom. The HUD has its own fixed 480x270 layer so text stays put.
// Reads simulation state only; never changes it.
import { createRng, clamp } from '../sim/math.js';
import { frameIndex } from './sprites.js';
import { drawHud } from './hud.js';
import { createParticles } from './particles.js';
import { drawText, textWidth } from './font.js';
import { createRadar, SCOPE } from './radar.js';

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
  const cam = { x: 0, y: 0, leadX: 0, leadY: 0, snapped: false };
  const camCfg = assets.settings.camera; // live: the tuning panel edits this object
  let frame = 0;

  // World position -> buffer pixel.
  const toScreenX = (wx) => (wx - cam.x) * SCALE;
  const toScreenY = (wy) => bh - (wy - cam.y) * SCALE;

  // Speed zoom: above zoomStartSpeed the view widens, reaching zoomMax at zoomFullSpeed.
  function updateZoom(focus, dt) {
    let target = 1;
    if (focus && focus.state === 'air') {
      const span = Math.max(1, camCfg.zoomFullSpeed - camCfg.zoomStartSpeed);
      const t = clamp((focus.speed - camCfg.zoomStartSpeed) / span, 0, 1);
      target = 1 + (camCfg.zoomMax - 1) * t * t * (3 - 2 * t);
    }
    const k = cam.snapped ? 1 - Math.exp(-dt * camCfg.zoomSpeed) : 1;
    zoom += (clamp(target, 1, MAX_ZOOM) - zoom) * k;
    bw = Math.round(W * zoom * SCALE);
    bh = Math.round(H * zoom * SCALE);
    vw = bw / SCALE;
    vh = bh / SCALE;
  }

  // The camera looks ahead: the plane sits towards the back of the screen so you see what you're
  // flying into. When the plane turns around, the look-ahead swings smoothly to the other side.
  function updateCamera(focus, dt) {
    if (!focus) return;
    if (focus.state !== 'dead') {
      updateZoom(focus, dt);
      const targetX = Math.cos(focus.angle) * vw * camCfg.leadX;
      const targetY = Math.sin(focus.angle) * vh * camCfg.leadY;
      const k = cam.snapped ? 1 - Math.exp(-dt * camCfg.leadSpeed) : 1;
      cam.leadX += (targetX - cam.leadX) * k;
      cam.leadY += (targetY - cam.leadY) * k;
      cam.x = focus.x + cam.leadX - vw / 2;
      cam.y = focus.y + cam.leadY - vh * camCfg.height;
      cam.snapped = true;
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
    }
  }

  function drawAirfieldBuildings() {
    const img = assets.images.hangar;
    const widthUnits = img.width / SCALE;
    for (const af of map.airfields) {
      const leftSide = af.x + af.width / 2 < map.width / 2;
      const hx = leftSide ? af.x + 4 : af.x + af.width - widthUnits - 4;
      const sx = Math.round(toScreenX(hx));
      if (sx > bw || sx + img.width < 0) continue;
      ctx.drawImage(img, sx, Math.round(toScreenY(af.height)) - img.height + 2);
    }
  }

  function drawPlane(p) {
    if (p.state === 'dead') return;
    const set = assets.planeSprite(p)[p.inverted ? 'inverted' : 'upright'];
    const sx = Math.round(toScreenX(p.x));
    const sy = Math.round(toScreenY(p.y));
    drawGear(p, sx, sy);
    ctx.drawImage(set.frames[frameIndex(p.angle)], sx - set.radius, sy - set.radius);
    drawMuzzleFlash(p, sx, sy);

    // Propeller disc: a flickering line across the nose.
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
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
  function drawGear(p, sx, sy) {
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
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

  const flashes = new Map(); // plane id -> frames of muzzle flash left
  const messages = [];

  function drawMuzzleFlash(p, sx, sy) {
    const f = flashes.get(p.id);
    if (!f) return;
    flashes.set(p.id, f - 1);
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
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
    if (p.burning && Math.random() < 0.8 * dt * 60) {
      particles.spawn('fire', wx + (Math.random() - 0.5) * 3, wy, p.vx * 0.3, p.vy * 0.3, 0.15 + Math.random() * 0.25, 1.5);
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
    // World point at the centre of the view (where the ears go when no plane is focused).
    centre() {
      return { x: cam.x + vw / 2, y: cam.y + vh / 2 };
    },
    shake(amount) {
      shake = Math.max(shake, amount);
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
    render(focus, dt, { showHelp }) {
      frame++;
      fitDisplay();
      updateCamera(focus, dt);
      for (const p of world.planes) emitEffects(p, dt);
      particles.update(dt, world.terrain);

      drawBackground();
      drawTerrain();
      drawAirfieldBuildings();
      particles.draw(ctx, toScreenX, toScreenY, SCALE);
      drawProjectiles();
      for (const p of world.planes) drawPlane(p);
      for (const p of world.planes) drawCrew(p);

      if (focus && focus.consciousness < 1) {
        ctx.fillStyle = `rgba(16,0,0,${((1 - focus.consciousness) * 0.88).toFixed(3)})`;
        ctx.fillRect(0, 0, bw, bh);
      }
      hud.clearRect(0, 0, W, H);
      drawHud(hud, world, focus, W, H, { showHelp });
      drawMessages();
      if (focus && radar.belowRadar(focus)) {
        const label = 'BELOW RADAR';
        drawText(hud, label, SCOPE.x + Math.round((SCOPE.w - textWidth(label)) / 2), SCOPE.y + SCOPE.h + 2, '#8fe8a0');
      }
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

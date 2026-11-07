// Draws the world into a low-resolution pixel buffer, then scales it up onto the screen with crisp pixels.
//
// World units vs pixels: the simulation measures everything in world units (480 x 270 of them fill
// the screen at normal zoom). The renderer draws SCALE buffer pixels per world unit, so sprites and
// terrain have SCALE x the detail without changing any gameplay numbers.
// The buffer itself has DETAIL x finer pixels: planes are drawn at that full detail (SCALE * DETAIL
// pixels per world unit, so their outline fits), everything else through a DETAIL x transform, so it
// looks just as it did. The visible area grows with speed zoom. The HUD has its own fixed 480x270 layer so text stays put.
// Reads simulation state only; never changes it.
import { createRng, clamp } from '../sim/math.js';
import { frameIndex, paintSprite } from './sprites.js';
import { drawHud, damageLines } from './hud.js';
import { createParticles } from './particles.js';
import { createGore } from './gore.js';
import { drawText, textWidth, lineHeight, setTextSize } from './font.js';
import { createRadar, SCOPE, PHOSPHOR } from './radar.js';
import { frameFight } from './fight-cam.js';
import { playerZoom, wheelRange } from './player-zoom.js';
import { prof } from '../ui/perfstats.js';
import { fireStage } from '../sim/fire.js';
import { drawSightShape } from './sight.js';
import { surfaceAt } from '../sim/ground.js';
import { localToWorld } from '../sim/weapons.js';
import { attitude, mainWheelContact, isUpright, wheelGeometry, DEFAULT_WHEELS } from '../sim/plane.js';

export const W = 480; // view width in world units at zoom 1
export const H = 270;
export const SCALE = 2; // pixels per world unit for scenery, ground sprites and effects
export const DETAIL = 2; // buffer pixels per scenery pixel
export const PLANE_SCALE = SCALE * DETAIL; // buffer pixels per world unit for planes (their sprites are drawn at this)
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
      // Dull overcast grey, darker underneath: a grim sky.
      const shade = v > 0.66 ? [110, 116, 120] : v > 0.52 ? [128, 134, 138] : v > 0.38 ? [145, 150, 153] : [157, 163, 166];
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
  const buffer = makeCanvas(Math.ceil(W * MAX_ZOOM * SCALE * DETAIL), Math.ceil(H * MAX_ZOOM * SCALE * DETAIL));
  const ctx = buffer.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  // The HUD is drawn straight onto the screen at its full resolution, laid out in 480x270 units.
  const hud = out;

  // Visible world area (world units) and its size in buffer pixels; both grow with zoom.
  let vw = W;
  let vh = H;
  let bw = W * SCALE;
  let bh = H * SCALE;
  let zoom = 1; // what is drawn: autoZoom with the player's wheel factor on top
  let autoZoom = 1; // the camera's own zoom (speed, dogfight, looking around)

  // Test switch for finding what costs frames: ?skip=sky,terrain,ground,planes,hud,radar,present
  // leaves those out.
  const skip = new Set((new URLSearchParams(location.search).get('skip') ?? '').split(','));

  // Match the screen canvas to its displayed size, so the final scale-up is sharp.
  function fitDisplay() {
    const dpr = window.devicePixelRatio || 1;
    // Test switch: ?cap=1080 limits the screen canvas to 1920x1080 (the browser stretches it).
    const cap = Number(new URLSearchParams(location.search).get('cap')) * 16 / 9 || Infinity;
    const w = Math.max(W * SCALE, Math.min(cap, Math.round(canvas.clientWidth * dpr)));
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
  const cam = { x: 0, y: 0, leadX: 0, leadY: 0, lookX: 0, lookY: 0, lookVX: 0, lookVY: 0, snapped: false, fight: 0, fightHold: 0, fightX: 0, fightY: 0, fightZoom: 1, wheel: 1, wheelV: 0, wheelTarget: 1, wasAir: false, wasDown: false, rest: 0, restX: 0, turnStart: null, turnLead: 0 };
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
      target = Math.max(target, 1 + (cam.fightZoom - 1) * cam.fight); // whichever shows more, not both
    }
    target += camCfg.lookZoom * Math.min(1, Math.hypot(cam.lookX, cam.lookY)); // glancing around widens the view
    const k = cam.snapped ? 1 - Math.exp(-dt * camCfg.zoomSpeed) : 1;
    autoZoom += (clamp(target, 1, MAX_ZOOM) - autoZoom) * k;
    // The scroll wheel on top (not in free look). It has its own, quicker smoothing.
    zoom = autoZoom;
    if (focus) {
      // Back to normal at a respawn (the plane was down, now it is not) and at each take-off. Only the
      // target moves: the spring below eases the view home, where setting the factor itself snapped it.
      const airborne = focus.state === 'air';
      const down = focus.state === 'dead';
      if ((airborne && !cam.wasAir) || (!down && cam.wasDown)) cam.wheelTarget = 1;
      cam.wasAir = airborne;
      cam.wasDown = down;
      const [lo, hi] = wheelRange(camCfg);
      cam.wheelTarget = clamp(cam.wheelTarget, lo, hi);
      // A critically damped spring, like the look: it starts moving gently, builds up and settles
      // without overshoot, instead of jumping a notch at once. wheelSmooth is its stiffness.
      if (!cam.snapped) cam.wheel = cam.wheelTarget;
      else {
        const w = camCfg.wheelSmooth;
        const step = Math.min(dt, 0.05) / 2;
        for (let i = 0; i < 2; i++) {
          cam.wheelV += (w * w * (cam.wheelTarget - cam.wheel) - 2 * w * cam.wheelV) * step;
          cam.wheel += cam.wheelV * step;
        }
      }
      zoom = playerZoom(autoZoom, cam.wheel, cam.fight, camCfg, MAX_ZOOM);
    }
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

  // Dogfight camera: with enemy planes about, the view eases over to frame them. cam.fight is how far
  // into that we are (0 to 1). The hold keeps it from letting go the moment someone flies out of range.
  function updateFight(focus, dt) {
    const flying = camCfg.fightOn && focus.state === 'air' && !focus.dying;
    const frame = flying && frameFight(focus, world.planes, camCfg, cam.fightHold > 0 ? camCfg.fightExit : camCfg.fightEnter, W, H);
    cam.fightHold = !flying ? 0 : frame ? camCfg.fightHold : Math.max(0, cam.fightHold - dt);
    const k = 1 - Math.exp(-dt * camCfg.fightSpeed);
    if (frame) {
      // The first frame of a fight starts in place: only cam.fight has to ease in.
      const start = cam.fight < 0.01;
      cam.fightX += (frame.x - cam.fightX) * (start ? 1 : k);
      cam.fightY += (frame.y - cam.fightY) * (start ? 1 : k);
      cam.fightZoom += (frame.zoom - cam.fightZoom) * (start ? 1 : k);
    }
    cam.fight += ((cam.fightHold > 0 ? 1 : 0) - cam.fight) * (1 - Math.exp(-dt * camCfg.fightBlend));
  }

  // free: free look, { x, y, zoom } for the centre of the view; the camera goes where it's sent.
  function updateCamera(focus, dt, look, free) {
    // While a plane swings round at a map edge the view rests where it was (the follow and look-ahead would
    // swing with the flip), eased in when the turn starts and eased back out to following when it ends.
    const turning = !free && focus && focus.state === 'air' && focus.edgeTurn != null;
    if (turning && cam.rest <= 0.001) cam.restX = cam.x;
    cam.rest += ((turning ? 1 : 0) - cam.rest) * (1 - Math.exp(-Math.min(dt, 0.1) * (turning ? 7 : 2.5)));
    if (cam.rest < 0.001) cam.rest = 0;
    if (free) {
      updateZoom(null, dt, free.zoom - 1);
      cam.x = free.x - vw / 2;
      cam.y = free.y - vh / 2;
      cam.back = { x: cam.x, y: cam.y, k: 1 }; // where to glide back from once free look ends
    } else if (!focus) return;
    if (!free && (focus.state !== 'dead' || focus.bailout)) {
      updateLook(focus, dt, look);
      updateFight(focus, dt);
      updateZoom(focus, dt);
      // Sideways the view leads where the nose points; up and down it leads along the flight path,
      // so a stalling plane that's sinking nose-up still shows the ground it's falling towards.
      const speed = Math.hypot(focus.vx, focus.vy);
      const climb = speed > 20 ? focus.vy / speed : Math.sin(focus.angle);
      // A pilot hanging under his parachute isn't going anywhere: keep him in the middle.
      const targetX = focus.bailout ? 0 : Math.cos(focus.angle) * vw * camCfg.leadX;
      const targetY = climb * vh * camCfg.leadY;
      const k = cam.snapped ? 1 - Math.exp(-dt * camCfg.leadSpeed) : 1;
      const ky = cam.snapped ? 1 - Math.exp(-dt * camCfg.leadSpeedY) : 1;
      // Turning round on the ground: the camera pans DURING the turn, in step with it. The look-ahead
      // swings to the new facing and the view follows the pivot to where the plane will stand (the sim
      // moves the plane by two wheel offsets when the turn ends), so nothing is left to jump at the end.
      let turnT = 0;
      let fx = focus.x;
      if (focus.state === 'ground' && focus.groundTurn != null && !focus.bailout) {
        if (cam.turnStart == null) {
          cam.turnStart = focus.groundTurn;
          cam.turnLead = cam.leadX;
        }
        const span = Math.max(0.01, 1 - cam.turnStart);
        const u = clamp((focus.groundTurn - cam.turnStart) / span, 0, 1);
        turnT = u * u * (3 - 2 * u);
        const dir = Math.cos(focus.angle) >= 0 ? 1 : -1;
        fx += turnT * 2 * dir * wheelGeometry(focus.def).main[0];
        cam.leadX = cam.turnLead + (-targetX - cam.turnLead) * turnT;
      } else {
        cam.turnStart = null;
        cam.leadX += (targetX - cam.leadX) * k;
      }
      cam.leadY += (targetY - cam.leadY) * ky;
      // However you look, your own plane stays on screen. Sideways, looking ahead on top of the
      // look-ahead would run into that edge and stop dead, so beyond the normal look-ahead the view
      // eases into the limit instead.
      const margin = 0.08;
      const limit = vw * (0.5 - margin);
      const knee = Math.min(vw * camCfg.leadX, limit * 0.85);
      // Some of the look-ahead stays in a fight, so you still see what you're flying into; near the
      // ground the framing fades out altogether, because then the ground matters most.
      const lowFade = clamp((focus.y - world.terrain.heightAt(focus.x)) / camCfg.fightLowAlt, 0, 1);
      const fight = cam.fight * lowFade;
      const leadShare = 1 - fight * (1 - camCfg.fightLeadKeep);
      const off = cam.leadX * leadShare + cam.fightX * fight + cam.lookX * vw * camCfg.lookRange;
      const past = Math.abs(off) - knee;
      const softOff = past <= 0 ? off : Math.sign(off) * (knee + (limit - knee) * Math.tanh(past / (limit - knee)));
      cam.x = fx + softOff - vw / 2;
      const restY = vh * (0.5 - camCfg.height); // the view centre above the plane outside a fight
      const centreY = cam.leadY * leadShare + restY * (1 - fight) + cam.fightY * fight;
      cam.y = focus.y + centreY + cam.lookY * vh * camCfg.lookRange - vh / 2;
      cam.x = clamp(cam.x, fx - vw * (1 - margin), fx - vw * margin);
      cam.y = clamp(cam.y, focus.y - vh * (1 - margin), focus.y - vh * margin);
      cam.snapped = true;
      // Back from free look: glide from where it was over to the plane.
      if (cam.back && cam.back.k > 0.005) {
        cam.x += (cam.back.x - cam.x) * cam.back.k;
        cam.y += (cam.back.y - cam.y) * cam.back.k;
        cam.back.k *= Math.exp(-dt * 4);
      }
    }
    if (cam.rest > 0) cam.x += (cam.restX - cam.x) * cam.rest;
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
    ridge(farRidge, 0.2, '#5f6a70');
    ridge(nearRidge, 0.45, '#3f4a3c');
  }

  // One buffer-pixel column of ground into g at x, its top row at `top`: grass (or runway, or scorched
  // earth), then soil layers down to floorY. Rivers lie over the channel bed from waterOf(river) down;
  // their glint is left out when ripple is false (drawn live).
  function paintColumn(g, x, ix, top, floorY, waterOf, ripple) {
    const t = world.terrain;
    const wx = ix / SCALE;
    const col = (x, y, h, colour) => {
      g.fillStyle = colour;
      g.fillRect(x, y, 1, h);
    };
    const bh = floorY;
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
      // Drab grass with the odd tuft poking up, a lit top edge and a darker under-layer, over dark earth:
      // the look is grim, it's war.
      if (n % 9 === 0) col(x, top - 1 - (n % 2), 1 + (n % 2), '#5e6a3c');
      col(x, top, 1, n % 4 === 0 ? '#838d52' : '#6f7a45');
      col(x, top + 1, 4 + (n % 3), '#56603a');
      col(x, top + 5 + (n % 3), 2, '#434b2e');
    }
    col(x, top + 7, bh - top - 7, '#33251a');
    col(x, top + 22, bh - top - 22, '#241a12');
    col(x, top + 44, bh - top - 44, '#160f0a');
    if (n % 5 === 0) col(x, top + 10 + (n % 31), 1, '#0e0906');
    if (n % 17 === 0) col(x, top + 14 + (n % 23), 2, '#3d3226'); // pebbles
    // River water over the channel bed, with a glinting, rippling surface.
    const river = map.rivers?.find((rv) => wx >= rv.x && wx <= rv.x + rv.width);
    if (river && t.heightAt(wx) < river.water) {
      const wy = waterOf(river);
      col(x, wy, top - wy, '#2e3f47');
      col(x, wy + 3, top - wy - 3, '#253239');
      col(x, wy, 1, ripple && (ix + Math.floor(frame / 8)) % 7 < 2 ? '#7d8e94' : '#4b5e66');
    }
  }

  // The ground is drawn once into chunks of CHUNK buffer-pixel columns, in world pixels (row 0 = the
  // top of the chunk, the bottom row = height 0), and copied to the screen each frame: a frame no longer
  // paints ~1000 columns of a handful of rectangles each. A chunk is repainted when its craters or
  // scorch change (checked by a sum over its heights). Only the river's glint is drawn live.
  // ?skip=terraincache goes back to painting every column every frame, for comparison.
  const CHUNK = 512;
  const chunks = new Map(); // index -> { canvas, top (rows above height 0), sig, used }
  let chunkTerrain = null;
  const chunkSig = (t, i) => {
    let s = 0;
    for (let k = Math.floor((i * CHUNK) / SCALE), end = Math.ceil(((i + 1) * CHUNK) / SCALE) + 1; k < end; k++) {
      s += (t.heights[k] ?? 0) * ((k & 255) + 1) + (t.scorch[k] ?? 0) * (((k * 7) & 127) + 1) * 1000;
    }
    return s;
  };
  function buildChunk(t, i, old) {
    prof.count('chunkbuild');
    const k0 = Math.floor((i * CHUNK) / SCALE);
    let high = 0;
    for (let k = k0, end = Math.ceil(((i + 1) * CHUNK) / SCALE) + 1; k < end; k++) high = Math.max(high, t.heights[k] ?? 0);
    const rows = Math.ceil((high + 4) * SCALE) + 4; // a little over the highest ground, for the tufts
    const canvas = old?.canvas ?? makeCanvas(CHUNK, rows);
    if (canvas.height !== rows) canvas.height = rows;
    canvas.width = CHUNK; // clears it
    const g = canvas.getContext('2d');
    const waterOf = (river) => rows + Math.round(-river.water * SCALE);
    for (let x = 0; x < CHUNK; x++) {
      const ix = i * CHUNK + x;
      paintColumn(g, x, ix, rows + Math.round(-t.heightAt(ix / SCALE) * SCALE), rows, waterOf, false);
    }
    return { canvas, rows, sig: chunkSig(t, i), used: frame };
  }
  function drawTerrain() {
    const t = world.terrain;
    const px0 = Math.round(cam.x * SCALE);
    const camPx = Math.round(cam.y * SCALE);
    if (skip.has('terraincache')) {
      for (let x = 0; x < bw; x++) {
        const top = Math.round(bh - (t.heightAt((px0 + x) / SCALE) - cam.y) * SCALE);
        if (top < bh) paintColumn(ctx, x, px0 + x, top, bh, (river) => Math.round(bh - (river.water - cam.y) * SCALE), true);
      }
      return;
    }
    if (chunkTerrain !== t) {
      chunks.clear();
      chunkTerrain = t;
    }
    for (let i = Math.floor(px0 / CHUNK); i * CHUNK < px0 + bw; i++) {
      let c = chunks.get(i);
      if (!c || c.sig !== chunkSig(t, i)) {
        c = buildChunk(t, i, c);
        chunks.set(i, c);
      }
      c.used = frame;
      // Where the chunk's row 0 lands on the screen; whole pixels, as the camera snaps to them.
      const dy = bh + camPx - c.rows;
      const sx = Math.max(0, px0 - i * CHUNK);
      const sy = Math.max(0, -dy);
      const w = Math.min(CHUNK, px0 + bw - i * CHUNK) - sx;
      const h = Math.min(c.rows - sy, bh - (dy + sy));
      if (w > 0 && h > 0) ctx.drawImage(c.canvas, sx, sy, w, h, i * CHUNK + sx - px0, dy + sy, w, h);
    }
    // Few chunks are needed at once; let go of ones not seen for a while.
    if (chunks.size > 8) for (const [i, c] of chunks) if (frame - c.used > 300) chunks.delete(i);
    // The river's glint ripples, so it is drawn on top each frame.
    for (const river of map.rivers ?? []) {
      const wy = Math.round(bh - (river.water - cam.y) * SCALE);
      ctx.fillStyle = '#7d8e94';
      for (let x = Math.max(0, Math.ceil(river.x * SCALE) - px0); x < bw && (px0 + x) / SCALE <= river.x + river.width; x++) {
        const ix = px0 + x;
        if ((ix + Math.floor(frame / 8)) % 7 < 2 && t.heightAt(ix / SCALE) < river.water) ctx.fillRect(x, wy, 1, 1);
      }
    }
  }

  // Ground objects stand on the ground, sunk in by a pixel. Guns face the enemy's side of the map; their
  // barrels and the radar aerial are drawn here so they can move. A destroyed object leaves a
  // blackened stump of its lower part.
  const groundFlashes = new Map(); // ground object id (soldiers: "id:index") -> frames of muzzle flash left
  const nationOf = (team) => map.airfields.find((a) => a.team === team)?.nation;
  const gore = createGore(world, assets.settings.gore, particles, {
    uniformOf: (id) => assets.nations[nationOf(world.ground.find((o) => o.id === id)?.team)]?.uniform,
    overallsOf: (slot) => CREW_LOOK[slot]?.overalls,
    teamUniform: (team) => assets.nations[nationOf(team)]?.uniform,
  });
  const CREW_LOOK = [
    { overalls: '#3c4a5c', bob: 0 },
    { overalls: '#5a5446', bob: 7 },
  ];
  const facingOf = (obj) => obj.dir ?? (obj.x < map.width / 2 ? 1 : -1);
  const spriteCache = new Map();
  // Tanks wear their nation's paint; everything else is drawn as it is.
  // 15 panel steps (0 = open sprite, 15 = shut) so the doors glide instead of jumping.
  const hangarDoorSuffix = (d) => { const k = 15 - Math.round(Math.min(1, Math.max(0, d)) * 15); return k === 0 ? '' : k === 15 ? '-shut' : `-d${k}`; };
  function spriteOf(obj) {
    // Hangar doors: shut, half or open by the object's door (0..1).
    const door = obj.type === 'hangar' && obj.alive && obj.door != null ? hangarDoorSuffix(obj.door) : '';
    const img = assets.images[obj.def.sprite + door];
    if (door) return [obj.def.sprite + door, img];
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

  let lastFocus = null;
  function drawSquad(obj, sx, frameNo) {
    if (obj.callsign && obj.alive && nameShown(obj.callsign, obj.owner, lastFocus)) drawManName(obj.callsign, obj.team, Math.round(toScreenX(obj.x)), Math.round(toScreenY(surfaceAt(world, obj.x))) + 2, lastFocus);
    const uniform = assets.nations[nationOf(obj.team)]?.uniform ?? '#6a6e5e';
    const engineers = obj.type === 'engineers';
    obj.soldiers.forEach((s, i) => {
      const wx = obj.x + s.dx;
      const gx = Math.round(toScreenX(wx));
      const gy = Math.round(toScreenY(surfaceAt(world, wx))) + 1;
      if (gx < -10 || gx > bw + 10) return;
      if (s.hp <= 0) {
        if (gore.on) return; // the gore layer lays the body where it fell
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

  // Taildraggers sit tail-down on the ground; the sim keeps that tilt (the guns use it too).
  const groundAttitude = attitude;

  // Which transient frame a plane shows, if any: rolling in the air, turning round or ground-looping.
  const smooth = (t) => t * t * (3 - 2 * t);
  function transientFrame(p, frames) {
    if (!frames) return null;
    const rows = frames.meta.rows;
    if (p.groundLoop != null) return { row: 'loop', index: Math.min(rows.loop.count - 1, Math.round(p.groundLoop * (rows.loop.count - 1))) };
    // Leaving the hangar: the head-on frames (the plain turn row would show the tail).
    // At the map edge: the turn-round frames up to the half way mark, where the sim flips the plane, then
    // the mirrored frames back down (frame 0 faces the way the plane is facing, whichever way that is).
    if (p.edgeTurn != null && p.state === 'air' && rows.turn) {
      const t = Math.min(1, p.edgeTurn);
      const row = rows.edge ? 'edge' : 'turn'; // 'edge' is the same swing with the gear up
      return { row, index: Math.round((t < 0.5 ? smooth(t) : 1 - smooth(t)) * (rows[row].count - 1)) };
    }
    if (p.groundTurn != null && p.exitPhase && rows.exit) return { row: 'exit', index: Math.round(smooth(Math.min(1, Math.max(0, (p.groundTurn - 0.5) * 2))) * (rows.exit.count - 1)) };
    if (p.groundTurn != null) return { row: 'turn', index: Math.round(smooth(Math.min(1, p.groundTurn)) * (rows.turn.count - 1)) };
    if (p.rolling) {
      const row = p.gear > 0.5 ? 'rollGear' : 'roll';
      return { row, index: Math.round((p.rollAngle / (Math.PI * 2)) * rows[row].count) % rows[row].count };
    }
    // Wing wobble: the roll frames a step either side of level. Level itself is the plain sprite.
    const w = wobble.get(p.id);
    if (w && p.state === 'air' && w.angle !== 0) {
      const row = p.gear > 0.5 ? 'rollGear' : 'roll';
      const n = rows[row].count;
      const rest = p.inverted ? Math.PI : 0;
      const index = (((Math.round(((rest + w.angle) / (Math.PI * 2)) * n)) % n) + n) % n;
      if (index !== Math.round((rest / (Math.PI * 2)) * n) % n) return { row, index };
    }
    return null;
  }

  // Wing lean and wobble per plane (drawing only), as an offset in roll angle from level that picks a roll
  // frame. Pulling up leans the belly into view, pushing down the top, by the turn rate (a tap is a small
  // lean, a held pull a big one) with a random flutter of steps on top. Level flight only gets the odd
  // single left or right tilt at a random moment, which gives way to the lean as the turn gets harder.
  const wobble = new Map();
  const wobbleRand = (w) => {
    w.seed = (w.seed + 0x6d2b79f5) | 0;
    let t = Math.imul(w.seed ^ (w.seed >>> 15), 1 | w.seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const STEP = (Math.PI * 2) / 16; // the roll sheet's frame spacing
  function updateWobble(p, dt) {
    const cfg = assets.settings.wobble;
    let w = wobble.get(p.id);
    if (!w) {
      w = { seed: p.id * 7919, last: p.angle, pitch: 0, side: 0, angle: 0, tilt: null, wait: 0, flutter: 0, flutterTo: 0, flutterIn: 0 };
      w.wait = -Math.log(1 - wobbleRand(w));
      wobble.set(p.id, w);
    }
    dt = Math.min(dt, 0.1);
    // Counter-clockwise turn rate on screen.
    const turn = Math.atan2(Math.sin(p.angle - w.last), Math.cos(p.angle - w.last));
    w.last = p.angle;
    w.pitch += ((dt > 0 ? turn / dt : 0) - w.pitch) * Math.min(1, dt * 8);
    const hard = Math.min(1, Math.abs(w.pitch) / (p.def.turnRate ?? 1.4));
    // Which wing shows is decided when a turn starts (pulling up: belly, pushing down: top) and kept until
    // the turn ends, so a 180 holds one lean even though the plane faces the other way by the end.
    if (hard < 0.05) w.side = 0;
    else if (!w.side) w.side = Math.sign(w.pitch) * (Math.cos(p.angle) >= 0 ? 1 : -1);
    // The belly sits at a negative roll angle on a plane drawn right way round, a positive one once
    // p.inverted flips at the top of the turn, which keeps the same wing in view.
    const lean = w.side * (p.inverted ? 1 : -1) * cfg.leanSteps * hard * STEP;

    // Flutter: a new random target every second or so, eased towards, scaled by how hard the turn is.
    w.flutterIn -= dt;
    if (w.flutterIn <= 0) {
      w.flutterIn = 0.5 + wobbleRand(w);
      w.flutterTo = (wobbleRand(w) * 2 - 1) * cfg.flutterSteps;
    }
    w.flutter += (w.flutterTo - w.flutter) * Math.min(1, dt * 6);
    const flutter = w.flutter * hard * STEP;

    // Level-flight tilts. The wait is counted in expected tilts, so a changing frequency takes effect at once.
    const amount = cfg.straightAmount * (1 - hard);
    if (!w.tilt) {
      w.wait -= dt * cfg.straightFreq;
      if (w.wait <= 0) {
        w.tilt = { t: 0, dir: wobbleRand(w) < 0.5 ? -1 : 1, size: 0.5 + 0.5 * wobbleRand(w), dur: 0.6 + 0.8 * wobbleRand(w) };
        w.wait = -Math.log(1 - wobbleRand(w));
      }
    }
    let tilt = 0;
    if (w.tilt) {
      w.tilt.t += dt / w.tilt.dur;
      if (w.tilt.t >= 1) w.tilt = null;
      else tilt = ((amount * Math.PI) / 180) * w.tilt.dir * w.tilt.size * Math.sin(Math.PI * w.tilt.t);
    }
    w.angle = lean + flutter + tilt;
  }

  // Propeller disc of a ground frame, seen at an angle: a dotted ellipse round the hub.
  function drawPropDisc(p, cx, cy, [hx, hy0, ax, ay0, bx, by0], rot, mirror, flipped = false) {
    const m = mirror ? -1 : 1;
    // A plane drawn upside down (frames flipped over): the disc's offsets flip with it.
    const f = flipped ? -1 : 1;
    const hy = hy0 * f;
    const ay = ay0 * f;
    const by = by0 * f;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const turn = (x, y) => [x * m * c + y * s, -x * m * s + y * c];
    const [px, py] = turn(hx, hy);
    const [ax2, ay2] = turn(ax, ay);
    const [bx2, by2] = turn(bx, by);
    const spin = Math.floor(frame * (p.rpm / 400));
    ctx.fillStyle = 'rgba(225,225,215,0.4)';
    for (let k = 0; k < 48; k++) {
      if ((k + spin) % 3 === 0) continue;
      const t = (k / 48) * Math.PI * 2;
      ctx.fillRect(Math.round(cx + px + Math.cos(t) * ax2 + Math.sin(t) * bx2), Math.round(cy + py + Math.cos(t) * ay2 + Math.sin(t) * by2), 1, 1);
    }
  }

  // Planes are drawn in full buffer pixels (PLANE_SCALE per world unit), not through the scenery's
  // DETAIL x transform.
  const planeX = (wx) => Math.round(toScreenX(wx) * DETAIL);
  const planeY = (wy) => Math.round(toScreenY(wy) * DETAIL);
  function drawPlane(p, focus) {
    if (p.state === 'dead' || p.exitPhase === 'wait') return; // still inside the hangar, waiting for doors or its turn
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawPlaneDetail(p, radarOutline(p, focus));
    drawPlaneName(p, focus);
    ctx.setTransform(DETAIL, 0, 0, DETAIL, 0, 0);
  }

  // Pilot names (bots too, if the option is on). A plane's is like paint: it tilts with the plane, reads normally when
  // the pilot is upright whichever way he flies, turns upside down with him and squashes through a roll.
  const NAME_FONT = "700 12px Consolas, 'Lucida Console', 'DejaVu Sans Mono', monospace";
  const NAME_GAP = 25; // below the plane's centre, in the plane's own frame
  const nameShown = (name, owner, focus) => name && assets.settings.hud.showNames !== false && (owner !== focus?.id || assets.settings.hud.showOwnName);
  const nameColour = (team, focus) => (team === focus?.team ? '#ece3b4' : '#f5a08a');
  // Name text with a dark outline round the letters, so it reads over sky, ground and planes alike.
  function nameText(text, x, y, colour) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = 3.2;
    ctx.strokeStyle = 'rgba(8,8,6,0.88)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = colour;
    ctx.fillText(text, x, y);
  }
  // Pushed out of the hangar the plane starts small and faint.
  function exitLook(p) {
    // Parking in is the roll-out reversed: the same look, run backwards.
    const into = p.park?.phase === 'in';
    if (p.exitPhase !== 'out' && !into) return { grow: 1, alpha: 1 };
    const t = into ? 1 - p.park.t : p.exitT;
    const def = hangarOf(p)?.def;
    const g0 = def?.exitStartScale ?? 0.6;
    const a0 = def?.exitStartAlpha ?? 0;
    return { grow: g0 + (1 - g0) * t, alpha: Math.min(1, (a0 + (1 - a0) * t) * 1.4) }; // solid by 70% of the way out
  }
  // The pilot's name stays off while the plane is being pushed out of the hangar and fades in once the
  // pilot has the controls (exitTo cleared).
  const NAME_FADE = 0.8; // seconds
  const gotControl = new WeakMap(); // plane -> performance.now() when it came out (or 0 while still leaving)
  function nameAlpha(p) {
    if (p.exitTo != null) {
      gotControl.set(p, 0);
      return 0;
    }
    const t = gotControl.get(p);
    if (t === undefined) return 1; // never left a hangar here
    if (t === 0) gotControl.set(p, performance.now());
    const a = Math.min(1, (performance.now() - (t || performance.now())) / 1000 / NAME_FADE);
    if (a >= 1) gotControl.delete(p);
    return a;
  }
  function drawPlaneName(p, focus) {
    if (!nameShown(p.callsign, p.id, focus)) return;
    if (p.seats?.[0]?.controller?.startsWith('bot') && assets.settings.hud.showBotNames === false) return;
    const alpha = nameAlpha(p);
    if (alpha <= 0) return;
    // Head-on frames (out of the hangar, turning round) are drawn level: the tail-down tilt would slant the name.
    const view = p.groundTurn != null ? { angle: p.angle, x: p.x, y: p.y } : groundAttitude(p);
    const roll = Math.cos(p.rollAngle ?? 0);
    const upright = Math.cos(view.angle) >= 0 === roll >= 0;
    ctx.save();
    ctx.translate(planeX(view.x), planeY(view.y));
    ctx.rotate(-(Math.cos(view.angle) >= 0 ? view.angle : view.angle - Math.PI));
    if (!upright) ctx.rotate(Math.PI);
    ctx.scale(1, Math.max(0.05, Math.abs(roll)));
    ctx.globalAlpha = alpha;
    ctx.font = NAME_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    nameText(p.callsign, 0, NAME_GAP, nameColour(p.team, focus));
    ctx.restore();
  }
  // A man's name hangs level under his feet.
  function drawManName(name, team, x, y, focus) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = NAME_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    nameText(name, x * DETAIL, (y + 7) * DETAIL, nameColour(team, focus));
    ctx.restore();
  }

  // A pilot coming down: tumbling at first, then swinging under a dull canopy. A deserter holds a white
  // flag; a canopy that's been shot trails in rags.
  function drawCanopy(cx, cy, torn) {
    for (let k = -13; k <= 13; k++) {
      if (torn && (k + 40) % 5 < 2) continue;
      const h = Math.round(9 * Math.sqrt(1 - (k * k) / 196));
      ctx.fillStyle = k % 7 === 0 ? '#5e5c4e' : k < 0 ? '#86826e' : '#74705e';
      ctx.fillRect(cx + k, cy - h, 1, h + (torn ? (k + 40) % 3 : 1));
    }
  }
  function drawParachute(c, focus) {
    const gx = Math.round(toScreenX(c.x));
    const gy = Math.round(toScreenY(c.y));
    if (gx < -40 || gx > bw + 40) return;
    const uniform = assets.nations[nationOf(c.team)]?.uniform ?? '#6a6e5e';
    const swing = c.open ? Math.round(Math.sin((frame + c.id * 17) / 22) * 2) : 0;
    if (c.open) {
      const cx = gx - swing;
      const cy = gy - 26;
      ctx.fillStyle = 'rgba(30,28,24,0.55)';
      for (let i = 0; i <= 18; i++) {
        const t = i / 18;
        ctx.fillRect(Math.round(gx + (cx - 12 - gx) * t), Math.round(gy - 8 + (cy + 1 - gy + 8) * t), 1, 1);
        ctx.fillRect(Math.round(gx + (cx + 12 - gx) * t), Math.round(gy - 8 + (cy + 1 - gy + 8) * t), 1, 1);
      }
      drawCanopy(cx, cy, c.torn);
    } else {
      // The pack streaming out above him.
      ctx.fillStyle = '#86826e';
      for (let k = 0; k < 8; k++) ctx.fillRect(gx + (k % 2), gy - 10 - k * 2, 2, 2);
    }
    // Legs dangling, body, head, helmet.
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(gx - 1, gy - 2, 1, 4);
    ctx.fillRect(gx + 1, gy - 2, 1, 4);
    ctx.fillStyle = uniform;
    ctx.fillRect(gx - 1, gy - 8, 3, 6);
    ctx.fillStyle = '#d6a77e';
    ctx.fillRect(gx - 1, gy - 10, 2, 2);
    ctx.fillStyle = '#3a3e34';
    ctx.fillRect(gx - 2, gy - 11, 4, 1);
    if (c.flag) {
      const d = c.dir;
      ctx.fillStyle = '#4a3624';
      for (let k = 0; k < 9; k++) ctx.fillRect(gx + d * 2, gy - 5 - k, 1, 1);
      const wave = Math.floor(frame / 8) % 2;
      ctx.fillStyle = '#c8c4b4';
      ctx.fillRect(gx + d * 3 - (d < 0 ? 5 : 0), gy - 14, 6, 4);
      ctx.fillStyle = '#a4a090';
      ctx.fillRect(gx + d * 3 + (d < 0 ? -5 : 5) * wave, gy - 11, 1, 2);
    }
    if (nameShown(c.callsign, c.owner, focus)) drawManName(c.callsign, c.team, gx, gy, focus);
  }
  // A dead man's canopy, collapsing and sinking away.
  const fallenCanopies = [];
  function drawFallenCanopies(dt) {
    for (let i = fallenCanopies.length - 1; i >= 0; i--) {
      const f = fallenCanopies[i];
      f.age += dt;
      f.x += f.vx * dt;
      f.y -= 14 * dt;
      if (f.age > 6 || f.y < world.terrain.heightAt(f.x)) {
        fallenCanopies.splice(i, 1);
        continue;
      }
      drawCanopy(Math.round(toScreenX(f.x)), Math.round(toScreenY(f.y)), true);
    }
  }

  // Enemy planes your radar has plotted get a phosphor-green outline: it flares as the beam sweeps
  // them and fades with the echo, and dims with distance. Low flyers and a dead station give none.
  const radarCfg = assets.settings.radar; // live: the tuning panel edits this object
  const outlines = new WeakMap(); // sprite canvas -> its silhouette in phosphor green
  function radarOutline(p, focus) {
    if (!radarCfg.outline || !focus || p.team === focus.team) return 0;
    const glow = radar.enemyGlow(p.id);
    if (glow <= 0) return 0;
    const d = Math.hypot(p.x - focus.x, p.y - focus.y);
    const span = Math.max(1, radarCfg.outlineFar - radarCfg.outlineNear);
    const fade = 1 - clamp((d - radarCfg.outlineNear) / span, 0, 1);
    return radarCfg.outlineAlpha * glow * fade;
  }
  function silhouette(img) {
    let s = outlines.get(img);
    if (!s) {
      s = document.createElement('canvas');
      s.width = img.width;
      s.height = img.height;
      const g = s.getContext('2d');
      g.drawImage(img, 0, 0);
      g.globalCompositeOperation = 'source-in';
      g.fillStyle = `rgb(${PHOSPHOR.join(',')})`;
      g.fillRect(0, 0, s.width, s.height);
      outlines.set(img, s);
    }
    return s;
  }
  // The silhouette nudged a pixel each way behind the sprite leaves a one-pixel rim around it.
  // Rolling out of the dark hangar the plane shows faded, clearing as it comes closer.
  let planeAlpha = 1;
  function drawOutlined(img, x, y, alpha) {
    if (alpha > 0.01) {
      const s = silhouette(img);
      ctx.globalAlpha = alpha * planeAlpha;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) ctx.drawImage(s, x + dx, y + dy);
    }
    ctx.globalAlpha = planeAlpha; // the outline branch above is skipped without a radar outline
    ctx.drawImage(img, x, y);
    ctx.globalAlpha = 1;
  }

  const hangarOf = (p) => world.ground.find((o) => o.type === 'hangar' && o.team === p.team);
  function drawPlaneDetail(p, outline) {
    const frames = assets.planeFrames(p);
    const shown = transientFrame(p, frames);
    if (shown && shown.row !== 'roll' && shown.row !== 'rollGear') {
      // On the ground, turning round or looping: the model's frame stands on the main wheels (gear
      // included), facing-left frames mirrored, tilted with the ground's slope.
      const right = Math.cos(p.angle) >= 0;
      let rot = right ? p.angle : p.angle - Math.PI;
      // The edge-turn frames are baked tail-down like the ground ones, but the plane is level in the air: take
      // the pitch back out, fully side-on at both ends and fading to nothing tail-on mid-swing.
      if (shown.row === 'edge') {
        const k = Math.cos(Math.min(1, p.edgeTurn) * Math.PI);
        rot -= wheelGeometry(p.def).tailDown * k * k * (right ? 1 : -1) * (isUpright(p) ? 1 : -1);
      }
      const at = mainWheelContact(p);
      const cx = planeX(at.x);
      const cy = planeY(at.y);
      // One disc per propeller (a twin's frames list one per engine): those behind the model first.
      const prop = frames.meta.props[shown.row][shown.index];
      const discs = Array.isArray(prop[0]) ? prop : [prop];
      // Pushed out of the hangar towards the camera: small at first, growing to full size.
      const { grow, alpha } = exitLook(p);
      planeAlpha = alpha;
      if (grow !== 1) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(grow, grow);
        ctx.translate(-cx, -cy);
      }
      ctx.globalAlpha = planeAlpha;
      for (const d of discs) if (d[6] < 0) drawPropDisc(p, cx, cy, d, rot, !right, !isUpright(p));
      const f = frames.frame(shown.row, shown.index, rot, !right, !isUpright(p));
      drawOutlined(f.canvas, cx - f.radius, cy - f.radius, outline);
      ctx.globalAlpha = planeAlpha;
      for (const d of discs) if (d[6] >= 0) drawPropDisc(p, cx, cy, d, rot, !right, !isUpright(p));
      ctx.globalAlpha = 1;
      if (grow !== 1) ctx.restore();
      planeAlpha = 1;
      return;
    }
    const view = groundAttitude(p);
    const sx = planeX(view.x);
    const sy = planeY(view.y);
    // A twin's roll frames list one disc per engine: they replace the single line at propOffset below, which
    // would sit between the engines, where there is no propeller.
    let twinDiscs = null;
    if (shown) {
      // Mid-roll: a frame of the model rolled about its long axis (gear drawn in it), rotated now.
      const prop = frames.meta.props[shown.row]?.[shown.index];
      if (Array.isArray(prop?.[0])) twinDiscs = prop;
      if (twinDiscs) for (const d of twinDiscs) if (d[6] < 0) drawPropDisc(p, sx, sy, d, view.angle, false);
      const f = frames.frame(shown.row, shown.index, view.angle);
      drawOutlined(f.canvas, sx - f.radius, sy - f.radius, outline);
      if (twinDiscs) for (const d of twinDiscs) if (d[6] >= 0) drawPropDisc(p, sx, sy, d, view.angle, false);
    } else {
      const set = assets.planeSprite(p)[p.inverted ? 'inverted' : 'upright'];
      drawGear(p, sx, sy, view.angle);
      const sprite = set.frames[frameIndex(view.angle)];
      drawOutlined(sprite, sx - set.radius, sy - set.radius, outline);
      gore.drawPlane(ctx, p, sx, sy, view.angle, PLANE_SCALE, sprite, set.radius);
    }
    drawMuzzleFlash(p, sx, sy, view.angle);

    if (!twinDiscs) {
      // Propeller disc: a flickering line across the nose (reddened after running soldiers down). A twin's
      // two propellers line up in side view: one line at propOffset, where the engines are.
      const c = Math.cos(view.angle);
      const s = Math.sin(view.angle);
      const f = p.inverted ? -1 : 1;
      const [ox, oy] = p.def.propOffset ?? [p.def.noseOffset[0] + 0.5, 0];
      const px = sx + (c * ox - s * oy * f) * PLANE_SCALE;
      const py = sy - (s * ox + c * oy * f) * PLANE_SCALE;
      const spin = Math.floor(frame * (p.rpm / 400));
      const reach = 4 * PLANE_SCALE + 1;
      const bloody = gore.bloodied(p.id) > 0;
      for (let k = -reach; k <= reach; k++) {
        if ((k + spin) % 3 === 0) continue;
        ctx.fillStyle = bloody ? `rgba(120,40,34,${Math.abs(k) > reach - 2 ? 0.35 : 0.55})` : Math.abs(k) > reach - 2 ? 'rgba(225,225,215,0.3)' : 'rgba(225,225,215,0.5)';
        ctx.fillRect(Math.round(px + s * k), Math.round(py + c * k), 1, 1);
      }
    }
  }

  // Main wheels and tail wheel. They're drawn behind the plane, so as the gear retracts (p.gear 1 -> 0)
  // the wheels slide up along their legs and disappear into the wing and fuselage.
  function drawGear(p, sx, sy, angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const f = p.inverted ? -1 : 1;
    const at = ([lx, ly]) => [sx + (c * lx - s * ly * f) * PLANE_SCALE, sy - (s * lx + c * ly * f) * PLANE_SCALE];
    for (const g of p.def.wheels ?? DEFAULT_WHEELS) {
      const out = p.def.fixedGear || (g.tail && p.def.fixedTailWheel) ? 1 : p.gear;
      if (out <= 0.02) continue;
      const e = out * out * (3 - 2 * out); // ease in and out
      const [ax, ay] = at(g.leg);
      const [bx, by] = at([g.stowed[0] + (g.wheel[0] - g.stowed[0]) * e, g.stowed[1] + (g.wheel[1] - g.stowed[1]) * e]);
      ctx.fillStyle = '#3a3a36';
      for (let t = 0; t <= 1; t += 0.1) ctx.fillRect(Math.round(ax + (bx - ax) * t), Math.round(ay + (by - ay) * t), 1, 1);
      // Round pixel tyre with a lighter hub.
      const cx = Math.round(bx);
      const cy = Math.round(by);
      const r = g.r * PLANE_SCALE + 0.5;
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

  // Ground crew (world.crew, src/sim/airfield.js): mechanics on foot between the hangar and the
  // plane they're sent to. Slot 0 works at the nose, slot 1 at the wing.
  function drawCrew(c) {
    const look = CREW_LOOK[c.slot] ?? CREW_LOOK[0];
    const p = c.plane != null ? world.planes.find((o) => o.id === c.plane) : null;
    const gx = Math.round(toScreenX(c.x));
    const gy = Math.round(toScreenY(c.y));
    if (gx < -10 || gx > bw + 10) return;
    const walking = c.state === 'out' || c.state === 'back' || (c.state === 'push' && c.moving);
    // Pushing a plane out towards the camera: the men grow with it.
    const pushed = c.push && c.state === 'push' ? world.planes.find((o) => o.id === c.pushing) : null;
    const g0 = hangarOf(pushed ?? {})?.def.exitStartScale ?? 0.8;
    const t = pushed?.exitPhase === 'out' ? pushed.exitT : pushed?.park?.phase === 'in' ? 1 - pushed.park.t : 1;
    const k = g0 + (1 - g0) * t;
    if (k !== 1) {
      ctx.save();
      ctx.translate(gx, gy);
      ctx.scale(k, k);
      ctx.translate(-gx, -gy);
    }
    const step = Math.floor((frame + look.bob) / 6) % 2;
    const working = (c.state === 'work' || c.state === 'setup') && Math.floor((frame + look.bob) / 10) % 2; // arm moving at the job
    // legs
    ctx.fillStyle = '#2a2622';
    ctx.fillRect(gx - 1, gy - 3, 1, 3 - (walking && step ? 1 : 0));
    ctx.fillRect(gx + 1, gy - 3, 1, 3 - (walking && !step ? 1 : 0));
    // overalls
    ctx.fillStyle = look.overalls;
    ctx.fillRect(gx - 1, gy - 8, 3, 5);
    // arm reaching towards the plane at the job, hanging forward otherwise
    const at = p ?? pushed;
    const toward = (at ? Math.sign(at.x - c.x) : 0) || 1; // park-in men push from behind: arms out towards the plane, mirrored with the way it goes
    if (c.state === 'work' || c.state === 'setup' || (c.park && c.state === 'push')) ctx.fillRect(gx + toward * 2, gy - 7 - (working ? 1 : 0), 1, 2);
    else ctx.fillRect(gx + (walking && step ? 1 : 0), gy - 6, 1, 2);
    // head and cap
    ctx.fillStyle = '#d6a77e';
    ctx.fillRect(gx - 1, gy - 10, 2, 2);
    ctx.fillStyle = '#26221e';
    ctx.fillRect(gx - 1, gy - 11, 3, 1);
    if (k !== 1) ctx.restore();
  }

  // The last flight's damage report, frozen when the focused plane is lost. Shown while it's down
  // and for settings.hud.lastFlightTime seconds after it respawns, fading at the end.
  let lastFlight = null;
  const hudCfg = assets.settings.hud;

  // Reflector gunsight: a ring and pip a fixed range down the firing line (no lead, like a 1943
  // Revi). It follows the fuselage, tail-down tilt included, not the camera. hud.crosshairStyle picks
  // ring (ring and pip), circle, cross or dot.
  // On the ground the sight stays hidden (hangar exit, queue, parked) until the throttle is opened for
  // the take-off; it then fades in over SIGHT_FADE seconds so it doesn't pop up.
  const SIGHT_FADE = 0.3;
  let sightFade = 0;
  let sightFadeAt = 0;
  function drawSight(p) {
    if (!hudCfg.crosshair || hudCfg.crosshairAlpha <= 0 || !p.guns.length) return;
    if (p.state === 'dead' || p.dying || p.waiting) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - sightFadeAt) / 1000);
    sightFadeAt = now;
    const live = p.state === 'air' || (p.exitTo == null && p.throttle > 0.05);
    sightFade = live ? Math.min(1, sightFade + dt / SIGHT_FADE) : 0;
    if (sightFade <= 0) return;
    const [mx, my] = localToWorld(p, p.def.noseOffset);
    const a = attitude(p).angle;
    const wx = mx + Math.cos(a) * hudCfg.crosshairRange;
    const wy = my + Math.sin(a) * hudCfg.crosshairRange;
    const x = ((wx - cam.x) * SCALE / bw) * W;
    const y = ((bh - (wy - cam.y) * SCALE) / bh) * H;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    drawSightShape(hud, x, y, sightFade < 1 ? { ...hudCfg, crosshairAlpha: hudCfg.crosshairAlpha * sightFade } : hudCfg);
  }

  const flashes = new Map(); // plane id -> frames of muzzle flash left
  const messages = [];

  function drawMuzzleFlash(p, sx, sy, angle) {
    const f = flashes.get(p.id);
    if (!f) return;
    flashes.set(p.id, f - 1);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const r = (p.def.noseOffset[0] + 3) * PLANE_SCALE;
    const fx = Math.round(sx + c * r);
    const fy = Math.round(sy - s * r);
    ctx.fillStyle = '#ffc850';
    ctx.fillRect(fx - 4, fy - 4, 8 + (f % 2) * 2, 8);
    ctx.fillStyle = '#fff6c8';
    ctx.fillRect(fx - 2, fy - 2, 4, 4);
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
    // Centred under the radar scope and the plane's warnings.
    const base = hud.globalAlpha;
    messages.slice(-4).forEach((m, i) => {
      hud.globalAlpha = base * Math.min(1, (m.until - now) / 600);
      drawText(hud, m.text, (W - textWidth(m.text)) / 2, 86 + i * (lineHeight() + 1), m.colour);
    });
    hud.globalAlpha = base;
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
      // A flame always leaves with its own upward kick: a parked plane has no speed to carry it, and
      // gravity alone lifts it barely a unit before it dies, so on the ground the fire lay low.
      const lift = 14 + Math.random() * 10 + stage * 12;
      const life = 0.25 + Math.random() * (0.3 + stage * 0.3);
      particles.spawn('fire', wx + (Math.random() - 0.5) * (3 + stage * 5), wy, p.vx * 0.3, p.vy * 0.3 + lift, life, size);
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
    // The scroll wheel: steps > 0 zoom out, < 0 in. The wheel factor is local to this screen.
    zoomBy(steps) {
      // When a limit is holding the view back (the zoom-out cap, or the fight's tightening limit), the
      // wheel factor may sit beyond it. Start from what is really applied, or the first notches back
      // would move nothing.
      const applied = zoom / autoZoom;
      if (Math.abs(applied - cam.wheel) > 1e-3) {
        cam.wheel = cam.wheelTarget = applied;
        cam.wheelV = 0;
      }
      const [lo, hi] = wheelRange(camCfg);
      cam.wheelTarget = clamp(cam.wheelTarget * Math.exp(steps * camCfg.wheelStep), lo, hi);
    },
    // World point at the centre of the view (where the ears go when no plane is focused).
    centre() {
      return { x: cam.x + vw / 2, y: cam.y + vh / 2 };
    },
    shake(amount) {
      shake = Math.max(shake, amount * (camCfg.shake ?? 1));
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
      gore.onEvent(e);
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
        else if (!(gore.on && (e.kind === 'infantry' || e.kind === 'engineers'))) particles.spawn('dust', e.x, e.y, (Math.random() - 0.5) * 16, 10 + Math.random() * 12, 0.4, 0.6); // men bleed instead
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
      // The crew shovel a crater full: a little dust over the patch.
      if (e.type === 'runwayFilled') for (let i = 0; i < 6; i++) particles.spawn('dust', e.x + (Math.random() - 0.5) * e.width, world.terrain.heightAt(e.x) + 1, (Math.random() - 0.5) * 10, 6 + Math.random() * 8, 0.6, 0.8);
      if ((e.type === 'soldierKilled' || e.type === 'crewKilled') && !gore.on) particles.spawn('dust', e.x, e.y + 2, 0, 8, 0.5, 0.7);
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
      if (e.type === 'pilotKilled' && e.open) fallenCanopies.push({ x: e.x, y: e.y + 13, vx: e.dir * 8, age: 0 });
      if (e.type === 'chuteTorn') for (let i = 0; i < 4; i++) particles.spawn('dust', e.x, e.y, (Math.random() - 0.5) * 20, Math.random() * 10, 0.5, 0.7);
      if (e.type === 'runDown') for (let i = 0; i < 5; i++) particles.spawn('dust', e.x, e.y, (Math.random() - 0.5) * 30, 6 + Math.random() * 12, 0.5, 0.7);
      if (e.type === 'bump') particles.sparks(e.x, e.y, 5);
      if (e.type === 'hedgeHit') for (let i = 0; i < 10; i++) particles.spawn('dust', e.x + (Math.random() - 0.5) * 20, e.y, (Math.random() - 0.5) * 40, 10 + Math.random() * 20, 0.6, 0.8);
      if (e.type === 'wallHit') {
        particles.sparks(e.x, e.y, 10);
        particles.dirtSpray(e.x, e.y, 0.4);
      }
      if (e.type === 'hardLanding') {
        for (let i = 0; i < 12; i++) particles.spawn('dust', e.x, e.y - 3, (Math.random() - 0.5) * 50, 10 + Math.random() * 14, 0.9, 1);
        if (e.noseDown) particles.sparks(e.x, e.y - 2, 6);
      }
      if (e.type === 'touchdown' && e.speed > 40) {
        for (let i = 0; i < 6; i++) particles.spawn('dust', e.x, e.y - 3, (Math.random() - 0.5) * 30, 8, 0.8, 0.8);
      }
    },
    render(focus, dt, { showHelp, look, free, paused }) {
      frame++;
      lastFocus = focus;
      fitDisplay();
      ctx.setTransform(DETAIL, 0, 0, DETAIL, 0, 0);
      ctx.imageSmoothingEnabled = false;
      prof.mark('other');
      updateCamera(focus, dt, look, free);
      for (const p of world.planes) updateWobble(p, dt);
      for (const p of world.planes) emitEffects(p, dt);
      emitGroundEffects(dt);
      particles.update(dt, world.terrain);
      gore.update(dt);
      prof.mark('update');

      if (!skip.has('sky')) drawBackground();
      prof.mark('sky');
      if (!skip.has('terrain')) drawTerrain();
      prof.mark('terrain');
      if (!skip.has('ground')) drawGround();
      prof.mark('ground');
      gore.draw(ctx, toScreenX, toScreenY, SCALE, (x) => surfaceAt(world, x), bw);
      prof.mark('gore');
      particles.draw(ctx, toScreenX, toScreenY, SCALE);
      prof.mark('particles');
      drawProjectiles();
      prof.mark('shots');
      if (!skip.has('planes')) for (const p of world.planes) drawPlane(p, focus);
      prof.mark('planes');
      for (const c of world.crew ?? []) drawCrew(c);
      for (const c of world.parachutes ?? []) drawParachute(c, focus);
      drawFallenCanopies(dt);
      prof.mark('crew');

      if (focus && focus.consciousness < 1) {
        ctx.fillStyle = `rgba(16,0,0,${((1 - focus.consciousness) * 0.88).toFixed(3)})`;
        ctx.fillRect(0, 0, bw, bh);
      }
      const k = canvas.width / bw;
      const ox = shake > 0.2 ? (Math.random() - 0.5) * 2 * shake * k : 0;
      const oy = shake > 0.2 ? (Math.random() - 0.5) * 2 * shake * k : 0;
      shake *= Math.exp(-dt * 7);
      if (ox || oy) {
        out.fillStyle = '#000';
        out.fillRect(0, 0, canvas.width, canvas.height);
      }
      // On a screen smaller than the buffer, shrink it smoothly: nearest-neighbour would drop pixel
      // rows unevenly and make the scenery shimmer. display.smooth softens the scale-up too.
      out.imageSmoothingEnabled = Boolean(assets.settings.display?.smooth) || canvas.width < bw * DETAIL;
      if (!skip.has('present')) out.drawImage(buffer, 0, 0, bw * DETAIL, bh * DETAIL, ox, oy, canvas.width, canvas.height);
      out.imageSmoothingEnabled = false;
      prof.mark('present');

      // The HUD on top, in 480x270 units at the screen's full resolution.
      const hk = canvas.width / W;
      setTextSize(hudCfg.textSize);
      hud.setTransform(hk, 0, 0, hk, 0, 0);
      let shownFlight = null;
      if (lastFlight) {
        const left = lastFlight.until === null ? Infinity : lastFlight.until - performance.now();
        if (left <= 0) lastFlight = null;
        else shownFlight = { ...lastFlight, alpha: Math.min(1, left / 1500) };
      }
      if (focus) gore.drawSpatters(hud, focus.id);
      if (focus && !free) drawSight(focus);
      hud.globalAlpha = hudCfg.opacity ?? 1;
      if (!skip.has('hud')) drawHud(hud, world, focus, W, H, { showHelp, lastFlight: shownFlight, freeLook: Boolean(free) });
      drawMessages();
      const L = lineHeight();
      const banner = (text, y, colour) => drawText(hud, text, (W - textWidth(text)) / 2, y, colour);
      if (free) {
        banner('FREE LOOK  MOUSE OR ARROWS MOVE (SHIFT FAST)  WHEEL ZOOM  V BACK', 122, '#f0e8c0');
        banner(`1 FRONT  2 BRIDGE  3 YOUR PLANE   W/S SPEED: ${free.speed}X`, 122 + L + 1, free.speed > 1 ? '#ffd870' : '#f0e8c0');
      }
      if (paused) banner('PAUSED', 142, '#f0f0e0');
      // Under the scope: the state of your own radar, then whether you're under the enemy's.
      const labels = [];
      if (radar.health <= 0) {
        if (Math.floor(performance.now() / 500) % 2) labels.push(['NO SIGNAL - RADAR STATION LOST', '#ff7050']);
        else labels.push(['', '']);
      } else if (radar.health < 1) labels.push(['RADAR DAMAGED', '#e8b060']);
      if (focus && radar.belowRadar(focus)) labels.push(['BELOW RADAR', '#8fe8a0']);
      labels.forEach(([label, colour], i) => {
        if (label) drawText(hud, label, SCOPE.x + (SCOPE.w - textWidth(label)) / 2, SCOPE.y + SCOPE.h + 2 + i * L, colour);
      });
      hud.globalAlpha = 1;
      hud.setTransform(1, 0, 0, 1, 0, 0);
      prof.mark('hud');
      radar.update(dt, focus);

      // The radar scope is scaled up smoothly for a soft phosphor glow.
      out.imageSmoothingEnabled = true;
      if (!skip.has('radar')) out.drawImage(radar.draw(performance.now() / 1000), SCOPE.x * hk, SCOPE.y * hk, SCOPE.w * hk, SCOPE.h * hk);
      out.imageSmoothingEnabled = false;
      prof.mark('radar');
    },
  };
}

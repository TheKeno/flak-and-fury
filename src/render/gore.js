// Blood and gore from soldiers hit by bullets, bombs, shells and propellers, and ground crew run down.
// Visual only (the simulation just says how a man died, in the soldierKilled, crewKilled and groundHit
// events), so Math.random is fine here.
// Everything is dark and muted. cfg is settings.gore, live from the tuning panel; mode is off, low (blood,
// stains and bodies) or full (also limbs, thrown bodies and blood on the plane).
//
// Built around a "profile" (blood colours, how many pieces a body breaks into) so animals can reuse it.

const PROFILES = {
  man: { blood: ['#5a1814', '#4a1410', '#3a100c'], pool: ['#3a100c', '#2e0c0a', '#220a08'], skin: '#a8805e' },
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const G = 140; // gravity for drops and pieces, world units/s²
const MAX = { drops: 500, stains: 500, bodies: 160, chunks: 120, planeSplats: 14 };

export function createGore(world, cfg, particles, { uniformOf, overallsOf = () => undefined, teamUniform = () => undefined }) {
  const drops = [];
  const stains = [];
  const bodies = [];
  const chunks = [];
  const planeBlood = new Map(); // plane id -> splats { lx, ly, age }
  const spatters = []; // blood thrown on the pilot's screen { plane, x, y, r, age, drip }
  const profile = PROFILES.man;
  const on = () => cfg.mode !== 'off';
  const full = () => cfg.mode === 'full';
  const push = (list, max, item) => {
    if (list.length >= max) list.shift();
    list.push(item);
  };
  const groundAt = (x) => world.terrain.heightAt(x);

  function spray(x, y, dir, n, speed) {
    for (let i = 0; i < n; i++) {
      push(drops, MAX.drops, {
        x, y, vx: dir * rand(0.2, 1) * speed + rand(-18, 18), vy: rand(0.1, 1) * speed * 0.8, life: 2,
      });
    }
  }
  function mist(x, y, n, size = 1) {
    for (let i = 0; i < n; i++) particles.spawn('mist', x + rand(-2, 2), y + rand(0, 3), rand(-20, 20), rand(5, 30), rand(0.5, 1.1), size);
  }
  const stain = (x, w) => push(stains, MAX.stains, { x, w, age: 0, life: cfg.stainLife * rand(0.7, 1.1), shade: Math.floor(rand(0, 3)) });

  function pushBody(x, dir, { head = true, legs = true, pool = 3 } = {}) {
    push(bodies, MAX.bodies, {
      x, dir: dir || (Math.random() < 0.5 ? 1 : -1), age: 0, life: cfg.bodyLife, pool, head, legs, uniform: null,
      back: Math.random() < 0.5, helmet: Math.random() < 0.6,
    });
    return bodies[bodies.length - 1];
  }

  // A flying piece. kind: arm, leg, head, helmet, torso or man (a whole body, which lands as one).
  function piece(kind, x, y, vx, vy, extra = {}) {
    push(chunks, MAX.chunks, { kind, x, y, vx, vy, rot: rand(0, 6.28), vrot: rand(-14, 14), life: cfg.bodyLife, rest: false, ...extra });
  }

  function bloodHit(e) {
    const dmg = clamp(e.damage ?? 1, 0.2, 6);
    spray(e.x, e.y, e.dir ?? 0, Math.ceil((2 + dmg * 2.5) * cfg.blood), 20 + dmg * 12);
    if (dmg > 1) mist(e.x, e.y, 2);
  }

  function kill(e, uniform = uniformOf(e.id)) {
    const dir = e.dir || (Math.random() < 0.5 ? 1 : -1);
    const gy = groundAt(e.x);
    const y = e.y + 3;
    const force = e.force ?? 1;
    const blast = e.cause === 'blast';
    const prop = e.cause === 'runDown';
    const splash = Math.ceil((8 + Math.min(force, 8) * 3) * cfg.blood);
    spray(e.x, y, dir, splash, 40 + Math.min(force, 8) * 10);
    mist(e.x, y, 2 + Math.min(4, Math.round(force)), 1);
    if (e.cause === 'other') {
      pushBody(e.x, dir).uniform = uniform;
      return;
    }
    if (!full()) {
      const b = pushBody(e.x, dir, { pool: 3 + force * 0.3 });
      b.uniform = uniform;
      return;
    }
    // How badly the man is torn apart: by what hit him, and how hard.
    const torn = prop ? 1 : clamp((force - 1) / cfg.limbForce, 0, 1);
    if (force >= cfg.mistForce) {
      // Nothing much left: a cloud, a stain, and bits.
      mist(e.x, y, 10, 1.6);
      for (const k of ['arm', 'arm', 'leg', 'head', 'torso']) if (Math.random() < 0.7) piece(k, e.x, y, dir * rand(0, 80) + rand(-40, 40), rand(40, 150), { uniform });
      for (let i = 0; i < 3; i++) stain(e.x + rand(-10, 10), rand(3, 7));
      return;
    }
    if (Math.random() < torn) {
      const lost = { arm: Math.random() < 0.7, leg: Math.random() < 0.6, head: Math.random() < 0.35 };
      if (!lost.arm && !lost.leg && !lost.head) lost.arm = true;
      const out = prop ? 0.6 : 1;
      if (lost.arm) piece('arm', e.x, y, dir * rand(20, 90) * out, rand(30, 100), { uniform });
      if (lost.leg) piece('leg', e.x, y - 2, dir * rand(10, 70) * out, rand(20, 70), { uniform });
      if (lost.head) piece('head', e.x, y + 4, dir * rand(10, 60) * out, rand(40, 110));
      const b = pushBody(e.x, dir, { head: !lost.head, legs: !lost.leg, pool: 5 + force * 0.4 });
      b.uniform = uniform;
      if (lost.arm && Math.random() < 0.5) piece('arm', e.x, y, -dir * rand(10, 50), rand(30, 80), { uniform });
    } else if (blast && Math.random() < cfg.slapstick) {
      // Dark slapstick: the blast tosses him into the air, spinning, and he comes down in a heap.
      piece('man', e.x, gy + 4, dir * rand(10, 60), rand(120, 220), { uniform, dir });
    } else pushBody(e.x, dir, { pool: 3 + force * 0.4 }).uniform = uniform;
    if (prop) {
      // A prop strike sends the helmet far up, turning over and over.
      piece('helmet', e.x, y + 2, dir * rand(20, 60), rand(130, 200), { vrot: rand(18, 30) * dir });
    }
    if (blast) mist(e.x, y, 3, 1.3);
  }

  // A pilot killed on the way down, in mid-air: worse than on the ground, and it all rains down.
  function pilotKill(e) {
    const uniform = teamUniform(e.team);
    const dir = e.dir || 1;
    if (e.cause === 'fall') return kill({ ...e, cause: 'blast', force: cfg.mistForce }, uniform);
    spray(e.x, e.y, dir, Math.ceil(70 * cfg.blood), 110);
    spray(e.x, e.y, -dir, Math.ceil(30 * cfg.blood), 70);
    mist(e.x, e.y, 16, 2);
    if (!full()) {
      pushBody(e.x, dir, { pool: 8 }).uniform = uniform;
      return;
    }
    for (const k of ['arm', 'arm', 'leg', 'leg', 'head', 'torso']) piece(k, e.x, e.y, dir * rand(-30, 110), rand(-20, 110), { uniform });
    piece('helmet', e.x, e.y + 3, dir * rand(20, 70), rand(90, 170), { vrot: rand(18, 30) * dir });
    for (let i = 0; i < 4; i++) stain(e.x + dir * rand(0, 30) + rand(-12, 12), rand(3, 8));
  }

  function addPlaneBlood(planeId, noseX) {
    const list = planeBlood.get(planeId) ?? [];
    planeBlood.set(planeId, list);
    for (let i = 0; i < 4 && cfg.mode === 'full'; i++) {
      if (list.length >= MAX.planeSplats) list.shift();
      const windscreen = Math.random() < 0.4;
      list.push({ lx: windscreen ? rand(-2, 4) : noseX - rand(0, 4), ly: windscreen ? rand(1, 3) : rand(-2.5, 2.5), age: 0 });
    }
    for (let i = 0; i < 3; i++) spatters.push({ plane: planeId, x: rand(30, 450), y: rand(20, 230), r: rand(3, 11), age: 0, drip: rand(0, 6) });
  }

  return {
    get on() {
      return on();
    },
    onEvent(e) {
      if (!on()) return;
      if (e.type === 'groundHit' && (e.kind === 'infantry' || e.kind === 'engineers')) bloodHit(e);
      else if (e.type === 'soldierKilled') kill(e);
      else if (e.type === 'pilotKilled') pilotKill(e);
      else if (e.type === 'runDown') addPlaneBlood(e.plane, world.planes.find((p) => p.id === e.plane)?.def.noseOffset?.[0] ?? 8);
      else if (e.type === 'crewKilled') {
        // A mechanic caught by the propeller of a rolling plane.
        kill(e, overallsOf(e.slot));
        if (e.cause === 'runDown') addPlaneBlood(e.plane, world.planes.find((p) => p.id === e.plane)?.def.noseOffset?.[0] ?? 8);
      }
    },
    update(dt) {
      if (!on()) return;
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i];
        d.life -= dt;
        d.vy -= G * dt;
        d.x += d.vx * dt;
        d.y += d.vy * dt;
        if (d.life <= 0 || d.y <= groundAt(d.x)) {
          if (d.life > 0 && Math.random() < 0.7) stain(d.x, rand(1, 2.5));
          drops.splice(i, 1);
        }
      }
      for (const s of stains) s.age += dt;
      for (let i = stains.length - 1; i >= 0; i--) if (stains[i].age > stains[i].life) stains.splice(i, 1);
      for (let i = bodies.length - 1; i >= 0; i--) {
        const b = bodies[i];
        b.age += dt;
        if (b.age > b.life) bodies.splice(i, 1);
      }
      for (let i = chunks.length - 1; i >= 0; i--) {
        const c = chunks[i];
        if (c.rest) {
          c.life -= dt;
          if (c.life <= 0) chunks.splice(i, 1);
          continue;
        }
        c.vy -= G * dt;
        c.x += c.vx * dt;
        c.y += c.vy * dt;
        c.rot += c.vrot * dt;
        if (Math.random() < dt * 14) push(drops, MAX.drops, { x: c.x, y: c.y, vx: c.vx * 0.3 + rand(-8, 8), vy: rand(0, 15), life: 1.5 });
        const g = groundAt(c.x);
        if (c.y > g) continue;
        c.y = g;
        if (c.kind === 'man') {
          // Lands as a body, with a thump of dust and blood.
          const b = pushBody(c.x, c.dir, { pool: 4 });
          b.uniform = c.uniform;
          spray(c.x, g + 2, 0, 10, 40);
          particles.spawn('dust', c.x, g + 1, rand(-10, 10), rand(5, 15), 0.5, 1);
          chunks.splice(i, 1);
        } else if (Math.abs(c.vy) > 25) {
          c.vy *= -0.3;
          c.vx *= 0.6;
          c.vrot *= 0.5;
          spray(c.x, g + 1, 0, 3, 25);
          stain(c.x, rand(1.5, 3));
        } else {
          c.rest = true;
          c.rot = Math.round(c.rot / Math.PI) * Math.PI; // lies flat
          if (c.kind !== 'helmet') stain(c.x, rand(2, 4));
        }
      }
      for (const list of planeBlood.values()) for (const s of list) s.age += dt;
      for (const [id, list] of planeBlood) {
        for (let i = list.length - 1; i >= 0; i--) if (list[i].age > cfg.planeBloodTime) list.splice(i, 1);
        if (!list.length) planeBlood.delete(id);
      }
      for (let i = spatters.length - 1; i >= 0; i--) {
        const s = spatters[i];
        s.age += dt;
        s.y += Math.max(0, s.age - 1) * s.drip * dt; // runs down the glass
        if (s.age > cfg.spatterTime) spatters.splice(i, 1);
      }
    },
    // Stains, bodies and pieces on the ground, then drops in the air. Sizes are in buffer pixels.
    draw(ctx, toX, toY, scale, surfaceAt, view) {
      if (!on()) return;
      const fade = (age, life) => clamp((life - age) / (life * 0.2), 0, 1);
      const colours = ['#4a1410', '#3a100c', '#2a0c0a'];
      for (const s of stains) {
        const sx = Math.round(toX(s.x));
        if (sx < -20 || sx > view + 20) continue;
        ctx.globalAlpha = fade(s.age, s.life);
        ctx.fillStyle = s.age < 6 ? colours[0] : s.age < 30 ? colours[1] : colours[2];
        ctx.fillRect(sx, Math.round(toY(surfaceAt(s.x))) + 1, Math.max(1, Math.round(s.w * scale * 0.5)), 1);
      }
      for (const b of bodies) {
        const gx = Math.round(toX(b.x));
        if (gx < -20 || gx > view + 20) continue;
        const gy = Math.round(toY(surfaceAt(b.x))) + 1;
        ctx.globalAlpha = fade(b.age, b.life);
        // The pool spreads for a few seconds, then dries dark.
        const r = Math.round(b.pool * Math.min(1, b.age / 4) * scale * 0.5);
        ctx.fillStyle = b.age < 8 ? profile.pool[0] : profile.pool[1];
        ctx.fillRect(gx - r, gy - 1, r * 2 + 1, 1);
        ctx.fillStyle = profile.pool[2];
        ctx.fillRect(gx - Math.round(r * 0.6), gy, Math.round(r * 1.2) + 1, 1);
        const d = b.dir;
        const body = b.uniform ?? '#6a6e5e';
        ctx.fillStyle = body;
        ctx.fillRect(gx - 2, gy - 2, b.legs ? 5 : 3, 2);
        if (b.legs) {
          ctx.fillStyle = '#2a2622';
          ctx.fillRect(gx - d * 3 - (d > 0 ? 0 : 1), gy - 1, 2, 1);
        } else {
          ctx.fillStyle = '#4a1410';
          ctx.fillRect(gx - d * 2 - (d > 0 ? 0 : 0), gy - 2, 1, 2);
        }
        if (b.head) {
          ctx.fillStyle = b.back ? profile.skin : '#8a6a4e';
          ctx.fillRect(gx + d * 2 - (d > 0 ? 0 : 1), gy - 2, 2, 2);
        } else {
          ctx.fillStyle = '#4a1410';
          ctx.fillRect(gx + d * 2 - (d > 0 ? 0 : 1), gy - 1, 2, 1);
        }
        ctx.fillStyle = '#3a100c';
        ctx.fillRect(gx - 1, gy - 2, 2, 1);
        if (b.helmet && b.head) {
          ctx.fillStyle = '#3a3e34';
          ctx.fillRect(gx + d * 4 - (d > 0 ? 0 : 1), gy - 1, 2, 1);
        }
      }
      for (const c of chunks) {
        const sx = toX(c.x);
        if (sx < -20 || sx > view + 20) continue;
        ctx.globalAlpha = c.rest ? clamp(c.life / (cfg.bodyLife * 0.1), 0, 1) : 1;
        drawPiece(ctx, c, sx, toY(c.y), profile);
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < drops.length; i++) {
        const d = drops[i];
        ctx.fillStyle = profile.blood[i % 3];
        ctx.fillRect(Math.round(toX(d.x)), Math.round(toY(d.y)), 1, 1);
      }
    },
    // Blood on a plane that has run soldiers down: points in the plane's frame, rotated like the sprite.
    drawPlane(ctx, p, sx, sy, angle, scale) {
      const list = planeBlood.get(p.id);
      if (!list || !on()) return;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const f = p.inverted ? -1 : 1;
      for (const b of list) {
        ctx.globalAlpha = clamp((cfg.planeBloodTime - b.age) / (cfg.planeBloodTime * 0.3), 0, 1);
        ctx.fillStyle = b.age < 6 ? '#4a1410' : '#2e0c0a';
        ctx.fillRect(Math.round(sx + (c * b.lx - s * b.ly * f) * scale), Math.round(sy - (s * b.lx + c * b.ly * f) * scale), 2, 2);
      }
      ctx.globalAlpha = 1;
    },
    // 0..1: how bloody the propeller still is.
    bloodied(planeId) {
      const list = planeBlood.get(planeId);
      return list?.length ? clamp(list.length / 4, 0.3, 1) : 0;
    },
    // Spatters on the pilot's own screen, drawn on the HUD layer (480x270).
    drawSpatters(ctx, planeId) {
      if (!on() || cfg.mode !== 'full') return;
      for (const s of spatters) {
        if (s.plane !== planeId) continue;
        ctx.globalAlpha = clamp((cfg.spatterTime - s.age) / (cfg.spatterTime * 0.4), 0, 0.75);
        ctx.fillStyle = s.age < 4 ? '#4a1410' : '#2e0c0a';
        const r = Math.round(s.r * Math.min(1, 0.5 + s.age));
        ctx.fillRect(Math.round(s.x - r), Math.round(s.y - r * 0.6), r * 2, Math.round(r * 1.2));
        ctx.fillRect(Math.round(s.x - r * 0.4), Math.round(s.y - r), Math.max(1, Math.round(r * 0.8)), r * 2);
        ctx.fillRect(Math.round(s.x), Math.round(s.y + r), 1, Math.round(Math.max(0, s.age - 1) * s.drip));
      }
      ctx.globalAlpha = 1;
    },
    clear() {
      for (const l of [drops, stains, bodies, chunks, spatters]) l.length = 0;
      planeBlood.clear();
    },
  };
}

// A piece as a few pixels rotated about its middle (buffer pixels; 1 px = half a world unit).
const PIECES = {
  arm: (u, skin) => [[-2, 0, u], [-1, 0, u], [0, 0, u], [1, 0, '#4a1410'], [2, 0, skin]],
  leg: (u) => [[-2, 0, u], [-1, 0, u], [0, 0, u], [1, 0, '#2a2622'], [2, 0, '#2a2622'], [2, -1, '#2a2622']],
  head: (u, skin) => [[0, 0, skin], [1, 0, skin], [0, 1, skin], [1, 1, skin], [0, -1, '#4a1410']],
  helmet: () => [[-1, 0, '#3a3e34'], [0, 0, '#3a3e34'], [1, 0, '#3a3e34'], [0, -1, '#3a3e34']],
  torso: (u) => [[-2, 0, u], [-1, 0, u], [0, 0, u], [1, 0, u], [-2, 1, '#4a1410'], [-1, 1, '#4a1410']],
  man: (u, skin) => [[-3, 0, '#2a2622'], [-2, 0, '#2a2622'], [-1, 0, u], [0, 0, u], [1, 0, u], [2, 0, skin], [3, 0, '#3a3e34'], [0, 1, u], [-1, 1, u]],
};

function drawPiece(ctx, c, sx, sy, profile) {
  const cos = Math.cos(c.rot);
  const sin = Math.sin(c.rot);
  const pixels = PIECES[c.kind](c.uniform ?? '#6a6e5e', profile.skin);
  for (const [px, py, colour] of pixels) {
    ctx.fillStyle = colour;
    ctx.fillRect(Math.round(sx + px * cos - py * sin), Math.round(sy - (px * sin + py * cos)), 1, 1);
  }
}

// Visual-only particles (smoke, fire, dust, debris). Not part of the simulation, so Math.random is fine here.
const KINDS = {
  smoke: { gravity: -6, drag: 0.6, colours: ['#d8d8d4', '#b4b4b0', '#8c8c88', '#6c6c68'], grow: 2.2 },
  exhaust: { gravity: -4, drag: 1.4, colours: ['#9a9a96', '#7a7a76', '#5c5c58'], grow: 1.2 },
  blacksmoke: { gravity: -10, drag: 0.8, colours: ['#4a4642', '#38342f', '#2a2723', '#4f4c48'], grow: 2.6 },
  fire: { gravity: -18, drag: 1.2, colours: ['#fff6c0', '#ffd34a', '#ff8a2a', '#d23a1a', '#5a2a1a'], grow: 1.5 },
  dust: { gravity: 6, drag: 2.0, colours: ['#b9a27c', '#9c8562', '#7d6a4e'], grow: 1.8 },
  debris: { gravity: 90, drag: 0.2, colours: ['#2a2622', '#3c3630', '#56504a'], grow: 0 },
  flakpuff: { gravity: -1.5, drag: 1.6, colours: ['#2e2c2a', '#3a3734', '#46433f', '#55524e'], grow: 1.6 },
  leaves: { gravity: 14, drag: 2.4, colours: ['#2c3324', '#262b1f', '#1e2219', '#3a3a2a'], grow: 0 },
  mist: { gravity: 8, drag: 2.2, colours: ['#5a1814', '#44110f', '#2e0b0a'], grow: 0.7 },
  spark: { gravity: 40, drag: 0.5, colours: ['#fff8d0', '#ffd060', '#ff9030'], grow: 0 },
};

export function createParticles() {
  const list = [];
  const spawn = (kind, x, y, vx, vy, life, size = 1) => {
    if (list.length > 1500) return;
    list.push({ kind: KINDS[kind], x, y, vx, vy, life, max: life, size });
  };
  const rand = (a, b) => a + Math.random() * (b - a);
  // Torn-off parts and wreckage: dark slabs that spin as they fall, bounce along the ground and lie
  // there a while. burn: trails fire and smoke while it moves (a wreck cartwheeling on).
  const pieces = [];
  const piece = (x, y, vx, vy, len, wid, burn = false) => {
    if (pieces.length > 80) pieces.shift();
    pieces.push({ x, y, vx, vy, len, wid, burn, a: rand(0, Math.PI), spin: rand(-12, 12), life: rand(6, 9), bounces: 0, colour: ['#24221f', '#2e2b27', '#38342e'][Math.floor(Math.random() * 3)] });
  };

  return {
    list,
    spawn,
    piece,
    pieces,
    explosion(x, y, power = 1) {
      for (let i = 0; i < 40 * power; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(10, 80) * power;
        spawn('fire', x, y, Math.cos(a) * s, Math.sin(a) * s * 0.7 + 20, rand(0.3, 0.9), rand(1, 3));
      }
      for (let i = 0; i < 26 * power; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = rand(5, 40);
        spawn('smoke', x, y, Math.cos(a) * s, Math.sin(a) * s * 0.5 + 15, rand(1.5, 4), rand(2, 4));
      }
      for (let i = 0; i < 18 * power; i++) {
        const a = rand(0.2, Math.PI - 0.2);
        const s = rand(40, 140);
        spawn('debris', x, y, Math.cos(a) * s, Math.sin(a) * s, rand(1, 2.5), rand(1, 2));
      }
    },
    // Earth and smoke thrown up by a ground explosion.
    dirtSpray(x, y, power = 1) {
      for (let i = 0; i < 30 * power; i++) {
        const a = rand(0.35, Math.PI - 0.35);
        const s = rand(30, 120) * power;
        spawn('dust', x, y + 1, Math.cos(a) * s * 0.6, Math.sin(a) * s, rand(0.8, 1.8), rand(1, 3));
      }
      for (let i = 0; i < 10 * power; i++) spawn('blacksmoke', x + rand(-6, 6), y + 2, rand(-8, 8), rand(10, 25), rand(2, 4), rand(2, 4));
    },
    sparks(x, y, n = 4) {
      for (let i = 0; i < n; i++) spawn('spark', x, y, rand(-50, 50), rand(-20, 50), rand(0.1, 0.3), 1);
    },
    update(dt, terrain) {
      for (let i = pieces.length - 1; i >= 0; i--) {
        const q = pieces[i];
        q.life -= dt;
        if (q.life <= 0) {
          pieces.splice(i, 1);
          continue;
        }
        const g = terrain.heightAt(q.x) + q.wid / 2;
        const resting = q.y <= g + 0.01 && Math.abs(q.vy) < 1 && Math.abs(q.vx) < 1;
        if (resting) continue;
        q.vy -= 90 * dt;
        q.vx -= q.vx * 0.15 * dt;
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.a += q.spin * dt;
        const moving = Math.abs(q.vx) + Math.abs(q.vy);
        if (q.burn && moving > 8) {
          if (Math.random() < dt * 30) spawn('fire', q.x, q.y, q.vx * 0.1, 12, rand(0.2, 0.5), rand(1, 2.2));
          if (Math.random() < dt * 14) spawn('blacksmoke', q.x, q.y, q.vx * 0.05, 8, rand(1.5, 3), rand(1.5, 2.5));
        }
        if (q.y < g) {
          // Hits the ground: digs in, throws dirt, bounces lower each time, the spin flips.
          q.y = g;
          if (moving > 20) for (let k = 0; k < 4; k++) spawn('dust', q.x, g, q.vx * 0.2 + rand(-15, 15), rand(8, 25), rand(0.5, 1.2), rand(1, 2));
          if (moving > 30 && q.burn) spawn('fire', q.x, g, 0, 20, 0.4, 2.5);
          q.vy = Math.abs(q.vy) * (q.bounces < 3 ? 0.4 : 0);
          q.vx *= 0.6;
          q.spin = -q.spin * 0.6;
          q.bounces++;
          if (Math.abs(q.vy) < 3) q.vy = 0;
          if (Math.abs(q.vx) < 2) q.vx = q.spin = 0;
        }
      }
      for (let i = list.length - 1; i >= 0; i--) {
        const p = list[i];
        p.life -= dt;
        if (p.life <= 0) {
          list.splice(i, 1);
          continue;
        }
        const k = p.kind;
        p.vx -= p.vx * k.drag * dt;
        p.vy -= p.vy * k.drag * dt + k.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.size += k.grow * dt;
        const g = terrain.heightAt(p.x);
        if (p.y < g) {
          p.y = g;
          p.vy = Math.abs(p.vy) * 0.25;
          p.vx *= 0.5;
        }
      }
    },
    // scale: buffer pixels per world unit (particle sizes are in world units).
    draw(ctx, toScreenX, toScreenY, scale = 1) {
      for (const q of pieces) {
        ctx.save();
        ctx.globalAlpha = Math.min(1, q.life / 1.5);
        ctx.translate(Math.round(toScreenX(q.x)), Math.round(toScreenY(q.y)));
        ctx.rotate(-q.a);
        ctx.fillStyle = q.colour;
        const l = Math.max(1, Math.round(q.len * scale));
        const w = Math.max(1, Math.round(q.wid * scale));
        ctx.fillRect(-l / 2, -w / 2, l, w);
        ctx.restore();
      }
      for (const p of list) {
        const t = 1 - p.life / p.max;
        const cols = p.kind.colours;
        ctx.fillStyle = cols[Math.min(cols.length - 1, Math.floor(t * cols.length))];
        const s = Math.max(1, Math.round(p.size * scale));
        ctx.fillRect(Math.round(toScreenX(p.x) - s / 2), Math.round(toScreenY(p.y) - s / 2), s, s);
      }
    },
  };
}

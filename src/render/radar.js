// Ground radar plot, shown as a green phosphor CRT scope.
//
// Like WWII radar it isn't a live picture: a beam sweeps across the map and each contact is only
// plotted when the beam passes over it, then glows and fades on the phosphor until the next sweep.
// Friendly aircraft carry IFF, so their echoes pulse; unknowns don't. Everything is the same green.
// Ground radar can't see aircraft flying very low (the low-level gap that Chain Home suffered from):
// any plane hugging the ground, friend or foe, drops off the scope when the beam next passes it.
//
// The scope is fed by your side's radar station. As the station is damaged the picture degrades: more
// noise, blotches on the phosphor, a stuttering sweep, echoes that drop out or show in the wrong place.
// When it's destroyed the tube collapses to a dot and only static is left.
//
// Drawn into its own small canvas, then scaled up smoothly onto the screen for a soft CRT glow.
import { radarHealth } from '../sim/ground.js';

export const SCOPE = { x: 132, y: 2, w: 216, h: 24 }; // position on the 480x270 HUD
const RES = 4; // scope canvas pixels per HUD pixel
export const PHOSPHOR = [110, 255, 140];

const rgba = (a) => `rgba(${PHOSPHOR[0]},${PHOSPHOR[1]},${PHOSPHOR[2]},${a.toFixed(3)})`;

export function createRadar(world, cfg) {
  const cw = SCOPE.w * RES;
  const ch = SCOPE.h * RES;
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');

  const pad = 3 * RES; // inner margin inside the bezel
  const top = world.map.ceiling + 80;
  const sx = (cw - pad * 2) / world.map.width;
  const sy = (ch - pad * 2) / top;
  const toX = (wx) => pad + wx * sx;
  const toY = (wy) => ch - pad - Math.min(wy, top) * sy;

  let sweep = 0; // beam position across the map, 0..1
  let sweeps = 0;
  let health = 1; // of your side's radar, 0..1
  let stall = 0; // seconds the damaged beam hangs before moving on
  let lostAt = null; // time (s) the radar failed, for the tube-collapse animation
  let blotches = []; // burned or glowing patches on a damaged tube
  const plots = new Map(); // plane id -> { x, y, glow, friendly, mine }

  // Static parts (bezel, faint grid, ground line) drawn once.
  const back = document.createElement('canvas');
  back.width = cw;
  back.height = ch;
  {
    const g = back.getContext('2d');
    const grad = g.createRadialGradient(cw / 2, ch / 2, ch * 0.2, cw / 2, ch / 2, cw * 0.6);
    grad.addColorStop(0, '#0b1e10');
    grad.addColorStop(1, '#030a05');
    g.fillStyle = grad;
    g.fillRect(0, 0, cw, ch);
    g.strokeStyle = rgba(0.07);
    g.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const x = Math.round(pad + ((cw - pad * 2) * i) / 8) + 0.5;
      g.beginPath();
      g.moveTo(x, pad);
      g.lineTo(x, ch - pad);
      g.stroke();
    }
    // Ceiling, dashed.
    g.setLineDash([RES * 2, RES * 2]);
    g.beginPath();
    g.moveTo(pad, toY(world.map.ceiling));
    g.lineTo(cw - pad, toY(world.map.ceiling));
    g.stroke();
    g.setLineDash([]);
    // Bezel.
    g.strokeStyle = '#2b302c';
    g.lineWidth = RES * 1.5;
    g.strokeRect(RES * 0.75, RES * 0.75, cw - RES * 1.5, ch - RES * 1.5);
    g.strokeStyle = '#0a0c0a';
    g.lineWidth = RES * 0.5;
    g.strokeRect(RES * 1.6, RES * 1.6, cw - RES * 3.2, ch - RES * 3.2);
  }

  function drawGround() {
    // The ground line is redrawn each frame since bombs dig craters.
    ctx.strokeStyle = rgba(0.28);
    ctx.lineWidth = RES * 0.6;
    ctx.beginPath();
    for (let x = pad; x <= cw - pad; x += 2) {
      const y = toY(world.terrain.heightAt((x - pad) / sx));
      if (x === pad) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    for (const af of world.map.airfields) {
      const x = toX(af.x + af.width / 2);
      const y = toY(af.height) - RES;
      ctx.fillStyle = rgba(0.45);
      ctx.fillRect(x - RES * 2, y, RES * 4, RES * 0.6);
    }
  }

  // Blotches on the tube: burned dark patches and smeary bright ones that drift and come and go, plus
  // now and then a band of interference rolling through the picture.
  function drawDamage(t, d) {
    const want = Math.round(d * 9);
    if (blotches.length !== want || Math.random() < 0.004) {
      blotches = Array.from({ length: want }, () => ({
        x: pad + Math.random() * (cw - pad * 2),
        y: pad + Math.random() * (ch - pad * 2),
        r: RES * (3 + Math.random() * 9),
        dark: Math.random() < 0.55,
        drift: (Math.random() - 0.5) * RES * 3,
        phase: Math.random() * 6,
      }));
    }
    for (const b of blotches) {
      const x = b.x + Math.sin(t * 0.4 + b.phase) * b.drift;
      const a = (b.dark ? 0.55 : 0.14 + 0.1 * Math.sin(t * 3 + b.phase)) * (0.5 + 0.5 * d);
      const g = ctx.createRadialGradient(x, b.y, 0, x, b.y, b.r);
      g.addColorStop(0, b.dark ? `rgba(0,0,0,${a.toFixed(3)})` : rgba(a));
      g.addColorStop(1, b.dark ? 'rgba(0,0,0,0)' : rgba(0));
      ctx.fillStyle = g;
      ctx.fillRect(x - b.r, b.y - b.r, b.r * 2, b.r * 2);
    }
    if (Math.sin(t * 1.7) + Math.sin(t * 4.3) > 2 - d * 1.6) {
      const y = ((t * 90) % (ch + 40)) - 20;
      ctx.fillStyle = rgba(0.06 + 0.12 * d);
      ctx.fillRect(pad, y, cw - pad * 2, RES * (1 + 2 * Math.random()));
    }
  }

  // Radar lost: the picture collapses to a bright line, then a dot, then the tube shows only faint
  // static and the odd flash as it tries to come back.
  function drawDead(t) {
    if (lostAt === null) lostAt = t;
    const since = t - lostAt;
    ctx.fillStyle = 'rgba(2,6,3,0.85)';
    ctx.fillRect(pad, pad, cw - pad * 2, ch - pad * 2);
    if (since < 0.9) {
      const k = since / 0.9;
      const w = (cw - pad * 2) * Math.max(0.01, 1 - k * 1.6);
      const h = RES * Math.max(0.4, 3 * (1 - k * 3));
      ctx.fillStyle = rgba(Math.max(0, 1 - k * 0.8));
      ctx.fillRect(cw / 2 - w / 2, ch / 2 - h / 2, w, h);
    }
    for (let i = 0; i < 140; i++) {
      ctx.fillStyle = rgba(Math.random() * 0.12);
      ctx.fillRect(pad + Math.random() * (cw - pad * 2), pad + Math.random() * (ch - pad * 2), RES * 0.5, RES * 0.5);
    }
    if (Math.random() < 0.02) {
      ctx.fillStyle = rgba(0.08);
      ctx.fillRect(pad, pad + Math.random() * (ch - pad * 2), cw - pad * 2, RES);
    }
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (let y = 0; y < ch; y += 3) ctx.fillRect(0, y, cw, 1);
    return canvas;
  }

  return {
    canvas,
    // Plane ids currently plotted (for tests).
    get plotted() {
      return [...plots.keys()];
    },
    get sweeps() {
      return sweeps;
    },
    // Strength of an enemy plane's on-screen outline: 1 as the beam sweeps it, fading to 0 over
    // cfg.outlineTime seconds (its own timer, not the phosphor's afterglow). 0 when not plotted.
    enemyGlow(id) {
      const plot = plots.get(id);
      if (!plot || plot.friendly || health <= 0) return 0;
      return Math.max(0, 1 - plot.age / Math.max(0.1, cfg.outlineTime));
    },
    // Is this plane currently below the enemy's radar?
    belowRadar: (p) => p.state === 'air' && p.y - world.terrain.heightAt(p.x) < cfg.lowGap,

    get health() {
      return health;
    },

    update(dt, focus) {
      health = focus ? radarHealth(world, focus.team) : 1;
      const d = 1 - health;
      if (health <= 0) {
        // No signal: no sweep, and the last echoes die away quickly.
        for (const [id, plot] of plots) if ((plot.glow -= dt * 2.5) <= 0) plots.delete(id);
        return;
      }
      lostAt = null;
      // A damaged set loses its timing now and then: the beam hangs, then lurches on.
      const hanging = stall > 0;
      if (hanging) {
        stall -= dt;
        if (stall <= 0) sweep = (sweep + Math.random() * 0.06 * d) % 1;
      } else if (Math.random() < d * d * dt * 2.5) stall = (0.1 + Math.random() * 0.5) * d;
      const prev = sweep;
      if (!hanging) sweep += dt / Math.max(0.2, cfg.sweepTime);
      const wrapped = sweep >= 1;
      if (wrapped) {
        sweep -= 1;
        sweeps++;
      }
      const crossed = (fx) => (wrapped ? fx >= prev || fx < sweep : fx >= prev && fx < sweep);

      for (const p of world.planes) {
        if (p.state === 'dead' || !crossed(p.x / world.map.width)) continue;
        const friendly = focus && p.team === focus.team;
        const low = p.y - world.terrain.heightAt(p.x) < cfg.lowGap;
        if (low) {
          // In the low-level gap: no echo, and the beam passing wipes the old one.
          plots.delete(p.id);
          continue;
        }
        // Damage loses some echoes altogether and throws others off.
        if (Math.random() < d * cfg.dropout) continue;
        const ex = p.x + (Math.random() - 0.5) * d * 160;
        const ey = p.y + (Math.random() - 0.5) * d * 70;
        plots.set(p.id, { x: ex, y: ey, glow: 1, age: 0, friendly, mine: p === focus, seed: Math.random() * 10 });
      }
      // A plot stays until both its phosphor glow and the on-screen outline have faded.
      for (const [id, plot] of plots) {
        plot.glow -= dt / Math.max(0.2, cfg.afterglow);
        plot.age += dt;
        if (plot.glow <= 0 && plot.age >= (cfg.outlineTime ?? 0)) plots.delete(id);
      }
    },

    draw(t) {
      ctx.drawImage(back, 0, 0);
      if (health <= 0) return drawDead(t);
      const d = 1 - health;
      const bright = 1 - 0.45 * d; // a failing set gives a dimmer picture
      drawGround();

      // Echoes: soft blobs that flare when swept and fade on the phosphor. Friendlies pulse (IFF).
      for (const plot of plots.values()) {
        if (plot.glow <= 0) continue; // kept only for the outline
        const pulse = plot.friendly ? 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 2 + plot.seed) : 1;
        const a = Math.max(0, plot.glow) ** 1.3 * pulse * bright;
        const x = toX(plot.x) + (Math.random() - 0.5) * RES * 0.4;
        const y = toY(plot.y) + (Math.random() - 0.5) * RES * 0.4;
        const r = RES * (2 + plot.glow);
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, rgba(Math.min(1, a * 1.2)));
        g.addColorStop(0.4, rgba(a * 0.5));
        g.addColorStop(1, rgba(0));
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
        if (plot.mine) {
          // The operator's marker on your own plot.
          ctx.strokeStyle = rgba(0.5 * Math.max(0.3, plot.glow));
          ctx.lineWidth = RES * 0.4;
          ctx.strokeRect(x - RES * 2.5, y - RES * 2.5, RES * 5, RES * 5);
        }
      }

      // The sweeping beam with its glowing trail.
      const bx = pad + sweep * (cw - pad * 2);
      const trail = cw * 0.07;
      const tg = ctx.createLinearGradient(bx - trail, 0, bx, 0);
      tg.addColorStop(0, rgba(0));
      tg.addColorStop(1, rgba(0.16 * bright));
      ctx.fillStyle = tg;
      ctx.fillRect(bx - trail, pad, trail, ch - pad * 2);
      ctx.fillStyle = rgba((stall > 0 ? 0.8 : 0.55) * bright);
      ctx.fillRect(bx - RES * 0.3, pad, RES * 0.6, ch - pad * 2);

      // "Grass": the flickering noise trace along the baseline, plus stray speckles.
      // Damage makes it taller and adds far more speckle.
      ctx.fillStyle = rgba(0.35);
      for (let x = pad; x < cw - pad; x += RES) {
        const h = Math.random() ** (3 - 1.5 * d) * RES * (2.5 + 6 * d);
        ctx.fillRect(x, ch - pad - h, RES * 0.5, h);
      }
      for (let i = 0; i < 6 + 90 * d; i++) {
        ctx.fillStyle = rgba(Math.random() * 0.25);
        ctx.fillRect(pad + Math.random() * (cw - pad * 2), pad + Math.random() * (ch - pad * 2), RES * 0.6, RES * 0.6);
      }

      if (d > 0.05) drawDamage(t, d);

      // Scanlines and a slight overall flicker.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 0; y < ch; y += 3) ctx.fillRect(0, y, cw, 1);
      ctx.fillStyle = `rgba(0,0,0,${(Math.random() * 0.05).toFixed(3)})`;
      ctx.fillRect(0, 0, cw, ch);
      return canvas;
    },
  };
}

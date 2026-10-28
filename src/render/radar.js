// Ground radar plot, shown as a green phosphor CRT scope.
//
// Like WWII radar it isn't a live picture: a beam sweeps across the map and each contact is only
// plotted when the beam passes over it, then glows and fades on the phosphor until the next sweep.
// Friendly aircraft carry IFF, so their echoes pulse; unknowns don't. Everything is the same green.
// Ground radar can't see aircraft flying very low (the low-level gap that Chain Home suffered from),
// so enemies hugging the ground vanish from your scope, and you vanish from theirs.
//
// Drawn into its own small canvas, then scaled up smoothly onto the screen for a soft CRT glow.

export const SCOPE = { x: 132, y: 2, w: 216, h: 24 }; // position on the 480x270 HUD
const RES = 4; // scope canvas pixels per HUD pixel
const PHOSPHOR = [110, 255, 140];

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

  return {
    canvas,
    get sweeps() {
      return sweeps;
    },
    // Is this plane currently below the enemy's radar?
    belowRadar: (p) => p.state === 'air' && p.y - world.terrain.heightAt(p.x) < cfg.lowGap,

    update(dt, focus) {
      const prev = sweep;
      sweep += dt / Math.max(0.2, cfg.sweepTime);
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
        if (!friendly && low) continue; // in the low-level gap: no echo
        plots.set(p.id, { x: p.x, y: p.y, glow: 1, friendly, mine: p === focus, seed: Math.random() * 10 });
      }
      for (const [id, plot] of plots) {
        plot.glow -= dt / Math.max(0.2, cfg.afterglow);
        if (plot.glow <= 0) plots.delete(id);
      }
    },

    draw(t) {
      ctx.drawImage(back, 0, 0);
      drawGround();

      // Echoes: soft blobs that flare when swept and fade on the phosphor. Friendlies pulse (IFF).
      for (const plot of plots.values()) {
        const pulse = plot.friendly ? 0.55 + 0.45 * Math.sin(t * 2 * Math.PI * 2 + plot.seed) : 1;
        const a = Math.max(0, plot.glow) ** 1.3 * pulse;
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
      tg.addColorStop(1, rgba(0.16));
      ctx.fillStyle = tg;
      ctx.fillRect(bx - trail, pad, trail, ch - pad * 2);
      ctx.fillStyle = rgba(0.55);
      ctx.fillRect(bx - RES * 0.3, pad, RES * 0.6, ch - pad * 2);

      // "Grass": the flickering noise trace along the baseline, plus stray speckles.
      ctx.fillStyle = rgba(0.35);
      for (let x = pad; x < cw - pad; x += RES) {
        const h = Math.random() ** 3 * RES * 2.5;
        ctx.fillRect(x, ch - pad - h, RES * 0.5, h);
      }
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = rgba(Math.random() * 0.25);
        ctx.fillRect(pad + Math.random() * (cw - pad * 2), pad + Math.random() * (ch - pad * 2), RES * 0.6, RES * 0.6);
      }

      // Scanlines and a slight overall flicker.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (let y = 0; y < ch; y += 3) ctx.fillRect(0, y, cw, 1);
      ctx.fillStyle = `rgba(0,0,0,${(Math.random() * 0.05).toFixed(3)})`;
      ctx.fillRect(0, 0, cw, ch);
      return canvas;
    },
  };
}

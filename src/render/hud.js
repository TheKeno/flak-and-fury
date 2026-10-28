import { drawText, textWidth } from './font.js';

const TEAM_COLOURS = ['#7fb2ff', '#ff7a6a', '#ffd25a', '#8be08b'];

function bar(ctx, x, y, w, value, colour) {
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fillRect(x, y, w + 2, 4);
  ctx.fillStyle = colour;
  ctx.fillRect(x + 1, y + 1, Math.round(w * value), 2);
}

function radar(ctx, world, W, focus) {
  const rw = 200;
  const rh = 14;
  const rx = Math.round((W - rw) / 2);
  const ry = 3;
  const sx = rw / world.map.width;
  const top = world.map.ceiling + 80;
  const sy = rh / top;
  ctx.fillStyle = 'rgba(10,16,20,0.55)';
  ctx.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
  ctx.fillStyle = 'rgba(60,80,50,0.9)';
  for (let x = 0; x < rw; x++) {
    const h = world.terrain.heightAt(x / sx) * sy;
    ctx.fillRect(rx + x, ry + rh - Math.round(h), 1, Math.round(h));
  }
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fillRect(rx, ry + rh - Math.round(world.map.ceiling * sy), rw, 1);
  for (const af of world.map.airfields) {
    ctx.fillStyle = TEAM_COLOURS[af.team];
    ctx.fillRect(rx + Math.round((af.x + af.width / 2) * sx) - 2, ry + rh - Math.round(af.height * sy) - 1, 4, 1);
  }
  for (const p of world.planes) {
    if (p.state === 'dead') continue;
    const blink = p === focus && Math.floor(performance.now() / 250) % 2;
    ctx.fillStyle = blink ? '#ffffff' : TEAM_COLOURS[p.team];
    ctx.fillRect(rx + Math.round(p.x * sx) - 1, ry + rh - Math.round(Math.min(p.y, top) * sy) - 1, 2, 2);
  }
}

export function drawHud(ctx, world, plane, W, H, { showHelp }) {
  radar(ctx, world, W, plane);
  if (!plane) return;

  const x = 6;
  let y = 6;
  const speedKmh = Math.round(plane.speed * 3.6 * 0.4 * 3.2); // display scale, not physics
  drawText(ctx, `SPD ${speedKmh}`, x, y, '#e8f0e0');
  y += 7;
  drawText(ctx, `ALT ${Math.max(0, Math.round((plane.y - world.terrain.heightAt(plane.x)) * 4))}`, x, y, '#e8f0e0');
  y += 7;
  drawText(ctx, `RPM ${Math.round(plane.rpm / 10) * 10}`, x, y, '#e8f0e0');
  y += 8;
  drawText(ctx, 'THR', x, y, '#c8d0c0');
  bar(ctx, x + 14, y + 1, 30, plane.throttle, '#e8c860');
  y += 7;
  const hp = Math.max(0, plane.hp / plane.def.hp);
  drawText(ctx, 'DMG', x, y, '#c8d0c0');
  bar(ctx, x + 14, y + 1, 30, hp, hp < 0.35 ? '#e05040' : hp < 0.6 ? '#e0a040' : '#80d070');
  if (plane.burning && Math.floor(performance.now() / 200) % 2) drawText(ctx, 'FIRE', x + 48, y, '#ff7040');
  y += 7;
  const rounds = plane.guns.reduce((n, g) => n + g.ammo, 0);
  drawText(ctx, `GUN ${Math.floor(rounds)}`, x, y, rounds > 0 ? '#e8f0e0' : '#e05040');
  y += 7;
  if (plane.bombs) {
    drawText(ctx, `BMB ${plane.bombs.count}`, x, y, plane.bombs.count > 0 ? '#e8f0e0' : '#808880');
    y += 7;
  }
  drawText(ctx, `KILLS ${plane.kills}  LOST ${plane.deaths}`, x, y, '#e8c860');
  y += 8;
  if (plane.consciousness < 1) {
    drawText(ctx, 'PLT', x, y, '#c8d0c0');
    bar(ctx, x + 14, y + 1, 30, plane.consciousness, plane.consciousness < 0.4 ? '#e05040' : '#80c0e0');
  }

  const blink = Math.floor(performance.now() / 300) % 2 === 0;
  const centre = (str, cy, colour) => drawText(ctx, str, Math.round((W - textWidth(str)) / 2), cy, colour);
  if (plane.state === 'dead') centre('CRASHED - BACK TO THE HANGAR', 60, '#ff9070');
  else if (plane.dying) centre('GOING DOWN!', 60, blink ? '#ff6050' : '#ffb0a0');
  else if (plane.blackout) centre('BLACKOUT - TAP A/D!', 60, blink ? '#ff6050' : '#ffb0a0');
  else if (plane.y > world.map.ceiling) centre('TOO HIGH', 60, blink ? '#ffd060' : '#fff0c0');
  else if (plane.stalled && plane.state === 'air') centre('STALL', 60, blink ? '#ff6050' : '#ffc0b0');
  else if (plane.state === 'ground' && plane.speed < 1 && plane.throttle < 0.05) centre('HOLD W TO OPEN THROTTLE', 60, '#f0f0e0');

  if (showHelp) {
    const lines = [
      'A/D  ROTATE LEFT / RIGHT',
      'W/S  THROTTLE',
      'L.SHIFT  ROLL / TURN ON GROUND',
      'SPACE  GUNS   E  BOMBS',
      'M  MUTE   T  TUNING   H  HIDE HELP',
    ];
    lines.forEach((l, i) => drawText(ctx, l, 6, H - 8 - (lines.length - 1 - i) * 7, '#f0f0e0'));
  }
}
